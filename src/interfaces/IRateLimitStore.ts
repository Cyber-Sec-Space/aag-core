export interface IRateLimitStore {
  /**
   * Tries to consume a single token for the given identity.
   * Returns true if allowed, false if rate limit has been exceeded.
   * 
   * @param id - The unique identifier (e.g., aiId).
   * @param maxTokens - The maximum allowed tokens (bucket capacity).
   * @param windowMs - The time window in milliseconds for a full refill.
   * @returns Promise resolving to true if request is permitted.
   */
  consume(id: string, maxTokens: number, windowMs: number): Promise<boolean>;
}
