/**
 * Cache type definitions for the dual-layer caching system
 */

/**
 * Configuration for a cache entry type
 */
export interface CacheConfig {
  /** Time-to-live for Cache API in seconds */
  cacheTtl: number;
  /** Time-to-live for KV storage in seconds */
  kvTtl: number;
  /** Stale-while-revalidate window in seconds */
  swrWindow: number;
  /** Cache key prefix for namespacing */
  keyPrefix: string;
}

/**
 * Result of a cache lookup operation
 */
export interface CacheResult<T = unknown> {
  /** The cached data */
  data: T;
  /** Where the data was retrieved from */
  source: CacheSource;
  /** Whether the data is stale (within SWR window) */
  isStale: boolean;
}

/**
 * Possible sources for cached data
 */
export type CacheSource = 'cache-api' | 'kv' | 'upstream';

/**
 * Metadata stored alongside cached data in KV
 */
export interface CacheMetadata {
  /** Timestamp when the data was cached */
  cachedAt: number;
  /** TTL in seconds */
  ttl: number;
  /** SWR window in seconds */
  swrWindow: number;
}

/**
 * Extended environment bindings with cache namespaces
 */
export interface Env {
  ENVIRONMENT: string;
  ALLOWED_ORIGINS: string;
  UNIVERSALIS_API_BASE: string;
  RATE_LIMIT_REQUESTS: string;
  RATE_LIMIT_WINDOW_SECONDS: string;
  /** KV namespace for price data caching */
  PRICE_CACHE?: KVNamespace;
  /** KV namespace for static data caching (data-centers, worlds) */
  STATIC_CACHE?: KVNamespace;
}
