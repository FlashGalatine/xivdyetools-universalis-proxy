# What's New in v1.4.0

*Released: February 5, 2026*

---

## Overview

This release simplifies how the proxy caches market board prices. The old system wrote data to two places (edge cache + KV storage); now it only uses edge cache. **Dye price lookups work exactly the same** — this is purely an internal optimization.

---

## What Changed?

### Simpler, Leaner Caching

Previously, every price lookup wrote to both Cloudflare's Cache API (fast, edge-local) and KV storage (global, but with a daily write limit). Since the edge cache alone handles everything we need — including serving slightly-stale data while refreshing in the background — the KV layer was unnecessary overhead.

**Result:** Zero KV writes per request, which helps us stay comfortably within Cloudflare's free-tier limits.

---

## For Developers

If you're interested in the technical details, check out [CHANGELOG.md](./CHANGELOG.md) for the full breakdown.

---

*No action required on your part. Dye prices from Universalis will continue to load quickly!*
