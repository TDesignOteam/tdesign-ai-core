import { describe, expect, it } from 'vitest';

import { applyA2UIDataUpdate, applyA2UIUpdates, convertA2UIMessagesToJsonRender } from '../a2ui-to-jsonrender';
import type { JsonRenderSchema } from '../types/core';

describe('A2UI 到 json-render 的转换', () => {
  it('从增量的 Surface、组件与数据消息构建 schema', () => {
    const schema = convertA2UIMessagesToJsonRender([
      { createSurface: { surfaceId: 's', catalogId: 'default' } },
      {
        updateComponents: {
          surfaceId: 's',
          components: [
            { id: 'root', component: 'Column', children: ['field', 'button'], gap: 8, weight: 1 },
            { id: 'field', component: 'TextField', text: { path: '/name' }, disabled: { path: '/locked' } },
            {
              id: 'button',
              component: 'Button',
              text: 'Submit',
              action: { name: 'submit', context: { name: { path: '/name' } } },
            },
          ],
        },
      },
      { updateDataModel: { surfaceId: 's', value: { name: 'Ada', locked: false } } },
    ]);

    expect(schema).toMatchObject({
      root: 'root',
      data: { name: 'Ada', locked: false },
      elements: {
        root: {
          type: 'Column',
          children: ['field', 'button'],
          props: { size: 8, style: { flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '8px' } },
        },
        field: { type: 'TextField', props: { valuePath: '/name', disabledPath: '/locked' } },
        button: {
          type: 'Button',
          props: { label: 'Submit', action: { action: 'submit', params: { name: { path: '/name' } } } },
        },
      },
    });
  });

  it('映射列表模板、单个子元素、自定义类型与行布局属性', () => {
    const schema = convertA2UIMessagesToJsonRender([
      { createSurface: { surfaceId: 's', catalogId: 'default' } },
      {
        updateComponents: {
          surfaceId: 's',
          components: [
            { id: 'root', component: 'Row', child: 'list', gap: 4, distribution: 'end' },
            { id: 'list', component: 'List', children: { path: '/items', componentId: 'item' } },
            { id: 'item', component: 'CustomWidget', tone: 'quiet' },
          ],
        },
      },
    ]);
    expect(schema?.elements.root).toMatchObject({
      type: 'Row',
      children: ['list'],
      props: { gutter: 4, justify: 'end', style: { justifyContent: 'flex-end' } },
    });
    expect(schema?.elements.list.props).toMatchObject({ childrenPath: '/items', childTemplate: 'item' });
    expect(schema?.elements.item).toEqual({ type: 'CustomWidget', props: { tone: 'quiet' } });
  });

  it('要求存在带根组件的活跃 Surface', () => {
    expect(convertA2UIMessagesToJsonRender([])).toBeNull();
    expect(convertA2UIMessagesToJsonRender([{ createSurface: { surfaceId: 's', catalogId: 'x' } }])).toBeNull();
    expect(
      convertA2UIMessagesToJsonRender([
        { createSurface: { surfaceId: 's', catalogId: 'x' } },
        { updateComponents: { surfaceId: 's', components: [{ id: 'root', component: 'Text' }] } },
        { deleteSurface: { surfaceId: 's' } },
      ]),
    ).toBeNull();
  });

  it('以不可变方式应用组件更新', () => {
    const schema: JsonRenderSchema = {
      root: 'root',
      elements: { root: { type: 'Text', props: { text: 'old' } } },
      data: {},
    };
    const updated = applyA2UIUpdates(schema, [{ id: 'root', component: 'Text', text: 'new' }]);
    expect(updated.elements.root).toEqual({ type: 'Text', props: { text: 'new' } });
    expect(updated).not.toBe(schema);
    expect(schema.elements.root.props).toEqual({ text: 'old' });
  });

  it('新增、替换、移除数据以及替换根数据', () => {
    const schema: JsonRenderSchema = {
      root: 'root',
      elements: {},
      data: { profile: { name: 'Ada' }, items: ['a', 'b'] },
    };
    const added = applyA2UIDataUpdate(schema, '/profile/age', 'add', 30);
    const removed = applyA2UIDataUpdate(added, '/items/0', 'remove');
    const replaced = applyA2UIDataUpdate(removed, '/', 'replace', { ready: true });
    expect(removed.data).toEqual({ profile: { name: 'Ada', age: 30 }, items: ['b'] });
    expect(replaced.data).toEqual({ ready: true });
  });

  it('为数字路径构造缺失的数组并拒绝非对象根替换', () => {
    const schema: JsonRenderSchema = { root: 'root', elements: {}, data: {} };
    expect(applyA2UIDataUpdate(schema, '/items/0/name', 'add', 'first').data).toEqual({ items: [{ name: 'first' }] });
    expect(applyA2UIDataUpdate(schema, '/', 'replace', null)).toBe(schema);
  });

  it.todo('解码数据路径中已转义的 JSON Pointer 令牌（~1 与 ~0）');
  it.fails('应用后续嵌套数据更新时保持先前的 schema 不可变', () => {
    const schema: JsonRenderSchema = {
      root: 'root',
      elements: {},
      data: { profile: { name: 'Ada' }, items: [{ id: 1 }] },
    };

    const updated = applyA2UIDataUpdate(schema, '/profile/name', 'replace', 'Grace');
    const appended = applyA2UIDataUpdate(updated, '/items/1', 'add', { id: 2 });

    expect(schema.data).toEqual({ profile: { name: 'Ada' }, items: [{ id: 1 }] });
    expect(updated.data).toEqual({ profile: { name: 'Grace' }, items: [{ id: 1 }] });
    expect(appended.data).toEqual({ profile: { name: 'Grace' }, items: [{ id: 1 }, { id: 2 }] });
    expect(updated.data?.profile).not.toBe(schema.data?.profile);
    expect(appended.data?.items).not.toBe(updated.data?.items);
  });
});
