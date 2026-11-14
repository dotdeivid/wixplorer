import { describe, expect, it } from 'vitest';
import { errorMessage, errorName } from './errors';

describe('errorName / errorMessage', () => {
  it('lee name y message de un Error', () => {
    const e = new RangeError('boom');
    expect(errorName(e)).toBe('RangeError');
    expect(errorMessage(e)).toBe('boom');
  });

  it('lee name de un DOMException (AbortError)', () => {
    expect(errorName(new DOMException('cancel', 'AbortError'))).toBe('AbortError');
  });

  it('devuelve undefined para valores que no son objetos con esas props', () => {
    for (const value of ['texto', 42, null, undefined, {}, { message: 1 }]) {
      expect(errorMessage(value)).toBeUndefined();
      expect(errorName(value)).toBeUndefined();
    }
  });
});
