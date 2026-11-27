import { expectBehavior } from '../helpers.js';

// A file-level function with an untyped param is generic: its param's type
// is only known at the call site. Arithmetic and comparison on it must still
// work, whichever numeric type the caller passes.

describe('untyped param arithmetic in a file-level function', () => {
  const script = `
    double = (n) { n * 2 }
    big = (n) { n > 10 }
    cube = (n) { n ^ 3 }

    @test = {
      result Integer = double(21)
      return :result
    }

    @testDecimal = {
      result Decimal = double(1.25)
      return :result
    }

    @testPower = {
      result Integer = cube(3)
      return :result
    }

    @testCompare = {
      result Boolean = big(11)
      return :result
    }
  `;

  it('doubles an Integer argument', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'test', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 42 }], to: 'c' } },
    );
  });

  it('doubles a Decimal argument', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'testDecimal', from: 'c' } },
      { output: { id: '2', 'ty': [{ result: 'Decimal' }], re: [{ result: 2.5 }], to: 'c' } },
    );
  });

  it('raises an untyped argument to a power', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: 'testPower', from: 'c' } },
      { output: { id: '4', 'ty': [{ result: 'Integer' }], re: [{ result: 27 }], to: 'c' } },
    );
  });

  it('compares an untyped argument', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: 'testCompare', from: 'c' } },
      { output: { id: '3', 'ty': [{ result: 'Boolean' }], re: [{ result: true }], to: 'c' } },
    );
  });
});

// Arithmetic on operands no type says are numbers is on numbers, checked when it
// runs: two Texts under `+` join, and any other operand fails. No operand reads as
// 0, and a Float isn't truncated.
describe('arithmetic on Anything operands', () => {
  const script = `
    @add = (a Anything, b Anything) {
      r Integer = (a + b) as Integer
      return r
    }
    @addF = (a Anything, b Anything) {
      r Float = (a + b) as Float
      return r
    }
    @join = (a Anything, b Anything) {
      r Text = (a + b) as Text
      return r
    }
  `;

  it('of numbers', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[2, 3], 'add'], ty: [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '1', re: [5], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: [[1.5, 2], 'addF'], ty: [['Float', 'Integer']], from: 'c' } },
      { output: { id: '2', re: [3.5], ty: ['Float'], to: 'c' } },
    );
  });

  it('of two Texts joins them', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [['a', 'b'], 'join'], ty: [['Text', 'Text']], from: 'c' } },
      { output: { id: '1', re: ['ab'], ty: ['Text'], to: 'c' } },
    );
  });

  it('with a Text, a Boolean or a null operand fails', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [['t', 1], 'add'], ty: [['Text', 'Integer']], from: 'c' } },
      { output: { id: '1', ex: { add: 'error' }, to: 'c' } },
      { input: { id: '2', op: [[true, 1], 'add'], ty: [['Boolean', 'Integer']], from: 'c' } },
      { output: { id: '2', ex: { add: 'error' }, to: 'c' } },
      { input: { id: '3', op: [[null, 1], 'add'], ty: [['null', 'Integer']], from: 'c' } },
      { output: { id: '3', ex: { add: 'error' }, to: 'c' } },
    );
  });
});
