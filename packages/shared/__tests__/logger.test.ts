import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsoleLogger, LoggerManager, type Logger } from '../logger';

describe('ConsoleLogger', () => {
  it('默认不输出 debug 日志', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    new ConsoleLogger().debug('hidden', { detail: true });

    expect(debug).not.toHaveBeenCalled();
  });

  it('启用时为 debug 输出添加前缀并转发额外参数', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    new ConsoleLogger(true).debug('visible', 1, { detail: true });

    expect(debug).toHaveBeenCalledWith('[SSE Debug] visible', 1, { detail: true });
  });

  it('为 info、warning 和 error 输出添加前缀并转发额外参数', () => {
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

  it('惰性返回稳定的默认 ConsoleLogger', () => {
    const first = LoggerManager.getLogger();

    expect(first).toBeInstanceOf(ConsoleLogger);
    expect(LoggerManager.getLogger()).toBe(first);
  });

  it('返回已配置的自定义 Logger', () => {
    const custom: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    LoggerManager.setLogger(custom);

    expect(LoggerManager.getLogger()).toBe(custom);
  });

  it('重置后恢复原始默认 Logger', () => {
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

  it('允许一个自定义 Logger 替换另一个', () => {
    const first = new ConsoleLogger(true);
    const second = new ConsoleLogger();

    LoggerManager.setLogger(first);
    LoggerManager.setLogger(second);

    expect(LoggerManager.getLogger()).toBe(second);
  });
});
