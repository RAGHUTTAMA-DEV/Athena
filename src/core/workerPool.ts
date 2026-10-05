import { CancellationToken, CancellationTokenSource } from './cancellation.js';
import { TelemetryManager, TraceContext } from './telemetry.js';

export type JobPriority = 'critical' | 'high' | 'normal' | 'low';

const PRIORITY_WEIGHTS: Record<JobPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3
};

export interface BackgroundTaskDefinition<T = any> {
  id?: string;
  name: string;
  priority?: JobPriority;
  execute: (token?: CancellationToken) => Promise<T>;
  timeoutMs?: number;
  traceContext?: TraceContext;
}

interface QueuedTask<T = any> {
  id: string;
  name: string;
  priority: JobPriority;
  execute: (token?: CancellationToken) => Promise<T>;
  queuedAt: number;
  timeoutMs?: number;
  traceContext?: TraceContext;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  cancellationSource: CancellationTokenSource;
}

export interface WorkerPoolStats {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  concurrency: number;
}

/**
 * BackgroundWorkerPool manages an asynchronous priority queue with strict
 * concurrency limits, ensuring background tasks never starve interactive chat.
 */
export class BackgroundWorkerPool {
  private static instance: BackgroundWorkerPool | null = null;
  private queue: QueuedTask[] = [];
  private activeCount: number = 0;
  private runningTasks: Map<string, QueuedTask> = new Map();
  private completedCount: number = 0;
  private failedCount: number = 0;
  private isShuttingDown: boolean = false;
  public readonly concurrency: number;

  constructor(concurrency?: number) {
    if (concurrency !== undefined) {
      this.concurrency = concurrency;
    } else {
      const envVal = parseInt(process.env.ATHENA_WORKER_CONCURRENCY || '2', 10);
      this.concurrency = isNaN(envVal) || envVal < 1 ? 2 : envVal;
    }
  }

  static getInstance(): BackgroundWorkerPool {
    if (!BackgroundWorkerPool.instance) {
      BackgroundWorkerPool.instance = new BackgroundWorkerPool();
    }
    return BackgroundWorkerPool.instance;
  }

  /**
   * Submits a task to the background priority queue.
   */
  submit<T = any>(task: BackgroundTaskDefinition<T>): Promise<T> {
    if (this.isShuttingDown) {
      return Promise.reject(new Error('BackgroundWorkerPool is shutting down; cannot accept new tasks.'));
    }

    const id = task.id || `bg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const priority = task.priority || 'normal';
    const cancellationSource = new CancellationTokenSource();

    return new Promise<T>((resolve, reject) => {
      const queuedTask: QueuedTask<T> = {
        id,
        name: task.name,
        priority,
        execute: task.execute,
        queuedAt: Date.now(),
        timeoutMs: task.timeoutMs,
        traceContext: task.traceContext || TelemetryManager.getInstance().getActiveContext() || undefined,
        resolve,
        reject,
        cancellationSource
      };

      this.queue.push(queuedTask);
      this.sortQueue();
      this.processNext();
    });
  }

  /**
   * Sorts the queue: lower numeric weight (critical = 0) first,
   * then earlier queuedAt (FIFO within same priority).
   */
  private sortQueue(): void {
    this.queue.sort((a, b) => {
      const pDiff = PRIORITY_WEIGHTS[a.priority] - PRIORITY_WEIGHTS[b.priority];
      if (pDiff !== 0) return pDiff;
      return a.queuedAt - b.queuedAt;
    });
  }

  private processNext(): void {
    if (this.isShuttingDown || this.activeCount >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    this.activeCount++;
    this.runningTasks.set(task.id, task);

    // Handle timeout if specified
    let timeoutTimer: NodeJS.Timeout | null = null;
    if (task.timeoutMs && task.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        task.cancellationSource.cancel();
      }, task.timeoutMs);
    }

    const prevContext = TelemetryManager.getInstance().getActiveContext();
    if (task.traceContext) {
      TelemetryManager.getInstance().setActiveContext(task.traceContext);
    }

    Promise.resolve()
      .then(() => task.execute(task.cancellationSource.token))
      .then(
        (result) => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          this.completedCount++;
          task.resolve(result);
        },
        (error) => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          this.failedCount++;
          task.reject(error);
        }
      )
      .finally(() => {
        TelemetryManager.getInstance().setActiveContext(prevContext);
        this.activeCount--;
        this.runningTasks.delete(task.id);
        this.processNext();
      });
  }

  /**
   * Cancels a queued or currently executing task.
   */
  cancelTask(id: string): boolean {
    // Check if task is still in queue
    const queueIndex = this.queue.findIndex(t => t.id === id);
    if (queueIndex !== -1) {
      const [removed] = this.queue.splice(queueIndex, 1);
      removed.cancellationSource.cancel();
      removed.reject(new Error(`Background task "${removed.name}" (${id}) was cancelled while queued.`));
      return true;
    }

    // Check if task is running
    const running = this.runningTasks.get(id);
    if (running) {
      running.cancellationSource.cancel();
      return true;
    }

    return false;
  }

  getStats(): WorkerPoolStats {
    return {
      queued: this.queue.length,
      running: this.activeCount,
      completed: this.completedCount,
      failed: this.failedCount,
      concurrency: this.concurrency
    };
  }

  /**
   * Waits for all current queued and running tasks to finish.
   */
  async drain(timeoutMs: number = 30000): Promise<void> {
    const startTime = Date.now();
    while (this.queue.length > 0 || this.activeCount > 0) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`WorkerPool drain timed out after ${timeoutMs}ms.`);
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  /**
   * Shuts down the worker pool, cancelling queued tasks.
   */
  async shutdown(timeoutMs: number = 5000): Promise<void> {
    this.isShuttingDown = true;
    // Cancel any queued tasks
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        task.cancellationSource.cancel();
        task.reject(new Error('BackgroundWorkerPool shutdown.'));
      }
    }
    // Wait for running tasks with timeout
    const startTime = Date.now();
    while (this.activeCount > 0) {
      if (Date.now() - startTime > timeoutMs) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}
