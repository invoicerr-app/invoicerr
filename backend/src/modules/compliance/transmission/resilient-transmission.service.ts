import { Injectable, Logger } from '@nestjs/common';
import { TransmissionStatus } from '../interfaces';
import {
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitOpenError,
  CircuitState,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  DEFAULT_RETRY_CONFIG,
  RetryConfig,
  RetryExhaustedError,
  withResilience,
} from './resilience';
import {
  TransmissionPayload,
  TransmissionResult,
} from './transmission.interface';
import { TransmissionService } from './transmission.service';

/**
 * Configuration for resilient transmission
 */
export interface ResilientTransmissionConfig {
  retry?: Partial<RetryConfig>;
  circuitBreaker?: Partial<CircuitBreakerConfig>;
}

/**
 * Circuit breaker status for monitoring
 */
export interface CircuitBreakerStatus {
  platform: string;
  state: CircuitState;
  isHealthy: boolean;
}

/**
 * Extended transmission result with retry information
 */
export interface ResilientTransmissionResult extends TransmissionResult {
  retriesAttempted?: number;
  circuitBreakerTripped?: boolean;
}

/**
 * Transmission service with built-in retry and circuit breaker patterns
 *
 * This service wraps the base TransmissionService to provide:
 * - Automatic retry with exponential backoff for transient failures
 * - Circuit breaker to prevent cascading failures
 * - Per-platform circuit breakers for isolation
 */
@Injectable()
export class ResilientTransmissionService {
  private readonly logger = new Logger(ResilientTransmissionService.name);
  private readonly circuitBreakers = new Map<string, CircuitBreaker>();
  private readonly retryConfig: RetryConfig;
  private readonly circuitBreakerConfig: CircuitBreakerConfig;

  constructor(
    private readonly transmissionService: TransmissionService,
    config?: ResilientTransmissionConfig,
  ) {
    this.retryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      ...config?.retry,
    };

    this.circuitBreakerConfig = {
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      ...config?.circuitBreaker,
    };

    this.logger.log(
      `Initialized with retry config: ${this.retryConfig.maxAttempts} attempts, ` +
        `circuit breaker threshold: ${this.circuitBreakerConfig.failureThreshold} failures`,
    );
  }

  /**
   * Get or create circuit breaker for a platform
   */
  private getCircuitBreaker(platform: string): CircuitBreaker {
    if (!this.circuitBreakers.has(platform)) {
      this.circuitBreakers.set(
        platform,
        new CircuitBreaker(platform, this.circuitBreakerConfig),
      );
    }
    return this.circuitBreakers.get(platform)!;
  }

  /**
   * Send invoice with retry and circuit breaker protection
   */
  async send(
    platform: string,
    payload: TransmissionPayload,
  ): Promise<ResilientTransmissionResult> {
    const circuitBreaker = this.getCircuitBreaker(platform);

    // Check if circuit is open
    if (!circuitBreaker.canExecute()) {
      this.logger.warn(
        `Circuit breaker open for ${platform}, rejecting transmission for invoice ${payload.invoiceNumber}`,
      );
      return {
        success: false,
        status: 'rejected',
        errorCode: 'CIRCUIT_BREAKER_OPEN',
        message: `Service ${platform} is temporarily unavailable. Please try again later.`,
        circuitBreakerTripped: true,
      };
    }

    let retriesAttempted = 0;

    try {
      const result = await withResilience(
        async () => {
          retriesAttempted++;
          return this.transmissionService.send(platform, payload);
        },
        circuitBreaker,
        this.retryConfig,
        this.logger,
      );

      // Check if the result itself indicates a failure (even without throwing)
      if (!result.success) {
        // Don't retry validation errors
        if (result.errorCode?.includes('VALIDATION')) {
          return {
            ...result,
            retriesAttempted: 1,
          };
        }
      }

      return {
        ...result,
        retriesAttempted,
      };
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        return {
          success: false,
          status: 'rejected',
          errorCode: 'CIRCUIT_BREAKER_OPEN',
          message: error.message,
          circuitBreakerTripped: true,
          retriesAttempted,
        };
      }

      if (error instanceof RetryExhaustedError) {
        return {
          success: false,
          status: 'rejected',
          errorCode: 'RETRY_EXHAUSTED',
          message: `Failed after ${error.attempts} attempts: ${error.lastError.message}`,
          retriesAttempted: error.attempts,
        };
      }

      // Unknown error
      return {
        success: false,
        status: 'rejected',
        errorCode: 'UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        retriesAttempted,
      };
    }
  }

  /**
   * Check transmission status with retry protection
   */
  async checkStatus(platform: string, externalId: string): Promise<TransmissionStatus> {
    const circuitBreaker = this.getCircuitBreaker(platform);

    if (!circuitBreaker.canExecute()) {
      this.logger.warn(`Circuit breaker open for ${platform}, cannot check status`);
      return 'pending';
    }

    try {
      return await withResilience(
        () => this.transmissionService.checkStatus(platform, externalId),
        circuitBreaker,
        {
          ...this.retryConfig,
          maxAttempts: 2, // Fewer retries for status checks
        },
        this.logger,
      );
    } catch (error) {
      this.logger.error(`Status check failed for ${platform}:`, error);
      return 'pending';
    }
  }

  /**
   * Cancel transmission (no retry - cancellation should be atomic)
   */
  async cancel(platform: string, externalId: string): Promise<boolean> {
    const circuitBreaker = this.getCircuitBreaker(platform);

    if (!circuitBreaker.canExecute()) {
      this.logger.warn(`Circuit breaker open for ${platform}, cannot cancel`);
      return false;
    }

    try {
      const result = await this.transmissionService.cancel(platform, externalId);
      circuitBreaker.recordSuccess();
      return result;
    } catch (error) {
      circuitBreaker.recordFailure(error instanceof Error ? error : new Error(String(error)));
      this.logger.error(`Cancellation failed for ${platform}:`, error);
      return false;
    }
  }

  /**
   * Get circuit breaker status for all platforms
   */
  getCircuitBreakerStatus(): CircuitBreakerStatus[] {
    const statuses: CircuitBreakerStatus[] = [];

    for (const [platform, breaker] of this.circuitBreakers) {
      const state = breaker.getState();
      statuses.push({
        platform,
        state,
        isHealthy: state === CircuitState.CLOSED,
      });
    }

    return statuses;
  }

  /**
   * Check if a platform's circuit breaker is healthy
   */
  isPlatformHealthy(platform: string): boolean {
    if (!this.circuitBreakers.has(platform)) {
      return true; // No circuit breaker = never failed
    }
    return this.circuitBreakers.get(platform)!.getState() === CircuitState.CLOSED;
  }

  /**
   * Reset circuit breaker for a platform (use with caution)
   */
  resetCircuitBreaker(platform: string): void {
    if (this.circuitBreakers.has(platform)) {
      this.circuitBreakers.delete(platform);
      this.logger.log(`Circuit breaker reset for ${platform}`);
    }
  }

  /**
   * Get available strategies (delegates to base service)
   */
  getAvailableStrategies(): string[] {
    return this.transmissionService.getAvailableStrategies();
  }

  /**
   * Check if platform is supported (delegates to base service)
   */
  isSupported(platform: string): boolean {
    return this.transmissionService.isSupported(platform);
  }

  /**
   * Get supported platforms (delegates to base service)
   */
  getSupportedPlatforms(): string[] {
    return this.transmissionService.getSupportedPlatforms();
  }
}
