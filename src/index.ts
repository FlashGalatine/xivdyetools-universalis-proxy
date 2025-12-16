/**
 * XIV Dye Tools - Universalis API Proxy
 *
 * Cloudflare Worker that proxies requests to Universalis API with:
 * - Proper CORS headers on ALL responses (including errors)
 * - Dual-layer caching (Cache API + KV) for optimal performance
 * - Request coalescing to prevent duplicate upstream requests
 * - Stale-while-revalidate for fast responses during cache refresh
 *
 * @module xivdyetools-universalis-proxy
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types/cache';
import { CACHE_CONFIGS } from './config/cache';
import { cachedFetch, buildCacheHeaders, UpstreamError } from './services/cached-fetch';

/**
 * Retry-After header value when rate limited (seconds)
 */
const RATE_LIMIT_RETRY_AFTER = 60;

const app = new Hono<{ Bindings: Env }>();

// =============================================================================
// CORS Middleware - Applied to ALL responses including errors
// =============================================================================

app.use('*', async (c, next) => {
  const allowedOrigins = c.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  const origin = c.req.header('Origin') || '';

  // Check if origin is allowed
  const isAllowed =
    c.env.ENVIRONMENT === 'development'
      ? // In development, allow localhost on any port
        origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')
      : allowedOrigins.includes(origin);

  // Apply CORS middleware with dynamic origin
  return cors({
    origin: isAllowed ? origin : allowedOrigins[0],
    allowMethods: ['GET', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Accept'],
    maxAge: 86400, // Cache preflight for 24 hours
    credentials: false,
  })(c, next);
});

// =============================================================================
// Health Check
// =============================================================================

app.get('/', (c) => {
  return c.json({
    name: 'xivdyetools-universalis-proxy',
    status: 'ok',
    environment: c.env.ENVIRONMENT,
    version: '1.1.0',
  });
});

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

// =============================================================================
// Universalis API Proxy Routes
// =============================================================================

/**
 * Normalize item IDs for consistent cache keys
 * Sorts IDs numerically to ensure same items in different order hit same cache
 */
function normalizeItemIds(itemIds: string): string {
  return itemIds
    .split(',')
    .map(Number)
    .filter((n) => !isNaN(n) && n > 0)
    .sort((a, b) => a - b)
    .join(',');
}

/**
 * Proxy aggregated price data endpoint
 * GET /api/v2/aggregated/:datacenter/:itemIds
 *
 * Features:
 * - Dual-layer caching (Cache API + KV)
 * - Request coalescing for duplicate requests
 * - Stale-while-revalidate for fast responses
 * - Normalized cache keys for better hit rates
 */
app.get('/api/v2/aggregated/:datacenter/:itemIds', async (c) => {
  const { datacenter, itemIds } = c.req.param();

  // Validate datacenter (alphanumeric only)
  if (!/^[a-zA-Z0-9]+$/.test(datacenter)) {
    return c.json({ error: 'Invalid datacenter parameter' }, 400);
  }

  // Validate itemIds (comma-separated numbers only)
  if (!/^[\d,]+$/.test(itemIds)) {
    return c.json({ error: 'Invalid itemIds parameter' }, 400);
  }

  // Normalize cache key for better cache hit rates
  // - Lowercase datacenter for consistency
  // - Sort item IDs so [1,2,3] and [3,1,2] hit same cache
  const normalizedIds = normalizeItemIds(itemIds);
  const cacheKey = `aggregated:${datacenter.toLowerCase()}:${normalizedIds}`;
  const config = CACHE_CONFIGS.aggregated;

  try {
    const result = await cachedFetch({
      cacheKey,
      config,
      upstreamUrl: `${c.env.UNIVERSALIS_API_BASE}/aggregated/${datacenter}/${itemIds}`,
      ctx: c.executionCtx,
      kv: c.env.PRICE_CACHE,
      baseUrl: new URL(c.req.url).origin,
    });

    return c.json(result.data, 200, buildCacheHeaders(result.source, result.isStale, config));
  } catch (error) {
    // Handle upstream errors specifically
    if (error instanceof UpstreamError) {
      // Handle rate limiting from upstream
      if (error.status === 429) {
        return c.json(
          {
            error: 'Rate limited by upstream API',
            retryAfter: RATE_LIMIT_RETRY_AFTER,
            message: 'Please try again later',
          },
          429,
          {
            'Retry-After': String(RATE_LIMIT_RETRY_AFTER),
          }
        );
      }

      return c.json(
        {
          error: `Upstream API error: ${error.status}`,
          message: error.statusText,
        },
        error.status as 400 | 404 | 500 | 502 | 503
      );
    }

    console.error('Error proxying to Universalis:', error);
    return c.json(
      {
        error: 'Failed to fetch from upstream API',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      502
    );
  }
});

/**
 * Proxy data centers list
 * GET /api/v2/data-centers
 *
 * Features:
 * - 24-hour cache TTL (data rarely changes)
 * - 6-hour stale-while-revalidate window
 */
app.get('/api/v2/data-centers', async (c) => {
  const cacheKey = 'data-centers:all';
  const config = CACHE_CONFIGS.dataCenters;

  try {
    const result = await cachedFetch({
      cacheKey,
      config,
      upstreamUrl: `${c.env.UNIVERSALIS_API_BASE}/data-centers`,
      ctx: c.executionCtx,
      kv: c.env.STATIC_CACHE,
      baseUrl: new URL(c.req.url).origin,
    });

    return c.json(result.data, 200, buildCacheHeaders(result.source, result.isStale, config));
  } catch (error) {
    if (error instanceof UpstreamError) {
      return c.json(
        { error: `Upstream API error: ${error.status}` },
        error.status as 400 | 404 | 500 | 502 | 503
      );
    }

    console.error('Error fetching data centers:', error);
    return c.json({ error: 'Failed to fetch data centers' }, 502);
  }
});

/**
 * Proxy worlds list
 * GET /api/v2/worlds
 *
 * Features:
 * - 24-hour cache TTL (data rarely changes)
 * - 6-hour stale-while-revalidate window
 */
app.get('/api/v2/worlds', async (c) => {
  const cacheKey = 'worlds:all';
  const config = CACHE_CONFIGS.worlds;

  try {
    const result = await cachedFetch({
      cacheKey,
      config,
      upstreamUrl: `${c.env.UNIVERSALIS_API_BASE}/worlds`,
      ctx: c.executionCtx,
      kv: c.env.STATIC_CACHE,
      baseUrl: new URL(c.req.url).origin,
    });

    return c.json(result.data, 200, buildCacheHeaders(result.source, result.isStale, config));
  } catch (error) {
    if (error instanceof UpstreamError) {
      return c.json(
        { error: `Upstream API error: ${error.status}` },
        error.status as 400 | 404 | 500 | 502 | 503
      );
    }

    console.error('Error fetching worlds:', error);
    return c.json({ error: 'Failed to fetch worlds' }, 502);
  }
});

// =============================================================================
// 404 Handler
// =============================================================================

app.notFound((c) => {
  return c.json(
    {
      error: 'Not Found',
      message: 'The requested endpoint does not exist',
      availableEndpoints: [
        '/api/v2/aggregated/:datacenter/:itemIds',
        '/api/v2/data-centers',
        '/api/v2/worlds',
      ],
    },
    404
  );
});

// =============================================================================
// Global Error Handler
// =============================================================================

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json(
    {
      error: 'Internal Server Error',
      message: c.env.ENVIRONMENT === 'development' ? err.message : 'An unexpected error occurred',
    },
    500
  );
});

export default app;
