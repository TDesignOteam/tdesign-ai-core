# json-render 开发说明

## 当前状态

### ✅ 已完成

1. **json-render 基础集成**
   - 核心渲染引擎 (`JsonRenderEngine`)
   - Activity 渲染器 (`JsonRenderActivityRenderer`)
   - 增量更新支持 (`ACTIVITY_DELTA` + JSON Patch)

2. **内置组件库**
   - 基础组件：Button, Input, TextField, Text, Card
   - 布局组件：Row, Col, Space, Column, Divider
   - 组件注册表：`tdesignRegistry`

3. **Catalog 架构**
   - 约束层：`tdesignCatalog` (Zod schemas + actions 白名单)
   - 渲染层：`tdesignRegistry` (React 组件映射)
   - 扩展 API：`createCustomCatalog`, `createCustomRegistry`

4. **Action 机制**
   - 预定义 actionHandlers 模式
   - Path References 自动解析
   - Button 内置 reset 功能

5. **AG-UI 协议支持**
   - 直接模式：服务端返回 json-render Schema
   - 流式增量更新：`ACTIVITY_SNAPSHOT` + `ACTIVITY_DELTA`
   - 性能优化：deltaInfo 增量渲染

6. **文档和示例**
   - 完整文档：`README.md`
   - 基础示例：`_example/agui-json-render.tsx`
   - 自定义组件示例：`_example/agui-json-render-full-custom.tsx`

### 🚧 待完成（下一步）

**A2UI 适配模式调试**

- 文件：`A2UIJsonRenderActivityRenderer.tsx`
- 示例：`_example/agui-a2ui-json-render.tsx`
- 适配器：`adapters/a2ui-to-json-render.ts`

**状态：** 代码已实现，但尚未完整调试

## 下一步工作：A2UI 适配模式

### 目标

支持服务端返回 A2UI 协议，前端自动转换为 json-render Schema 进行渲染。

### 工作内容

#### 1. 调试 A2UI 适配器

**文件：** `adapters/a2ui-to-json-render.ts`

**核心逻辑：**

```typescript
function convertA2UIToJsonRender(a2uiContent: A2UIContent): JsonRenderSchema {
  // 1. 解析 A2UI Surface
  const surface = extractSurface(a2uiContent);
  
  // 2. 转换组件树
  const elements = convertComponents(surface.components);
  
  // 3. 提取数据模型
  const data = surface.dataModel || {};
  
  return {
    root: surface.rootComponentId,
    elements,
    data,
  };
}
```

**需要验证：**

- [ ] A2UI `createSurface` 消息解析
- [ ] A2UI `updateSurface` 消息转换为 `ACTIVITY_DELTA`
- [ ] 组件类型映射（A2UI → json-render）
- [ ] 数据模型提取和绑定
- [ ] Actions 映射

#### 2. 调试示例文件

**文件：** `_example/agui-a2ui-json-render.tsx`

**测试场景：**

- [ ] A2UI 消息接收和解析
- [ ] 自动转换为 json-render Schema
- [ ] 流式增量更新
- [ ] Action 触发和处理
- [ ] 错误处理

#### 3. Mock Server 支持

**文件：** `mock-server/online2/handlers/a2ui/xxx.js`

**需要实现：**

- [ ] 返回 A2UI 格式的 `ACTIVITY_SNAPSHOT`
- [ ] 返回 A2UI 格式的 `ACTIVITY_DELTA`
- [ ] 处理 `USER_ACTION` 事件

**A2UI 消息格式示例：**

```json
// ACTIVITY_SNAPSHOT
{
  "type": "ACTIVITY_SNAPSHOT",
  "activityType": "a2ui-json-render",
  "content": {
    "messages": [
      {
        "createSurface": {
          "surface": {
            "id": "surface1",
            "version": "0.9",
            "rootComponentId": "card1",
            "components": {
              "card1": {
                "id": "card1",
                "type": "Card",
                "title": "用户信息",
                "children": ["field1"]
              },
              "field1": {
                "id": "field1",
                "type": "TextField",
                "parent": "card1",
                "label": "姓名",
                "valuePath": "name"
              }
            },
            "dataModel": {
              "name": ""
            }
          }
        }
      }
    ]
  }
}

// ACTIVITY_DELTA
{
  "type": "ACTIVITY_DELTA",
  "activityType": "a2ui-json-render",
  "content": {
    "messages": [
      {
        "updateSurface": {
          "surfaceId": "surface1",
          "updates": [
            {
              "addComponent": {
                "component": {
                  "id": "btn1",
                  "type": "Button",
                  "parent": "card1",
                  "label": "提交"
                }
              }
            }
          ]
        }
      }
    ]
  }
}
```

#### 4. 测试用例

**文件：** `__tests__/a2ui-adapter.test.ts`

**需要覆盖：**

- [ ] A2UI → json-render 转换正确性
- [ ] 组件树结构转换
- [ ] 数据模型提取
- [ ] 增量更新转换
- [ ] 边界情况处理

### 预计工作量

- **A2UI 适配器调试**：2-3 天
- **示例文件调试**：1 天
- **Mock Server 实现**：1 天
- **测试用例编写**：1 天

**总计**：5-6 天

### 验收标准

- [ ] `_example/agui-a2ui-json-render.tsx` 可以正常运行
- [ ] A2UI 消息正确转换为 json-render Schema
- [ ] 流式增量更新正常工作
- [ ] Action 触发和处理正常
- [ ] 无明显性能问题
- [ ] 有完整的测试用例

## 技术难点

### 1. A2UI 组件树 → json-render 扁平结构

**A2UI 结构**（嵌套树）：

```json
{
  "components": {
    "card1": {
      "id": "card1",
      "type": "Card",
      "children": ["field1", "btn1"]
    },
    "field1": {
      "id": "field1",
      "parent": "card1",
      "type": "TextField"
    }
  }
}
```

**json-render 结构**（扁平 + children 数组）：

```json
{
  "elements": {
    "card1": {
      "key": "card1",
      "type": "Card",
      "children": ["field1", "btn1"]
    },
    "field1": {
      "key": "field1",
      "type": "TextField"
    }
  }
}
```

**转换逻辑：**

```typescript
function convertComponents(a2uiComponents: Record<string, A2UIComponent>) {
  const elements: Record<string, UIElement> = {};
  
  for (const [id, component] of Object.entries(a2uiComponents)) {
    elements[id] = {
      key: id,
      type: component.type,
      props: extractProps(component),
      children: component.children || [],
    };
  }
  
  return elements;
}
```

### 2. A2UI updateSurface → json-render JSON Patch

**A2UI 更新**：

```json
{
  "updateSurface": {
    "updates": [
      {
        "addComponent": {
          "component": { "id": "btn1", "type": "Button" }
        }
      }
    ]
  }
}
```

**json-render Patch**：

```json
{
  "patch": [
    {
      "op": "add",
      "path": "/elements/btn1",
      "value": { "type": "Button", "props": { ... } }
    }
  ]
}
```

**转换逻辑：**

```typescript
function convertA2UIUpdate(update: A2UIUpdate): JSONPatch {
  if (update.addComponent) {
    return {
      op: 'add',
      path: `/elements/${update.addComponent.component.id}`,
      value: convertComponent(update.addComponent.component),
    };
  }
  
  if (update.updateComponent) {
    return {
      op: 'replace',
      path: `/elements/${update.updateComponent.componentId}/props`,
      value: update.updateComponent.props,
    };
  }
  
  // ... 处理其他更新类型
}
```

### 3. 性能优化

A2UI 适配会增加一次转换开销，需要注意：

- [ ] 避免重复转换（使用缓存）
- [ ] 增量更新时只转换变化的部分
- [ ] 大数据量时的性能测试

## 参考资源

- **A2UI 协议文档**：`../../docs/a2ui-guide.md`
- **json-render 官方文档**：https://json-render.dev/
- **现有适配器实现**：`adapters/a2ui-to-json-render.ts`

## 联系方式

如有问题，请联系项目维护者。
