/* eslint-disable max-classes-per-file */
/**
 * Enhanced error classes for SSE client
 */

export class SSEError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly isRetryable: boolean = false,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'SSEError';
  }
}

export class ConnectionError extends SSEError {
  constructor(message: string, statusCode?: number, details?: unknown) {
    super(message, 'CONNECTION_ERROR', statusCode, true, details);
    this.name = 'ConnectionError';
  }
}

export class TimeoutError extends SSEError {
  constructor(details?: unknown, message = '请求超时') {
    super(message, 'TIMEOUT_ERROR', undefined, true, details);
    this.name = 'TimeoutError';
  }
}

export class ParseError extends SSEError {
  constructor(message: string, details?: unknown) {
    super(message, 'PARSE_ERROR', undefined, false, details);
    this.name = 'ParseError';
  }
}

export class ValidationError extends SSEError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', undefined, false, details);
    this.name = 'ValidationError';
  }
}
