// Logger configuration
const DEBUG = process.env['DEBUG'] === 'true';

export interface Logger {
  info: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
  error: (message: string, error?: unknown) => void;
  warn: (message: string, ...args: unknown[]) => void;
}

export class ConsoleLogger implements Logger {
  private prefix?: string;
  private logQueue: (() => void)[] = [];
  private isProcessing = false;

  constructor(prefix?: string) {
    this.prefix = prefix ?? '';
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.logQueue.length === 0) return;

    this.isProcessing = true;
    while (this.logQueue.length > 0) {
      const logFn = this.logQueue.shift();
      if (logFn) {
        logFn();
        // Small delay to ensure console output is flushed
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    this.isProcessing = false;
  }

  private queueLog(logFn: () => void): void {
    this.logQueue.push(logFn);
    void this.processQueue();
  }

  private formatMessage(message: string): string {
    const timestamp = new Date().toISOString().substring(11, 19); // HH:MM:SS
    return `${timestamp} [${this.prefix ?? 'Logger'}] ${message}`;
  }

  info(message: string, ...args: unknown[]): void {
    this.queueLog(() => {
      if (args.length > 0) {
        console.log(this.formatMessage(message), ...args);
      } else {
        console.log(this.formatMessage(message));
      }
    });
  }

  debug(message: string, ...args: unknown[]): void {
    if (DEBUG) {
      this.queueLog(() => {
        if (args.length > 0) {
          console.debug(this.formatMessage(`[DEBUG] ${message}`), ...args);
        } else {
          console.debug(this.formatMessage(`[DEBUG] ${message}`));
        }
      });
    }
  }

  error(message: string, error?: unknown): void {
    this.queueLog(() => {
      const errorMsg = error instanceof Error ? error.message : JSON.stringify(error ?? '');
      console.error(this.formatMessage(`❌ ${message}`), errorMsg);
    });
  }

  warn(message: string, ...args: unknown[]): void {
    this.queueLog(() => {
      if (args.length > 0) {
        console.warn(this.formatMessage(`⚠️  ${message}`), ...args);
      } else {
        console.warn(this.formatMessage(`⚠️  ${message}`));
      }
    });
  }
}

// Export a default logger instance
export const logger: Logger = new ConsoleLogger();

// Export a factory function for creating prefixed loggers
export const createLogger = (prefix: string): Logger => new ConsoleLogger(prefix);
