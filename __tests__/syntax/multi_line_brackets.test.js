import { expectBehavior, compileSource } from '../helpers.js';

// Inside `( )` and `[ ]`, a line break separates items as a comma does. A line that
// ends in an operator continues on the next; otherwise the next line is a new item,
// whatever it starts with. Commas stay legal, a trailing one too.
describe('line breaks in brackets', () => {
  const script = `
    add = (
      a Integer
      b Integer
    ) -> a + b

    @args = () -> add(
      1
      2
    )
    @named = () -> pair(
      x: 1
      y: 2
    )
    pair = (x: Integer, y: Integer) -> x * 10 + y
    @list = (k Integer) -> [
      k
      -1
      (k)
      k +
        1
    ]
    @commas = () -> [
      1,
      2,
    ]
    @reply = (k Integer) {
      return (
        a: k
        b: k + 1
      )
    }
    @inlineIf = (c Boolean) -> [
      if (c) 1
      else 2
      3
    ]
    @statement = (k Integer) {
      x Integer = k *
        2 +
        1
      return x
    }
  `;

  it('call args, positional and named; params one per line', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'args', from: 'c' } },
      { output: { id: '1', re: [3], to: 'c' } },
      { input: { id: '2', op: 'named', from: 'c' } },
      { output: { id: '2', re: [12], to: 'c' } },
    );
  });

  it('a next line starting with - or ( is a new item; a line ending in + continues', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], 'list'], ty: [['Integer']], from: 'c' } },
      { output: { id: '1', re: [[5, -1, 5, 6]], ty: ['List of Integers'], to: 'c' } },
    );
  });

  it('commas, a trailing one before the break', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'commas', from: 'c' } },
      { output: { id: '1', re: [[1, 2]], ty: ['List of Integers'], to: 'c' } },
    );
  });

  it('a grouped reply', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], 'reply'], ty: [['Integer']], from: 'c' } },
      { output: { id: '1', re: [{ a: 5, b: 6 }], ty: [{ a: 'Integer', b: 'Integer' }], to: 'c' } },
    );
  });

  it('else on the next line continues an inline if', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], 'inlineIf'], ty: [['Boolean']], from: 'c' } },
      { output: { id: '1', re: [[2, 3]], to: 'c' } },
    );
  });

  it('a line ending in an operator continues, outside brackets too', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], 'statement'], ty: [['Integer']], from: 'c' } },
      { output: { id: '1', re: [11], ty: ['Integer'], to: 'c' } },
    );
  });
});

describe('line breaks in brackets — compile errors', () => {
  it('a next line starting with . is a new item, not a member call', () => {
    expect(() => compileSource(`
      @f = (t Text) -> [
        t
        .size()
      ]
    `)).toThrow();
  });
});
