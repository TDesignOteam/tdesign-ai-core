# Changelog

## 🌈 0.0.4 `2026-09-07`

### 🐞 Bug Fixes

- 修复适配 A2UI 功能的部分缺陷 @LzhengH ([#35](https://github.com/TDesignOteam/tdesign-ai-core/pull/35))

## 🌈 0.0.3 `2026-09-02`

### 🚀 Features

- `Agui`: 支持同一消息中的多个 Markdown、推理和 Activity 内容块按 `messageId` 并行增量更新 @LzhengH ([#23](https://github.com/TDesignOteam/tdesign-ai-core/pull/23))

### 🐞 Bug Fixes

- `Agui`: 修复并行流式场景下首个 Activity 增量及结束事件可能错误更新其他同类型内容块的问题 @liweijie0812 ([#24](https://github.com/TDesignOteam/tdesign-ai-core/pull/24))
- `ChatEngine`: 修复 Chrome 86 下读取消息状态和深拷贝状态失败的问题 @RSS1102 ([#26](https://github.com/TDesignOteam/tdesign-ai-core/pull/26))
- `Dependencies`: 移除未使用且存在安全风险的 `expr-eval` 运行时依赖 @liweijie0812 ([#19](https://github.com/TDesignOteam/tdesign-ai-core/pull/19))
- `Package`: 统一 npm 与 pnpm 发布包的构建入口，并确保直接打包前自动生成有效构建产物 @RSS1102 ([#22](https://github.com/TDesignOteam/tdesign-ai-core/pull/22))

### 🚧 Others

- `Build`: 为 ESM 和 IIFE 构建产物补充包名、版本、版权及许可证声明 @liweijie0812 ([#21](https://github.com/TDesignOteam/tdesign-ai-core/pull/21))
- `Package`: 为发布包补充 MIT 许可证并修正仓库与问题反馈元数据 @liweijie0812 ([#20](https://github.com/TDesignOteam/tdesign-ai-core/pull/20))

## 🌈 0.0.2 `2026-07-24`

### 🐞 Bug Fixes

- Remove the private workspace dependency `@tdesign/ai-shared` from the published dependency manifest and keep it bundled into build artifacts.
- Move published `exports`, `module`, and `types` entries to top-level `package.json` fields so both npm and pnpm publish flows resolve `dist` artifacts correctly.
- Normalize the repository URL for npm package metadata.

## 🌈 0.0.1 `2026-07-24`

首个公开版本，提供框架无关的 TDesign AI 聊天引擎核心能力。

### 🚀 Features

- 实现 `ChatEngine` 核心门面，统一管理初始化、销毁、发送消息、重新生成、中止请求、恢复运行和历史消息回填。
- 实现消息仓库与内容块处理器，支持文本、Markdown、思考过程、工具调用、Activity、建议、附件等多类型内容的增量合并与状态更新。
- 实现请求传输层，支持普通 `fetch`、SSE 流式响应和 WebSocket 连接，并提供超时、重试、中止和错误处理能力。
- 实现协议化 StreamHandler 架构，内置默认协议、AG-UI 和 OpenClaw 的消息流处理策略。
- 实现 AG-UI 适配能力，包括事件映射、工具调用处理、Activity 管理和历史消息转换。
- 实现 OpenClaw 适配能力，包括 WebSocket 握手、RPC 调用、事件映射、设备身份和历史消息转换。
- 实现事件总线，覆盖引擎生命周期、消息变更、请求状态、AG-UI 协议事件和自定义事件。
- 实现 json-render / A2UI 相关工具，支持 surface 状态管理、消息转换、action binding 和 patch 更新辅助。
- 提供 ESM 与 IIFE 构建产物，支持 npm/bundler 使用以及浏览器 `<script>` 直接引入。
