import { expectReply } from './helpers.js';

describe('over — map', () => {
  it('maps integers: adds 1 to each element', async () => {
    const source = `
      on test()
        nums : List of Integers = [1, 2, 3] : List of Integers
        result : List of Integers = over nums (item : Integer) { item + 1 } : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ result: 'List of Integers' }],
        re: [{ result: [2, 3, 4] }, 'test'],
        to: 'caller',
      },
    });
  });

  it('identity map over texts', async () => {
    const source = `
      on test()
        words : List of Texts = ["hello", "world"] : List of Texts
        result : List of Texts = over words (w : Text) { w } : Text
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ result: 'List of Texts' }],
        re: [{ result: ['hello', 'world'] }, 'test'],
        to: 'caller',
      },
    });
  });

  it('untyped fn body → List of Anything — bv-a emits component types array', async () => {
    const source = `
      on test()
        nums : List of Integers = [10, 20] : List of Integers
        result : List = over nums (item) { item }
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: expect.objectContaining({
        'bv-a': [{ result: ['Integer', 'Integer'] }],
        re: [{ result: [10, 20] }, 'test'],
      }),
    });
  });

  it('over empty list → reply is null', async () => {
    const source = `
      on test()
        nums : List of Integers = []
        result : List of Integers = over nums (item : Integer) { item + 1 } : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: expect.objectContaining({
        re: [{ result: null }, 'test'],
      }),
    });
  });

  it('over with proc call inside fn body (async callback)', async () => {
    const source = `
      on test()
        nums : List of Integers = [3, 4] : List of Integers
        result : List of Integers = over nums (item : Integer) {
          result: sq : Integer = square(item)
          sq
        } : Integer
        reply :result

      proc square(num : Integer)
        sq : Integer = num * num
        reply(result: sq : Integer)
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ result: 'List of Integers' }],
        re: [{ result: [9, 16] }, 'test'],
        to: 'caller',
      },
    });
  });

  it.todo('standalone over (side-effect only) — requires actor state, not yet implemented');
});
