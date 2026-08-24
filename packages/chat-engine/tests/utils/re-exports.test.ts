import { describe, expect, it } from 'vitest';

import * as shared from '../../../shared/index';
import ChatEngineEventEmitter from '../../utils/eventEmitter';
import * as chatEngineImmutablePatch from '../../utils/immutable-patch';
import * as chatEngineLogger from '../../utils/logger';

describe('chat-engine utils 再导出', () => {
  it('将共享的事件发射器再导出为默认导出', () => {
    expect(ChatEngineEventEmitter).toBe(shared.SimpleEventEmitter);
  });

  it('再导出共享的不可变补丁工具函数', () => {
    expect(chatEngineImmutablePatch.applyPatchImmutable).toBe(shared.applyPatchImmutable);
    expect(chatEngineImmutablePatch.applyPatch).toBe(shared.applyPatch);
  });

  it('再导出共享的 logger 实现', () => {
    expect(chatEngineLogger.LoggerManager).toBe(shared.LoggerManager);
    expect(chatEngineLogger.ConsoleLogger).toBe(shared.ConsoleLogger);
  });
});
