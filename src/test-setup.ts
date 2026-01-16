/**
 * Test Setup - Mocks for Cloudflare Worker runtime APIs
 *
 * This file provides mocks for Cloudflare-specific globals that aren't
 * available in Node.js test environments:
 * - caches (Cache API)
 * - KVNamespace
 * - ExecutionContext
 */

import { vi } from 'vitest';

/**
 * Mock Cache implementation
 */
export class MockCache implements Cache {
  private storage = new Map<string, Response>();

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const key = typeof request === 'string' ? request : (request as Request).url;
    const cached = this.storage.get(key);
    return cached ? cached.clone() : undefined;
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    const key = typeof request === 'string' ? request : (request as Request).url;
    this.storage.set(key, response.clone());
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    const key = typeof request === 'string' ? request : (request as Request).url;
    return this.storage.delete(key);
  }

  // Required but not used
  async add(): Promise<void> {}
  async addAll(): Promise<void> {}
  async keys(): Promise<readonly Request[]> {
    return [];
  }
  async matchAll(): Promise<readonly Response[]> {
    return [];
  }

  // Test helper to clear storage
  clear(): void {
    this.storage.clear();
  }

  // Test helper to get size
  get size(): number {
    return this.storage.size;
  }
}

/**
 * Mock CacheStorage implementation
 */
export class MockCacheStorage implements CacheStorage {
  private caches = new Map<string, MockCache>();

  async open(cacheName: string): Promise<MockCache> {
    let cache = this.caches.get(cacheName);
    if (!cache) {
      cache = new MockCache();
      this.caches.set(cacheName, cache);
    }
    return cache;
  }

  async has(cacheName: string): Promise<boolean> {
    return this.caches.has(cacheName);
  }

  async delete(cacheName: string): Promise<boolean> {
    return this.caches.delete(cacheName);
  }

  async keys(): Promise<string[]> {
    return Array.from(this.caches.keys());
  }

  async match(): Promise<Response | undefined> {
    return undefined;
  }

  // Test helper to clear all caches
  clear(): void {
    this.caches.clear();
  }
}

/**
 * Mock KV Namespace implementation
 */
export function createMockKV(): KVNamespace & {
  _storage: Map<string, { value: string; metadata?: unknown }>;
  _clear: () => void;
} {
  const storage = new Map<string, { value: string; metadata?: unknown }>();

  return {
    _storage: storage,
    _clear: () => storage.clear(),

    async get(
      key: string,
      options?: KVNamespaceGetOptions<'text' | 'json' | 'arrayBuffer' | 'stream'>
    ): Promise<string | object | ArrayBuffer | ReadableStream | null> {
      const entry = storage.get(key);
      if (!entry) return null;

      const type = typeof options === 'string' ? options : options?.type ?? 'text';

      switch (type) {
        case 'json':
          return JSON.parse(entry.value);
        case 'arrayBuffer':
          return new TextEncoder().encode(entry.value).buffer;
        case 'stream':
          return new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(entry.value));
              controller.close();
            },
          });
        default:
          return entry.value;
      }
    },

    async getWithMetadata<T = unknown, M = unknown>(
      key: string,
      type?: 'text' | 'json' | 'arrayBuffer' | 'stream'
    ): Promise<KVNamespaceGetWithMetadataResult<T, M>> {
      const entry = storage.get(key);
      if (!entry) {
        return { value: null, metadata: null, cacheStatus: null };
      }

      let value: T | null = null;
      const resolvedType = type ?? 'text';

      switch (resolvedType) {
        case 'json':
          value = JSON.parse(entry.value) as T;
          break;
        case 'arrayBuffer':
          value = new TextEncoder().encode(entry.value).buffer as unknown as T;
          break;
        default:
          value = entry.value as unknown as T;
      }

      return {
        value,
        metadata: (entry.metadata as M) ?? null,
        cacheStatus: null,
      };
    },

    async put(
      key: string,
      value: string | ArrayBuffer | ReadableStream,
      options?: KVNamespacePutOptions
    ): Promise<void> {
      let stringValue: string;
      if (typeof value === 'string') {
        stringValue = value;
      } else if (value instanceof ArrayBuffer) {
        stringValue = new TextDecoder().decode(value);
      } else {
        // ReadableStream - simplified handling
        const reader = value.getReader();
        const chunks: Uint8Array[] = [];
        let done = false;
        while (!done) {
          const result = await reader.read();
          done = result.done;
          if (result.value) chunks.push(result.value);
        }
        stringValue = new TextDecoder().decode(
          chunks.reduce((acc, chunk) => {
            const result = new Uint8Array(acc.length + chunk.length);
            result.set(acc);
            result.set(chunk, acc.length);
            return result;
          }, new Uint8Array())
        );
      }

      storage.set(key, {
        value: stringValue,
        metadata: options?.metadata,
      });
    },

    async delete(key: string): Promise<void> {
      storage.delete(key);
    },

    async list(): Promise<KVNamespaceListResult<unknown, string>> {
      const keys = Array.from(storage.keys()).map((name) => ({
        name,
        expiration: undefined,
        metadata: storage.get(name)?.metadata,
      }));
      return {
        keys,
        list_complete: true,
        cacheStatus: null,
      };
    },
  } as KVNamespace & {
    _storage: Map<string, { value: string; metadata?: unknown }>;
    _clear: () => void;
  };
}

/**
 * Create a mock ExecutionContext
 */
export function createMockExecutionContext(): ExecutionContext {
  const waitUntilPromises: Promise<unknown>[] = [];

  return {
    waitUntil: vi.fn((promise: Promise<unknown>) => {
      waitUntilPromises.push(promise);
    }),
    passThroughOnException: vi.fn(),
    // Test helper to wait for all background tasks
    _waitForAll: () => Promise.all(waitUntilPromises),
    _promises: waitUntilPromises,
  } as unknown as ExecutionContext;
}

/**
 * Create a mock Env object
 */
export function createMockEnv(
  overrides: Partial<{
    ENVIRONMENT: string;
    ALLOWED_ORIGINS: string;
    UNIVERSALIS_API_BASE: string;
    RATE_LIMIT_REQUESTS: string;
    RATE_LIMIT_WINDOW_SECONDS: string;
    PRICE_CACHE: ReturnType<typeof createMockKV>;
    STATIC_CACHE: ReturnType<typeof createMockKV>;
  }> = {}
) {
  return {
    ENVIRONMENT: 'test',
    ALLOWED_ORIGINS: 'https://xivdyetools.app',
    UNIVERSALIS_API_BASE: 'https://universalis.app/api/v2',
    RATE_LIMIT_REQUESTS: '100',
    RATE_LIMIT_WINDOW_SECONDS: '60',
    PRICE_CACHE: createMockKV(),
    STATIC_CACHE: createMockKV(),
    ...overrides,
  };
}

// Setup global mocks
let mockCacheStorage = new MockCacheStorage();

// @ts-expect-error - Assigning to globalThis for test environment
globalThis.caches = mockCacheStorage;

// Helper to reset all mocks between tests
export function resetAllMocks(): void {
  mockCacheStorage.clear();
  // Create a completely new instance to ensure isolation
  mockCacheStorage = new MockCacheStorage();
  // @ts-expect-error - Assigning to globalThis for test environment
  globalThis.caches = mockCacheStorage;
}
