import { describe, expect, it } from 'vitest';

import { ConnectionError, ParseError, SSEError, TimeoutError, ValidationError } from '../../server/errors';

describe('server errors', () => {
  it('retains base error metadata', () => {
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
  ])('constructs %s with its intended metadata', (error, name, code, isRetryable, statusCode) => {
    expect(error).toBeInstanceOf(SSEError);
    expect(error).toMatchObject({ name, code, isRetryable, statusCode });
  });

  it('uses the default timeout message and stores details', () => {
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

  it.todo('accepts a timeout message as the first argument, matching all server call sites');
});
