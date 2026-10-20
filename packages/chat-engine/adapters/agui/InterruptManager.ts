import type { ChatJSONObject, ChatJSONValue } from '../../type';
import { AGUIError } from './types/schema';
import type { Interrupt, ResumeInput } from './types/schema';

/**
 * 中断运行的上下文信息
 *
 * 契约要求恢复必须使用相同的 threadId，因此在记录开放中断时一并保存，
 * 供上层在下一轮请求中回传。
 */
export interface InterruptContext {
  threadId?: string;
  runId?: string;
}

export interface InterruptManager {
  /** 获取当前所有开放中断 */
  getInterrupts: () => Interrupt[];
  /** 按 id 获取指定中断 */
  getInterrupt: (interruptId: string) => Interrupt | undefined;
  /** 是否存在尚未处理的开放中断 */
  hasPendingInterrupts: () => boolean;
  /** 中断运行所属的 threadId */
  getThreadId: () => string | null;
  /** 中断运行所属的 runId */
  getRunId: () => string | null;
  /** 记录一批开放中断（RUN_FINISHED 携带中断结果时触发） */
  handleInterrupts: (interrupts: Interrupt[], context?: InterruptContext) => void;
  /** 用户已响应某个中断（拒绝也通过 payload 表达，如 { approved: false }） */
  resolve: (interruptId: string, payload?: ChatJSONValue, metadata?: ChatJSONObject) => void;
  /** 用户放弃某个中断（不携带 payload） */
  cancel: (interruptId: string, metadata?: ChatJSONObject) => void;
  /** 是否所有开放中断都已收集到响应 */
  isFullyResolved: () => boolean;
  /** 构建 resume 数组，若存在未处理中断则抛出 AGUIError（不支持部分恢复） */
  buildResume: () => ResumeInput[];
  /** 订阅开放中断变化（记录、响应、清理时触发），返回取消订阅函数 */
  subscribe: (callback: (interrupts: Interrupt[], context: InterruptContext) => void) => () => void;
  /** 清空所有中断与已收集的响应 */
  clear: () => void;
}

/**
 * InterruptManager
 *
 * 管理 AG-UI 中断（interrupts）的客户端生命周期：记录 RUN_FINISHED 携带的开放中断、
 * 收集用户对每个中断的响应（resolve / cancel），并在恢复前构建满足契约规则的 resume 数组。
 *
 * 契约规则（客户端侧强制，违反时抛出 {@link AGUIError}）：
 * 1. 恢复关联：resolve / cancel 的 interruptId 必须引用某个开放中断
 * 2. 覆盖所有开放中断：buildResume 必须处理全部中断，不支持部分恢复
 * 3. 过期强制：不得对超过 expiresAt 的中断提交 resolve
 *
 * 载荷校验（responseSchema）为可选能力，此处不内置 JSON Schema 校验器，
 * 交由上层在 resolve 前自行校验。
 * https://docs.ag-ui.com/concepts/interrupts
 */
export class InterruptManagerImpl implements InterruptManager {
  private interrupts = new Map<string, Interrupt>();

  private responses = new Map<string, ResumeInput>();

  private threadId: string | null = null;

  private runId: string | null = null;

  private subscribers = new Set<(interrupts: Interrupt[], context: InterruptContext) => void>();

  getInterrupts(): Interrupt[] {
    return Array.from(this.interrupts.values());
  }

  getInterrupt(interruptId: string): Interrupt | undefined {
    return this.interrupts.get(interruptId);
  }

  hasPendingInterrupts(): boolean {
    return this.interrupts.size > 0;
  }

  getThreadId(): string | null {
    return this.threadId;
  }

  getRunId(): string | null {
    return this.runId;
  }

  handleInterrupts(interrupts: Interrupt[], context: InterruptContext = {}): void {
    this.interrupts = new Map(interrupts.map((interrupt) => [interrupt.id, interrupt]));
    this.responses.clear();
    this.threadId = context.threadId ?? null;
    this.runId = context.runId ?? null;
    this.notify();
  }

  resolve(interruptId: string, payload?: ChatJSONValue, metadata?: ChatJSONObject): void {
    const interrupt = this.requireInterrupt(interruptId);
    if (isExpired(interrupt)) {
      throw new AGUIError(`Interrupt "${interruptId}" has expired at ${interrupt.expiresAt}`);
    }
    this.responses.set(interruptId, {
      interruptId,
      status: 'resolved',
      ...(payload !== undefined ? { payload } : {}),
      ...(metadata ? { metadata } : {}),
    });
    this.notify();
  }

  cancel(interruptId: string, metadata?: ChatJSONObject): void {
    this.requireInterrupt(interruptId);
    this.responses.set(interruptId, {
      interruptId,
      status: 'cancelled',
      ...(metadata ? { metadata } : {}),
    });
    this.notify();
  }

  isFullyResolved(): boolean {
    if (this.interrupts.size === 0) return false;
    return Array.from(this.interrupts.keys()).every((id) => this.responses.has(id));
  }

  buildResume(): ResumeInput[] {
    const unresolved = Array.from(this.interrupts.keys()).filter((id) => !this.responses.has(id));
    if (unresolved.length > 0) {
      throw new AGUIError(`Cannot resume: unresolved interrupts remain (${unresolved.join(', ')})`);
    }
    // 保持开放中断的原始顺序输出
    return Array.from(this.interrupts.keys()).map((id) => this.responses.get(id) as ResumeInput);
  }

  subscribe(callback: (interrupts: Interrupt[], context: InterruptContext) => void): () => void {
    this.subscribers.add(callback);
    if (this.hasPendingInterrupts()) callback(this.getInterrupts(), this.getContext());
    return () => this.subscribers.delete(callback);
  }

  clear(): void {
    this.interrupts.clear();
    this.responses.clear();
    this.threadId = null;
    this.runId = null;
    this.notify();
  }

  private requireInterrupt(interruptId: string): Interrupt {
    const interrupt = this.interrupts.get(interruptId);
    if (!interrupt) {
      throw new AGUIError(`Unknown interruptId "${interruptId}"`);
    }
    return interrupt;
  }

  private getContext(): InterruptContext {
    return { threadId: this.threadId ?? undefined, runId: this.runId ?? undefined };
  }

  private notify(): void {
    const interrupts = this.getInterrupts();
    const context = this.getContext();
    this.subscribers.forEach((callback) => callback(interrupts, context));
  }
}

function isExpired(interrupt: Interrupt): boolean {
  if (!interrupt.expiresAt) return false;
  const expiresAt = new Date(interrupt.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt < Date.now();
}

export const interruptManager = new InterruptManagerImpl();
