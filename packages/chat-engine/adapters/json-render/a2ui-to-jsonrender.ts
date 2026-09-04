/**
 * A2UI v0.9.1 → json-render 适配器
 * 将 A2UI v0.9.1协议转换为 json-render Schema
 *
 * 核心设计：
 * 1. A2UI 的 createSurface 只是初始化信号，不包含组件数据
 * 2. 组件数据通过 updateComponents 消息逐步发送（数组形式）
 * 3. 数据模型通过 updateDataModel 消息填充
 * 4. 组件字段名是 'component'，不是 'type'
 */

import type { UIElement } from '@json-render/core';
import type { JsonRenderSchema } from './types/core';
import type {
  A2UIComponent,
  A2UIMessage,
  A2UIRootDataModelUpdate,
  A2UISurfaceState,
  A2UIUpdateDataModel,
} from './types/a2ui';

/**
 * 组件类型映射表
 * A2UI 类型 → json-render 类型
 */
const TYPE_MAPPING: Record<string, string> = {
  // 基础组件
  Text: 'Text',
  Image: 'Image',
  Icon: 'Icon',
  Video: 'Video',
  AudioPlayer: 'AudioPlayer',
  Button: 'Button',
  TextField: 'TextField', // 映射到 TextField 以支持数据绑定
  CheckBox: 'Checkbox',
  ChoicePicker: 'Select',
  Slider: 'Slider',
  DateTimeInput: 'DatePicker',

  // 布局组件
  Card: 'Card',
  Row: 'Row',
  Column: 'Column', // A2UI Column → json-render Column（垂直布局），不是 Col（栅格列）
  Col: 'Col', // 保留 Col 映射给显式使用栅格的场景
  List: 'List',
  Tabs: 'Tabs',
  Divider: 'Divider',
  Modal: 'Dialog',
};

type DataNode = Record<string, unknown> | unknown[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isDataNode(value: unknown): value is DataNode {
  return isRecord(value) || Array.isArray(value);
}

function isArrayIndex(key: string): boolean {
  return /^\d+$/.test(key);
}

function getNodeValue(node: DataNode, key: string): unknown {
  return Array.isArray(node) ? node[parseInt(key, 10)] : node[key];
}

function setNodeValue(node: DataNode, key: string, value: unknown): void {
  if (Array.isArray(node)) {
    node[parseInt(key, 10)] = value;
  } else {
    node[key] = value;
  }
}

function hasNodeValue(node: DataNode, key: string): boolean {
  return Array.isArray(node) ? isArrayIndex(key) && parseInt(key, 10) in node : key in node;
}

function deleteNodeValue(node: DataNode, key: string): void {
  if (Array.isArray(node) && isArrayIndex(key)) {
    node.splice(parseInt(key, 10), 1);
  } else if (!Array.isArray(node)) {
    delete node[key];
  }
}

function isRootDataReplacement<TData extends Record<string, unknown>, TValue>(
  update: A2UIUpdateDataModel<TData, TValue>,
): update is A2UIRootDataModelUpdate<TData> {
  return (
    (update.op === undefined || update.op === 'replace') &&
    (update.path === undefined || update.path === '' || update.path === '/')
  );
}

function createEmptyDataModel<TData extends Record<string, unknown>>(): TData {
  // 用户数据模型由 A2UI 路径更新逐步构造；TData 是调用方声明的编译期契约，不在转换器内做字段级校验。
  return {} as TData;
}

/**
 * 属性映射函数
 * 将 A2UI v0.9.1 组件属性转换为 json-render 组件属性
 */
function mapProps<TProps extends Record<string, unknown>>(component: A2UIComponent<TProps>): Record<string, unknown> {
  // 排除 A2UI 特有字段，保留其他属性
  const { id: _id, component: componentType, weight, child: _child, children: _children, ...restProps } = component;

  // 用户/组件目录自定义 props 默认透传，只对已知 A2UI 字段做局部转换。
  const mappedProps: Record<string, unknown> = { ...restProps };

  // 处理 weight（flex-grow）
  if (weight !== undefined) {
    mappedProps.style = {
      ...recordOrEmpty(mappedProps.style),
      flexGrow: weight,
    };
  }

  // ============ 通用协议识别：{ path: '/xxx' } 数据绑定 ============
  //
  // A2UI v0.9.1 协议中，任何字段的值都可以是 `{ path: '/xxx' }` 结构，表示该字段
  // 绑定到 dataModel 的对应路径。这是一种"字段级修饰"语法糖，作用于任意字段。
  //
  // 例如：
  //   text: 'Hello'                    → 静态字符串
  //   text: { path: '/user/name' }     → 绑定到 dataModel.user.name
  //   disabled: false                  → 静态布尔
  //   disabled: { path: '/formLock' }  → 绑定到 dataModel.formLock
  //
  // 通用处理规则：值为 { path: string } 结构的字段，自动转换为 `<key>Path: '/xxx'`
  //   text     → textPath
  //   disabled → disabledPath
  //   checked  → checkedPath
  //   title    → titlePath
  //   ...（未来任何新增字段都自动支持，无需改这里）
  //
  // 特殊字段名重命名（如 A2UI `text` → json-render `content`）由 switch 分支
  // 二次映射：先由本段生成 `textPath`，switch 里再改成 `contentPath`。
  for (const key of Object.keys(mappedProps)) {
    const value = mappedProps[key];
    if (isRecord(value) && typeof value.path === 'string' && Object.keys(value).length === 1) {
      // 只有 `path` 一个字段的对象才认定为数据绑定（避免误伤有 path 属性的普通对象）
      mappedProps[`${key}Path`] = value.path;
      delete mappedProps[key];
    }
  }

  // 特定类型的属性转换
  switch (componentType) {
    case 'Text':
      // A2UI Text 的 text 属性 → json-render Text 的 content / contentPath
      //   - text: '静态字符串'         → content: '静态字符串'（在下方 string 分支处理）
      //   - text: { path: '/xxx' }    → 已由上面通用扫描转成 textPath，此处再重命名为 contentPath
      if (typeof mappedProps.text === 'string') {
        mappedProps.content = mappedProps.text;
        delete mappedProps.text;
      }
      if (typeof mappedProps.textPath === 'string') {
        mappedProps.contentPath = mappedProps.textPath;
        delete mappedProps.textPath;
      }
      break;

    case 'Button':
      // A2UI Button 的 text 属性 → json-render 的 label（或 children）
      if (mappedProps.text && typeof mappedProps.text === 'string') {
        mappedProps.label = mappedProps.text;
        delete mappedProps.text;
      }
      // A2UI action 字段原样透传给 json-render props.action。
      // 运行时由 a2ui-binding 里的 normalizeActionBinding 归一化，
      // 统一支持 v0.9.1 官方 event / functionCall 与 legacy 扁平格式。
      // 处理 theme 映射（A2UI 的 theme: 'primary' → TDesign 的 theme: 'primary'）
      // 保持不变，TDesign Button 支持 theme 属性
      break;

    case 'TextField':
      // A2UI TextField 的 text 数据绑定 → json-render 的 valuePath
      //   - text: { path } 已由通用扫描转成 textPath，此处再重命名为 valuePath
      if (typeof mappedProps.textPath === 'string') {
        mappedProps.valuePath = mappedProps.textPath;
        delete mappedProps.textPath;
      }
      break;

    case 'CheckBox':
      // A2UI CheckBox 的 checked 数据绑定 → json-render 的 valuePath
      //   - checked: { path } 已由通用扫描转成 checkedPath，此处再重命名为 valuePath
      if (typeof mappedProps.checkedPath === 'string') {
        mappedProps.valuePath = mappedProps.checkedPath;
        delete mappedProps.checkedPath;
      }
      break;

    case 'Column':
      // A2UI Column 的 gap 属性 → json-render Column 的 size 属性 + CSS gap 后备
      if (mappedProps.gap !== undefined) {
        mappedProps.size = mappedProps.gap;
        // 同时设置 CSS gap 作为后备方案
        mappedProps.style = {
          ...recordOrEmpty(mappedProps.style),
          display: 'flex',
          flexDirection: 'column',
          gap: `${mappedProps.gap}px`,
        };
        delete mappedProps.gap;
      }
      break;

    case 'Row':
      // A2UI Row 的 gap 属性 → json-render Row 的 gutter 属性 + CSS gap 后备
      if (mappedProps.gap !== undefined) {
        mappedProps.gutter = mappedProps.gap;
        // 同时设置 CSS gap 作为后备方案
        mappedProps.style = {
          ...recordOrEmpty(mappedProps.style),
          display: 'flex',
          flexDirection: 'row',
          gap: `${mappedProps.gap}px`,
        };
        delete mappedProps.gap;
      }
      // A2UI Row 的 distribution 属性 → json-render Row 的 justify 属性
      if (typeof mappedProps.distribution === 'string') {
        const distributionMap: Record<string, string> = {
          start: 'start',
          end: 'end',
          center: 'center',
          'space-between': 'space-between',
          'space-around': 'space-around',
        };
        mappedProps.justify = distributionMap[mappedProps.distribution] || mappedProps.distribution;
        // 同时设置 CSS justifyContent
        mappedProps.style = {
          ...recordOrEmpty(mappedProps.style),
          justifyContent: mappedProps.distribution === 'end' ? 'flex-end' : mappedProps.distribution,
        };
        delete mappedProps.distribution;
      }
      break;

    default:
      break;
  }

  return mappedProps;
}

/**
 * 转换单个 A2UI 组件为 json-render UIElement
 */
function convertComponent<TProps extends Record<string, unknown>>(component: A2UIComponent<TProps>): UIElement {
  // A2UI 使用 'component' 字段，不是 json-render 的 'type'
  const a2uiType = component.component;
  const mappedType = TYPE_MAPPING[a2uiType] || a2uiType;
  const props = mapProps(component);

  const element: UIElement = {
    type: mappedType,
    props,
  };

  // 处理子组件
  if (component.children) {
    if (Array.isArray(component.children)) {
      // 静态子组件数组
      element.children = component.children;
    } else if (typeof component.children === 'object' && component.children.path) {
      // 模板子组件（数据绑定列表）
      element.props.childrenPath = component.children.path;
      element.props.childTemplate = component.children.componentId;
    }
  } else if (component.child) {
    // 单子组件
    element.children = [component.child];
  }

  return element;
}

/**
 * 从 A2UI 消息数组构建 Surface 状态
 * 累积处理所有消息类型
 */
function buildSurfaceState<TProps extends Record<string, unknown>, TData extends Record<string, unknown>, TValue>(
  messages: A2UIMessage<TProps, TData, TValue>[],
): A2UISurfaceState<TProps, TData> | null {
  let surfaceState: A2UISurfaceState<TProps, TData> | null = null;

  for (const msg of messages) {
    // 1. createSurface - 初始化 Surface
    if (msg.createSurface) {
      surfaceState = {
        surfaceId: msg.createSurface.surfaceId,
        catalogId: msg.createSurface.catalogId,
        components: new Map(),
        dataModel: createEmptyDataModel<TData>(),
      };
    }

    // 2. updateComponents - 累积组件
    if (msg.updateComponents && surfaceState) {
      const { components } = msg.updateComponents;
      // A2UI v0.9.1 的 components 是数组
      if (Array.isArray(components)) {
        for (const comp of components) {
          surfaceState.components.set(comp.id, comp);
        }
      }
    }

    // 3. updateDataModel - 累积数据
    if (msg.updateDataModel && surfaceState) {
      const { path, op, value } = msg.updateDataModel;
      const operation = op || 'replace';

      if (isRootDataReplacement(msg.updateDataModel)) {
        // dataModel 是用户可定义对象；协议根替换只接受对象，避免把非对象写入 json-render data。
        if (isRecord(msg.updateDataModel.value)) {
          surfaceState.dataModel = msg.updateDataModel.value;
        }
      } else if (operation === 'replace' && path) {
        // 替换指定路径
        setValueByPath(surfaceState.dataModel, path, value);
      } else if (operation === 'add' && path) {
        // 添加到指定路径
        setValueByPath(surfaceState.dataModel, path, value);
      } else if (operation === 'remove' && path) {
        // 删除指定路径
        deleteValueByPath(surfaceState.dataModel, path);
      }
    }

    // 4. deleteSurface - 删除 Surface（返回 null）
    if (msg.deleteSurface && surfaceState?.surfaceId === msg.deleteSurface.surfaceId) {
      surfaceState = null;
    }
  }

  return surfaceState;
}

/**
 * 根据 JSON Pointer 路径设置值
 * 支持数组索引路径（如 /list/0/name）
 */
function setValueByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('/').filter(Boolean);
  let current: DataNode = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const nextKey = parts[i + 1];
    if (!hasNodeValue(current, key)) {
      // 如果下一个 key 是数字，创建数组；否则创建对象
      setNodeValue(current, key, isArrayIndex(nextKey) ? [] : {});
    }
    const next = getNodeValue(current, key);
    if (!isDataNode(next)) return;
    current = next;
  }

  if (parts.length > 0) {
    setNodeValue(current, parts[parts.length - 1], value);
  }
}

/**
 * 根据 JSON Pointer 路径删除值
 * 支持数组索引路径
 */
function deleteValueByPath(obj: Record<string, unknown>, path: string): void {
  const parts = path.split('/').filter(Boolean);
  let current: DataNode = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!hasNodeValue(current, key)) return;
    const next = getNodeValue(current, key);
    if (!isDataNode(next)) return;
    current = next;
  }

  if (parts.length > 0) {
    deleteNodeValue(current, parts[parts.length - 1]);
  }
}

/**
 * 将 Surface 状态转换为 json-render Schema
 */
function surfaceStateToSchema<TProps extends Record<string, unknown>, TData extends Record<string, unknown>>(
  state: A2UISurfaceState<TProps, TData>,
): JsonRenderSchema<TData> {
  const elements: Record<string, UIElement> = {};

  // 遍历所有组件，转换为 json-render elements
  state.components.forEach((component, id) => {
    elements[id] = convertComponent(component);
  });

  return {
    root: 'root', // A2UI v0.9.1 规定必须有 id 为 'root' 的组件
    elements,
    data: state.dataModel,
  };
}

/**
 * 转换 A2UI v0.9.1 消息数组为 json-render Schema
 *
 * 处理流程：
 * 1. 查找 createSurface 消息初始化 Surface
 * 2. 累积所有 updateComponents 消息构建组件树
 * 3. 累积所有 updateDataModel 消息填充数据
 * 4. 转换为 json-render Schema
 *
 * @param messages A2UI 消息数组
 * @returns json-render Schema 或 null
 */
export function convertA2UIMessagesToJsonRender<
  TProps extends Record<string, unknown> = Record<string, unknown>,
  TData extends Record<string, unknown> = Record<string, unknown>,
  TValue = unknown,
>(messages: A2UIMessage<TProps, TData, TValue>[]): JsonRenderSchema<TData> | null {
  if (!messages || messages.length === 0) {
    return null;
  }

  // 构建 Surface 状态
  const surfaceState = buildSurfaceState(messages);

  if (!surfaceState) {
    return null;
  }

  // 检查是否有 root 组件
  if (!surfaceState.components.has('root')) {
    return null;
  }

  // 转换为 json-render Schema
  return surfaceStateToSchema(surfaceState);
}

/**
 * 应用增量更新到现有 Schema
 *
 * @param schema 当前 json-render Schema
 * @param components A2UI updateComponents 的组件数组
 * @returns 更新后的 Schema
 */
export function applyA2UIUpdates<
  TProps extends Record<string, unknown> = Record<string, unknown>,
  TData extends Record<string, unknown> = Record<string, unknown>,
>(schema: JsonRenderSchema<TData>, components: A2UIComponent<TProps>[]): JsonRenderSchema<TData> {
  if (!Array.isArray(components)) {
    return schema;
  }

  const newElements = { ...schema.elements };

  for (const component of components) {
    // 转换组件并添加/更新
    newElements[component.id] = convertComponent(component);
  }

  return {
    ...schema,
    elements: newElements,
  };
}

/**
 * 应用数据模型更新到现有 Schema
 *
 * @param schema 当前 json-render Schema
 * @param path JSON Pointer 路径
 * @param op 操作类型
 * @param value 值
 * @returns 更新后的 Schema
 */
export function applyA2UIDataUpdate<TData extends Record<string, unknown> = Record<string, unknown>>(
  schema: JsonRenderSchema<TData>,
  path: '/' | '' | undefined,
  op?: 'replace',
  value?: TData,
): JsonRenderSchema<TData>;
export function applyA2UIDataUpdate<TData extends Record<string, unknown> = Record<string, unknown>, TValue = unknown>(
  schema: JsonRenderSchema<TData>,
  path: string | undefined,
  op?: 'add' | 'replace' | 'remove',
  value?: TValue,
): JsonRenderSchema<TData>;
export function applyA2UIDataUpdate<TData extends Record<string, unknown> = Record<string, unknown>>(
  schema: JsonRenderSchema<TData>,
  path: string | undefined,
  op: 'add' | 'replace' | 'remove' = 'replace',
  value?: unknown,
): JsonRenderSchema<TData> {
  if (op === 'replace' && (path === '/' || !path)) {
    // data 是用户可定义对象；协议根替换只接受对象，非对象 payload 保持现有 data。
    if (!isRecord(value)) {
      return schema;
    }
    return {
      ...schema,
      // 根数据替换采用调用方声明的 TData 契约；运行时只校验 json-render 支持对象根。
      data: value as TData,
    };
  }

  if (!path) {
    return schema;
  }

  // 关键：沿 path 深克隆所有中间节点，避免 mutate 上游冻结/复用的对象引用。
  // 这里采用"路径上写时复制（copy-on-write along path）"：路径外的其它分支保持
  // 原引用共享，性能与不可变性兼顾。
  const newData = cloneAlongPath(schema.data || ({} as TData), path);

  if (op === 'remove') {
    deleteValueByPath(newData, path);
  } else {
    setValueByPath(newData, path, value);
  }

  return {
    ...schema,
    data: newData,
  };
}

/**
 * 沿 JSON Pointer 路径深克隆中间节点
 *
 * 对路径上的每一层对象/数组做**浅克隆**（`{ ...obj }` 或 `[...arr]`），并把克隆对象
 * 挂回上一层。这样最终返回的对象与 `input` 结构完全相同，但路径上的所有节点都是全新
 * 引用，可以安全 mutate；路径外的其它分支保持原始引用共享，避免全量深克隆的性能开销。
 *
 * 用途：给基于 mutation 的 setValueByPath / deleteValueByPath 打好安全底座。
 */
function cloneAlongPath<TData extends Record<string, unknown>>(input: TData, path: string): TData {
  const parts = path.split('/').filter(Boolean);
  // 顶层浅克隆
  const rootClone: Record<string, unknown> = Array.isArray(input) ? ([...(input as unknown[])] as never) : { ...input };

  let current: DataNode = rootClone as DataNode;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const original = getNodeValue(current, key);
    if (!isDataNode(original)) {
      // 中间节点不存在或非对象/数组，setValueByPath 里会按需新建，这里直接停止克隆
      break;
    }
    const cloned: DataNode = Array.isArray(original) ? [...original] : { ...original };
    setNodeValue(current, key, cloned);
    current = cloned;
  }

  return rootClone as TData;
}

export default {
  convertA2UIMessagesToJsonRender,
  applyA2UIUpdates,
  applyA2UIDataUpdate,
};
