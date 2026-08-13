import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsoleLogger, LoggerManager, type Logger } from '../../utils/logger';

describe('ConsoleLogger', () => {
  it('prefixes info, warning, and error output', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = new ConsoleLogger();

    logger.info('connected', { id: 1 });
    logger.warn('slow');
    logger.error('failed', 500);

    expect(info).toHaveBeenCalledWith('[SSE Info] connected', { id: 1 });
    expect(warn).toHaveBeenCalledWith('[SSE Warn] slow');
    expect(error).toHaveBeenCalledWith('[SSE Error] failed', 500);
  });

  it('only emits debug output when enabled', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    new ConsoleLogger().debug('hidden');
    new ConsoleLogger(true).debug('visible', 1);

    expect(debug).toHaveBeenCalledOnce();
    expect(debug).toHaveBeenCalledWith('[SSE Debug] visible', 1);
  });
});

describe('LoggerManager', () => {
  afterEach(() => LoggerManager.resetToDefault());

  it('returns a stable default logger', () => {
    expect(LoggerManager.getLogger()).toBeInstanceOf(ConsoleLogger);
    expect(LoggerManager.getLogger()).toBe(LoggerManager.getLogger());
  });

  it('uses a custom logger until reset', () => {
    const custom: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    LoggerManager.setLogger(custom);
    expect(LoggerManager.getLogger()).toBe(custom);

    LoggerManager.resetToDefault();
    expect(LoggerManager.getLogger()).toBeInstanceOf(ConsoleLogger);
    expect(LoggerManager.getLogger()).not.toBe(custom);
  });
});
