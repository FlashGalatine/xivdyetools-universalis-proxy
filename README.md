# XIV Dye Tools - Universalis Proxy

Cloudflare Worker that proxies requests to the Universalis API with proper CORS support.

## Problem Solved

When the Universalis API returns a 429 (Too Many Requests) error, it doesn't include CORS headers. This causes browsers to block the response entirely, making it impossible for client-side JavaScript to handle rate limiting gracefully.

This proxy:
1. Forwards requests to Universalis API
2. **Always** includes CORS headers on responses (including errors)
3. Adds optional edge caching via Cloudflare KV
4. Returns meaningful error responses that clients can handle

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Health check and service info |
| `GET /health` | Simple health check |
| `GET /api/v2/aggregated/:datacenter/:itemIds` | Proxied price data |
| `GET /api/v2/data-centers` | Proxied data centers list |
| `GET /api/v2/worlds` | Proxied worlds list |

## Development

```bash
# Install dependencies
npm install

# Start local dev server (port 8787)
npm run dev

# Type check
npm run type-check
```

## Deployment

```bash
# Deploy to development
npm run deploy

# Deploy to production
npm run deploy:production
```

## Configuration

Environment variables in `wrangler.toml`:

| Variable | Description |
|----------|-------------|
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins |
| `UNIVERSALIS_API_BASE` | Base URL for Universalis API |
| `RATE_LIMIT_REQUESTS` | Max requests per window (future use) |
| `RATE_LIMIT_WINDOW_SECONDS` | Rate limit window in seconds (future use) |

## Integration

Update `xivdyetools-core` to use this proxy URL instead of calling Universalis directly:

```typescript
// Before
const UNIVERSALIS_API_BASE = 'https://universalis.app/api/v2';

// After (production)
const UNIVERSALIS_API_BASE = 'https://universalis-proxy.xivdyetools.workers.dev/api/v2';
```

## Caching (Optional)

To enable KV-based caching, uncomment the `kv_namespaces` section in `wrangler.toml` and create a KV namespace:

```bash
wrangler kv:namespace create PRICE_CACHE
wrangler kv:namespace create PRICE_CACHE --preview
```

Update the namespace IDs in `wrangler.toml`.
