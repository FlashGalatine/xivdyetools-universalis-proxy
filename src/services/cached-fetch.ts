/**
 * Cached Fetch - Main orchestration for the dual-layer caching system
 *
 * This module orchestrates the cache lookup flow:
 * 1. Check Cache API (fastest, edge-local)
 * 2. Check KV (global, persistent)
 * 3. Coalesce and fetch from upstream
 * 4. Store results back to both cache layers
 *
 * Implements stale-while-revalidate pattern for better performance.
 */

import { CacheService } from './cache-service';
import { RequestCoalescer } from './request-coalescer';
import type { CacheConfig, CacheResult, CacheSource } from '../types/cache';

/**
 * Options for cached fetch
 */
export interface CachedFetchOptions {
  /** Unique cache key for this request */
  cacheKey: string;
  /** Cache configuration for this endpoint type */
  config: CacheConfig;
  /** Full URL to the upstream API */
  upstreamUrl: string;
  /** Worker execution context */
  ctx: ExecutionContext;
  /** KV namespace for caching (optional) */
  kv?: KVNamespace;
  /** Base URL for Cache API synthetic URLs */
  baseUrl: string;
}

/**
 * User-Agent header for upstream requests
 */
const USER_AGENT = 'XIVDyeTools/1.0 (https://xivdyetools.projectgalatine.com)';

/**
 * Main cached fetch function - orchestrates all cache layers
 *
 * @returns CacheResult with data, source, and staleness info
 * @throws Error if upstream fetch fails and no cached data available
 */
export async function cachedFetch<T = unknown>(
  options: CachedFetchOptions
): Promise<CacheResult<T>> {
  const { cacheKey, config, upstreamUrl, ctx, kv, baseUrl } = options;

  const cacheService = new CacheService(kv, ctx, baseUrl);
  const coalescer = new RequestCoalescer(ctx);

  // Layer 1: Check Cache API
  const cacheApiResult = await cacheService.getFromCacheApi(cacheKey);
  if (cacheApiResult) {
    const data = (await cacheApiResult.response.json()) as T;

    if (cacheApiResult.isStale) {
      // Trigger background revalidation, but return stale data immediately
      ctx.waitUntil(
        revalidateInBackground(cacheKey, upstreamUrl, cacheService, config, coalescer)
      );
    }

    return {
      data,
      source: 'cache-api',
      isStale: cacheApiResult.isStale,
    };
  }

  // Layer 2: Check KV
  const kvResult = await cacheService.getFromKv<T>(cacheKey);
  if (kvResult) {
    // Populate Cache API for faster future hits (async)
    cacheService.storeToAll(cacheKey, kvResult.data, config);

    if (kvResult.isStale) {
      // Trigger background revalidation
      ctx.waitUntil(
        revalidateInBackground(cacheKey, upstreamUrl, cacheService, config, coalescer)
      );
    }

    return {
      data: kvResult.data,
      source: 'kv',
      isStale: kvResult.isStale,
    };
  }

  // Layer 3: Fetch from upstream with request coalescing
  const data = await coalescer.coalesce<T>(cacheKey, async () => {
    const response = await fetchFromUpstream(upstreamUrl);

    if (!response.ok) {
      throw new UpstreamError(response.status, response.statusText);
    }

    return response.json() as Promise<T>;
  });

  // Populate all cache layers (async)
  cacheService.storeToAll(cacheKey, data, config);

  return {
    data,
    source: 'upstream',
    isStale: false,
  };
}

/**
 * Fetch from upstream Universalis API
 */
async function fetchFromUpstream(url: string): Promise<Response> {
  return fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });
}

/**
 * Revalidate cached data in the background
 * This is called when serving stale data to refresh the cache
 */
async function revalidateInBackground(
  cacheKey: string,
  upstreamUrl: string,
  cacheService: CacheService,
  config: CacheConfig,
  coalescer: RequestCoalescer
): Promise<void> {
  const revalidateKey = `revalidate:${cacheKey}`;

  try {
    // Use coalescing to prevent multiple simultaneous revalidations
    const data = await coalescer.coalesce(revalidateKey, async () => {
      const response = await fetchFromUpstream(upstreamUrl);

      if (!response.ok) {
        throw new Error(`Revalidation failed: ${response.status}`);
      }

      return response.json();
    });

    // Update cache with fresh data
    cacheService.storeToAll(cacheKey, data, config);
  } catch {
    // Revalidation failed silently - stale data will continue to be served
    // until it expires beyond the SWR window
  }
}

/**
 * Custom error for upstream API failures
 */
export class UpstreamError extends Error {
  status: number;
  statusText: string;

  constructor(status: number, statusText: string) {
    super(`Upstream API error: ${status} ${statusText}`);
    this.name = 'UpstreamError';
    this.status = status;
    this.statusText = statusText;
  }
}

/**
 * Build response headers for cache debugging
 */
export function buildCacheHeaders(
  source: CacheSource,
  isStale: boolean,
  config: CacheConfig
): Record<string, string> {
  return {
    'X-Cache': source === 'upstream' ? 'MISS' : 'HIT',
    'X-Cache-Source': source,
    'X-Cache-Stale': isStale ? 'true' : 'false',
    'Cache-Control': `public, max-age=${config.cacheTtl}`,
  };
}
