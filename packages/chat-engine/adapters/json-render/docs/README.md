# TDesign Chat - json-render 集成方案

> 基于 `@json-render/core` 和 `@json-render/react` 的生成式 UI 渲染方案，支持 AG-UI 协议的流式增量更新。

## 📖 目录

- [快速开始](#快速开始)
- [核心概念](#核心概念)
- [方案设计](#方案设计)
- [接入使用](#接入使用)
- [扩展开发](#扩展开发)
- [API 参考](#api-参考)
- [常见问题](#常见问题)

---

## 快速开始

### 安装依赖

```bash
pnpm add @json-render/core @json-render/react zod
```

### 基础示例

```typescript
import { useChat, useAgentActivity, createJsonRenderActivityConfig } from '@tdesign-react/chat';
import { MessagePlugin } from 'tdesign-react';

function MyApp() {
  // 1. 创建 ChatEngine
  const { chatEngine, messages, status } = useChat({
    chatServiceConfig: {
      endpoint: 'http://your-api/sse/json-render',
      protocol: 'agui',
    },
  });

  // 2. 配置 json-render Activity
  const jsonRenderConfig = useMemo(
    () =>
      createJsonRenderActivityConfig({
        activityType: 'json-render',
        actionHandlers: {
          submit: async (params) => {
            console.log('表单提交:', params);
            await api.submit(params);
            MessagePlugin.success('提交成功');
          },
          reset: async (params) => {
            MessagePlugin.info('表单已重置');
          },
        },
      }),
    [],
  );

  // 3. 注册 Activity
  useAgentActivity(jsonRenderConfig);

  // 4. 渲染界面
  return (
    <div style={{ height: '100vh' }}>
      <ChatList>
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message}>
            {/* ActivityRenderer 会自动处理 json-render activity */}
          </ChatMessage>
        ))}
      </ChatList>
      <ChatSender loading={status === 'streaming'} />
    </div>
  );
}
```

---

## 核心概念

### 1. 生成式 UI 模式

json-render 采用 **预定义 + 动态组合** 的模式：

- **安全性**：AI 只能使用预定义的组件和操作
- **可控性**：前端预先知道所有可能的 action
- **可维护性**：业务逻辑集中管理

### 2. 两层架构

```
┌─────────────────────────────────────────────┐
│            Catalog（约束层）                 │
│  - 定义组件 props schema (Zod)              │
│  - 定义 actions 白名单                       │
│  - 告诉 AI/LLM 可以生成什么                  │
│  - 用于服务端/AI 提示词生成                  │
└─────────────────────────────────────────────┘
                    ↓
         AI 生成 json-render Schema
                    ↓
┌─────────────────────────────────────────────┐
│       ComponentRegistry（渲染层）            │
│  - React 组件映射表                          │
│  - 定义组件如何渲染                          │
│  - 传给 <Renderer registry={...} />         │
└─────────────────────────────────────────────┘
```

### 3. Schema 格式

```json
{
  "root": "form1",
  "elements": {
    "form1": {
      "key": "form1",
      "type": "Card",
      "props": {
        "title": "用户信息表单"
      },
      "children": ["name-field", "email-field", "submit-btn"]
    },
    "name-field": {
      "key": "name-field",
      "type": "TextField",
      "props": {
        "label": "姓名",
        "valuePath": "name",
        "placeholder": "请输入姓名"
      }
    },
    "submit-btn": {
      "key": "submit-btn",
      "type": "Button",
      "props": {
        "label": "提交",
        "theme": "primary",
        "action": {
          "name": "submit",
          "params": {
            "name": { "path": "name" },
            "email": { "path": "email" }
          }
        }
      }
    }
  },
  "data": {
    "name": "",
    "email": ""
  }
}
```

### 4. 增量更新（ACTIVITY_DELTA）

使用 JSON Patch 实现流式增量更新：

```json
{
  "type": "ACTIVITY_DELTA",
  "activityType": "json-render",
  "patch": [
    {
      "op": "add",
      "path": "/elements/new-button",
      "value": {
        "type": "Button",
        "props": { "label": "新按钮" }
      }
    },
    {
      "op": "replace",
      "path": "/data/name",
      "value": "张三"
    }
  ]
}
```

---

## 方案设计

### 架构设计

#### 1. 数据流

```
用户输入 → TextField (useData().set()) → DataProvider
                                              ↓
用户点击 → Button (onAction()) → ActionProvider → actionHandlers
                                              ↓
                                    解析 path 引用
                                              ↓
                                    业务处理逻辑
```

#### 2. 组件职责

| 组件 | 职责 | API |
|------|------|-----|
| TextField | 写入数据 | `useData().set(path, value)` |
| Button | 触发操作 | `onAction(action)` |
| ActionProvider | 解析 path 引用 | 自动将 `{ path: 'name' }` 转为实际值 |
| DataProvider | 管理表单数据 | `initialData`, `data`, `update()` |

#### 3. Action 机制

**预定义 Actions 模式**：

```typescript
// 前端预先定义所有 action
actionHandlers: {
  submit: async (params) => { /* 提交表单 */ },
  reset: async (params) => { /* 重置表单 */ },
  delete: async (params) => { /* 删除数据 */ },
  refresh: async (params) => { /* 刷新数据 */ },
}
```

**Path References**：

```json
{
  "action": {
    "name": "submit",
    "params": {
      "name": { "path": "name" },      // 引用 data.name
      "email": { "path": "email" }     // 引用 data.email
    }
  }
}
```

ActionProvider 自动解析 `{ path: '...' }`，将实际数据传递给 handler。

### 内置组件

#### 基础组件（5 个）

| 组件 | 说明 | 主要 Props |
|------|------|------------|
| Button | 按钮 | `label`/`children`, `variant`, `theme`, `action` |
| Input | 输入框 | `value`, `placeholder`, `type` |
| TextField | 表单字段 | `label`, `name`, `valuePath`, `placeholder` |
| Text | 文本 | `content`, `variant`, `color` |
| Card | 卡片容器 | `title`, `description`, `bordered` |

#### 布局组件（5 个）

| 组件 | 说明 | 主要 Props |
|------|------|------------|
| Row | 行布局 | `gutter`, `justify`, `align` |
| Col | 列布局 | `span`, `offset` |
| Space | 间距布局 | `direction`, `size`, `align` |
| Column | 垂直布局 | `gap`, `align` |
| Divider | 分割线 | `layout`, `dashed` |

#### 内置 Actions（3 个）

| Action | 说明 |
|--------|------|
| `submit` | 提交表单数据 |
| `reset` | 重置表单（Button 组件自动清空数据） |
| `cancel` | 取消操作 |

---

## 接入使用

### 模式 1：直接模式（json-render Schema）

服务端直接返回 json-render Schema。

#### 服务端事件格式

```typescript
// 1. ACTIVITY_SNAPSHOT（初始化）
{
  type: 'ACTIVITY_SNAPSHOT',
  messageId: 'msg_xxx',
  activityType: 'json-render',
  content: {
    root: 'card1',
    elements: { /* ... */ },
    data: { /* ... */ },
  }
}

// 2. ACTIVITY_DELTA（增量更新）
{
  type: 'ACTIVITY_DELTA',
  messageId: 'msg_xxx',
  activityType: 'json-render',
  patch: [
    { op: 'add', path: '/elements/btn1', value: { /* ... */ } },
    { op: 'replace', path: '/data/name', value: '张三' }
  ]
}
```

#### 前端使用

```typescript
import { createJsonRenderActivityConfig } from '@tdesign-react/chat';

const config = createJsonRenderActivityConfig({
  activityType: 'json-render',
  registry: tdesignRegistry, // 可选，默认使用内置组件
  actionHandlers: {
    submit: async (params) => {
      // params 已解析 path 引用，是实际数据
      console.log('提交:', params); // { name: '张三', email: 'test@example.com' }
      
      // 发送到服务端
      await chatEngine.sendAIMessage({
        params: {
          userActionMessage: {
            name: 'submit',
            params,
            timestamp: new Date().toISOString(),
          },
        },
        sendRequest: true,
      });
    },
    reset: async (params) => {
      // Button 组件已自动清空表单数据
      MessagePlugin.info('表单已重置');
    },
  },
  debug: true, // 开启调试日志
});

useAgentActivity(config);
```

### 模式 2：适配模式（A2UI → json-render）

服务端返回 A2UI 协议，前端自动转换为 json-render Schema。

> **注意**：A2UI 适配模式尚未完成调试，预计后续版本支持。

#### 前端使用

```typescript
import { createA2UIJsonRenderActivityConfig } from '@tdesign-react/chat';

const config = createA2UIJsonRenderActivityConfig({
  activityType: 'a2ui-json-render',
  actionHandlers: {
    submit: async (params) => { /* ... */ },
    reset: async (params) => { /* ... */ },
  },
});

useAgentActivity(config);
```

---

## 扩展开发

### 步骤 1: 定义 Catalog（约束层）

```typescript
import { createCustomCatalog } from '@tdesign-react/chat';
import { z } from 'zod';

const customCatalog = createCustomCatalog({
  name: 'my-dashboard',
  components: {
    // 自定义组件 1
    StatusCard: {
      props: z.object({
        title: z.string(),
        status: z.enum(['success', 'warning', 'error', 'info']),
        description: z.string().nullable(),
        icon: z.string().nullable(),
      }),
      description: '状态卡片，用于展示系统状态信息',
    },
    
    // 自定义组件 2
    ProgressBar: {
      props: z.object({
        label: z.string().nullable(),
        percentage: z.number().min(0).max(100),
        showInfo: z.boolean().nullable(),
      }),
      description: '进度条，用于展示任务完成进度',
    },
  },
  actions: {
    // 自定义 actions（除了内置的 submit/reset/cancel）
    refresh: { description: '刷新数据' },
    export: { description: '导出报告' },
  },
});

// 查看合并后的 Catalog
console.log('可用组件:', customCatalog.componentNames);
// 输出: ['Button', 'TextField', ..., 'StatusCard', 'ProgressBar']

console.log('可用 Actions:', customCatalog.actionNames);
// 输出: ['submit', 'reset', 'cancel', 'refresh', 'export']
```

### 步骤 2: 实现 React 组件（渲染层）

```typescript
import React from 'react';
import type { ComponentRenderProps } from '@json-render/react';

// StatusCard 组件实现
export const StatusCard: React.FC<ComponentRenderProps> = ({ element }) => {
  const { title, status, description, icon } = element.props as {
    title: string;
    status: 'success' | 'warning' | 'error' | 'info';
    description?: string;
    icon?: string;
  };

  const statusColors = {
    success: '#52c41a',
    warning: '#faad14',
    error: '#f5222d',
    info: '#1890ff',
  };

  const statusIcons = {
    success: '✓',
    warning: '⚠',
    error: '✗',
    info: 'ℹ',
  };

  return (
    <div
      style={{
        padding: '16px',
        borderRadius: '8px',
        border: `2px solid ${statusColors[status]}`,
        backgroundColor: `${statusColors[status]}10`,
        display: 'flex',
        gap: '12px',
      }}
    >
      <div style={{ fontSize: '24px', color: statusColors[status] }}>
        {icon || statusIcons[status]}
      </div>
      <div>
        <div style={{ fontSize: '16px', fontWeight: 600, color: statusColors[status] }}>
          {title}
        </div>
        {description && (
          <div style={{ fontSize: '14px', marginTop: '4px' }}>{description}</div>
        )}
      </div>
    </div>
  );
};

// ProgressBar 组件实现
export const ProgressBar: React.FC<ComponentRenderProps> = ({ element }) => {
  const { label, percentage, showInfo = true } = element.props as {
    label?: string;
    percentage: number;
    showInfo?: boolean;
  };

  // 根据进度决定颜色
  const color = percentage < 30 ? '#f5222d' : percentage < 70 ? '#faad14' : '#52c41a';

  return (
    <div style={{ width: '100%' }}>
      {label && (
        <div style={{ marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>
          {label}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div
          style={{
            flex: 1,
            height: '20px',
            borderRadius: '10px',
            backgroundColor: '#f0f0f0',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${percentage}%`,
              height: '100%',
              backgroundColor: color,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
        {showInfo && (
          <span style={{ fontSize: '14px', fontWeight: 600, color, minWidth: '45px' }}>
            {percentage}%
          </span>
        )}
      </div>
    </div>
  );
};
```

### 步骤 3: 注册组件

```typescript
import { createCustomRegistry } from '@tdesign-react/chat';

const customRegistry = createCustomRegistry({
  StatusCard,    // 组件名必须与 Catalog 中定义的一致
  ProgressBar,
});
```

### 步骤 4: 配置 Activity

```typescript
const config = createJsonRenderActivityConfig({
  registry: customRegistry,  // 使用自定义 registry
  actionHandlers: {
    // 内置 actions
    submit: async (params) => {
      await api.submit(params);
      MessagePlugin.success('提交成功');
    },
    reset: async (params) => {
      MessagePlugin.info('表单已重置');
    },
    
    // 自定义 actions（必须与 Catalog 中定义的一致）
    refresh: async (params) => {
      console.log('刷新数据:', params);
      await fetchData();
      MessagePlugin.success('刷新成功');
    },
    export: async (params) => {
      console.log('导出数据:', params);
      const blob = await exportData(params);
      downloadFile(blob, 'report.pdf');
      MessagePlugin.success('导出成功');
    },
  },
});

useAgentActivity(config);
```

### 完整示例

参考：`_example/agui-json-render-full-custom.tsx`

---

## API 参考

### createJsonRenderActivityConfig

创建 json-render Activity 配置。

```typescript
function createJsonRenderActivityConfig(
  options: JsonRenderActivityConfigOptions
): ActivityConfig;

interface JsonRenderActivityConfigOptions {
  /** Activity 类型标识，默认 'json-render' */
  activityType?: string;
  
  /** 组件注册表，默认使用 tdesignRegistry */
  registry?: ComponentRegistry;
  
  /** Action 处理器映射表 */
  actionHandlers?: Record<string, (params: any) => void | Promise<void>>;
  
  /** 是否显示调试信息 */
  debug?: boolean;
  
  /** Activity 描述 */
  description?: string;
}
```

### createCustomCatalog

创建自定义 Catalog（约束层），用于 AI/服务端生成 Schema。

```typescript
function createCustomCatalog(config: {
  name: string;
  components?: Record<string, ComponentSchema>;
  actions?: Record<string, { description: string }>;
  validation?: 'strict' | 'warn';
}): Catalog;

// 返回的 Catalog 包含
catalog.componentNames  // 可用组件名列表
catalog.actionNames     // 可用 action 名列表
catalog.components      // 组件定义（合并了内置 + 自定义）
catalog.actions         // action 定义（合并了内置 + 自定义）
```

### createCustomRegistry

创建自定义 ComponentRegistry（渲染层），用于渲染组件。

```typescript
function createCustomRegistry(
  customComponents: ComponentRegistry
): ComponentRegistry;

// 示例
const customRegistry = createCustomRegistry({
  StatusCard: MyStatusCard,
  ProgressBar: MyProgressBar,
});
```

### tdesignCatalog

内置的 TDesign Catalog（约束层）。

```typescript
import { tdesignCatalog, tdesignComponentList, tdesignActionList } from '@tdesign-react/chat';

console.log(tdesignComponentList);  // ['Button', 'TextField', 'Card', ...]
console.log(tdesignActionList);     // ['submit', 'reset', 'cancel']
```

### tdesignRegistry

内置的 TDesign ComponentRegistry（渲染层）。

```typescript
import { tdesignRegistry } from '@tdesign-react/chat';

const config = createJsonRenderActivityConfig({
  registry: tdesignRegistry,  // 使用内置组件
  actionHandlers: { ... },
});
```

---

## 常见问题

### Q1: Catalog 和 ComponentRegistry 有什么区别？

- **Catalog（约束层）**：使用 `createCatalog` + Zod 定义组件 props schema 和 actions 白名单，用于告诉 AI/LLM 可以生成什么，通常在服务端使用
- **ComponentRegistry（渲染层）**：React 组件映射表，定义组件如何渲染，传给 `<Renderer registry={...} />`

### Q2: 必须定义 Catalog 吗？

**不是必须的**。如果不使用 AI 生成 UI，只需要 ComponentRegistry：

```typescript
const config = createJsonRenderActivityConfig({
  registry: tdesignRegistry,  // 只需要 registry
  actionHandlers: { ... },
});
```

### Q3: 如何处理表单重置？

Button 组件已内置 reset 逻辑，当 `action.name === 'reset'` 时会自动清空表单数据：

```json
{
  "type": "Button",
  "props": {
    "label": "重置",
    "action": "reset"
  }
}
```

前端只需要在 actionHandlers 中处理 UI 提示：

```typescript
actionHandlers: {
  reset: async (params) => {
    // Button 已自动清空数据，这里只需提示
    MessagePlugin.info('表单已重置');
  }
}
```

### Q4: 如何获取表单数据？

使用 **Path References** 模式，在 action params 中引用数据路径：

```json
{
  "type": "Button",
  "props": {
    "action": {
      "name": "submit",
      "params": {
        "name": { "path": "name" },
        "email": { "path": "email" }
      }
    }
  }
}
```

ActionProvider 会自动解析，actionHandler 接收到的是实际值：

```typescript
actionHandlers: {
  submit: async (params) => {
    console.log(params);  // { name: '张三', email: 'test@example.com' }
  }
}
```

### Q5: 如何调试？

开启 debug 模式：

```typescript
const config = createJsonRenderActivityConfig({
  debug: true,
  actionHandlers: { ... },
});
```

控制台会输出：

```
[json-render] 全量渲染: { activityType: 'json-render', elementCount: 10 }
[json-render] 应用增量更新: { deltaInfo: {...}, elementCount: 12 }
[json-render] Action 触发: { actionName: 'submit', params: {...} }
```

### Q6: 自定义组件如何访问 DataProvider？

在自定义组件中使用 `useData()` hook：

```typescript
import { useData } from '@json-render/react';

const MyComponent: React.FC<ComponentRenderProps> = ({ element }) => {
  const { data, set, update } = useData();
  
  return (
    <input
      value={data[element.props.valuePath]}
      onChange={(e) => set(element.props.valuePath, e.target.value)}
    />
  );
};
```

### Q8: 如何处理错误？

在 actionHandler 中添加错误处理：

```typescript
actionHandlers: {
  submit: async (params) => {
    try {
      await api.submit(params);
      MessagePlugin.success('提交成功');
    } catch (error) {
      console.error('提交失败:', error);
      MessagePlugin.error(`提交失败: ${error.message}`);
    }
  }
}
```

---

## 示例文件

| 文件 | 说明 |
|------|------|
| `_example/agui-json-render.tsx` | 基础示例：内置组件 + 表单交互 |
| `_example/agui-json-render-full-custom.tsx` | 完整示例：自定义组件 + Catalog 定义 |
| `_example/agui-a2ui-json-render.tsx` | A2UI 适配模式（待调试） |

---

## 相关资源

- [json-render 官方文档](https://json-render.dev/)
- [TDesign React 组件库](https://tdesign.tencent.com/react/)
- [AG-UI 协议文档](../../docs/agui-protocol.md)

---

## 开发计划

- [x] json-render 基础集成
- [x] AG-UI 协议支持
- [x] 内置组件库
- [x] 自定义组件扩展
- [x] Action 机制
- [x] 增量更新优化
- [ ] A2UI 适配模式调试（下一步）
- [ ] 性能监控和优化
- [ ] 更多内置组件
- [ ] 服务端 Catalog 生成 AI Prompt 工具

---

## License

MIT
