import { expectBehavior } from '../helpers.js';

describe('Runtime errors', () => {
  const script = `
    @arityMismatch
      =
      nums List of Integers = [1, 2, 3] as List of Integers
      [a Integer, b Integer] = nums
      -> result: 0 as Integer

    @emptyHead
      =
      nums List of Integers = [] as List of Integers
      [h Integer] = nums
      -> result: h

    @tooShort
      =
      nums List of Integers = [1] as List of Integers
      [a Integer, b Integer] = nums
      -> result: 0 as Integer
  `;

  it('list arity mismatch — [a, b] = [1, 2, 3] without discard', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@arityMismatch', from: 'c' } },
      { output: { id: '1', ex: { '@arityMismatch': 'error' }, to: 'c' } },
    );
  });

  it('head of empty list — [h] = []', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@emptyHead', from: 'c' } },
      { output: { id: '2', ex: { '@emptyHead': 'error' }, to: 'c' } },
    );
  });

  it('head of too-short list — [a, b] = [1]', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@tooShort', from: 'c' } },
      { output: { id: '3', ex: { '@tooShort': 'error' }, to: 'c' } },
    );
  });
});
