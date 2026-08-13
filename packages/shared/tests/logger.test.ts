import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsoleLogger, LoggerManager, type Logger } from '../logger';

describe('ConsoleLogger', () => {
  it('does not write debug output by default', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    new ConsoleLogger().debug('hidden', { detail: true });

    expect(debug).not.toHaveBeenCalled();
  });

  it('prefixes debug output and forwards extra arguments when enabled', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    new ConsoleLogger(true).debug('visible', 1, { detail: true });

    expect(debug).toHaveBeenCalledWith('[SSE Debug] visible', 1, { detail: true });
  });

  it('prefixes info, warning, and error output and forwards extra arguments', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = new ConsoleLogger();

    logger.info('connected', 42, { id: 'request' });
    logger.warn('delayed', 42, { id: 'request' });
    logger.error('failed', 42, { id: 'request' });

    expect(info).toHaveBeenCalledWith('[SSE Info] connected', 42, { id: 'request' });
    expect(warn).toHaveBeenCalledWith('[SSE Warn] delayed', 42, { id: 'request' });
    expect(error).toHaveBeenCalledWith('[SSE Error] failed', 42, { id: 'request' });
  });
});

describe('LoggerManager', () => {
  afterEach(() => {
    LoggerManager.resetToDefault();
  });

  it('lazily returns a stable default ConsoleLogger', () => {
    const first = LoggerManager.getLogger();

    expect(first).toBeInstanceOf(ConsoleLogger);
    expect(LoggerManager.getLogger()).toBe(first);
  });

  it('returns a configured custom logger', () => {
    const custom: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    LoggerManager.setLogger(custom);

    expect(LoggerManager.getLogger()).toBe(custom);
  });

  it('restores the original default logger after reset', () => {
    const defaultLogger = LoggerManager.getLogger();
    const custom: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    LoggerManager.setLogger(custom);

    LoggerManager.resetToDefault();

    expect(LoggerManager.getLogger()).toBe(defaultLogger);
    expect(LoggerManager.getLogger()).not.toBe(custom);
  });

  it('allows one custom logger to replace another', () => {
    const first = new ConsoleLogger(true);
    const second = new ConsoleLogger();

    LoggerManager.setLogger(first);
    LoggerManager.setLogger(second);

    expect(LoggerManager.getLogger()).toBe(second);
  });
});
