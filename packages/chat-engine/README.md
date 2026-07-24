# @tdesign/ai-chat-engine

English | [简体中文](./README-zh_CN.md)

TDesign AI Chat Engine is a framework-agnostic chat engine core package. It manages conversation state, streaming request orchestration, protocol adapters, and event dispatching, so it can serve as the runtime foundation for UI components, React/Vue hooks, or business SDKs without binding to a specific view framework.

## Installation

```bash
pnpm add @tdesign/ai-chat-engine immer
```

`immer` is a peer dependency and should be provided by the consuming project.

## Features

- Message state management: manages user, assistant, and system messages with statuses such as `pending`, `streaming`, `complete`, `stop`, and `error`.
- Streaming orchestration: supports `fetch`, SSE, and WebSocket transports, including abort handling, reconnect options, and error callbacks.
- Protocol adapters: includes stream handling strategies for the default protocol, AG-UI, and OpenClaw to reduce protocol-specific logic in upper layers.
- Content block merging: supports incremental updates for content types such as text, markdown, thinking, toolcall, activity, suggestion, and attachment.
- Event bus: exposes engine lifecycle, message changes, request state, protocol events, and custom events for UI and business logic integration.
- json-render / A2UI utilities: provides protocol-to-json-render conversion, surface state management, action binding, and patch update helpers.
- Browser builds: ships both ESM output for npm/bundlers and an IIFE build for CDN or `<script>` usage.

## Quick Start

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

await engine.sendUserMessage({ prompt: 'Introduce TDesign AI Chat Engine' });
```

## Common Imports

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
