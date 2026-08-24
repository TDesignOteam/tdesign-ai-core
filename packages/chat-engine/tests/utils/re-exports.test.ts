import { describe, expect, it } from 'vitest';

import * as shared from '../../../shared/index';
import ChatEngineEventEmitter from '../../utils/eventEmitter';
import * as chatEngineImmutablePatch from '../../utils/immutable-patch';
import * as chatEngineLogger from '../../utils/logger';

describe('chat-engine utils re-exports', () => {
  it('re-exports the shared event emitter as the default export', () => {
    expect(ChatEngineEventEmitter).toBe(shared.SimpleEventEmitter);
  });

  it('re-exports the shared immutable patch helpers', () => {
    expect(chatEngineImmutablePatch.applyPatchImmutable).toBe(shared.applyPatchImmutable);
    expect(chatEngineImmutablePatch.applyPatch).toBe(shared.applyPatch);
  });

  it('re-exports the shared logger implementations', () => {
    expect(chatEngineLogger.LoggerManager).toBe(shared.LoggerManager);
    expect(chatEngineLogger.ConsoleLogger).toBe(shared.ConsoleLogger);
  });
});
