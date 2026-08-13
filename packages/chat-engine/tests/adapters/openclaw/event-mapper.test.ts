import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenClawEventMapper } from '../../../adapters/openclaw/event-mapper';

describe('OpenClawEventMapper', () => {
  let mapper: OpenClawEventMapper;

  beforeEach(() => {
    mapper = new OpenClawEventMapper();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('maps assistant snapshots using deltas and tracks full text', () => {
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

  it('derives increments from generic full snapshots', () => {
    expect(mapper.mapEvent({ type: 'event', event: 'agent', payload: { data: { text: 'A' } } }).content).toMatchObject({
      data: 'A',
    });
    expect(mapper.mapEvent({ type: 'event', event: 'agent', payload: { data: { text: 'AB' } } }).content).toMatchObject(
      { data: 'B' },
    );
    expect(mapper.mapEvent({ type: 'event', event: 'agent', payload: { data: { text: 'AB' } } }).content).toBeNull();
  });

  it('treats chat events as lifecycle signals', () => {
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

  it('maps tool start and result phases', () => {
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

  it('supports result-only tool events and suggestion results', () => {
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

  it('maps generic events and resets observable state', () => {
    expect(
      mapper.mapEvent({ type: 'event', event: 'notice', payload: { message: 'maintenance' } }).content,
    ).toMatchObject({ data: 'maintenance' });
    mapper.mapEvent({ type: 'event', event: 'agent', payload: { runId: 'r', data: { delta: 'x' } } });
    mapper.reset();
    expect(mapper.getCurrentRunId()).toBeNull();
    expect(mapper.getTextBuffer()).toBe('');
    expect(mapper.getToolCalls()).toEqual([]);
  });

  it.todo('merges generic tool args objects without requiring a string delta');
});
