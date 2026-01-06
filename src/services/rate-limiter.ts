/**
 * Rate Limiter Service
 *
 * In-memory sliding window rate limiter for the Universalis proxy.
 * Uses module-level state that persists within a Worker isolate.
 *
 * SECURITY: Prevents abuse of the proxy and protects upstream Universalis API.
 *
 * Note: This is an in-memory implementation which resets when the Worker isolate
 * is recycled. For mission-critical rate limiting, consider using KV or
 * Durable Objects. This implementation is acceptable for defense-in-depth.
 *
 * @module services/rate-limiter
 */

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum requests allowed per window */
  maxRequests: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests in the current window */
  remaining: number;
  /** Seconds until the rate limit window resets */
  resetInSeconds: number;
}

/**
 * Request log entry with timestamp
 */
interface RequestLog {
  timestamps: number[];
}

/**
 * In-memory rate limit storage
 * Key: IP address or identifier
 * Value: Array of request timestamps
 */
const ipRequestLog = new Map<string, RequestLog>();

/**
 * Cleanup interval in milliseconds
 * Cleans up expired entries every 60 seconds
 */
const CLEANUP_INTERVAL_MS = 60 * 1000;

/**
 * Last cleanup timestamp
 */
let lastCleanup = Date.now();

/**
 * Clean up expired entries from the rate limit log
 */
function cleanup(windowSeconds: number): void {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const cutoff = now - windowMs;

  for (const [ip, log] of ipRequestLog.entries()) {
    // Remove timestamps older than the window
    log.timestamps = log.timestamps.filter((ts) => ts > cutoff);

    // Remove the entry entirely if no timestamps remain
    if (log.timestamps.length === 0) {
      ipRequestLog.delete(ip);
    }
  }

  lastCleanup = now;
}

/**
 * Check if a request should be rate limited
 *
 * Uses a sliding window algorithm:
 * - Counts requests in the last `windowSeconds`
 * - Allows if count is under `maxRequests`
 * - Records the request timestamp if allowed
 *
 * @param identifier - Unique identifier (IP address or user ID)
 * @param config - Rate limit configuration
 * @returns Rate limit result with remaining count and reset time
 */
export function checkRateLimit(identifier: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const cutoff = now - windowMs;

  // Periodic cleanup to prevent memory growth
  if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
    cleanup(config.windowSeconds);
  }

  // Get or create request log for this identifier
  let log = ipRequestLog.get(identifier);
  if (!log) {
    log = { timestamps: [] };
    ipRequestLog.set(identifier, log);
  }

  // Filter to only timestamps within the current window
  log.timestamps = log.timestamps.filter((ts) => ts > cutoff);

  // Check if rate limit exceeded
  if (log.timestamps.length >= config.maxRequests) {
    // Find when the oldest request will expire
    const oldestTimestamp = log.timestamps[0];
    const resetInSeconds = Math.ceil((oldestTimestamp + windowMs - now) / 1000);

    return {
      allowed: false,
      remaining: 0,
      resetInSeconds: Math.max(1, resetInSeconds),
    };
  }

  // Record this request
  log.timestamps.push(now);

  return {
    allowed: true,
    remaining: config.maxRequests - log.timestamps.length,
    resetInSeconds: config.windowSeconds,
  };
}

/**
 * Get rate limit headers for the response
 *
 * @param result - Rate limit check result
 * @param maxRequests - Maximum requests per window
 * @returns Headers object with rate limit information
 */
export function getRateLimitHeaders(
  result: RateLimitResult,
  maxRequests: number
): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(maxRequests),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + result.resetInSeconds),
  };
}

/**
 * Clear all rate limit data (for testing)
 */
export function clearRateLimits(): void {
  ipRequestLog.clear();
  lastCleanup = Date.now();
}
