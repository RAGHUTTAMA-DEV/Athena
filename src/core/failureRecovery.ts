import { FailureCategory } from './runState.js';

export type EnhancedFailureCategory =
  | FailureCategory
  | 'rate_limit'
  | 'network_reset'
  | 'provider_outage'
  | 'policy_violation';

export interface RecoveryAction {
  action: 'retry_backoff' | 'fallback_provider' | 'quarantine_tool' | 'abort' | 'prompt_repair';
  backoffMs: number;
  maxRetries: number;
  shouldRetry: boolean;
  reason: string;
}

export class FailureRecoveryManager {
  private static instance: FailureRecoveryManager;

  public static getInstance(): FailureRecoveryManager {
    if (!FailureRecoveryManager.instance) {
      FailureRecoveryManager.instance = new FailureRecoveryManager();
    }
    return FailureRecoveryManager.instance;
  }

  /**
   * Classifies an unhandled exception or status into structured failure taxonomy.
   */
  public classifyError(error: any): EnhancedFailureCategory {
    if (!error) return 'bug';

    const msg = (error.message || String(error)).toLowerCase();
    const status = error.status || error.statusCode || error.response?.status;

    if (status === 429 || msg.includes('429') || msg.includes('rate limit') || msg.includes('resource_exhausted')) {
      return 'rate_limit';
    }

    if (status === 401 || status === 403 || msg.includes('unauthorized') || msg.includes('permission denied') || msg.includes('auth')) {
      return 'auth';
    }

    if (
      status === 500 ||
      status === 502 ||
      status === 503 ||
      status === 504 ||
      msg.includes('service unavailable') ||
      msg.includes('bad gateway')
    ) {
      return 'provider_outage';
    }

    if (
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      error.name === 'TimeoutError' ||
      error.code === 'ETIMEDOUT'
    ) {
      return 'timeout';
    }

    if (
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('network error') ||
      msg.includes('socket hang up')
    ) {
      return 'network_reset';
    }

    if (msg.includes('policy') || msg.includes('blocked by policy') || msg.includes('security')) {
      return 'policy_violation';
    }

    return 'bug';
  }

  /**
   * Computes recommended recovery strategy given failure category and consecutive attempt count.
   */
  public getRecoveryStrategy(category: EnhancedFailureCategory, attempt: number = 1): RecoveryAction {
    switch (category) {
      case 'rate_limit':
        if (attempt <= 3) {
          // Exponential backoff: 2s, 4s, 8s
          const backoff = Math.min(1000 * Math.pow(2, attempt), 10000);
          return {
            action: 'retry_backoff',
            backoffMs: backoff,
            maxRetries: 3,
            shouldRetry: true,
            reason: `Rate limit encountered. Backing off for ${backoff}ms before retry.`
          };
        }
        return {
          action: 'fallback_provider',
          backoffMs: 0,
          maxRetries: 3,
          shouldRetry: true,
          reason: 'Rate limit retries exhausted on primary provider. Failing over to secondary provider.'
        };

      case 'provider_outage':
        return {
          action: 'fallback_provider',
          backoffMs: 500,
          maxRetries: 2,
          shouldRetry: true,
          reason: 'Upstream provider outage detected. Routing immediately to standby provider.'
        };

      case 'network_reset':
        if (attempt <= 3) {
          const jitter = Math.floor(Math.random() * 500);
          const backoff = 1000 * attempt + jitter;
          return {
            action: 'retry_backoff',
            backoffMs: backoff,
            maxRetries: 3,
            shouldRetry: true,
            reason: `Network reset encountered. Retrying connection after ${backoff}ms.`
          };
        }
        return {
          action: 'fallback_provider',
          backoffMs: 0,
          maxRetries: 3,
          shouldRetry: true,
          reason: 'Network disconnect repeated. Triggering fallback provider.'
        };

      case 'timeout':
        if (attempt <= 2) {
          return {
            action: 'retry_backoff',
            backoffMs: 1500,
            maxRetries: 2,
            shouldRetry: true,
            reason: 'Operation timed out. Retrying with adjusted timeout backoff.'
          };
        }
        return {
          action: 'abort',
          backoffMs: 0,
          maxRetries: 2,
          shouldRetry: false,
          reason: 'Operation timed out repeatedly. Halting to preserve budget.'
        };

      case 'auth':
      case 'policy_violation':
        return {
          action: 'abort',
          backoffMs: 0,
          maxRetries: 0,
          shouldRetry: false,
          reason: 'Security or policy violation cannot be auto-retried. Halting execution.'
        };

      default:
        return {
          action: 'prompt_repair',
          backoffMs: 0,
          maxRetries: 2,
          shouldRetry: attempt <= 2,
          reason: 'Unhandled runtime failure. Attempting prompt repair diagnostic.'
        };
    }
  }
}
