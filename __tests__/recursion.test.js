import compile from '../index.js';
import { expectReply } from './helpers.js';

describe('recursion — recursive proc calls', () => {
  it('recursive drain counts down to 0', async () => {
    const source = `
      on test()
        result : Integer = drain(10)
        -> :result

      proc drain(a : Integer)
        b : Integer = if a > 0 drain(a - 1) : Integer else 0 : Integer
        -> b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', re: { result: 0 }, 'bv-a': { result: 'Integer' }, to: 'caller' },
    });
  });
});

describe('recursion — recursive function calls', () => {
  it('recursive factorial computes 5! = 120', async () => {
    const source = `
      on test()
        factorial = |n| {
          result : Integer = if n > 1 n * factorial(n - 1) : Integer else 1 : Integer
        }
        result : Integer = factorial(5)
        -> :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', re: { result: 120 }, 'bv-a': { result: 'Integer' }, to: 'caller' },
    });
  });
});
