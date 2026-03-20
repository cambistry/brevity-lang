import { runActor } from './helpers.js';

describe('parallel assignment', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @posLiteral
        =
        a, b = 1 as Integer, 2 : Integer
        -> x: a, y: b

      @posArith
        =
        a, b = 10 as Integer, 20 as Integer
        -> sum: (a + b) as Integer

      @namedLiteral
        =
        :x, :y = x: 5 : Integer, y: 7 : Integer
        -> a: x, b: y

      @stringLiteral
        =
        a, b = "hello" as Text, "world" as Text
        -> first: a, second: b
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'posLiteral', from: 'c' },
        { id: '2', op: 'posArith', from: 'c' },
        { id: '3', op: 'namedLiteral', from: 'c' },
        { id: '4', op: 'stringLiteral', from: 'c' },
      ],
    });
  });

  it('a, b = 1, 2 — positional inline structure', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { x: 'Integer', y: 'Integer' }, re: { x: 1, y: 2 }, to: 'c' });
  });

  it('a, b = 10, 20 — arithmetic on results', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { sum: 'Integer' }, re: { sum: 30 }, to: 'c' });
  });

  it(':x, :y = x: 5, y: 7 — named inline structure', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { a: 'Integer', b: 'Integer' }, re: { a: 5, b: 7 }, to: 'c' });
  });

  it('a, b = "hello", "world" — string literals', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { first: 'Text', second: 'Text' }, re: { first: 'hello', second: 'world' }, to: 'c' });
  });
});
