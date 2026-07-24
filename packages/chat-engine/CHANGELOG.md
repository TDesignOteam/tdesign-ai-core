# Changelog

## 0.0.1

首个公开版本，提供框架无关的 TDesign AI 聊天引擎核心能力。

### Features

- 实现 `ChatEngine` 核心门面，统一管理初始化、销毁、发送消息、重新生成、中止请求、恢复运行和历史消息回填。
- 实现消息仓库与内容块处理器，支持文本、Markdown、思考过程、工具调用、Activity、建议、附件等多类型内容的增量合并与状态更新。
- 实现请求传输层，支持普通 `fetch`、SSE 流式响应和 WebSocket 连接，并提供超时、重试、中止和错误处理能力。
- 实现协议化 StreamHandler 架构，内置默认协议、AG-UI 和 OpenClaw 的消息流处理策略。
- 实现 AG-UI 适配能力，包括事件映射、工具调用处理、Activity 管理和历史消息转换。
- 实现 OpenClaw 适配能力，包括 WebSocket 握手、RPC 调用、事件映射、设备身份和历史消息转换。
- 实现事件总线，覆盖引擎生命周期、消息变更、请求状态、AG-UI 协议事件和自定义事件。
- 实现 json-render / A2UI 相关工具，支持 surface 状态管理、消息转换、action binding 和 patch 更新辅助。
- 提供 ESM 与 IIFE 构建产物，支持 npm/bundler 使用以及浏览器 `<script>` 直接引入。
