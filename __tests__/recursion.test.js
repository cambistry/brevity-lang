import { runActor } from './helpers.js';

describe('recursion', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @drain
        =
        result : Integer = drainFn(10)
        -> :result

      drainFn
        =
        a : Integer
        =
        b : Integer = if a > 0 drainFn(a - 1) : Integer else 0 as Integer
        -> b : Integer

      @factorial
        =
        fact = |n| {
          result : Integer = if n > 1 n * fact(n - 1) : Integer else 1 as Integer
        }
        result : Integer = fact(5)
        -> :result
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: '@drain', from: 'c' },
        { id: '2', op: '@factorial', from: 'c' },
      ],
    });
  });

  it('recursive drain counts down to 0', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { result: 'Integer' }, re: { result: 0 }, to: 'c' });
  });

  it('recursive factorial computes 5! = 120', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { result: 'Integer' }, re: { result: 120 }, to: 'c' });
  });
});
