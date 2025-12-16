/**
 * CacheService - Manages dual-layer caching with Cache API and KV
 *
 * Layer 1: Cloudflare Cache API (edge-local, fast, free)
 * Layer 2: Cloudflare KV (global, persistent)
 */

import type { CacheConfig, CacheMetadata } from '../types/cache';

/**
 * Result from Cache API lookup
 */
interface CacheApiResult {
  response: Response;
  isStale: boolean;
}

/**
 * Result from KV lookup
 */
interface KvResult<T = unknown> {
  data: T;
  isStale: boolean;
}

/**
 * CacheService handles all caching operations for both Cache API and KV storage
 */
export class CacheService {
  private cache: Cache | null = null;
  private kv: KVNamespace | undefined;
  private ctx: ExecutionContext;
  private baseUrl: string;
  private cacheInitPromise: Promise<Cache> | null = null;

  constructor(kv: KVNamespace | undefined, ctx: ExecutionContext, baseUrl: string) {
    this.kv = kv;
    this.ctx = ctx;
    this.baseUrl = baseUrl;
  }

  /**
   * Get the default cache (lazy initialization)
   */
  private async getCache(): Promise<Cache | null> {
    // Cache API is not available in local development
    if (typeof caches === 'undefined') {
      return null;
    }

    if (this.cache) {
      return this.cache;
    }

    if (!this.cacheInitPromise) {
      this.cacheInitPromise = caches.open('universalis-proxy');
    }

    this.cache = await this.cacheInitPromise;
    return this.cache;
  }

  /**
   * Build a Cache API-compatible URL from a cache key
   * Cache API requires full URLs as keys
   */
  private buildCacheUrl(key: string): string {
    return `${this.baseUrl}/__cache/${encodeURIComponent(key)}`;
  }

  /**
   * Get data from Cache API (Layer 1)
   * Returns null if not found or expired beyond SWR window
   */
  async getFromCacheApi(key: string): Promise<CacheApiResult | null> {
    const cache = await this.getCache();
    if (!cache) return null;

    try {
      const cacheUrl = this.buildCacheUrl(key);
      const cacheRequest = new Request(cacheUrl);

      const cached = await cache.match(cacheRequest);
      if (!cached) return null;

      // Extract cache metadata from headers
      const cachedAt = parseInt(cached.headers.get('X-Cached-At') || '0', 10);
      const ttl = parseInt(cached.headers.get('X-Cache-TTL') || '0', 10);
      const swrWindow = parseInt(cached.headers.get('X-SWR-Window') || '0', 10);

      const now = Date.now();
      const age = (now - cachedAt) / 1000;
      const isExpired = age > ttl;
      const isWithinSwr = age <= ttl + swrWindow;

      // If beyond SWR window, delete from cache and return null
      if (isExpired && !isWithinSwr) {
        this.ctx.waitUntil(cache.delete(cacheRequest));
        return null;
      }

      return {
        response: cached.clone(),
        isStale: isExpired,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get data from KV storage (Layer 2)
   * Returns null if not found or expired beyond SWR window
   */
  async getFromKv<T = unknown>(key: string): Promise<KvResult<T> | null> {
    if (!this.kv) return null;

    try {
      const result = await this.kv.getWithMetadata<T, CacheMetadata>(key, 'json');
      if (!result.value || !result.metadata) return null;

      const now = Date.now();
      const age = (now - result.metadata.cachedAt) / 1000;
      const isExpired = age > result.metadata.ttl;
      const isWithinSwr = age <= result.metadata.ttl + result.metadata.swrWindow;

      // If beyond SWR window, delete and return null
      if (isExpired && !isWithinSwr) {
        this.ctx.waitUntil(this.kv.delete(key));
        return null;
      }

      return {
        data: result.value,
        isStale: isExpired,
      };
    } catch {
      return null;
    }
  }

  /**
   * Store data in Cache API
   */
  async storeToCacheApi(key: string, data: unknown, config: CacheConfig): Promise<void> {
    const cache = await this.getCache();
    if (!cache) return;

    try {
      const cacheUrl = this.buildCacheUrl(key);
      const now = Date.now();

      const response = new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json',
          // Set max-age to include SWR window so response isn't evicted too early
          'Cache-Control': `public, max-age=${config.cacheTtl + config.swrWindow}`,
          'X-Cached-At': String(now),
          'X-Cache-TTL': String(config.cacheTtl),
          'X-SWR-Window': String(config.swrWindow),
        },
      });

      await cache.put(new Request(cacheUrl), response);
    } catch {
      // Cache storage failed, continue without it
    }
  }

  /**
   * Store data in KV storage
   */
  async storeToKv(key: string, data: unknown, config: CacheConfig): Promise<void> {
    if (!this.kv) return;

    try {
      const metadata: CacheMetadata = {
        cachedAt: Date.now(),
        ttl: config.kvTtl,
        swrWindow: config.swrWindow,
      };

      await this.kv.put(key, JSON.stringify(data), {
        // Set expiration to include SWR window
        expirationTtl: config.kvTtl + config.swrWindow,
        metadata,
      });
    } catch {
      // KV storage failed, continue without it
    }
  }

  /**
   * Store data to both cache layers asynchronously (non-blocking)
   */
  storeToAll(key: string, data: unknown, config: CacheConfig): void {
    this.ctx.waitUntil(
      Promise.all([
        this.storeToCacheApi(key, data, config).catch(() => {}),
        this.storeToKv(key, data, config).catch(() => {}),
      ])
    );
  }

  /**
   * Delete data from both cache layers
   */
  deleteFromAll(key: string): void {
    this.ctx.waitUntil(
      Promise.all([
        this.deleteFromCacheApi(key).catch(() => {}),
        this.deleteFromKv(key).catch(() => {}),
      ])
    );
  }

  /**
   * Delete data from Cache API
   */
  private async deleteFromCacheApi(key: string): Promise<void> {
    const cache = await this.getCache();
    if (!cache) return;

    const cacheUrl = this.buildCacheUrl(key);
    await cache.delete(new Request(cacheUrl));
  }

  /**
   * Delete data from KV
   */
  private async deleteFromKv(key: string): Promise<void> {
    if (!this.kv) return;
    await this.kv.delete(key);
  }
}
