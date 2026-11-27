import { expectBehavior, compileSource } from '../helpers.js';

// `and`, `or`, `not` on Booleans, short-circuiting. Loosest of all operators:
// `not a == b` is `not (a == b)`, and `and` binds tighter than `or`.
describe('and, or, not', () => {
  const script = `
    n *Integer = 0
    bump! = {
      n <- n + 1
      return true
    }

    @both = (a Boolean, b Boolean) { return a and b }
    @either = (a Boolean, b Boolean) { return a or b }
    @neg = (a Boolean) { return not a }
    @mixed = (a Boolean, b Boolean, c Boolean) { return a or b and c }
    @notEquals = (k Integer) { return not k == 1 }
    @inRange = (k Integer) {
      if k > 0 and k < 10 { return true }
      return false
    }
    @short! = (a Boolean) {
      x Boolean = a and bump!()
      y Boolean = not a or bump!()
      return n
    }
  `;

  it('and', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true, true], 'both'], ty: [['Boolean', 'Boolean']], from: 'c' } },
      { output: { id: '1', re: [true], ty: ['Boolean'], to: 'c' } },
      { input: { id: '2', op: [[true, false], 'both'], ty: [['Boolean', 'Boolean']], from: 'c' } },
      { output: { id: '2', re: [false], ty: ['Boolean'], to: 'c' } },
    );
  });

  it('or', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false, true], 'either'], ty: [['Boolean', 'Boolean']], from: 'c' } },
      { output: { id: '1', re: [true], ty: ['Boolean'], to: 'c' } },
      { input: { id: '2', op: [[false, false], 'either'], ty: [['Boolean', 'Boolean']], from: 'c' } },
      { output: { id: '2', re: [false], ty: ['Boolean'], to: 'c' } },
    );
  });

  it('not', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'neg'], ty: [['Boolean']], from: 'c' } },
      { output: { id: '1', re: [false], ty: ['Boolean'], to: 'c' } },
    );
  });

  it('and binds tighter than or', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true, false, false], 'mixed'], ty: [['Boolean', 'Boolean', 'Boolean']], from: 'c' } },
      { output: { id: '1', re: [true], ty: ['Boolean'], to: 'c' } },
      { input: { id: '2', op: [[false, true, false], 'mixed'], ty: [['Boolean', 'Boolean', 'Boolean']], from: 'c' } },
      { output: { id: '2', re: [false], ty: ['Boolean'], to: 'c' } },
    );
  });

  it('not is looser than a comparison', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], 'notEquals'], ty: [['Integer']], from: 'c' } },
      { output: { id: '1', re: [false], ty: ['Boolean'], to: 'c' } },
      { input: { id: '2', op: [[2], 'notEquals'], ty: [['Integer']], from: 'c' } },
      { output: { id: '2', re: [true], ty: ['Boolean'], to: 'c' } },
    );
  });

  it('in an if condition', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[5], 'inRange'], ty: [['Integer']], from: 'c' } },
      { output: { id: '1', re: [true], ty: ['Boolean'], to: 'c' } },
      { input: { id: '2', op: [[12], 'inRange'], ty: [['Integer']], from: 'c' } },
      { output: { id: '2', re: [false], ty: ['Boolean'], to: 'c' } },
    );
  });

  it('the right operand runs only when the left doesn\'t settle it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], 'short!'], ty: [['Boolean']], from: 'c' } },
      { output: { id: '1', re: [0], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: [[true], 'short!'], ty: [['Boolean']], from: 'c' } },
      { output: { id: '2', re: [2], ty: ['Integer'], to: 'c' } },
    );
  });
});

describe('and, or, not — compile errors', () => {
  it('an operand that isn\'t a Boolean', () => {
    expect(() => compileSource(`
      @f = (k Integer) { return k and true }
    `)).toThrow("'and' takes Booleans: this operand is 'Integer'");
  });

  it('not on a Text', () => {
    expect(() => compileSource(`
      @f = (t Text) { return not t }
    `)).toThrow("'not' takes Booleans: this operand is 'Text'");
  });

  it('a keyword is not a name', () => {
    expect(() => compileSource(`
      @f = () {
        or Integer = 1
        return or
      }
    `)).toThrow();
  });
});
