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
 * In-flight request tracking map
 * This lives at module scope and persists for the lifetime of the isolate
 */
const inFlightRequests = new Map<string, Promise<unknown>>();

/**
 * Maximum time to keep a request in the in-flight map (safety timeout)
 */
const MAX_IN_FLIGHT_TIME_MS = 30000; // 30 seconds

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
    // Check for existing in-flight request
    const existing = inFlightRequests.get(key);
    if (existing) {
      try {
        return (await existing) as T;
      } catch (error) {
        // If the original request failed, remove it and try again
        inFlightRequests.delete(key);
        throw error;
      }
    }

    // Create new request promise
    const promise = fetchFn();
    inFlightRequests.set(key, promise);

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

    // Safety cleanup timeout in case promise never resolves
    this.ctx.waitUntil(
      new Promise<void>((resolve) => {
        setTimeout(() => {
          if (inFlightRequests.has(key)) {
            inFlightRequests.delete(key);
          }
          resolve();
        }, MAX_IN_FLIGHT_TIME_MS);
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
