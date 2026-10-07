export interface CancellationToken {
  readonly isCancelled: boolean;
  readonly reason?: string;
  readonly abortSignal: AbortSignal;
  onCancel(callback: (reason?: string) => void): () => void;
  throwIfCancelled(): void;
}

export class CancellationTokenSource {
  private _isCancelled = false;
  private _reason?: string;
  private _listeners: Array<(reason?: string) => void> = [];
  private _abortController = new AbortController();
  private _children: CancellationTokenSource[] = [];

  constructor() {}

  get token(): CancellationToken {
    return {
      isCancelled: this._isCancelled,
      reason: this._reason,
      abortSignal: this._abortController.signal,
      onCancel: (callback: (reason?: string) => void) => {
        if (this._isCancelled) {
          try {
            callback(this._reason);
          } catch (e) {
            // Ignore listener error
          }
          return () => {};
        }
        this._listeners.push(callback);
        return () => {
          this._listeners = this._listeners.filter(cb => cb !== callback);
        };
      },
      throwIfCancelled: () => {
        if (this._isCancelled) {
          const err = new Error(this._reason || 'Operation cancelled');
          err.name = 'CancellationError';
          throw err;
        }
      }
    };
  }

  cancel(reason?: string): void {
    if (this._isCancelled) return;
    this._isCancelled = true;
    this._reason = reason || 'Operation cancelled';

    try {
      this._abortController.abort(this._reason);
    } catch (e) {
      // Ignore abort error
    }

    const listeners = [...this._listeners];
    for (const listener of listeners) {
      try {
        listener(this._reason);
      } catch (e) {
        console.error('[CancellationTokenSource] Error in cancellation listener:', e);
      }
    }

    // Propagate cancellation recursively to any spawned child sources
    for (const child of this._children) {
      child.cancel(reason);
    }
  }

  createChild(): CancellationTokenSource {
    const child = new CancellationTokenSource();
    if (this._isCancelled) {
      child.cancel(this._reason);
    } else {
      this._children.push(child);
    }
    return child;
  }
}
