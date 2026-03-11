import compile from '../index.js';
import { expectReply } from './helpers.js';

describe('recursion — recursive proc calls', () => {
  it('recursive drain counts down to 0', async () => {
    const source = `
      on test()
        result : Integer = drain(10)
        reply :result

      proc drain(a : Integer)
        b : Integer = if a > 0 drain(a - 1) : Integer else 0 : Integer
        reply b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', re: { result: 0 }, 'bv-a': { result: 'Integer' }, to: 'caller' },
    });
  });
});
