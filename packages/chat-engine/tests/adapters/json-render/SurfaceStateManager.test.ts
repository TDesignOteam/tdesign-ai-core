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

  it('注册、查询、替换并删除 Surface', () => {
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

  it('更新缓存数据并在微任务中通知订阅者', async () => {
    manager.registerSurface('s1', schema);
    const subscriber = vi.fn();
    manager.subscribe('s1', subscriber);
    expect(manager.updateData('s1', '/count', 'replace', 2)).toBe(true);
    expect(subscriber).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({ data: { count: 2 } }));
  });

  it('支持在排队通知前取消订阅并隔离抛错的订阅者', async () => {
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

  it('对未知更新返回 false 并报告缓存统计信息', () => {
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

  it('清空全部 Surface 和订阅', async () => {
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
