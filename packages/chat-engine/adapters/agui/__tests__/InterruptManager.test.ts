import { beforeEach, describe, expect, it } from 'vitest';

import { InterruptManagerImpl } from '../InterruptManager';
import { AGUIError } from '../types/schema';
import type { Interrupt } from '../types/schema';

describe('InterruptManager', () => {
  let manager: InterruptManagerImpl;

  const confirmInterrupt: Interrupt = {
    id: 'int-1',
    reason: 'confirmation',
    message: 'Send email?',
  };
  const toolInterrupt: Interrupt = {
    id: 'int-2',
    reason: 'tool_call',
    toolCallId: 'tc-001',
  };

  beforeEach(() => {
    manager = new InterruptManagerImpl();
  });

  it('记录开放中断并保存运行上下文', () => {
    manager.handleInterrupts([confirmInterrupt, toolInterrupt], { threadId: 'thread-1', runId: 'run-1' });

    expect(manager.hasPendingInterrupts()).toBe(true);
    expect(manager.getInterrupts()).toHaveLength(2);
    expect(manager.getInterrupt('int-2')).toMatchObject({ reason: 'tool_call', toolCallId: 'tc-001' });
    expect(manager.getThreadId()).toBe('thread-1');
    expect(manager.getRunId()).toBe('run-1');
  });

  it('resolve 携带 payload、cancel 省略 payload，并按原始顺序构建 resume', () => {
    manager.handleInterrupts([confirmInterrupt, toolInterrupt]);
    manager.resolve('int-2', { approved: true });
    manager.cancel('int-1');

    expect(manager.isFullyResolved()).toBe(true);
    expect(manager.buildResume()).toEqual([
      { interruptId: 'int-1', status: 'cancelled' },
      { interruptId: 'int-2', status: 'resolved', payload: { approved: true } },
    ]);
  });

  it('未覆盖全部中断时 buildResume 抛出 AGUIError（不支持部分恢复）', () => {
    manager.handleInterrupts([confirmInterrupt, toolInterrupt]);
    manager.resolve('int-1', { approved: false });

    expect(manager.isFullyResolved()).toBe(false);
    expect(() => manager.buildResume()).toThrow(AGUIError);
  });

  it('对无法关联的 interruptId 抛出 AGUIError', () => {
    manager.handleInterrupts([confirmInterrupt]);
    expect(() => manager.resolve('unknown')).toThrow(AGUIError);
    expect(() => manager.cancel('unknown')).toThrow(AGUIError);
  });

  it('对已过期的中断拒绝 resolve', () => {
    const expired: Interrupt = {
      id: 'int-exp',
      reason: 'input_required',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    manager.handleInterrupts([expired]);
    expect(() => manager.resolve('int-exp', { value: 1 })).toThrow(AGUIError);
  });

  it('subscribe 立即回放当前开放中断，并在响应/清理时通知', () => {
    const received: number[] = [];
    manager.handleInterrupts([confirmInterrupt, toolInterrupt], { threadId: 'thread-1' });

    const unsubscribe = manager.subscribe((interrupts) => received.push(interrupts.length));
    // 订阅时立即回放
    expect(received).toEqual([2]);

    manager.resolve('int-1', { approved: true });
    manager.clear();
    // resolve 与 clear 各触发一次
    expect(received).toEqual([2, 2, 0]);

    unsubscribe();
    manager.handleInterrupts([confirmInterrupt]);
    // 已取消订阅，不再收到
    expect(received).toEqual([2, 2, 0]);
  });

  it('clear 重置全部状态', () => {
    manager.handleInterrupts([confirmInterrupt], { threadId: 'thread-1', runId: 'run-1' });
    manager.clear();

    expect(manager.hasPendingInterrupts()).toBe(false);
    expect(manager.getInterrupts()).toEqual([]);
    expect(manager.getThreadId()).toBeNull();
    expect(manager.getRunId()).toBeNull();
  });
});
