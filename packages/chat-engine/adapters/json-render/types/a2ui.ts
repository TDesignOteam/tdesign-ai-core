/**
 * A2UI v0.9.1 协议类型定义
 * 用于 A2UI → json-render 转换
 *
 * A2UI Protocol v0.9.1 Specification
 * 参考：https://a2ui.org/specification/v0.9.1-a2ui/
 */

/**
 * A2UI 标准组件类型（Standard Catalog）
 */
export type A2UIComponentType =
  | 'Text'
  | 'Image'
  | 'Icon'
  | 'Video'
  | 'AudioPlayer'
  | 'Button'
  | 'TextField'
  | 'CheckBox'
  | 'ChoicePicker'
  | 'Slider'
  | 'DateTimeInput'
  | 'Card'
  | 'Row'
  | 'Column'
  | 'List'
  | 'Tabs'
  | 'Divider'
  | 'Modal';

/**
 * A2UI v0.9.1 组件定义
 * 注意：A2UI 使用 'component' 字段（不是 json-render 的 'type'）
 */
export interface A2UIComponent {
  /** 组件唯一标识符 */
  id: string;
  /** 组件类型（A2UI 使用 'component' 字段） */
  component: string;
  /** 权重（flex-grow），仅在 Row/Column 子组件中有效 */
  weight?: number;
  /** 单子组件 ID */
  child?: string;
  /** 多子组件 ID 数组，或模板配置 */
  children?:
    | string[]
    | {
        path: string;
        componentId: string;
      };
  /** 其他组件特定属性 */
  [key: string]: any;
}

/**
 * A2UI v0.9.1 createSurface 消息
 * 只包含 surfaceId 和 catalogId，不包含组件数据
 */
export interface A2UICreateSurface {
  /** Surface 唯一标识符 */
  surfaceId: string;
  /** Catalog ID（组件目录标识） */
  catalogId: string;
}

/**
 * A2UI v0.9.1 updateComponents 消息
 * components 是数组，不是 Record
 */
export interface A2UIUpdateComponents {
  /** Surface 唯一标识符 */
  surfaceId: string;
  /** 组件数组（不是 Record） */
  components: A2UIComponent[];
}

/**
 * A2UI v0.9.1 updateDataModel 消息
 */
export interface A2UIUpdateDataModel {
  /** Surface 唯一标识符 */
  surfaceId: string;
  /** JSON Pointer 路径 */
  path?: string;
  /** 操作类型 */
  op?: 'add' | 'replace' | 'remove';
  /** 数据值 */
  value?: unknown;
}

/**
 * A2UI v0.9.1 deleteSurface 消息
 */
export interface A2UIDeleteSurface {
  /** Surface 唯一标识符 */
  surfaceId: string;
}

/**
 * A2UI v0.9.1 消息类型（Server to Client）
 * v0.9.1 schema 同时接受 "v0.9" 和 "v0.9.1"，每条消息只包含一种消息类型
 */
export interface A2UIMessage {
  /** A2UI 协议版本；v0.9.1 与 v0.9 payload 兼容 */
  version?: 'v0.9' | 'v0.9.1';
  createSurface?: A2UICreateSurface;
  updateComponents?: A2UIUpdateComponents;
  updateDataModel?: A2UIUpdateDataModel;
  deleteSurface?: A2UIDeleteSurface;
}

/**
 * A2UI Surface 状态（客户端维护）
 * 由多条消息累积构建
 */
export interface A2UISurfaceState {
  /** Surface ID */
  surfaceId: string;
  /** Catalog ID */
  catalogId: string;
  /** 组件 Map（由 updateComponents 累积） */
  components: Map<string, A2UIComponent>;
  /** 数据模型（由 updateDataModel 累积） */
  dataModel: Record<string, unknown>;
}
