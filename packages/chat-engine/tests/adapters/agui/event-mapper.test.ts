import { beforeEach, describe, expect, it } from 'vitest';

import { AGUIEventMapper } from '../../../adapters/agui/event-mapper';

describe('AGUIEventMapper', () => {
  let mapper: AGUIEventMapper;

  beforeEach(() => {
    mapper = new AGUIEventMapper();
    mapper.reset();
  });

  it('拒绝格式错误和未知的事件', () => {
    expect(mapper.mapEvent({ data: 'not json' })).toBeNull();
    expect(mapper.mapEvent({ data: { type: 'UNKNOWN' } })).toBeNull();
    expect(mapper.mapEvent({ data: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: '' } })).toBeNull();
  });

  it('映射标准与简化的文本生命周期', () => {
    expect(mapper.mapEvent({ data: { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' } })).toMatchObject(
      {
        type: 'markdown',
        status: 'streaming',
        strategy: 'append',
        data: '',
      },
    );
    expect(mapper.mapEvent({ data: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hi' } })).toMatchObject({
      data: 'Hi',
      strategy: 'merge',
    });
    expect(mapper.mapEvent({ data: { type: 'TEXT_MESSAGE_END', messageId: 'm1' } })).toMatchObject({
      status: 'complete',
      strategy: 'merge',
    });

    expect(mapper.mapEvent({ data: { type: 'TEXT_MESSAGE_CHUNK', messageId: 'm2', delta: 'A' } })).toMatchObject({
      data: 'A',
      strategy: 'append',
    });
    expect(mapper.mapEvent({ data: { type: 'TEXT_MESSAGE_CHUNK', messageId: 'm2', delta: 'B' } })).toMatchObject({
      data: 'B',
      strategy: 'merge',
    });
    expect(mapper.mapEvent({ data: { type: 'TEXT_MESSAGE_CHUNK', messageId: 'm3', delta: 'C' } })).toMatchObject({
      data: 'C',
      strategy: 'append',
    });
  });

  it('携带推理标题并关闭简化的推理消息', () => {
    expect(mapper.mapEvent({ data: { type: 'REASONING_START', title: 'Analyzing' } })).toBeNull();
    expect(
      mapper.mapEvent({ data: { type: 'REASONING_MESSAGE_CHUNK', messageId: 'r1', delta: 'Step' } }),
    ).toMatchObject({
      type: 'thinking',
      data: { text: 'Step', title: 'Analyzing' },
      strategy: 'append',
      ext: { collapsed: false },
    });
    expect(
      mapper.mapEvent({ data: { type: 'REASONING_MESSAGE_CHUNK', messageId: 'r1', delta: ' two' } }),
    ).toMatchObject({ data: { text: ' two' }, strategy: 'merge' });
    expect(mapper.mapEvent({ data: { type: 'REASONING_MESSAGE_CHUNK', messageId: 'r1', delta: '' } })).toMatchObject({
      status: 'complete',
      data: { title: '思考结束' },
      ext: { collapsed: true },
    });
  });

  it('在标准生命周期中累积工具调用的参数与结果', () => {
    expect(
      mapper.mapEvent({ data: { type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'search' } }),
    ).toMatchObject({ strategy: 'append', status: 'pending' });
    mapper.mapEvent({ data: { type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: '{"q":' } });
    expect(mapper.mapEvent({ data: { type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: '"vitest"}' } })).toMatchObject({
      data: { args: '{"q":"vitest"}' },
      status: 'streaming',
      strategy: 'merge',
    });
    expect(
      mapper.mapEvent({
        data: { type: 'TOOL_CALL_RESULT', messageId: 'm', toolCallId: 't1', toolCallName: 'search', content: 'done' },
      }),
    ).toMatchObject({ data: { result: 'done' }, status: 'complete' });
    mapper.mapEvent({ data: { type: 'TOOL_CALL_END', toolCallId: 't1' } });
    expect(mapper.isToolCallEnded('t1')).toBe(true);
    expect(mapper.getToolCall('t1')?.eventType).toBe('TOOL_CALL_END');
  });

  it('从简化分块创建工具调用并重置其状态', () => {
    expect(
      mapper.mapEvent({ data: { type: 'TOOL_CALL_CHUNK', toolCallId: 't2', toolCallName: 'read', delta: '{"file":' } }),
    ).toMatchObject({
      type: 'toolcall-read-t2',
      data: { args: '{"file":' },
      strategy: 'append',
    });
    expect(mapper.mapEvent({ data: { type: 'TOOL_CALL_CHUNK', toolCallId: 't2', delta: '"a"}' } })).toMatchObject({
      data: { args: '{"file":"a"}' },
      strategy: 'merge',
    });
    mapper.clearToolCall('t2');
    expect(mapper.getToolCall('t2')).toBeUndefined();
  });

  it('映射快照、自定义事件与运行错误', () => {
    const snapshot = mapper.mapEvent({
      data: { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'm1', role: 'assistant', content: 'hello' }] },
    });
    expect(Array.isArray(snapshot) ? snapshot[0] : snapshot).toMatchObject({ type: 'markdown', data: 'hello' });
    expect(mapper.mapEvent({ data: { type: 'CUSTOM', name: 'metric', value: 1 } })).toMatchObject({ type: 'custom' });
    expect(mapper.mapEvent({ data: { type: 'RUN_ERROR', message: 'failed' } })).toEqual([
      { type: 'text', data: 'failed', status: 'error', strategy: 'append' },
    ]);
  });

  it('快照之前的第一个 ACTIVITY_DELTA 使用追加策略', () => {
    const first = mapper.mapEvent({
      data: {
        type: 'ACTIVITY_DELTA',
        messageId: 'm1',
        activityType: 'plan',
        patch: [{ op: 'add', path: '/operations/-', value: { title: 'first' } }],
      },
    });
    const second = mapper.mapEvent({
      data: {
        type: 'ACTIVITY_DELTA',
        messageId: 'm1',
        activityType: 'plan',
        patch: [{ op: 'add', path: '/operations/-', value: { title: 'second' } }],
      },
    });

    expect(first).toMatchObject({ type: 'activity-plan', strategy: 'append' });
    expect(second).toMatchObject({ type: 'activity-plan', strategy: 'merge' });
  });

  it('交错的 TEXT_MESSAGE_CHUNK 按 messageId 路由到各自的块', () => {
    const a1 = mapper.mapEvent({ data: { type: 'TEXT_MESSAGE_CHUNK', messageId: 't1', delta: 'A1' } });
    const b1 = mapper.mapEvent({ data: { type: 'TEXT_MESSAGE_CHUNK', messageId: 't2', delta: 'B1' } });
    const a2 = mapper.mapEvent({ data: { type: 'TEXT_MESSAGE_CHUNK', messageId: 't1', delta: 'A2' } });

    expect(a1).toMatchObject({ type: 'markdown', strategy: 'append', id: 't1', data: 'A1' });
    expect(b1).toMatchObject({ type: 'markdown', strategy: 'append', id: 't2', data: 'B1' });
    expect(a2).toMatchObject({ type: 'markdown', strategy: 'merge', id: 't1', data: 'A2' });
  });

  it('标准文本生命周期事件携带 messageId 作为内容 id', () => {
    expect(mapper.mapEvent({ data: { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' } })).toMatchObject(
      { type: 'markdown', strategy: 'append', id: 'm1' },
    );
    expect(mapper.mapEvent({ data: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hi' } })).toMatchObject({
      strategy: 'merge',
      id: 'm1',
    });
    expect(mapper.mapEvent({ data: { type: 'TEXT_MESSAGE_END', messageId: 'm1' } })).toMatchObject({
      status: 'complete',
      strategy: 'merge',
      id: 'm1',
    });
  });

  it('交错的 REASONING_MESSAGE_CHUNK 按 messageId 路由到各自的块', () => {
    const r1a = mapper.mapEvent({ data: { type: 'REASONING_MESSAGE_CHUNK', messageId: 'r1', delta: 'one' } });
    const r2a = mapper.mapEvent({ data: { type: 'REASONING_MESSAGE_CHUNK', messageId: 'r2', delta: 'two' } });
    const r1b = mapper.mapEvent({ data: { type: 'REASONING_MESSAGE_CHUNK', messageId: 'r1', delta: ' more' } });

    expect(r1a).toMatchObject({ type: 'thinking', strategy: 'append', id: 'r1' });
    expect(r2a).toMatchObject({ type: 'thinking', strategy: 'append', id: 'r2' });
    expect(r1b).toMatchObject({ type: 'thinking', strategy: 'merge', id: 'r1', data: { text: ' more' } });
  });

  it('REASONING_MESSAGE_END 按 messageId 关闭指定块且不破坏其他块的追踪', () => {
    mapper.mapEvent({ data: { type: 'REASONING_MESSAGE_CHUNK', messageId: 'r1', delta: 'a' } });
    mapper.mapEvent({ data: { type: 'REASONING_MESSAGE_CHUNK', messageId: 'r2', delta: 'b' } });

    const ended = mapper.mapEvent({ data: { type: 'REASONING_MESSAGE_END', messageId: 'r1' } });
    expect(ended).toMatchObject({
      type: 'thinking',
      status: 'complete',
      strategy: 'merge',
      id: 'r1',
      ext: { collapsed: true },
    });

    const r2b = mapper.mapEvent({ data: { type: 'REASONING_MESSAGE_CHUNK', messageId: 'r2', delta: 'c' } });
    expect(r2b).toMatchObject({ type: 'thinking', strategy: 'merge', id: 'r2', data: { text: 'c' } });
  });

  it('空 delta 仅关闭自身 messageId 的推理块', () => {
    mapper.mapEvent({ data: { type: 'REASONING_MESSAGE_CHUNK', messageId: 'r1', delta: 'a' } });
    mapper.mapEvent({ data: { type: 'REASONING_MESSAGE_CHUNK', messageId: 'r2', delta: 'b' } });

    const closed = mapper.mapEvent({ data: { type: 'REASONING_MESSAGE_CHUNK', messageId: 'r1', delta: '' } });
    expect(closed).toMatchObject({ status: 'complete', strategy: 'merge', id: 'r1' });

    const r2b = mapper.mapEvent({ data: { type: 'REASONING_MESSAGE_CHUNK', messageId: 'r2', delta: 'c' } });
    expect(r2b).toMatchObject({ strategy: 'merge', id: 'r2', data: { text: 'c' } });
  });

  it('REASONING_END 按 messageId 关闭指定块且不影响其他推理块', () => {
    mapper.mapEvent({ data: { type: 'REASONING_MESSAGE_CHUNK', messageId: 'r1', delta: 'a' } });
    mapper.mapEvent({ data: { type: 'REASONING_MESSAGE_CHUNK', messageId: 'r2', delta: 'b' } });

    const ended = mapper.mapEvent({ data: { type: 'REASONING_END', messageId: 'r1', title: 'Done' } });
    expect(ended).toMatchObject({
      type: 'thinking',
      status: 'complete',
      strategy: 'merge',
      id: 'r1',
      data: { title: 'Done' },
      ext: { collapsed: true },
    });

    const r2b = mapper.mapEvent({ data: { type: 'REASONING_MESSAGE_CHUNK', messageId: 'r2', delta: 'c' } });
    expect(r2b).toMatchObject({ strategy: 'merge', id: 'r2', data: { text: 'c' } });
  });

  it('REASONING_ENCRYPTED_VALUE 关联到当前追踪的推理块', () => {
    mapper.mapEvent({ data: { type: 'REASONING_MESSAGE_CHUNK', messageId: 'r1', delta: 'a' } });

    const encrypted = mapper.mapEvent({
      data: { type: 'REASONING_ENCRYPTED_VALUE', subtype: 'message', entityId: 'e1', encryptedValue: 'xyz' },
    });

    expect(encrypted).toMatchObject({
      type: 'thinking',
      strategy: 'merge',
      id: 'r1',
      ext: { encryptedValue: 'xyz', subtype: 'message', entityId: 'e1' },
    });
  });

  it('相同 activityType 的不同 messageId 增量携带各自 id 并合并回原实例', () => {
    const first = mapper.mapEvent({
      data: {
        type: 'ACTIVITY_DELTA',
        messageId: 'm1',
        activityType: 'plan',
        patch: [{ op: 'add', path: '/operations/-', value: { title: 'first' } }],
      },
    });
    const firstAgain = mapper.mapEvent({
      data: {
        type: 'ACTIVITY_DELTA',
        messageId: 'm1',
        activityType: 'plan',
        patch: [{ op: 'add', path: '/operations/-', value: { title: 'more' } }],
      },
    });

    expect(first).toMatchObject({ type: 'activity-plan', strategy: 'append', id: 'm1' });
    expect(firstAgain).toMatchObject({ type: 'activity-plan', strategy: 'merge', id: 'm1' });
  });

  it('新 messageId 的首个增量使用追加策略且内容不受其他实例污染', () => {
    mapper.mapEvent({
      data: {
        type: 'ACTIVITY_DELTA',
        messageId: 'm1',
        activityType: 'plan',
        patch: [{ op: 'add', path: '/operations/-', value: { title: 'first' } }],
      },
    });

    const other = mapper.mapEvent({
      data: {
        type: 'ACTIVITY_DELTA',
        messageId: 'm2',
        activityType: 'plan',
        patch: [{ op: 'add', path: '/operations/-', value: { title: 'other' } }],
      },
    });

    expect(other).toMatchObject({
      type: 'activity-plan',
      strategy: 'append',
      id: 'm2',
      data: { content: { operations: [{ title: 'other' }] } },
    });
  });

  it('重置后已打开的 messageId 重新走追加策略', () => {
    mapper.mapEvent({ data: { type: 'TEXT_MESSAGE_CHUNK', messageId: 't1', delta: 'A' } });
    mapper.reset();

    expect(mapper.mapEvent({ data: { type: 'TEXT_MESSAGE_CHUNK', messageId: 't1', delta: 'B' } })).toMatchObject({
      strategy: 'append',
      id: 't1',
    });
  });
});
