# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2025-12-24

### Fixed

#### Security Audit - Critical Issues Resolved

- **PROXY-CRITICAL-001**: Fixed memory leak in request coalescer
  - Added timestamp-based entries with periodic cleanup
  - Stale entries cleaned every 10 seconds (entries older than 60s)
  - Prevents unbounded map growth if promises hang
- **PROXY-CRITICAL-002**: Refactored CORS middleware for clarity
  - Set CORS headers directly instead of calling cors() middleware function
  - Explicit OPTIONS preflight handling with proper headers
  - More predictable header application on all responses
- **PROXY-CRITICAL-003**: Added item ID count and range validation
  - Maximum 100 items per request (prevents DoS amplification)
  - Item IDs validated to be 1-1,000,000 (reasonable FFXIV range)
  - Returns clear error messages with invalid ID details

### Changed

- Removed unused `cors` import from Hono middleware

---

## [1.1.0] - 2025-12-16

### Added

- **Dual-layer caching system** with Cloudflare Cache API (edge) and KV storage (global)
- **Request coalescing** to prevent duplicate upstream requests when multiple clients request the same data simultaneously
- **Stale-while-revalidate pattern** for instant responses while refreshing cache in background
- Caching for `/api/v2/data-centers` endpoint (24-hour TTL)
- Caching for `/api/v2/worlds` endpoint (24-hour TTL)
- Cache debugging headers: `X-Cache`, `X-Cache-Source`, `X-Cache-Stale`, `Cache-Control`
- New `STATIC_CACHE` KV namespace for rarely-changing data

### Changed

- Upgraded from simple KV-only caching to dual-layer Cache API + KV architecture
- Cache key normalization: item IDs are now sorted for better cache hit rates
- Datacenter names are lowercased in cache keys for consistency
- Version bumped to 1.1.0

### Technical Details

- New files: `src/types/cache.ts`, `src/config/cache.ts`, `src/services/cache-service.ts`, `src/services/request-coalescer.ts`, `src/services/cached-fetch.ts`
- Cache TTLs: 5 minutes for price data, 24 hours for static data (worlds/data-centers)
- SWR windows: 2 minutes for price data, 6 hours for static data

## [1.0.0] - 2025-12-16

### Added

- Initial release of Universalis API proxy
- CORS support for all responses including error responses (429, 500, etc.)
- Proxy endpoints for `/api/v2/aggregated/:datacenter/:itemIds`
- Proxy endpoints for `/api/v2/data-centers` and `/api/v2/worlds`
- Health check endpoints at `/` and `/health`
- Input validation to prevent injection attacks
- User-Agent header identifying XIV Dye Tools
- Optional KV-based caching with 5-minute TTL
- Development and production environment configurations
