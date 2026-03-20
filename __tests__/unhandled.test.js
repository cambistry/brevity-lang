import { runActor } from './helpers.js';

describe('unhandled op', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @hello = -> answer: "world" as Text
      @inc = |:x : Integer| -> bigger: (x + 1) as Integer
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'goodbye', from: 'c' },
        { id: '2', op: [{ x: 5 }, 'compute'], 'bv-a': [{ x: 'Integer' }], from: 'c' },
        { id: '3', op: 'nope', from: 'c' },
        { id: '4', op: [{ x: 5 }, 'inc'], 'bv-a': [{ x: 'Integer' }], from: 'c' },
      ],
    });
  });

  it('string op with no matching function → ex unhandled', () => {
    expect(outputs[0]).toEqual({ id: '1', ex: { goodbye: 'unhandled' }, to: 'c' });
  });

  it('object op with no matching function → ex unhandled', () => {
    expect(outputs[1]).toEqual({ id: '2', ex: { compute: 'unhandled' }, to: 'c' });
  });

  it('multi-function actor — unrecognised op → ex unhandled', () => {
    expect(outputs[2]).toEqual({ id: '3', ex: { nope: 'unhandled' }, to: 'c' });
  });

  it('multi-function actor — recognised op replies normally', () => {
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { bigger: 'Integer' }, re: { bigger: 6 }, to: 'c' });
  });
});
