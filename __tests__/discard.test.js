import { expectReply } from './helpers.js';

describe('underscore discard — positional destructure', () => {
  it('_, b = args — discard first positional, bind second', async () => {
    const source = `
      on test(...args)
        _, b = args
        reply result: b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[99, 42], 'test'], 'bv-a': [['Integer', 'Integer']], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ result: 'Integer' }], re: [{ result: 42 }, 'test'], to: 'caller' },
    });
  });

  it('a, _, b = args — discard middle positional, bind first and third', async () => {
    const source = `
      on test(...args)
        a, _, b = args
        reply sum: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[10, 99, 20], 'test'], 'bv-a': [['Integer', 'Integer', 'Integer']], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ sum: 'Integer' }], re: [{ sum: 30 }, 'test'], to: 'caller' },
    });
  });

  it('_, _ = args — multiple underscores in one pattern, no bindings generated', async () => {
    const source = `
      on test(...args)
        _, _ = args
        reply result: 0 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[1, 2], 'test'], 'bv-a': [['Integer', 'Integer']], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ result: 'Integer' }], re: [{ result: 0 }, 'test'], to: 'caller' },
    });
  });

  it('(a, _, b) = args — paren form with discard', async () => {
    const source = `
      on test(...args)
        (a, _, b) = args
        reply sum: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[5, 77, 6], 'test'], 'bv-a': [['Integer', 'Integer', 'Integer']], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ sum: 'Integer' }], re: [{ sum: 11 }, 'test'], to: 'caller' },
    });
  });

  it('a, _, _, d = args — two consecutive discards', async () => {
    const source = `
      on test(...args)
        a, _, _, d = args
        reply sum: a + d : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[1, 0, 0, 4], 'test'], 'bv-a': [['Integer', 'Integer', 'Integer', 'Integer']], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ sum: 'Integer' }], re: [{ sum: 5 }, 'test'], to: 'caller' },
    });
  });
});
