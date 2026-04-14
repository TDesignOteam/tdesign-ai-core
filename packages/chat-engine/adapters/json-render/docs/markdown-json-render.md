非常好的思路！让我分析一下这个混合方案的可行性。

## 混合架构分析

```
┌─────────────────────────────────────────────────────────┐
│                    混合渲染架构                          │
│                                                         │
│  Markdown 流 (文本 + 插槽标记)                          │
│  "这是分析结果：<json-render id="chart-1" /> 继续..."   │
│                          ↓                             │
│  react-markdown 解析                                    │
│                          ↓                             │
│  ┌──────────────┐  ┌─────────────────────────────────┐ │
│  │ 普通文本渲染  │  │ <json-render id="chart-1" />   │ │
│  │              │  │         ↓                       │ │
│  │              │  │ JsonRenderActivityRenderer     │ │
│  │              │  │ (复用现有引擎)                  │ │
│  └──────────────┘  └─────────────────────────────────┘ │
│                                                         │
│  JSON Patch 流 (组件数据)                               │
│  独立通道传输 content.root + content.elements          │
└─────────────────────────────────────────────────────────┘
```

---

## 复用可行性评估

### ✅ 可以完全复用的部分

| 模块 | 复用程度 | 说明 |
|------|----------|------|
| `JsonRenderElement` | 100% | 核心渲染引擎，不变 |
| `DataProvider` | 100% | 数据绑定机制，不变 |
| `ActionProvider` | 100% | Action 处理机制，不变 |
| `VisibilityProvider` | 100% | 可见性控制，不变 |
| `ComponentRegistry` | 100% | 组件注册表，不变 |
| `createCustomRegistry` | 100% | 自定义组件注册，不变 |

### ⚠️ 需要适配的部分

| 模块 | 改动程度 | 说明 |
|------|----------|------|
| `JsonRenderActivityRenderer` | 小改 | 支持通过 `id` 查找对应 Schema |
| 数据存储 | 新增 | 需要一个 Store 管理多个插槽的 Schema |

---

## 具体实现方案

### 1. 数据流设计

```
SSE 流 1: Markdown 文本流
─────────────────────────────────────────────
"分析结果如下：<json-render id="chart-1" />"

SSE 流 2: JSON Patch 流（复用现有协议）
─────────────────────────────────────────────
{
  "type": "ACTIVITY_DELTA",
  "activityId": "chart-1",  // 对应插槽 id
  "content": { "root": "...", "elements": {...} }
}
```

### 2. Schema Store 管理

```tsx
// 新增：管理多个插槽的 Schema
const JsonRenderSlotsContext = React.createContext<{
  schemas: Record<string, JsonRenderSchema>;
  updateSchema: (id: string, schema: JsonRenderSchema) => void;
}>(null);

// 接收 JSON Patch 流，更新对应 id 的 Schema
useEffect(() => {
  eventBus.on('ACTIVITY_DELTA', (event) => {
    updateSchema(event.activityId, event.content);
  });
}, []);
```

### 3. 适配 JsonRenderActivityRenderer

```tsx
// 当前代码几乎不用改，只需包装一层通过 id 获取 schema
const JsonRenderSlot: React.FC<{ id: string }> = ({ id }) => {
  const { schemas } = useContext(JsonRenderSlotsContext);
  const schema = schemas[id];
  
  if (!schema) {
    return <div>加载中...</div>;
  }
  
  // 完全复用现有 Renderer
  return (
    <JsonRenderActivityRenderer
      activityType="json-render-slot"
      messageId={id}
      content={schema}           // 复用现有 content 结构
      registry={registry}        // 复用现有 registry
      actionHandlers={handlers}  // 复用现有 handlers
    />
  );
};
```

### 4. react-markdown 集成

```tsx
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';

const MarkdownWithSlots = ({ content }) => (
  <ReactMarkdown
    rehypePlugins={[rehypeRaw]}
    components={{
      // 拦截 <json-render> 标签，渲染为 JsonRenderSlot
      'json-render': ({ id }) => <JsonRenderSlot id={id} />,
    }}
  >
    {content}
  </ReactMarkdown>
);
```

---

## 复用评估总结

```
┌─────────────────────────────────────────────────────────┐
│                    复用程度评估                          │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  json-render 核心引擎        复用 100%          │   │
│  │  • JsonRenderElement                            │   │
│  │  • DataProvider / ActionProvider                │   │
│  │  • ComponentRegistry                            │   │
│  │  • createCustomRegistry                         │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  ActivityRenderer           适配改造 ~50行      │   │
│  │  • 新增 JsonRenderSlotsContext                  │   │
│  │  • 新增 JsonRenderSlot 包装组件                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  新增 Markdown 渲染层       新增 ~100行         │   │
│  │  • react-markdown 集成                          │   │
│  │  • 插槽标签拦截                                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  总改动量: ~150 行   复用率: 90%+                       │
└─────────────────────────────────────────────────────────┘
```

---

## 结论

**完全可行，且复用率很高！**

| 维度 | 评估 |
|------|------|
| **核心引擎** | 100% 复用，零改动 |
| **Renderer** | 包装一层即可，~50 行 |
| **新增代码** | Markdown 集成 ~100 行 |
| **协议兼容** | JSON Patch 流复用，仅需加 `activityId` 字段 |
| **风险** | 低，改动隔离性好 |

**建议**：可以作为 json-render 的一个新模式 `mode: 'markdown-slot'`，与现有 `mode: 'activity'` 并存。