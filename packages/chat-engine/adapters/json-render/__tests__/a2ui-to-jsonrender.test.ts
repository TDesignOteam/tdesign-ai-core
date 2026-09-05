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
              action: { event: { name: 'submit', context: { name: { path: '/name' } } } },
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
          props: { label: 'Submit', action: { event: { name: 'submit', context: { name: { path: '/name' } } } } },
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
      elements: { root: { type: 'Text', props: { content: 'old' } } },
      data: {},
    };
    const updated = applyA2UIUpdates(schema, [{ id: 'root', component: 'Text', text: 'new' }]);
    // Text 组件的 A2UI `text` 字段会被 mapProps 映射为 json-render 的 `content`
    expect(updated.elements.root).toEqual({ type: 'Text', props: { content: 'new' } });
    expect(updated).not.toBe(schema);
    expect(schema.elements.root.props).toEqual({ content: 'old' });
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

  it('解码数据路径中已转义的 JSON Pointer 令牌（~1 与 ~0）', () => {
    const originalData = Object.freeze({ 'a/b': Object.freeze({ '~key': 'old' }) });
    const schema: JsonRenderSchema = { root: 'root', elements: {}, data: originalData };

    const updated = applyA2UIDataUpdate(schema, '/a~1b/~0key', 'add', 'value');

    expect(updated.data).toEqual({ 'a/b': { '~key': 'value' } });
    expect(updated.data?.['a/b']).not.toBe(originalData['a/b']);
    expect(originalData['a/b']['~key']).toBe('old');
  });

  it('应用后续嵌套数据更新时保持先前的 schema 不可变（copy-on-write along path）', () => {
    const schema: JsonRenderSchema = {
      root: 'root',
      elements: {},
      data: { profile: { name: 'Ada' }, items: [{ id: 1 }] },
    };

    const updated = applyA2UIDataUpdate(schema, '/profile/name', 'replace', 'Grace');
    const appended = applyA2UIDataUpdate(updated, '/items/1', 'add', { id: 2 });

    // 原始 schema 保持不可变
    expect(schema.data).toEqual({ profile: { name: 'Ada' }, items: [{ id: 1 }] });
    // 中间态数据只更新到指定路径
    expect(updated.data).toEqual({ profile: { name: 'Grace' }, items: [{ id: 1 }] });
    // 最终态两条 patch 都生效
    expect(appended.data).toEqual({ profile: { name: 'Grace' }, items: [{ id: 1 }, { id: 2 }] });
    // 路径上的中间节点是全新引用（copy-on-write）
    expect(updated.data?.profile).not.toBe(schema.data?.profile);
    expect(appended.data?.items).not.toBe(updated.data?.items);
  });

  it('冻结源数据（Object.freeze）时也能安全应用子路径 patch', () => {
    // 模拟 React state / immer 冻结数据的场景
    const frozenData = Object.freeze({
      form: Object.freeze({ city: '' }),
      result: Object.freeze({ statusLabel: '', tempLabel: '-- °C' }),
    });
    const schema: JsonRenderSchema = { root: 'root', elements: {}, data: frozenData as any };

    // 子路径 patch 不应抛 "Cannot assign to read only property" 错误
    const patched = applyA2UIDataUpdate(schema, '/result/tempLabel', 'replace', '26.5 °C');

    expect(patched.data).toEqual({
      form: { city: '' },
      result: { statusLabel: '', tempLabel: '26.5 °C' },
    });
    // 原对象保持冻结不变
    expect(frozenData.result.tempLabel).toBe('-- °C');
    // 路径外的分支（form）保持引用共享，避免不必要的深拷贝
    expect((patched.data as any).form).toBe(frozenData.form);
  });

  it('通用 { path } 扫描：任意字段的 { path } 结构自动转成 <field>Path', () => {
    const schema = convertA2UIMessagesToJsonRender([
      { createSurface: { surfaceId: 's', catalogId: 'default' } },
      {
        updateComponents: {
          surfaceId: 's',
          components: [
            {
              id: 'root',
              component: 'CustomCard',
              // 各种字段的数据绑定语法，均应自动转为 <field>Path
              title: { path: '/meta/title' },
              subtitle: { path: '/meta/subtitle' },
              href: { path: '/meta/url' },
              // 静态值保持不变
              theme: 'primary',
              // disabled 也是通用字段
              disabled: { path: '/locked' },
            },
          ],
        },
      },
    ]);

    expect(schema?.elements.root.props).toMatchObject({
      titlePath: '/meta/title',
      subtitlePath: '/meta/subtitle',
      hrefPath: '/meta/url',
      theme: 'primary',
      disabledPath: '/locked',
    });
    // 原始字段应已被删除（避免透传给底层组件造成困惑）
    expect(schema?.elements.root.props).not.toHaveProperty('title');
    expect(schema?.elements.root.props).not.toHaveProperty('subtitle');
    expect(schema?.elements.root.props).not.toHaveProperty('href');
    expect(schema?.elements.root.props).not.toHaveProperty('disabled');
  });

  it('Text 组件的 text 字段：静态字符串转 content，数据绑定转 contentPath', () => {
    const schema = convertA2UIMessagesToJsonRender([
      { createSurface: { surfaceId: 's', catalogId: 'default' } },
      {
        updateComponents: {
          surfaceId: 's',
          components: [
            { id: 'root', component: 'Column', children: ['t1', 't2'] },
            { id: 't1', component: 'Text', text: '静态标题' },
            { id: 't2', component: 'Text', text: { path: '/result/statusLabel' } },
          ],
        },
      },
    ]);

    expect(schema?.elements.t1.props).toEqual({ content: '静态标题' });
    expect(schema?.elements.t2.props).toMatchObject({ contentPath: '/result/statusLabel' });
    // Text 特殊映射后，中间 textPath 字段应被清理
    expect(schema?.elements.t2.props).not.toHaveProperty('textPath');
    expect(schema?.elements.t2.props).not.toHaveProperty('text');
  });

  it('安全性：只含 path 一个字段的对象才视为数据绑定，避免误伤业务对象', () => {
    const schema = convertA2UIMessagesToJsonRender([
      { createSurface: { surfaceId: 's', catalogId: 'default' } },
      {
        updateComponents: {
          surfaceId: 's',
          components: [
            {
              id: 'root',
              component: 'RequestForm',
              // 业务配置对象（含多个字段）→ 不应被误认为数据绑定
              request: { path: '/api/user', method: 'GET' },
              // 空对象也不视为数据绑定
              emptyConfig: {},
              // 只含 path 的才是数据绑定
              titlePath: '/meta/title', // 已经是 path 后缀形式，保持不变
              title: { path: '/meta/title' }, // 会被通用扫描转
            },
          ],
        },
      },
    ]);

    // 业务配置对象应原样保留
    expect(schema?.elements.root.props).toMatchObject({
      request: { path: '/api/user', method: 'GET' },
      emptyConfig: {},
    });
    // 显式声明的 xxxPath 保持不变
    expect(schema?.elements.root.props.titlePath).toBe('/meta/title');
    // { path } 单字段结构被识别为数据绑定
    expect(schema?.elements.root.props).not.toHaveProperty('title');
  });
});
