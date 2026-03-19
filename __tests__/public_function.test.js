import { runActor } from './helpers.js';

describe('public function', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @helloOpen
        =
        -> answer: "world" : Text

      @helloInline = -> answer: "world" : Text

      @echo = |:text : Text| ->(:text : Text)

      @add
        =
        :a : Integer
        :b : Integer
        =
        x : Integer = a + b
        -> :x
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'helloOpen', from: 'c' },
        { id: '2', op: 'helloInline', from: 'c' },
        { id: '3', op: 'helloOpen', from: 'c' },
        { id: '4', op: [{ text: 'abc' }, 'echo'], 'bv-a': [{ text: 'Text' }], from: 'c' },
        { id: '5', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
      ],
    });
  });

  it('@hello — open style', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' });
  });

  it('@hello = -> — dense inline', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' });
  });

  it('multiple public functions — both reachable', () => {
    expect(outputs[2]).toEqual({ id: '3', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' });
    expect(outputs[3]).toEqual({ id: '4', 'bv-a': { text: 'Text' }, re: { text: 'abc' }, to: 'c' });
  });

  it('whitespace-only blank line between params and body', () => {
    expect(outputs[4]).toEqual({ id: '5', 'bv-a': { x: 'Integer' }, re: { x: 7 }, to: 'c' });
  });
});
