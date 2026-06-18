# tdesign-ai-core

TDesign AIGC 领域框架无关的核心 SDK 集合。

## 定位

本仓库承载 TDesign 设计体系中所有 **框架无关** 的 AIGC 核心逻辑，以 git submodule 方式被 tdesign-react、tdesign-vue-next、tdesign-miniprogram 等组件库引入。

## 包结构

| 包                     | npm 名                    | 说明                                                                     |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------ |
| `packages/chat-engine` | `@tdesign/ai-chat-engine` | 聊天引擎核心：消息管理、流式处理、协议适配（AG-UI / OpenClaw）、事件总线 |
| `packages/shared`      | `@tdesign/ai-shared`      | 跨引擎公共工具：EventEmitter、Logger、JSON Patch                         |

## 架构

```
tdesign-ai-core (本仓库, 框架无关)
├── @tdesign/ai-shared         ← 公共工具层
└── @tdesign/ai-chat-engine    ← 聊天引擎核心
    ├── ChatEngine (Facade)
    ├── EventBus (Pub/Sub)
    ├── Store (Reactive State, immer)
    ├── StreamHandlers (Strategy: Default / AGUI / OpenClaw)
    ├── Adapters (AGUI / OpenClaw / json-render / A2UI)
    └── Server (SSE Client / WebSocket Client / Batch)

tdesign-react / tdesign-vue-next / tdesign-miniprogram (宿主仓库)
└── packages/ai-core  ← git submodule 挂载点
    以 workspace 包方式引用 @tdesign/ai-chat-engine
    各框架实现自己的 hooks/composables/behaviors 绑定层
```

## 作为 Submodule 使用

### 添加到宿主仓库

```bash
git submodule add https://github.com/Tencent/tdesign-ai-core.git packages/ai-core
```

### 在宿主仓库中引用

宿主仓库的 `pnpm-workspace.yaml` 通常已包含 `packages/**`，因此 submodule 内的子包会自动被发现为 workspace 成员。

```typescript
// 在宿主仓库的框架绑定层中使用
import ChatEngine from '@tdesign/ai-chat-engine';
import type { ChatServiceConfig } from '@tdesign/ai-chat-engine';
```

## 开发

```bash
pnpm install
pnpm type-check
```

## License

MIT
