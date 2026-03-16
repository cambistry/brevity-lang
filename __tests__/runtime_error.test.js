import { expectReply } from './helpers.js';

// All runtime errors produce: ex: { <op>: 'error' }

describe('Runtime errors', () => {
  it('list arity mismatch — [a, b] = [1, 2, 3] without discard', async () => {
    const source = `
      on test()
        nums : List of Integers = [1, 2, 3] : List of Integers
        [a : Integer, b : Integer] = nums
        -> result: 0 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        ex: { test: 'error' },
        to: 'caller',
      },
    });
  });

  it('head of empty list — [h] = []', async () => {
    const source = `
      on test()
        nums : List of Integers = [] : List of Integers
        [h : Integer] = nums
        -> result: h
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        ex: { test: 'error' },
        to: 'caller',
      },
    });
  });

  it('head of too-short list — [a, b] = [1]', async () => {
    const source = `
      on test()
        nums : List of Integers = [1] : List of Integers
        [a : Integer, b : Integer] = nums
        -> result: 0 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        ex: { test: 'error' },
        to: 'caller',
      },
    });
  });
});
