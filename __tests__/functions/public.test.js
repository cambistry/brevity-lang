import { expectBehavior } from '../helpers.js';

describe('public function', () => {
  const script = `
    @helloOpen
      =
      -> answer: "world"

    @helloInline = -> answer: "world"

    @echo = (text: Text) ->(:text)

    @add
      =
      a: Integer
      b: Integer
      =
      x Integer = a + b
      -> :x
  `;

  it('@hello — lineal form', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@helloOpen', from: 'c' } },
      { output: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' } },
    );
  });

  it('@hello = -> — delimited inline', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@helloInline', from: 'c' } },
      { output: { id: '2', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' } },
    );
  });

  it('@echo — named param round-trip', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [{ text: 'abc' }, '@echo'], 'bv-a': [{ text: 'Text' }], from: 'c' } },
      { output: { id: '3', 'bv-a': { text: 'Text' }, re: { text: 'abc' }, to: 'c' } },
    );
  });

  it('whitespace-only blank line between params and body', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [{ a: 3, b: 4 }, '@add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' } },
      { output: { id: '4', 'bv-a': { x: 'Integer' }, re: { x: 7 }, to: 'c' } },
    );
  });
});
