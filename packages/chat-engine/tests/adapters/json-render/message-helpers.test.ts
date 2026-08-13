import { describe, expect, it } from 'vitest';

import {
  extractSurfaceId,
  groupMessagesBySurface,
  hasCreationMessages,
  hasDeletionMessages,
  isUIMessages,
} from '../../../adapters/json-render/message-helpers';

describe('A2UI message helpers', () => {
  const create = { createSurface: { surfaceId: 'a', catalogId: 'default' } };
  const updateData = { updateDataModel: { surfaceId: 'a', path: '/count', op: 'replace' as const, value: 1 } };
  const remove = { deleteSurface: { surfaceId: 'a' } };

  it('extracts the first surface ID in message order', () => {
    expect(extractSurfaceId([updateData, create])).toBe('a');
    expect(extractSurfaceId([{}])).toBeNull();
  });

  it('classifies UI, creation, deletion, and data-only batches', () => {
    expect(isUIMessages([updateData])).toBe(false);
    expect(isUIMessages([create])).toBe(true);
    expect(hasCreationMessages([create])).toBe(true);
    expect(hasDeletionMessages([remove])).toBe(true);
  });

  it('groups messages by surface while preserving order and drops unidentified messages', () => {
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
