# @tdesign/ai-chat-engine

简体中文 | [English](./README.md)

TDesign AI Chat Engine 是一个框架无关的聊天引擎核心包，负责对话消息管理、流式请求编排、协议适配和事件分发。它可以作为上层 UI 组件、React/Vue Hooks 或业务 SDK 的底层运行时，不绑定具体视图框架。

## 安装

```bash
pnpm add @tdesign/ai-chat-engine immer
```

`immer` 是 peer dependency，需要由使用方项目提供。

## 核心能力

- 消息状态管理：统一维护用户、助手、系统消息，以及 `pending`、`streaming`、`complete`、`stop`、`error` 等状态。
- 流式请求编排：支持 `fetch`、SSE 和 WebSocket 传输，并提供请求中止、重连配置和错误回调。
- 协议适配：内置默认协议、AG-UI 和 OpenClaw 的流式处理策略，降低上层对后端协议差异的感知。
- 内容块合并：支持 text、markdown、thinking、toolcall、activity、suggestion、attachment 等内容类型的增量更新。
- 事件总线：提供引擎生命周期、消息变更、请求状态和协议事件的订阅能力，方便 UI 或业务逻辑响应运行状态。
- json-render / A2UI 工具：提供协议消息到 json-render 数据结构的转换、状态管理和 action binding 辅助能力。
- 浏览器产物：除 ESM 入口外，也提供 IIFE 产物用于 CDN 或 `<script>` 场景。

## 快速开始

```ts
import ChatEngine, { ChatEngineEventType } from '@tdesign/ai-chat-engine';
import type { ChatServiceConfig } from '@tdesign/ai-chat-engine';

const engine = new ChatEngine();

const config: ChatServiceConfig = {
  endpoint: '/api/chat',
  transport: 'sse',
  protocol: 'default',
  onMessage(chunk) {
    return {
      type: 'markdown',
      data: String(chunk.data ?? ''),
    };
  },
};

await engine.init(config);

engine.eventBus.on(ChatEngineEventType.REQUEST_COMPLETE, ({ message }) => {
  console.log('AI response completed:', message);
});

await engine.sendUserMessage({ prompt: '介绍一下 TDesign AI Chat Engine' });
```

## 常用入口

```ts
import ChatEngine, { ChatEngineEventType, createEventBus } from '@tdesign/ai-chat-engine';

import type { AIMessageContent, ChatMessagesData, ChatRequestParams, ChatServiceConfig } from '@tdesign/ai-chat-engine';
```

## CDN / IIFE

```html
<script src="https://unpkg.com/@tdesign/ai-chat-engine/dist/index.iife.js"></script>
<script>
  const { default: ChatEngine } = window.TDesignAIChatEngine;
  const engine = new ChatEngine();
</script>
```
