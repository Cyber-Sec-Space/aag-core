/**
 * Base custom error class for AAG Core runtime exceptions.
 * It strictly structures generic JavaScript errors into categorized HTTP boundaries
 * that Host Applications (like the Gateway) can easily interpret.
 */
export class AagError extends Error {
  constructor(
    public readonly message: string,
    public readonly code: string,
    public readonly status: number = 500
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Thrown when IConfigStore returns malformed data terminating validation by Zod.
 */
export class AagConfigurationError extends AagError {
  constructor(message: string, public readonly details?: any) {
    super(message, "ERR_CONFIG", 500);
  }
}

/**
 * Thrown when an AI_ID or AI_KEY is missing, malformed, revoked, or fails identity verification.
 */
export class AuthenticationError extends AagError {
  constructor(message: string) {
    super(message, "ERR_AUTH", 401);
  }
}

/**
 * Thrown when an AI_ID attempts to access a server or tool not explicitly allowed by RBAC constraints.
 */
export class AuthorizationError extends AagError {
  constructor(message: string) {
    super(message, "ERR_FORBIDDEN", 403);
  }
}

/**
 * Thrown when a downstream MCP server fails to connect, timeout, or crashes unexpectedly.
 */
export class UpstreamConnectionError extends AagError {
  constructor(message: string) {
    super(message, "ERR_UPSTREAM_CONNECTION", 502);
  }
}

/**
 * Thrown by RateLimitMiddleware when an AI_ID exceeds their permitted Token Bucket threshold.
 */
export class RateLimitExceededError extends AagError {
  constructor(message: string) {
    super(message, "ERR_RATE_LIMIT", 429);
  }
}
