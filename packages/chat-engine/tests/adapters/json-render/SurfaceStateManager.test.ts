import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SurfaceStateManager } from '../../../adapters/json-render/SurfaceStateManager';
import type { JsonRenderSchema } from '../../../adapters/json-render/types/core';

describe('SurfaceStateManager', () => {
  let manager: SurfaceStateManager;
  const schema: JsonRenderSchema = {
    root: 'root',
    elements: { root: { type: 'Text', props: {} } },
    data: { count: 1 },
  };

  beforeEach(() => {
    manager = new SurfaceStateManager();
  });

  it('registers, queries, replaces, and deletes surfaces', () => {
    manager.registerSurface('s1', schema, 'catalog');
    expect(manager.hasSurface('s1')).toBe(true);
    expect(manager.getSchema('s1')).toBe(schema);
    expect(manager.getSurface('s1')).toMatchObject({ surfaceId: 's1', catalogId: 'catalog' });

    const next: JsonRenderSchema = { ...schema, elements: { ...schema.elements, extra: { type: 'Text', props: {} } } };
    expect(manager.updateSchema('s1', next)).toBe(true);
    expect(manager.getSchema('s1')).toBe(next);
    expect(manager.deleteSurface('s1')).toBe(true);
    expect(manager.deleteSurface('s1')).toBe(false);
  });

  it('updates cached data and notifies subscribers in a microtask', async () => {
    manager.registerSurface('s1', schema);
    const subscriber = vi.fn();
    manager.subscribe('s1', subscriber);
    expect(manager.updateData('s1', '/count', 'replace', 2)).toBe(true);
    expect(subscriber).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({ data: { count: 2 } }));
  });

  it('honors unsubscribe before queued notification and isolates throwing subscribers', async () => {
    manager.registerSurface('s1', schema);
    const stopped = vi.fn();
    const stop = manager.subscribe('s1', stopped);
    manager.subscribe('s1', () => {
      throw new Error('subscriber failed');
    });
    const surviving = vi.fn();
    manager.subscribe('s1', surviving);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    manager.updateData('s1', '/count', 'replace', 3);
    stop();
    await Promise.resolve();
    expect(stopped).not.toHaveBeenCalled();
    expect(surviving).toHaveBeenCalledOnce();
  });

  it('returns false for unknown updates and reports cache statistics', () => {
    expect(manager.updateData('missing', '/x', 'replace', 1)).toBe(false);
    expect(manager.updateSchema('missing', schema)).toBe(false);
    manager.registerSurface('s1', schema);
    const unsubscribe = manager.subscribe('s1', () => undefined);
    expect(manager.getStats()).toMatchObject({
      count: 1,
      surfaces: [{ id: 's1', elementsCount: 1, subscriberCount: 1 }],
    });
    unsubscribe();
    expect(manager.getStats().surfaces[0].subscriberCount).toBe(0);
  });

  it('clears all surfaces and subscriptions', async () => {
    manager.registerSurface('s1', schema);
    const subscriber = vi.fn();
    manager.subscribe('s1', subscriber);
    manager.updateData('s1', '/count', 'replace', 2);
    manager.clearAll();
    await Promise.resolve();
    expect(manager.getAllSurfaceIds()).toEqual([]);
    expect(subscriber).not.toHaveBeenCalled();
  });
});
