import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionManager } from '../../server/connection-manager';
import { TimeoutError } from '../../server/errors';
import { SSEConnectionState } from '../../server/types';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  LoggerManager: { getLogger: () => logger },
}));

describe('ConnectionManager', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('records connection duration using the current time', () => {
    const manager = new ConnectionManager('connection-1');
    manager.startConnection();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.250Z'));

    manager.onConnectionSuccess();

    expect(manager.getStats()).toEqual({ connectionTime: 250 });
    expect(logger.info).toHaveBeenCalledWith('Connection established in 250ms');
  });

  it('returns defensive copies of connection information and statistics', () => {
    const manager = new ConnectionManager('connection-1');
    const error = new Error('failed');
    manager.updateState(SSEConnectionState.ERROR, error);

    const info = manager.getConnectionInfo();
    info.stats.connectionTime = 999;

    expect(info).toMatchObject({
      id: 'connection-1',
      retryCount: 0,
      lastActivity: Date.now(),
      stats: { lastError: error },
    });
    expect(manager.getStats()).toEqual({ lastError: error });
  });

  it('logs timeout errors, cleans statistics, and reports no retry', () => {
    const manager = new ConnectionManager('connection-1');
    const error = new TimeoutError();

    expect(manager.handleConnectionError(error)).toBe(false);

    expect(logger.error).toHaveBeenCalledWith('Connection connection-1 error:', error);
    expect(logger.info).toHaveBeenCalledWith('Timeout error occurred, no retry will be attempted');
    expect(manager.getStats()).toEqual({});
  });

  it('clears recorded statistics during cleanup', () => {
    const manager = new ConnectionManager('connection-1');
    manager.updateState(SSEConnectionState.ERROR, new Error('failed'));

    manager.cleanup();

    expect(manager.getStats()).toEqual({});
    expect(logger.debug).toHaveBeenCalledWith('Connection manager connection-1 cleaned up');
  });
});
