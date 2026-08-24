import { describe, expect, it } from 'vitest';

import { ConnectionError, ParseError, SSEError, TimeoutError, ValidationError } from '../errors';

describe('服务端错误', () => {
  it('保留基础错误元数据', () => {
    const details = { requestId: 'request-1' };
    const error = new SSEError('failed', 'CUSTOM', 418, true, details);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'SSEError',
      message: 'failed',
      code: 'CUSTOM',
      statusCode: 418,
      isRetryable: true,
      details,
    });
  });

  it.each([
    [new ConnectionError('offline', 503, { host: 'api' }), 'ConnectionError', 'CONNECTION_ERROR', true, 503],
    [new ParseError('invalid JSON', { input: '{' }), 'ParseError', 'PARSE_ERROR', false, undefined],
    [
      new ValidationError('missing prompt', { field: 'prompt' }),
      'ValidationError',
      'VALIDATION_ERROR',
      false,
      undefined,
    ],
  ])('用预期的元数据构造 %s', (error, name, code, isRetryable, statusCode) => {
    expect(error).toBeInstanceOf(SSEError);
    expect(error).toMatchObject({ name, code, isRetryable, statusCode });
  });

  it('使用默认超时消息并存储详情', () => {
    const details = { elapsed: 1000 };
    const error = new TimeoutError(details);

    expect(error).toMatchObject({
      name: 'TimeoutError',
      message: '请求超时',
      code: 'TIMEOUT_ERROR',
      isRetryable: true,
      details,
    });
  });

  it.todo('接受超时消息作为第一个参数，与服务端所有调用点保持一致');
});
