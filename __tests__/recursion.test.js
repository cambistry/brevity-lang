import { compileActor, expectActorReply } from './helpers.js';

describe('recursion', () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileActor(`
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
    `);
  });

  it('recursive drain counts down to 0', async () => {
    await expectActorReply({
      compiled, receive: { id: '1', op: '@drain', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 0 }, to: 'c' },
    });
  });

  it('recursive factorial computes 5! = 120', async () => {
    await expectActorReply({
      compiled, receive: { id: '2', op: '@factorial', from: 'c' },
      reply: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 120 }, to: 'c' },
    });
  });
});
