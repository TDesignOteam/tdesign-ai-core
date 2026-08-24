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

  it.fails('快照之前的第一个 ACTIVITY_DELTA 使用追加策略', () => {
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
});
