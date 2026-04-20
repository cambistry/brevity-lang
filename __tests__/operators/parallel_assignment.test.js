import { expectBehavior } from '../helpers.js';

describe('parallel assignment', () => {
  const script = `
    @posLiteral
      =
      a, b = 1 as Integer, 2 as Integer
      -> x: a, y: b

    @posArith
      =
      a, b = 10 as Integer, 20 as Integer
      -> sum: (a + b)

    @namedLiteral
      =
      :x, :y = x: 5 as Integer, y: 7 as Integer
      -> a: x, b: y

    @stringLiteral
      =
      a, b = "hello" as Text, "world" as Text
      -> first: a, second: b
  `;

  it('a, b = 1, 2 — positional inline structure', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@posLiteral', from: 'c' } },
      { output: { id: '1', 'bv-a': { x: 'Integer', y: 'Integer' }, re: { x: 1, y: 2 }, to: 'c' } },
    );
  });

  it('a, b = 10, 20 — arithmetic on results', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@posArith', from: 'c' } },
      { output: { id: '2', 'bv-a': { sum: 'Integer' }, re: { sum: 30 }, to: 'c' } },
    );
  });

  it(':x, :y = x: 5, y: 7 — named inline structure', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@namedLiteral', from: 'c' } },
      { output: { id: '3', 'bv-a': { a: 'Integer', b: 'Integer' }, re: { a: 5, b: 7 }, to: 'c' } },
    );
  });

  it('a, b = "hello", "world" — string literals', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@stringLiteral', from: 'c' } },
      { output: { id: '4', 'bv-a': { first: 'Text', second: 'Text' }, re: { first: 'hello', second: 'world' }, to: 'c' } },
    );
  });
});
