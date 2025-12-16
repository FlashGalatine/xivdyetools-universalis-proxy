# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
