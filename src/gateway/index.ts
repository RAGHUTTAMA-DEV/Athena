export interface Gateway {
  start(): Promise<void>;
  stop(): Promise<void>;
}
