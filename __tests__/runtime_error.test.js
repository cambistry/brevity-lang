import { expectReply } from './helpers.js';

describe('Runtime errors', () => {
  const script = `
    @arityMismatch
      =
      nums : List of Integers = [1, 2, 3] : List of Integers
      [a : Integer, b : Integer] = nums
      -> result: 0 as Integer

    @emptyHead
      =
      nums : List of Integers = [] : List of Integers
      [h : Integer] = nums
      -> result: h

    @tooShort
      =
      nums : List of Integers = [1] : List of Integers
      [a : Integer, b : Integer] = nums
      -> result: 0 as Integer
  `;

  it('list arity mismatch — [a, b] = [1, 2, 3] without discard', async () => {
    await expectReply({
      script, receive: { id: '1', op: '@arityMismatch', from: 'c' },
      reply: { id: '1', ex: { '@arityMismatch': 'error' }, to: 'c' },
    });
  });

  it('head of empty list — [h] = []', async () => {
    await expectReply({
      script, receive: { id: '2', op: '@emptyHead', from: 'c' },
      reply: { id: '2', ex: { '@emptyHead': 'error' }, to: 'c' },
    });
  });

  it('head of too-short list — [a, b] = [1]', async () => {
    await expectReply({
      script, receive: { id: '3', op: '@tooShort', from: 'c' },
      reply: { id: '3', ex: { '@tooShort': 'error' }, to: 'c' },
    });
  });
});
