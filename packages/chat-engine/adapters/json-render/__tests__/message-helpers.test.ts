import { describe, expect, it } from 'vitest';

import {
  extractSurfaceId,
  groupMessagesBySurface,
  hasCreationMessages,
  hasDeletionMessages,
  isUIMessages,
} from '../message-helpers';

describe('A2UI 消息辅助函数', () => {
  const create = { createSurface: { surfaceId: 'a', catalogId: 'default' } };
  const updateData = { updateDataModel: { surfaceId: 'a', path: '/count', op: 'replace' as const, value: 1 } };
  const remove = { deleteSurface: { surfaceId: 'a' } };

  it('按消息顺序提取第一个 Surface ID', () => {
    expect(extractSurfaceId([updateData, create])).toBe('a');
    expect(extractSurfaceId([{}])).toBeNull();
  });

  it('区分 UI、创建、删除与仅数据的消息批次', () => {
    expect(isUIMessages([updateData])).toBe(false);
    expect(isUIMessages([create])).toBe(true);
    expect(hasCreationMessages([create])).toBe(true);
    expect(hasDeletionMessages([remove])).toBe(true);
  });

  it('按 Surface 分组消息并保持顺序，丢弃无法识别的消息', () => {
    const b = { updateDataModel: { surfaceId: 'b', path: '/name', value: 'B' } };
    const groups = groupMessagesBySurface<Record<string, unknown>, Record<string, unknown>, unknown>([
      create,
      b,
      updateData,
      {},
    ]);
    expect([...groups.keys()]).toEqual(['a', 'b']);
    expect(groups.get('a')).toEqual([create, updateData]);
    expect(groups.get('b')).toEqual([b]);
  });
});
