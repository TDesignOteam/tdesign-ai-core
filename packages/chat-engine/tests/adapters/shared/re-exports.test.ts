import { describe, expect, it } from 'vitest';

import * as sharedAdapters from '../../../adapters/shared';
import * as aguiUtils from '../../../adapters/agui/utils';
import { activityManager } from '../../../adapters/agui/ActivityManager';

describe('adapters/shared re-exports', () => {
  it('re-exports the AG-UI factories and merge utilities as the same implementations', () => {
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

  it('re-exports the AG-UI activity manager singleton', () => {
    expect(sharedAdapters.activityManager).toBe(activityManager);
  });
});
