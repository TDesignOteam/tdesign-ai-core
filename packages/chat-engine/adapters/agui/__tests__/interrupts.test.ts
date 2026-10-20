import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AGUIAdapter } from '../index';
import type { AGUIAdapterCallbacks } from '../index';
import { EventSchemas, getRunInterrupts, isInterruptOutcome } from '../types/events';
import type { RunFinishedEvent } from '../types/events';

/**
 * AG-UI 中断（interrupts）适配器链路测试
 *
 * 覆盖：RUN_FINISHED 携带 interrupt 结果时触发 onRunInterrupt 而非 onRunComplete，
 * 并将开放中断记录到 interruptManager；success / 省略 outcome 时按正常完成处理。
 * https://docs.ag-ui.com/concepts/interrupts
 */
describe('AGUIAdapter 中断处理', () => {
  let adapter: AGUIAdapter;
  let callbacks: AGUIAdapterCallbacks;

  const emit = (event: object) => adapter.handleAGUIEvent({ data: JSON.stringify(event) }, callbacks);

  beforeEach(() => {
    adapter = new AGUIAdapter();
    adapter.interruptManager.clear();
    callbacks = {
      onRunComplete: vi.fn(),
      onRunInterrupt: vi.fn(),
    };
  });

  it('interrupt 结果触发 onRunInterrupt 并记录开放中断', () => {
    const result = emit({
      type: 'RUN_FINISHED',
      threadId: 'thread-1',
      runId: 'run-1',
      outcome: {
        type: 'interrupt',
        interrupts: [
          {
            id: 'int-abc123',
            reason: 'tool_call',
            message: 'Send email to a@b.com?',
            toolCallId: 'tc-001',
          },
        ],
      },
    });

    // 生命周期事件不转换为消息内容
    expect(result).toBeNull();
    expect(callbacks.onRunInterrupt).toHaveBeenCalledTimes(1);
    expect(callbacks.onRunComplete).not.toHaveBeenCalled();

    expect(adapter.interruptManager.hasPendingInterrupts()).toBe(true);
    expect(adapter.interruptManager.getThreadId()).toBe('thread-1');
    expect(adapter.interruptManager.getInterrupt('int-abc123')).toMatchObject({ toolCallId: 'tc-001' });
  });

  it('success 结果按正常完成处理', () => {
    emit({ type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1', outcome: { type: 'success' } });
    expect(callbacks.onRunComplete).toHaveBeenCalledTimes(1);
    expect(callbacks.onRunInterrupt).not.toHaveBeenCalled();
    expect(adapter.interruptManager.hasPendingInterrupts()).toBe(false);
  });

  it('省略 outcome 时向后兼容为正常完成', () => {
    emit({ type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' });
    expect(callbacks.onRunComplete).toHaveBeenCalledTimes(1);
    expect(callbacks.onRunInterrupt).not.toHaveBeenCalled();
  });

  it('构建可恢复的 resume 数组', () => {
    emit({
      type: 'RUN_FINISHED',
      threadId: 'thread-1',
      runId: 'run-1',
      outcome: {
        type: 'interrupt',
        interrupts: [{ id: 'int-abc123', reason: 'confirmation' }],
      },
    });

    adapter.interruptManager.resolve('int-abc123', { approved: true });
    expect(adapter.interruptManager.buildResume()).toEqual([
      { interruptId: 'int-abc123', status: 'resolved', payload: { approved: true } },
    ]);
  });
});

describe('RUN_FINISHED outcome schema 与辅助函数', () => {
  it('校验 interrupt 结果事件并提取中断', () => {
    const parsed = EventSchemas.safeParse({
      type: 'RUN_FINISHED',
      threadId: 'thread-1',
      runId: 'run-1',
      outcome: { type: 'interrupt', interrupts: [{ id: 'int-1', reason: 'input_required' }] },
    });
    expect(parsed.success).toBe(true);
    const event = (parsed.success ? parsed.data : {}) as RunFinishedEvent;
    expect(isInterruptOutcome(event)).toBe(true);
    expect(getRunInterrupts(event)).toHaveLength(1);
  });

  it('interrupt 结果的 interrupts 不允许为空数组', () => {
    const parsed = EventSchemas.safeParse({
      type: 'RUN_FINISHED',
      threadId: 'thread-1',
      runId: 'run-1',
      outcome: { type: 'interrupt', interrupts: [] },
    });
    expect(parsed.success).toBe(false);
  });

  it('省略 outcome 的事件不含中断', () => {
    const event = { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' } as RunFinishedEvent;
    expect(isInterruptOutcome(event)).toBe(false);
    expect(getRunInterrupts(event)).toBeNull();
  });
});
