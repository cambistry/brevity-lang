import { expectBehavior } from '../helpers.js';

describe('arguments', () => {
  const script = `
    @multInline
      =
      a Integer
      b Integer
      =
      x Integer = a * b
      ->(x as Integer)

    @multOpen
      =
      a Integer
      b Integer
      =
      x Integer = a * b
      ->
        x as Integer

    @keyMapped
      =
      outer: (inner) Text
      =
      ->(result: inner as Text)

    @mixed
      =
      a Integer
      b Integer
      message: Text
      =
      result Integer = a + b
      ->
        result as Integer
        comment: message as Text
  `;

  it('positional args — explicit inline', async () => {
    await expectBehavior(script, {
      input: { id: '1', op: [[3, 5], '@multInline'], 'bv-a': [['Integer', 'Integer']], from: 'c' },
      output: { id: '1', 'bv-a': ['Integer'], re: [15], to: 'c' },
    });
  });

  it('positional args — lineal form', async () => {
    await expectBehavior(script, {
      input: { id: '2', op: [[3, 5], '@multOpen'], 'bv-a': [['Integer', 'Integer']], from: 'c' },
      output: { id: '2', 'bv-a': ['Integer'], re: [15], to: 'c' },
    });
  });

  it('key-mapped arg — outer: (inner) Text', async () => {
    await expectBehavior(script, {
      input: { id: '3', op: [{ outer: 'hello' }, '@keyMapped'], 'bv-a': [{ outer: 'Text' }], from: 'c' },
      output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' },
    });
  });

  it('mixed positional + named args', async () => {
    await expectBehavior(script, {
      input: { id: '4', op: [[1, 2, { message: 'add this' }], '@mixed'], 'bv-a': [['Integer', 'Integer', { message: 'Text' }]], from: 'c' },
      output: { id: '4', 'bv-a': ['Integer', { comment: 'Text' }], re: [3, { comment: 'add this' }], to: 'c' },
    });
  });
});
