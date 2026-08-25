import { describe, expect, it } from 'vitest';

import * as sharedAdapters from '..';
import * as aguiUtils from '../../../adapters/agui/utils';
import { activityManager } from '../../../adapters/agui/ActivityManager';

describe('adapters/shared 再导出', () => {
  it('将 AG-UI 工厂与合并工具再导出为相同实现', () => {
    for (const name of [
      'createAIMessageContent',
      'createToolCallContent',
      'createActivityContent',
      'createMarkdownContent',
      'createTextContent',
      'createThinkingContent',
      'createSuggestionContent',
      'mergeStringContent',
      'updateToolCall',
      'handleSuggestionToolCall',
      'parseSSEData',
    ] as const) {
      expect(sharedAdapters[name]).toBe(aguiUtils[name]);
    }
  });

  it('再导出 AG-UI 活动管理器单例', () => {
    expect(sharedAdapters.activityManager).toBe(activityManager);
  });
});
