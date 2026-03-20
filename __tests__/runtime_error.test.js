import { runActor } from './helpers.js';

// All runtime errors produce: ex: { <op>: 'error' }

describe('Runtime errors', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
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

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: '@arityMismatch', from: 'c' },
        { id: '2', op: '@emptyHead', from: 'c' },
        { id: '3', op: '@tooShort', from: 'c' },
      ],
    });
  });

  it('list arity mismatch — [a, b] = [1, 2, 3] without discard', () => {
    expect(outputs[0]).toEqual({ id: '1', ex: { '@arityMismatch': 'error' }, to: 'c' });
  });

  it('head of empty list — [h] = []', () => {
    expect(outputs[1]).toEqual({ id: '2', ex: { '@emptyHead': 'error' }, to: 'c' });
  });

  it('head of too-short list — [a, b] = [1]', () => {
    expect(outputs[2]).toEqual({ id: '3', ex: { '@tooShort': 'error' }, to: 'c' });
  });
});
