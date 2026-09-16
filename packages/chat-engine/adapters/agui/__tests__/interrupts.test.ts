import { describe, expect, it, vi } from 'vitest';

import { AGUIAdapter } from '../index';
import { AGUIEventType, EventSchemas, RunFinishedEventSchema } from '../types/events';
import { InterruptResumeSchema, RunAgentInputSchema } from '../types/schema';

const toolCallInterrupt = {
  id: 'int-abc123',
  reason: 'tool_call',
  message: 'Send email to a@b.com with subject "Hi"?',
  toolCallId: 'tc-001',
  responseSchema: {
    type: 'object',
    properties: { approved: { type: 'boolean' } },
    required: ['approved'],
  },
};

const interruptFinishedEvent = {
  type: AGUIEventType.RUN_FINISHED,
  threadId: 'thread-1',
  runId: 'run-1',
  outcome: {
    type: 'interrupt',
    interrupts: [toolCallInterrupt],
  },
};

describe('AG-UI Interrupts schema', () => {
  it('RUN_FINISHED 携带 interrupt outcome 时解析并保留 interrupts', () => {
    const parsed = RunFinishedEventSchema.parse(interruptFinishedEvent);

    expect(parsed.outcome).toEqual({
      type: 'interrupt',
      interrupts: [toolCallInterrupt],
    });
  });

  it('RUN_FINISHED 的 outcome 可缺省或为 success（向后兼容）', () => {
    const legacy = RunFinishedEventSchema.parse({
      type: AGUIEventType.RUN_FINISHED,
      threadId: 'thread-1',
      runId: 'run-1',
      result: 'done',
    });
    expect(legacy.outcome).toBeUndefined();

    const success = RunFinishedEventSchema.parse({
      type: AGUIEventType.RUN_FINISHED,
      threadId: 'thread-1',
      runId: 'run-1',
      outcome: { type: 'success' },
    });
    expect(success.outcome).toEqual({ type: 'success' });
  });

  it('interrupt outcome 的 interrupts 必须非空', () => {
    expect(
      RunFinishedEventSchema.safeParse({
        ...interruptFinishedEvent,
        outcome: { type: 'interrupt', interrupts: [] },
      }).success,
    ).toBe(false);
  });

  it('tool_call interrupt 必须携带 toolCallId', () => {
    expect(
      RunFinishedEventSchema.safeParse({
        ...interruptFinishedEvent,
        outcome: {
          type: 'interrupt',
          interrupts: [{ id: 'int-1', reason: 'tool_call' }],
        },
      }).success,
    ).toBe(false);
    expect(
      RunFinishedEventSchema.safeParse({
        ...interruptFinishedEvent,
        outcome: {
          type: 'interrupt',
          interrupts: [{ id: 'int-1', reason: 'confirmation' }],
        },
      }).success,
    ).toBe(true);
  });

  it('RunAgentInput 支持可选的 resume 数组', () => {
    const input = {
      threadId: 'thread-1',
      runId: 'run-2',
      state: {},
      messages: [],
      tools: [],
      context: [],
      forwardedProps: {},
      resume: [
        { interruptId: 'int-abc123', status: 'resolved', payload: { approved: true } },
        { interruptId: 'int-def456', status: 'cancelled', metadata: { source: 'ui' } },
      ],
    };

    expect(RunAgentInputSchema.parse(input).resume).toEqual(input.resume);
    expect(RunAgentInputSchema.parse({ ...input, resume: undefined }).resume).toBeUndefined();
  });

  it('resume 条目校验 status 取值与 interruptId 必填', () => {
    expect(InterruptResumeSchema.safeParse({ interruptId: 'i-1', status: 'resolved' }).success).toBe(true);
    expect(InterruptResumeSchema.safeParse({ interruptId: 'i-1', status: 'approved' }).success).toBe(false);
    expect(InterruptResumeSchema.safeParse({ status: 'resolved' }).success).toBe(false);
  });

  it('携带 interrupt outcome 的 RUN_FINISHED 通过事件联合校验', () => {
    expect(EventSchemas.safeParse(interruptFinishedEvent).success).toBe(true);
  });
});

describe('AGUIAdapter interrupt 派发', () => {
  it('RUN_FINISHED 携带 interrupt outcome 时触发 onRunInterrupted 而非 onRunComplete', () => {
    const adapter = new AGUIAdapter();
    const onRunComplete = vi.fn();
    const onRunInterrupted = vi.fn();

    const result = adapter.handleAGUIEvent(
      { data: JSON.stringify(interruptFinishedEvent) },
      { onRunComplete, onRunInterrupted },
    );

    expect(result).toBeNull();
    expect(onRunInterrupted).toHaveBeenCalledOnce();
    expect(onRunInterrupted).toHaveBeenCalledWith(
      expect.objectContaining({ type: AGUIEventType.RUN_FINISHED, runId: 'run-1' }),
      [toolCallInterrupt],
    );
    expect(onRunComplete).not.toHaveBeenCalled();
  });

  it('未提供 onRunInterrupted 时回退到 onRunComplete', () => {
    const adapter = new AGUIAdapter();
    const onRunComplete = vi.fn();

    adapter.handleAGUIEvent({ data: interruptFinishedEvent }, { onRunComplete });

    expect(onRunComplete).toHaveBeenCalledOnce();
    expect(onRunComplete).toHaveBeenCalledWith(false, {}, expect.objectContaining({ runId: 'run-1' }));
  });

  it('普通 RUN_FINISHED（无 outcome 或 success）仍触发 onRunComplete', () => {
    const adapter = new AGUIAdapter();
    const onRunComplete = vi.fn();
    const onRunInterrupted = vi.fn();

    adapter.handleAGUIEvent(
      {
        data: {
          type: AGUIEventType.RUN_FINISHED,
          threadId: 'thread-1',
          runId: 'run-1',
          outcome: { type: 'success' },
        },
      },
      { onRunComplete, onRunInterrupted },
    );

    expect(onRunComplete).toHaveBeenCalledOnce();
    expect(onRunInterrupted).not.toHaveBeenCalled();
  });

  it('非法 RUN_FINISHED 事件告警并跳过生命周期回调', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const adapter = new AGUIAdapter();
    const onRunComplete = vi.fn();
    const onRunInterrupted = vi.fn();

    adapter.handleAGUIEvent(
      {
        data: {
          type: AGUIEventType.RUN_FINISHED,
          threadId: 'thread-1',
          runId: 'run-1',
          outcome: { type: 'cancelled' },
        },
      },
      { onRunComplete, onRunInterrupted },
    );
    adapter.handleAGUIEvent(
      {
        data: {
          type: AGUIEventType.RUN_FINISHED,
          threadId: 'thread-1',
          runId: 'run-1',
          outcome: { type: 'interrupt', interrupts: [{ reason: 'tool_call' }] },
        },
      },
      { onRunComplete, onRunInterrupted },
    );

    expect(warn).toHaveBeenCalledTimes(2);
    expect(onRunComplete).not.toHaveBeenCalled();
    expect(onRunInterrupted).not.toHaveBeenCalled();
  });

  it('缺少 threadId 或 runId 的生命周期事件不会触发回调', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const adapter = new AGUIAdapter();
    const onRunStart = vi.fn();
    const onRunComplete = vi.fn();
    const onRunInterrupted = vi.fn();

    adapter.handleAGUIEvent(
      { data: { type: AGUIEventType.RUN_STARTED, runId: 'run-1' } },
      { onRunStart, onRunComplete, onRunInterrupted },
    );
    adapter.handleAGUIEvent(
      {
        data: {
          type: AGUIEventType.RUN_FINISHED,
          runId: 'run-1',
          outcome: { type: 'interrupt', interrupts: [toolCallInterrupt] },
        },
      },
      { onRunStart, onRunComplete, onRunInterrupted },
    );

    expect(warn).toHaveBeenCalledTimes(2);
    expect(onRunStart).not.toHaveBeenCalled();
    expect(onRunComplete).not.toHaveBeenCalled();
    expect(onRunInterrupted).not.toHaveBeenCalled();
  });
});
