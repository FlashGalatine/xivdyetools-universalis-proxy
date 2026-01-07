# XIV Dye Tools - Universalis Proxy

**v1.3.0** | Cloudflare Worker that proxies requests to the Universalis API with proper CORS support.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3%2B-blue)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020)](https://workers.cloudflare.com/)

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
| `RATE_LIMIT_REQUESTS` | Max requests per rate limit window (default: 60) |
| `RATE_LIMIT_WINDOW_SECONDS` | Rate limit window in seconds (default: 60) |

## Features

- **Datacenter Whitelist** - Validates datacenter/world against FFXIV's official list
- **IP-Based Rate Limiting** - Configurable sliding window rate limiter with `X-RateLimit-*` headers
- **Dual-Layer Caching** - Cloudflare Cache API (edge) + KV storage (global)
- **Request Coalescing** - Prevents duplicate upstream requests for simultaneous clients
- **Stale-While-Revalidate** - Instant responses while refreshing cache in background

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

## Connect With Me

**Flash Galatine** | Balmung (Crystal)

🎮 **FFXIV**: [Lodestone Character](https://na.finalfantasyxiv.com/lodestone/character/7677106/)
📝 **Blog**: [Project Galatine](https://blog.projectgalatine.com/)
💻 **GitHub**: [@FlashGalatine](https://github.com/FlashGalatine)
🐦 **X / Twitter**: [@AsheJunius](https://x.com/AsheJunius)
📺 **Twitch**: [flashgalatine](https://www.twitch.tv/flashgalatine)
🌐 **BlueSky**: [projectgalatine.com](https://bsky.app/profile/projectgalatine.com)
❤️ **Patreon**: [ProjectGalatine](https://patreon.com/ProjectGalatine)
☕ **Ko-Fi**: [flashgalatine](https://ko-fi.com/flashgalatine)
💬 **Discord**: [Join Server](https://discord.gg/5VUSKTZCe5)

## License

MIT © 2025 Flash Galatine
