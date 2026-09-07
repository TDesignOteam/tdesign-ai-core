import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenClawEventMapper } from '../event-mapper';

describe('OpenClawEventMapper', () => {
  let mapper: OpenClawEventMapper;

  beforeEach(() => {
    mapper = new OpenClawEventMapper();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('使用增量映射助手快照并跟踪完整文本', () => {
    const first = mapper.mapEvent({
      type: 'event',
      event: 'agent',
      payload: { runId: 'r1', stream: 'assistant', data: { text: 'Hello', delta: 'Hello' } },
    });
    const second = mapper.mapEvent({
      type: 'event',
      event: 'agent',
      payload: { stream: 'assistant', data: { text: 'Hello!', delta: '!' } },
    });
    expect(first).toMatchObject({ content: { type: 'text', data: 'Hello', status: 'streaming' }, runId: 'r1' });
    expect(second.content).toMatchObject({ data: '!' });
    expect(mapper.getTextBuffer()).toBe('Hello!');
  });

  it('从通用完整快照推导增量', () => {
    expect(mapper.mapEvent({ type: 'event', event: 'agent', payload: { data: { text: 'A' } } }).content).toMatchObject({
      data: 'A',
    });
    expect(mapper.mapEvent({ type: 'event', event: 'agent', payload: { data: { text: 'AB' } } }).content).toMatchObject(
      { data: 'B' },
    );
    expect(mapper.mapEvent({ type: 'event', event: 'agent', payload: { data: { text: 'AB' } } }).content).toBeNull();
  });

  it('将 chat 事件视为生命周期信号', () => {
    expect(
      mapper.mapEvent({ type: 'event', event: 'chat', payload: { state: 'delta', runId: 'r2' } }).content,
    ).toBeNull();
    expect(mapper.mapEvent({ type: 'event', event: 'chat', payload: { state: 'final' } })).toMatchObject({
      content: { type: 'text', data: '', status: 'complete' },
      isFinal: true,
      runId: 'r2',
    });
    expect(
      mapper.mapEvent({ type: 'event', event: 'chat', payload: { state: 'error', errorMessage: 'bad' } }),
    ).toMatchObject({
      content: { data: 'Error: bad', status: 'error' },
      isFinal: true,
      hasError: true,
    });
  });

  it('映射工具调用的开始与结果阶段', () => {
    const start = mapper.mapEvent({
      type: 'event',
      event: 'agent',
      payload: {
        runId: 'r',
        stream: 'tool',
        data: { phase: 'start', toolCallId: 't1', name: 'read', args: { path: '/a' } },
      },
    });
    expect(start.content).toMatchObject({
      type: 'toolcall-read-t1',
      data: { args: '{"path":"/a"}' },
      status: 'streaming',
      strategy: 'append',
    });

    const result = mapper.mapEvent({
      type: 'event',
      event: 'agent',
      payload: { stream: 'tool', data: { phase: 'result', toolCallId: 't1', meta: 'read /a', isError: false } },
    });
    expect(result.content).toMatchObject({
      data: { result: 'read /a', ext: { isError: false } },
      status: 'complete',
      strategy: 'merge',
    });
    expect(mapper.isToolCallEnded('t1')).toBe(true);
  });

  it('支持仅有结果的工具事件与建议结果', () => {
    const result = mapper.mapEvent({
      type: 'event',
      event: 'agent',
      payload: {
        stream: 'tool',
        data: { phase: 'result', toolCallId: 's1', name: 'suggestion', content: '[{"title":"Next"}]' },
      },
    });
    expect(result.content).toMatchObject({ type: 'suggestion', data: [{ title: 'Next' }] });
    expect(mapper.getToolCall('s1')).toMatchObject({ toolCallName: 'suggestion', result: '[{"title":"Next"}]' });
  });

  it('映射通用事件并重置可观察状态', () => {
    expect(
      mapper.mapEvent({ type: 'event', event: 'notice', payload: { message: 'maintenance' } }).content,
    ).toMatchObject({ data: 'maintenance' });
    mapper.mapEvent({ type: 'event', event: 'agent', payload: { runId: 'r', data: { delta: 'x' } } });
    mapper.reset();
    expect(mapper.getCurrentRunId()).toBeNull();
    expect(mapper.getTextBuffer()).toBe('');
    expect(mapper.getToolCalls()).toEqual([]);
  });

  it('合并不依赖字符串增量的通用工具参数对象', () => {
    mapper.mapEvent({
      type: 'event',
      event: 'agent',
      payload: { stream: 'tool', data: { phase: 'start', toolCallId: 't1', name: 'read', args: {} } },
    });

    const result = mapper.mapEvent({
      type: 'event',
      event: 'agent',
      payload: { stream: 'tool', data: { phase: 'args', toolCallId: 't1', args: { path: '/a' } } },
    });

    expect(result.content).toMatchObject({ data: { args: '{"path":"/a"}' } });

    const merged = mapper.mapEvent({
      type: 'event',
      event: 'agent',
      payload: { stream: 'tool', data: { phase: 'args', toolCallId: 't1', args: { mode: 'raw' } } },
    });

    expect(merged.content).toMatchObject({ data: { args: '{"path":"/a","mode":"raw"}' } });
  });
});
