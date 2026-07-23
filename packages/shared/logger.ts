export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export class ConsoleLogger implements Logger {
  private enableDebug: boolean;

  constructor(enableDebug = false) {
    this.enableDebug = enableDebug;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.enableDebug) {
      console.debug(`[SSE Debug] ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    console.info(`[SSE Info] ${message}`, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(`[SSE Warn] ${message}`, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    console.error(`[SSE Error] ${message}`, ...args);
  }
}

export class LoggerManager {
  private static instance: Logger;

  private static customLogger: Logger | null = null;

  static getLogger(): Logger {
    if (this.customLogger) {
      return this.customLogger;
    }

    if (!this.instance) {
      this.instance = new ConsoleLogger();
    }
    return this.instance;
  }

  static setLogger(logger: Logger): void {
    this.customLogger = logger;
  }

  static resetToDefault(): void {
    this.customLogger = null;
  }
}
