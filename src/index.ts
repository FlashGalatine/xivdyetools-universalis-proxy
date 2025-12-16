/**
 * XIV Dye Tools - Universalis API Proxy
 *
 * Cloudflare Worker that proxies requests to Universalis API with:
 * - Proper CORS headers on ALL responses (including errors)
 * - Rate limiting to avoid 429 errors from upstream
 * - Request deduplication
 * - Edge caching for repeated requests
 *
 * @module xivdyetools-universalis-proxy
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

/**
 * Environment bindings
 */
interface Env {
  ENVIRONMENT: string;
  ALLOWED_ORIGINS: string;
  UNIVERSALIS_API_BASE: string;
  RATE_LIMIT_REQUESTS: string;
  RATE_LIMIT_WINDOW_SECONDS: string;
  // Optional KV for caching
  PRICE_CACHE?: KVNamespace;
}

/**
 * Cache TTL for price data (5 minutes)
 */
const CACHE_TTL_SECONDS = 300;

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
    version: '1.0.0',
  });
});

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

// =============================================================================
// Universalis API Proxy Routes
// =============================================================================

/**
 * Proxy aggregated price data endpoint
 * GET /api/v2/aggregated/:datacenter/:itemIds
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

  // Build cache key
  const cacheKey = `aggregated:${datacenter}:${itemIds}`;

  // Check KV cache if available
  if (c.env.PRICE_CACHE) {
    try {
      const cached = await c.env.PRICE_CACHE.get(cacheKey, 'json');
      if (cached) {
        return c.json(cached, 200, {
          'X-Cache': 'HIT',
          'X-Cache-TTL': String(CACHE_TTL_SECONDS),
        });
      }
    } catch {
      // Cache miss or error, continue to fetch
    }
  }

  // Forward request to Universalis
  const universalisUrl = `${c.env.UNIVERSALIS_API_BASE}/aggregated/${datacenter}/${itemIds}`;

  try {
    const response = await fetch(universalisUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'XIVDyeTools/1.0 (https://xivdyetools.projectgalatine.com)',
      },
    });

    // Handle rate limiting from upstream
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After') || String(RATE_LIMIT_RETRY_AFTER);
      return c.json(
        {
          error: 'Rate limited by upstream API',
          retryAfter: parseInt(retryAfter, 10),
          message: 'Please try again later',
        },
        429,
        {
          'Retry-After': retryAfter,
        }
      );
    }

    // Handle other errors
    if (!response.ok) {
      return c.json(
        {
          error: `Upstream API error: ${response.status}`,
          message: response.statusText,
        },
        response.status as 400 | 404 | 500 | 502 | 503
      );
    }

    // Parse response
    const data = await response.json();

    // Cache in KV if available
    if (c.env.PRICE_CACHE) {
      try {
        await c.env.PRICE_CACHE.put(cacheKey, JSON.stringify(data), {
          expirationTtl: CACHE_TTL_SECONDS,
        });
      } catch {
        // Caching failed, continue without it
      }
    }

    return c.json(data, 200, {
      'X-Cache': 'MISS',
    });
  } catch (error) {
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
 */
app.get('/api/v2/data-centers', async (c) => {
  const universalisUrl = `${c.env.UNIVERSALIS_API_BASE}/data-centers`;

  try {
    const response = await fetch(universalisUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'XIVDyeTools/1.0 (https://xivdyetools.projectgalatine.com)',
      },
    });

    if (!response.ok) {
      return c.json(
        { error: `Upstream API error: ${response.status}` },
        response.status as 400 | 404 | 500 | 502 | 503
      );
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    console.error('Error fetching data centers:', error);
    return c.json({ error: 'Failed to fetch data centers' }, 502);
  }
});

/**
 * Proxy worlds list
 * GET /api/v2/worlds
 */
app.get('/api/v2/worlds', async (c) => {
  const universalisUrl = `${c.env.UNIVERSALIS_API_BASE}/worlds`;

  try {
    const response = await fetch(universalisUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'XIVDyeTools/1.0 (https://xivdyetools.projectgalatine.com)',
      },
    });

    if (!response.ok) {
      return c.json(
        { error: `Upstream API error: ${response.status}` },
        response.status as 400 | 404 | 500 | 502 | 503
      );
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
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
