/**
 * RequestCoalescer - Prevents duplicate in-flight requests
 *
 * When multiple requests come in for the same resource simultaneously,
 * this ensures only one actual upstream request is made. Other requests
 * wait for and share the result of the first request.
 *
 * Note: This works within a single isolate instance. Cross-isolate deduplication
 * is handled by the Cache API and KV layers.
 */

/**
 * PROXY-CRITICAL-001: Use timestamp-based entries for proper cleanup
 * This prevents memory leaks if promises hang or take too long
 */
interface InFlightEntry {
  promise: Promise<unknown>;
  createdAt: number;
}

/**
 * In-flight request tracking map
 * This lives at module scope and persists for the lifetime of the isolate
 */
const inFlightRequests = new Map<string, InFlightEntry>();

/**
 * Maximum time to keep a request in the in-flight map (safety timeout)
 */
const MAX_IN_FLIGHT_TIME_MS = 60000; // 60 seconds

/**
 * How often to run cleanup sweep
 */
const CLEANUP_INTERVAL_MS = 10000; // 10 seconds

/**
 * Last cleanup timestamp to avoid excessive sweeps
 */
let lastCleanupTime = 0;

/**
 * Cleanup stale entries from the in-flight map
 * This is called periodically to ensure memory doesn't grow unboundedly
 */
function cleanupStaleEntries(): void {
  const now = Date.now();

  // Don't cleanup too frequently
  if (now - lastCleanupTime < CLEANUP_INTERVAL_MS) {
    return;
  }
  lastCleanupTime = now;

  // Remove entries older than MAX_IN_FLIGHT_TIME_MS
  for (const [key, entry] of inFlightRequests) {
    if (now - entry.createdAt > MAX_IN_FLIGHT_TIME_MS) {
      inFlightRequests.delete(key);
    }
  }
}

/**
 * RequestCoalescer handles request deduplication within an isolate
 */
export class RequestCoalescer {
  private ctx: ExecutionContext;

  constructor(ctx: ExecutionContext) {
    this.ctx = ctx;
  }

  /**
   * Execute a fetch function with request coalescing
   *
   * If an identical request is already in flight, returns its result.
   * Otherwise, executes the fetch function and shares the result with
   * any concurrent requests for the same key.
   *
   * @param key - Unique identifier for the request (usually the cache key)
   * @param fetchFn - Function that performs the actual fetch
   * @returns The fetch result (may be shared with other concurrent requests)
   */
  async coalesce<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
    // Run periodic cleanup to prevent memory leaks
    cleanupStaleEntries();

    // Check for existing in-flight request
    const existing = inFlightRequests.get(key);
    if (existing) {
      try {
        return (await existing.promise) as T;
      } catch (error) {
        // If the original request failed, remove it and try again
        inFlightRequests.delete(key);
        throw error;
      }
    }

    // Create new request promise with timestamp
    const promise = fetchFn();
    inFlightRequests.set(key, {
      promise,
      createdAt: Date.now(),
    });

    // Schedule cleanup after the request completes
    this.ctx.waitUntil(
      promise
        .finally(() => {
          // Small delay before cleanup to handle very rapid sequential requests
          setTimeout(() => {
            inFlightRequests.delete(key);
          }, 100);
        })
        .catch(() => {
          // Prevent unhandled rejection - errors are handled by the caller
        })
    );

    return promise;
  }

  /**
   * Check if a request is currently in flight
   */
  isInFlight(key: string): boolean {
    return inFlightRequests.has(key);
  }

  /**
   * Get the current number of in-flight requests (for debugging)
   */
  getInFlightCount(): number {
    return inFlightRequests.size;
  }
}
