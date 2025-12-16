/**
 * Tests for CacheService - dual-layer caching with Cache API and KV
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CacheService } from './cache-service';
import {
  createMockKV,
  createMockExecutionContext,
  resetAllMocks,
  MockCacheStorage,
} from '../test-setup';
import type { CacheConfig } from '../types/cache';

describe('CacheService', () => {
  let mockKV: ReturnType<typeof createMockKV>;
  let mockCtx: ReturnType<typeof createMockExecutionContext>;
  let cacheService: CacheService;
  const baseUrl = 'https://test.example.com';

  const testConfig: CacheConfig = {
    cacheTtl: 300,
    kvTtl: 300,
    swrWindow: 120,
    keyPrefix: 'test',
  };

  beforeEach(() => {
    resetAllMocks();
    mockKV = createMockKV();
    mockCtx = createMockExecutionContext();
    cacheService = new CacheService(mockKV, mockCtx, baseUrl);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getFromCacheApi', () => {
    it('should return null when cache is empty', async () => {
      const result = await cacheService.getFromCacheApi('nonexistent-key');
      expect(result).toBeNull();
    });

    it('should return cached response when available', async () => {
      const testData = { items: [1, 2, 3] };
      const now = Date.now();

      // Manually populate the cache
      const cache = await caches.open('universalis-proxy');
      const cacheUrl = `${baseUrl}/__cache/test-key`;
      const response = new Response(JSON.stringify(testData), {
        headers: {
          'Content-Type': 'application/json',
          'X-Cached-At': String(now),
          'X-Cache-TTL': '300',
          'X-SWR-Window': '120',
        },
      });
      await cache.put(new Request(cacheUrl), response);

      const result = await cacheService.getFromCacheApi('test-key');
      expect(result).not.toBeNull();
      expect(result?.isStale).toBe(false);

      const data = await result?.response.json();
      expect(data).toEqual(testData);
    });

    it('should mark data as stale when beyond TTL but within SWR window', async () => {
      const testData = { items: [1, 2, 3] };
      const now = Date.now();
      const cachedAt = now - 350 * 1000; // 350 seconds ago (beyond 300s TTL, within 420s total)

      const cache = await caches.open('universalis-proxy');
      const cacheUrl = `${baseUrl}/__cache/stale-key`;
      const response = new Response(JSON.stringify(testData), {
        headers: {
          'Content-Type': 'application/json',
          'X-Cached-At': String(cachedAt),
          'X-Cache-TTL': '300',
          'X-SWR-Window': '120',
        },
      });
      await cache.put(new Request(cacheUrl), response);

      const result = await cacheService.getFromCacheApi('stale-key');
      expect(result).not.toBeNull();
      expect(result?.isStale).toBe(true);
    });

    it('should return null and delete when beyond SWR window', async () => {
      const testData = { items: [1, 2, 3] };
      const now = Date.now();
      const cachedAt = now - 500 * 1000; // 500 seconds ago (beyond 420s total window)

      const cache = await caches.open('universalis-proxy');
      const cacheUrl = `${baseUrl}/__cache/expired-key`;
      const response = new Response(JSON.stringify(testData), {
        headers: {
          'Content-Type': 'application/json',
          'X-Cached-At': String(cachedAt),
          'X-Cache-TTL': '300',
          'X-SWR-Window': '120',
        },
      });
      await cache.put(new Request(cacheUrl), response);

      const result = await cacheService.getFromCacheApi('expired-key');
      expect(result).toBeNull();

      // Check that waitUntil was called for deletion
      expect(mockCtx.waitUntil).toHaveBeenCalled();
    });

    it('should handle cache errors gracefully', async () => {
      // Create a new cache service with caches undefined
      const originalCaches = globalThis.caches;
      // @ts-expect-error - Intentionally setting undefined for testing
      globalThis.caches = undefined;

      const service = new CacheService(mockKV, mockCtx, baseUrl);
      const result = await service.getFromCacheApi('any-key');
      expect(result).toBeNull();

      globalThis.caches = originalCaches;
    });
  });

  describe('getFromKv', () => {
    it('should return null when KV is empty', async () => {
      const result = await cacheService.getFromKv('nonexistent-key');
      expect(result).toBeNull();
    });

    it('should return null when KV namespace is undefined', async () => {
      const service = new CacheService(undefined, mockCtx, baseUrl);
      const result = await service.getFromKv('any-key');
      expect(result).toBeNull();
    });

    it('should return cached data when available', async () => {
      const testData = { items: [1, 2, 3] };
      const now = Date.now();

      await mockKV.put('test-key', JSON.stringify(testData), {
        metadata: {
          cachedAt: now,
          ttl: 300,
          swrWindow: 120,
        },
      });

      const result = await cacheService.getFromKv('test-key');
      expect(result).not.toBeNull();
      expect(result?.data).toEqual(testData);
      expect(result?.isStale).toBe(false);
    });

    it('should mark data as stale when beyond TTL but within SWR window', async () => {
      const testData = { items: [1, 2, 3] };
      const now = Date.now();
      const cachedAt = now - 350 * 1000; // 350 seconds ago

      await mockKV.put('stale-key', JSON.stringify(testData), {
        metadata: {
          cachedAt,
          ttl: 300,
          swrWindow: 120,
        },
      });

      const result = await cacheService.getFromKv('stale-key');
      expect(result).not.toBeNull();
      expect(result?.isStale).toBe(true);
    });

    it('should return null and delete when beyond SWR window', async () => {
      const testData = { items: [1, 2, 3] };
      const now = Date.now();
      const cachedAt = now - 500 * 1000; // 500 seconds ago

      await mockKV.put('expired-key', JSON.stringify(testData), {
        metadata: {
          cachedAt,
          ttl: 300,
          swrWindow: 120,
        },
      });

      const result = await cacheService.getFromKv('expired-key');
      expect(result).toBeNull();
      expect(mockCtx.waitUntil).toHaveBeenCalled();
    });

    it('should return null when metadata is missing', async () => {
      await mockKV.put('no-metadata-key', JSON.stringify({ test: true }));

      const result = await cacheService.getFromKv('no-metadata-key');
      expect(result).toBeNull();
    });
  });

  describe('storeToCacheApi', () => {
    it('should store data in Cache API with correct headers', async () => {
      const testData = { items: [1, 2, 3] };
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));

      await cacheService.storeToCacheApi('store-test', testData, testConfig);

      const cache = await caches.open('universalis-proxy');
      const cacheUrl = `${baseUrl}/__cache/store-test`;
      const cached = await cache.match(new Request(cacheUrl));

      expect(cached).toBeDefined();
      expect(cached?.headers.get('Content-Type')).toBe('application/json');
      expect(cached?.headers.get('X-Cache-TTL')).toBe('300');
      expect(cached?.headers.get('X-SWR-Window')).toBe('120');
      expect(cached?.headers.get('Cache-Control')).toBe('public, max-age=420'); // TTL + SWR
    });

    it('should do nothing when caches is undefined', async () => {
      const originalCaches = globalThis.caches;
      // @ts-expect-error - Intentionally setting undefined for testing
      globalThis.caches = undefined;

      const service = new CacheService(mockKV, mockCtx, baseUrl);
      // Should not throw
      await service.storeToCacheApi('key', { data: 'test' }, testConfig);

      globalThis.caches = originalCaches;
    });
  });

  describe('storeToKv', () => {
    it('should store data in KV with metadata', async () => {
      const testData = { items: [1, 2, 3] };
      vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));

      await cacheService.storeToKv('kv-test', testData, testConfig);

      const result = await mockKV.getWithMetadata('kv-test', 'json');
      expect(result.value).toEqual(testData);
      expect(result.metadata).toMatchObject({
        ttl: 300,
        swrWindow: 120,
      });
    });

    it('should do nothing when KV is undefined', async () => {
      const service = new CacheService(undefined, mockCtx, baseUrl);
      // Should not throw
      await service.storeToKv('key', { data: 'test' }, testConfig);
    });
  });

  describe('storeToAll', () => {
    it('should store to both cache layers asynchronously', async () => {
      const testData = { items: [1, 2, 3] };

      cacheService.storeToAll('all-test', testData, testConfig);

      // waitUntil should have been called
      expect(mockCtx.waitUntil).toHaveBeenCalled();

      // Wait for the async operations
      await (mockCtx as unknown as { _waitForAll: () => Promise<void> })._waitForAll();

      // Check KV
      const kvResult = await mockKV.getWithMetadata('all-test', 'json');
      expect(kvResult.value).toEqual(testData);

      // Check Cache API
      const cache = await caches.open('universalis-proxy');
      const cacheUrl = `${baseUrl}/__cache/all-test`;
      const cached = await cache.match(new Request(cacheUrl));
      expect(cached).toBeDefined();
    });
  });

  describe('deleteFromAll', () => {
    it('should delete from both cache layers', async () => {
      const testData = { items: [1, 2, 3] };

      // First, store data
      await cacheService.storeToCacheApi('delete-test', testData, testConfig);
      await cacheService.storeToKv('delete-test', testData, testConfig);

      // Verify data exists
      const cache = await caches.open('universalis-proxy');
      const cacheUrl = `${baseUrl}/__cache/delete-test`;
      expect(await cache.match(new Request(cacheUrl))).toBeDefined();
      expect(await mockKV.get('delete-test')).not.toBeNull();

      // Delete
      cacheService.deleteFromAll('delete-test');
      await (mockCtx as unknown as { _waitForAll: () => Promise<void> })._waitForAll();

      // Verify deleted
      expect(await cache.match(new Request(cacheUrl))).toBeUndefined();
      expect(await mockKV.get('delete-test')).toBeNull();
    });

    it('should handle errors gracefully during deletion', async () => {
      // This should not throw even with no data
      cacheService.deleteFromAll('nonexistent-key');
      await (mockCtx as unknown as { _waitForAll: () => Promise<void> })._waitForAll();
    });
  });

  describe('URL encoding', () => {
    it('should properly encode cache keys with special characters', async () => {
      const key = 'aggregated:Crystal:123,456,789';
      const testData = { test: true };

      await cacheService.storeToCacheApi(key, testData, testConfig);

      const result = await cacheService.getFromCacheApi(key);
      expect(result).not.toBeNull();

      const data = await result?.response.json();
      expect(data).toEqual(testData);
    });
  });

  describe('concurrent access', () => {
    it('should handle multiple simultaneous reads', async () => {
      const testData = { items: [1, 2, 3] };
      await cacheService.storeToCacheApi('concurrent-test', testData, testConfig);
      await cacheService.storeToKv('concurrent-test', testData, testConfig);

      const reads = await Promise.all([
        cacheService.getFromCacheApi('concurrent-test'),
        cacheService.getFromKv('concurrent-test'),
        cacheService.getFromCacheApi('concurrent-test'),
        cacheService.getFromKv('concurrent-test'),
      ]);

      reads.forEach((result, i) => {
        expect(result, `Read ${i} failed`).not.toBeNull();
      });
    });
  });
});
