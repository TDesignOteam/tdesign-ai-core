/**
 * AG-UI 协议流式处理器
 *
 * SSE 数据 → AGUIEventMapper.mapEvent → 用户自定义 onMessage → processMessageResult
 * 同时负责发布 AG-UI 细粒度事件（AGUI_ACTIVITY / AGUI_TOOLCALL）
 */
import { AGUIAdapter } from '../adapters/agui';
import type { AGUIAdapterCallbacks } from '../adapters/agui';
import type { AIMessageContent, ChatRequestParams, SSEChunkData, ToolCall } from '../type';
import { ChatEngineEventType } from '../event-bus';
import { LLMService } from '../server';
import type { IStreamHandler, StreamContext, StreamLifecycleContext, StreamProtocol } from './types';

export class AGUIStreamHandler implements IStreamHandler {
  readonly protocol: StreamProtocol = 'agui';

  private llmService: LLMService;
  private aguiAdapter: AGUIAdapter;

  constructor(llmService: LLMService, aguiAdapter?: AGUIAdapter) {
    this.llmService = llmService;
    this.aguiAdapter = aguiAdapter ?? new AGUIAdapter();
  }

  /**
   * 获取内部持有的 AGUIAdapter 实例
   *
   * 常见场景推荐使用 `handleEvent` / `getToolcallByName` / `resetAdapter`
   * 等代理方法，直接访问 adapter 仅在需要其额外能力时使用：
   *
   *   engine.agui?.getAdapter();
   */
  getAdapter(): AGUIAdapter {
    return this.aguiAdapter;
  }

  /**
   * 处理一个 AG-UI SSE chunk，返回映射后的消息内容
   *
   * 相当于 `this.getAdapter().handleAGUIEvent(chunk, callbacks)`，
   * 作为业务侧高频调用的语法糖暴露：
   *
   *   engine.agui?.handleEvent(chunk);
   *   engine.agui?.handleEvent(chunk, { onRunStart, onRunError });
   */
  handleEvent(chunk: SSEChunkData, callbacks: AGUIAdapterCallbacks = {}): AIMessageContent | AIMessageContent[] | null {
    return this.aguiAdapter.handleAGUIEvent(chunk, callbacks);
  }

  /**
   * 按名称查找运行态 toolcall（AGUI 协议专属）
   */
  getToolcallByName(name: string): ToolCall | undefined {
    return this.aguiAdapter.getToolcallByName(name);
  }

  /**
   * 重置 adapter 内部状态，用于开启新一轮对话前的清理
   */
  resetAdapter(): void {
    this.aguiAdapter.reset();
  }

  async handleStream(params: ChatRequestParams, context: StreamContext): Promise<void> {
    const { messageId, config } = context;

    await this.llmService.handleStreamRequest(params, {
      ...config,
      // @ts-ignore
      onMessage: (_chunk: SSEChunkData) => {
        if (context.getStopReceive() || !messageId) return null;
        let chunk = _chunk;
        if (config.onChunk) {
          // @ts-ignore
          chunk = config.onChunk(chunk);
          if (!chunk) {
            return;
          }
        }

        let result: AIMessageContent | AIMessageContent[] | null = null;

        // SSE 数据 → AGUIEventMapper.mapEvent → 用户自定义 onMessage(解析后数据 + 原始 chunk)
        // 首先使用 AGUI 适配器进行通用协议解析
        result = this.aguiAdapter.handleAGUIEvent(chunk, {
          onRunStart: (event) => {
            // 重置适配器状态，确保新一轮对话从干净状态开始
            this.aguiAdapter.reset();
            config.onStart?.(JSON.stringify(event));
            // 发布 AGUI 运行开始事件
            context.eventBus.emit(ChatEngineEventType.AGUI_RUN_START, {
              runId: event.runId || '',
              threadId: event.threadId,
              timestamp: Date.now(),
            });
          },
          onRunComplete: (isAborted, requestParams, event) => {
            context.handleComplete(messageId, isAborted, requestParams, event);
            // 发布 AGUI 运行完成事件
            if (!isAborted) {
              context.eventBus.emit(ChatEngineEventType.AGUI_RUN_COMPLETE, {
                runId: event?.runId || '',
                threadId: event?.threadId,
                timestamp: Date.now(),
              });
            }
          },
          onRunError: (error) => {
            context.handleError(messageId, error);
            // 发布 AGUI 运行错误事件
            context.eventBus.emit(ChatEngineEventType.AGUI_RUN_ERROR, {
              error,
            });
          },
        });

        // 然后调用用户自定义的 onMessage，传入解析后的结果和原始数据
        if (config.onMessage) {
          const userResult = config.onMessage(chunk, context.messageStore.getMessageByID(messageId), result);
          // 如果用户返回了自定义结果，使用用户的结果
          if (userResult) {
            result = userResult;
          }
        }

        // 发布流数据事件
        context.eventBus.emit(ChatEngineEventType.REQUEST_STREAM, {
          messageId,
          chunk,
          content: result,
        });

        // 处理消息结果
        context.processMessageResult(messageId, result);
        return result;
      },
      onError: (error) => {
        if (messageId) context.handleError(messageId, error);
      },
      onComplete: (isAborted) => {
        // AGUI 的完成事件由 AGUIAdapter 内部处理，这里只处理中断情况
        if (isAborted && messageId) {
          context.handleComplete(messageId, isAborted, params);
        }
      },
    });
  }

  /**
   * 发布 AG-UI 细粒度事件
   *
   * 在 MESSAGE_UPDATE 之后由 ChatEngine 统一回调，无需感知协议。
   * 根据内容类型分发到对应的事件通道（AGUI_ACTIVITY / AGUI_TOOLCALL）。
   */
  afterMessageUpdate(
    messageId: string,
    result: AIMessageContent | AIMessageContent[],
    context: StreamLifecycleContext,
  ): void {
    const { eventBus } = context;
    const contents = Array.isArray(result) ? result : [result];
    for (const content of contents) {
      // Activity 事件
      if ((content as any).data?.activityType) {
        eventBus.emit(ChatEngineEventType.AGUI_ACTIVITY, {
          activityType: (content as any).data.activityType,
          messageId,
          content: (content as any)?.data?.content,
        });
      }

      // ToolCall 事件
      if ((content as any)?.data?.eventType?.startsWith('TOOL_CALL')) {
        eventBus.emit(ChatEngineEventType.AGUI_TOOLCALL, {
          toolCall: (content as any).data,
          eventType: (content as any).data.eventType,
        });
      }
    }
  }
}
