import { Logger } from '@nestjs/common';

/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Failing, rejecting requests
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening
  resetTimeoutMs: number; // Time before trying half-open
  halfOpenMaxAttempts: number; // Requests to try in half-open state
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: [
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'NETWORK_ERROR',
    'HTTP_429',
    'HTTP_502',
    'HTTP_503',
    'HTTP_504',
  ],
};

/**
 * Default circuit breaker configuration
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 60000, // 1 minute
  halfOpenMaxAttempts: 3,
};

/**
 * Error that indicates the circuit is open
 */
export class CircuitOpenError extends Error {
  constructor(
    public readonly serviceName: string,
    public readonly openedAt: Date,
    public readonly resetAt: Date,
  ) {
    super(
      `Circuit breaker is open for ${serviceName}. Will reset at ${resetAt.toISOString()}`,
    );
    this.name = 'CircuitOpenError';
  }
}

/**
 * Error after all retry attempts exhausted
 */
export class RetryExhaustedError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly lastError: Error,
  ) {
    super(`All ${attempts} retry attempts exhausted. Last error: ${lastError.message}`);
    this.name = 'RetryExhaustedError';
  }
}

/**
 * Circuit breaker implementation per service
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime: Date | null = null;
  private halfOpenSuccessCount = 0;
  private readonly logger: Logger;

  constructor(
    private readonly serviceName: string,
    private readonly config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG,
  ) {
    this.logger = new Logger(`CircuitBreaker:${serviceName}`);
  }

  getState(): CircuitState {
    this.checkStateTransition();
    return this.state;
  }

  /**
   * Check if request is allowed through the circuit
   */
  canExecute(): boolean {
    this.checkStateTransition();

    if (this.state === CircuitState.CLOSED) {
      return true;
    }

    if (this.state === CircuitState.HALF_OPEN) {
      return this.halfOpenSuccessCount < this.config.halfOpenMaxAttempts;
    }

    return false;
  }

  /**
   * Throw if circuit is open
   */
  assertCanExecute(): void {
    if (!this.canExecute()) {
      const resetAt = new Date(
        (this.lastFailureTime?.getTime() || Date.now()) + this.config.resetTimeoutMs,
      );
      throw new CircuitOpenError(
        this.serviceName,
        this.lastFailureTime || new Date(),
        resetAt,
      );
    }
  }

  /**
   * Record a successful execution
   */
  recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenSuccessCount++;
      if (this.halfOpenSuccessCount >= this.config.halfOpenMaxAttempts) {
        this.logger.log(`Circuit closed for ${this.serviceName} after successful recovery`);
        this.close();
      }
    } else {
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed execution
   */
  recordFailure(error: Error): void {
    this.failureCount++;
    this.lastFailureTime = new Date();

    if (this.state === CircuitState.HALF_OPEN) {
      this.logger.warn(
        `Circuit re-opened for ${this.serviceName} after failure in half-open state`,
      );
      this.open();
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.logger.warn(
        `Circuit opened for ${this.serviceName} after ${this.failureCount} failures. ` +
          `Last error: ${error.message}`,
      );
      this.open();
    }
  }

  private checkStateTransition(): void {
    if (this.state === CircuitState.OPEN && this.lastFailureTime) {
      const timeSinceFailure = Date.now() - this.lastFailureTime.getTime();
      if (timeSinceFailure >= this.config.resetTimeoutMs) {
        this.logger.log(`Circuit half-open for ${this.serviceName}, testing recovery`);
        this.halfOpen();
      }
    }
  }

  private open(): void {
    this.state = CircuitState.OPEN;
    this.halfOpenSuccessCount = 0;
  }

  private halfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.halfOpenSuccessCount = 0;
  }

  private close(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.halfOpenSuccessCount = 0;
    this.lastFailureTime = null;
  }
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: Error, config: RetryConfig = DEFAULT_RETRY_CONFIG): boolean {
  const errorMessage = error.message.toUpperCase();
  const errorCode = (error as NodeJS.ErrnoException).code?.toUpperCase() || '';

  // Check for known retryable error codes
  for (const retryableCode of config.retryableErrors || []) {
    if (
      errorMessage.includes(retryableCode) ||
      errorCode.includes(retryableCode) ||
      errorMessage.includes(`HTTP_${retryableCode.replace('HTTP_', '')}`)
    ) {
      return true;
    }
  }

  // Check for network-related errors
  if (
    errorMessage.includes('NETWORK') ||
    errorMessage.includes('TIMEOUT') ||
    errorMessage.includes('CONNECTION') ||
    errorMessage.includes('UNAVAILABLE') ||
    errorMessage.includes('TEMPORARILY')
  ) {
    return true;
  }

  return false;
}

/**
 * Calculate delay for retry with exponential backoff and jitter
 */
export function calculateRetryDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): number {
  const baseDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
  const cappedDelay = Math.min(baseDelay, config.maxDelayMs);

  // Add jitter (0-25% of delay) to prevent thundering herd
  const jitter = Math.random() * 0.25 * cappedDelay;

  return Math.floor(cappedDelay + jitter);
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  logger?: Logger,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === config.maxAttempts || !isRetryableError(lastError, config)) {
        throw lastError;
      }

      const delay = calculateRetryDelay(attempt, config);
      logger?.warn(
        `Attempt ${attempt}/${config.maxAttempts} failed: ${lastError.message}. ` +
          `Retrying in ${delay}ms...`,
      );

      await sleep(delay);
    }
  }

  throw new RetryExhaustedError(config.maxAttempts, lastError!);
}

/**
 * Execute a function with circuit breaker protection
 */
export async function withCircuitBreaker<T>(
  fn: () => Promise<T>,
  circuitBreaker: CircuitBreaker,
): Promise<T> {
  circuitBreaker.assertCanExecute();

  try {
    const result = await fn();
    circuitBreaker.recordSuccess();
    return result;
  } catch (error) {
    circuitBreaker.recordFailure(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Execute a function with both retry and circuit breaker
 */
export async function withResilience<T>(
  fn: () => Promise<T>,
  circuitBreaker: CircuitBreaker,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
  logger?: Logger,
): Promise<T> {
  return withCircuitBreaker(
    () => withRetry(fn, retryConfig, logger),
    circuitBreaker,
  );
}
