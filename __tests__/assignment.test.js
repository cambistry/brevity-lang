import { expectReply } from './helpers.js';

describe('assignment', () => {
  it.todo('plain local var used in expression before reply');

  it('typed assign as last block statement evaluates to assigned value', async () => {
    const source = `
      on test()
        result : Integer = if true {
          x : Integer = 42 : Integer
        } else {
          0 : Integer
        }
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { test: { result: 'Integer' } },
        re: { test: { result: 42 } },
        to: 'caller',
      },
    });
  });

  it('untyped assign as last block statement evaluates to assigned value', async () => {
    const source = `
      on test()
        result : Integer = if true {
          x : Integer
          x = 42 : Integer
        } else {
          0 : Integer
        }
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { test: { result: 'Integer' } },
        re: { test: { result: 42 } },
        to: 'caller',
      },
    });
  });
});
