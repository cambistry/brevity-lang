import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Boolean literals (truthiness)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Boolean literals', () => {
  const script = `
      @boolTrue = { result Integer = if true 1 else 0; return :result }
      @boolFalse = { result Integer = if false 1 else 0; return :result }
      @nullFalsy
        =
        cond Integer | null = null
        result Integer = if cond 1 else 0
        return :result
      @zeroTruthy
        =
        result Integer = if 0 1 else 99
        return :result
  `;

  it('true literal is truthy', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@boolTrue', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('false literal is falsy', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@boolFalse', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 0 }, to: 'c' } },
    );
  });

  it('null is falsy', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@nullFalsy', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 0 }, to: 'c' } },
    );
  });

  it('0 (integer zero) is truthy', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@zeroTruthy', from: 'c' } },
      { output: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Comparison operators
// ═══════════════════════════════════════════════════════════════════════════════

describe('Comparison operators', () => {
  const script = `
      @eqTrue
        =
        x Integer = 5
        result Integer = if x == 5 1 else 0
        return :result

      @neqTrue
        =
        x Integer = 5
        result Integer = if x != 3 1 else 0
        return :result

      @gtTrue
        =
        x Integer = 10
        result Integer = if x > 5 1 else 0
        return :result

      @ltTrue
        =
        x Integer = 3
        result Integer = if x < 5 1 else 0
        return :result

      @gteTrue
        =
        x Integer = 5
        result Integer = if x >= 5 1 else 0
        return :result

      @lteTrue
        =
        x Integer = 5
        result Integer = if x <= 5 1 else 0
        return :result
  `;

  it('== true case', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@eqTrue', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('!= true case', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@neqTrue', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('> true case', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@gtTrue', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('< true case', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@ltTrue', from: 'c' } },
      { output: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('>= true case', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@gteTrue', from: 'c' } },
      { output: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('<= true case', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: '@lteTrue', from: 'c' } },
      { output: { id: '6', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// if/else expression forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('if/else expression', () => {
  const script = `
      @singleLine
        =
        cond Boolean = true
        x Integer = if cond 10 else 20
        return result: x

      @blockForm
        =
        x Integer = 1
        result Text = if x == 1 {
          "abc"
        } else {
          "def"
        }
        return :result

      @elseIf
        =
        x Integer = 2
        result Integer = if x == 1 10 else if x == 2 20 else 30
        return :result

      @shadow
        =
        x Integer = 10
        result Integer = if true {
          x Integer = 99
        } else {
          0
        }
        return :x, :result

      @readOuter
        =
        x Integer = 7
        result Integer = if true {
          x
        } else {
          0
        }
        return :result
  `;

  it('single-line with type annotation on both branches', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@singleLine', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('block form — last expression is the value', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@blockForm', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'abc' }, to: 'c' } },
    );
  });

  it('else if chain', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@elseIf', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 20 }, to: 'c' } },
    );
  });

  it('inner block shadows outer variable; outer value is unchanged', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@shadow', from: 'c' } },
      { output: { id: '4', 'bv-a': { x: 'Integer', result: 'Integer' }, re: { x: 10, result: 99 }, to: 'c' } },
    );
  });

  it('block reads outer scope variables', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@readOuter', from: 'c' } },
      { output: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// if without else + function call in branch
// ═══════════════════════════════════════════════════════════════════════════════

describe('if without else + function call', () => {
  const script = `
      @noElseFalse
        =
        result Integer | null = if false 42
        return :result

      @noElseTrue
        =
        result Integer | null = if true 42
        return :result

      @fnCallInIf
        =
        x Integer = 5
        result Integer = if x > 3 {
          result: sq Integer = square(x)
          sq
        } else {
          0
        }
        return :result

      square
        =
        num Integer
        =
        sq Integer = num * num
        return (result: sq)
  `;

  it('no-else if with false condition → result is null', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@noElseFalse', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer | null' }, re: { result: null }, to: 'c' } },
    );
  });

  it('no-else if with true condition → result is value', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@noElseTrue', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer | null' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('function call inside if block branch', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@fnCallInIf', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 25 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rebinding a name inside a branch
// ═══════════════════════════════════════════════════════════════════════════════

describe('rebinding a name inside a branch', () => {
  const script = `
    @Box = *{
      @one = { return 1 }
      @rebound = (c Boolean) {
        r = 5
        if c {
          r = 2
          return r
        }
        return r
      }
    }

    @plain = (c Boolean) {
      r = 5
      if c {
        r = 2
        return r
      }
      return r
    }
    @instance = (c Boolean) {
      b = Box()
      r = 5
      if c {
        r = b.one()
        return r
      }
      return r
    }
    @typed = (c Boolean) {
      r Integer = 5
      if c {
        r Integer = 2
        return r
      }
      return r
    }
    @fromItself = (c Boolean) {
      r = 5
      if c {
        r = r + 1
        return r
      }
      return r
    }
    @twice = (c Boolean) {
      r = 5
      if c {
        r = 2
        r = r + 1
        return r
      }
      return r
    }
    @inExpression = (c Boolean) {
      r = 5
      if c {
        r = 2
        return r + 10
      }
      return r + 10
    }
    @elseBranch = (c Boolean) {
      r = 5
      if c {
        return r
      } else {
        r = 2
        return r
      }
    }
    @elseIf = (c Boolean) {
      r = 5
      if c {
        return r
      } else if true {
        r = 2
        return r
      }
      return r
    }
    @nested = (c Boolean) {
      r = 5
      if c {
        r = 2
        if c {
          r = 3
          return r
        }
        return r
      }
      return r
    }
    @nestedOuter = (c Boolean) {
      r = 5
      if c {
        r = 2
        if false {
          r = 3
        }
        return r
      }
      return r
    }
    @fallsThrough = (c Boolean) {
      r = 5
      if c {
        r = 2
      }
      return r
    }
    @onInstance = (c Boolean) {
      b = Box()
      return b.rebound(c)
    }
    @viaFunction = (c Boolean) {
      return rebound(c)
    }
    rebound = (c Boolean) {
      r = 5
      if c {
        r = 2
        return r
      }
      return r
    }
    @viaFunctionCall = (c Boolean) {
      return reboundCall(c)
    }
    reboundCall = (c Boolean) {
      b = Box()
      r = 5
      if c {
        r = b.one()
        return r
      }
      return r
    }
    @instanceTag = (c Boolean) {
      b = Box()
      r = 5
      if c {
        r = b.one()
        return r
      }
      return r
    }
    @outerFromItself = {
      r = 5
      r = r + 1
      return r
    }
    @byName = (c Boolean) {
      r = 5
      if c {
        r = 2
        return :r
      }
      return :r
    }
  `;

  it('returns a plain rebound value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@plain'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [2], to: 'c' } },
    );
  });
  it('a plain rebind leaves the path that skips the branch alone', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@plain'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
    );
  });
  it('returns a value rebound from an instance call', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@instance'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1], to: 'c' }) },
    );
  });
  it('an instance call leaves the path that skips the branch alone', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@instance'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
    );
  });
  it('returns a typed shadow', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@typed'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('a typed shadow leaves the path that skips the branch alone', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@typed'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
    );
  });
  it('reads the outer value on the right of its own rebind', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@fromItself'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [6], to: 'c' }) },
    );
  });
  it('rebinds twice in one branch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@twice'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [3], to: 'c' }) },
    );
  });
  it('reads the rebound value inside an expression', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@inExpression'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [12], to: 'c' }) },
    );
  });
  it('rebinds in an else branch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@elseBranch'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('the then branch still reads the outer value when else rebinds', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@elseBranch'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
    );
  });
  it('rebinds in an else-if branch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@elseIf'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('rebinds in a nested branch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@nested'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [3], to: 'c' }) },
    );
  });
  it('a nested branch that is skipped leaves the enclosing rebind', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@nestedOuter'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('a rebind stays inside its branch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@fallsThrough'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
    );
  });
  it('works in a handler on an instance', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@onInstance'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('works in a private function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@viaFunction'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('works with an instance call in a private function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@viaFunctionCall'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1], to: 'c' }) },
    );
  });
  it('a bind in the enclosing body reads the old value too', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@outerFromItself', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [6], to: 'c' }) },
    );
  });
  it('claims no type for a value rebound from an instance call', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@instanceTag'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', re: [1], to: 'c' } },
    );
  });
  it('returns the rebound value by name', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@byName'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', 'bv-a': { r: 'Integer' }, re: { r: 2 }, to: 'c' } },
    );
  });
  it('the path that skips the branch returns the outer value by name', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@byName'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { r: 5 }, to: 'c' }) },
    );
  });
});

describe('rebinding a name inside a branch of a lambda', () => {
  const script = `
    @inLambda = (c Boolean) {
      f = (d Boolean) {
        r = 5
        if d {
          r = 2
          return r
        }
        return r
      }
      return f(c)
    }
    @inLambdaBound = (c Boolean) {
      f = (d Boolean) {
        r = 5
        if d {
          r = 2
          return r
        }
        return r
      }
      x Integer = f(c)
      return x
    }
    @lambdaInFunction = (c Boolean) {
      x = viaLambda(c)
      return x
    }
    viaLambda = (c Boolean) {
      f = (d Boolean) {
        r = 5
        if d {
          r = 2
          return r
        }
        return r
      }
      return f(c)
    }
    @lambdaGuardNoRebind = (c Boolean) {
      f = (d Boolean) {
        if d {
          return 2
        }
        return 5
      }
      return f(c)
    }
  `;

  it('works in a lambda', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@inLambda'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('works in a lambda whose result is bound', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@inLambdaBound'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('works in a lambda returned from a private function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@lambdaInFunction'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('a returned lambda call with a branch and no rebind', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@lambdaGuardNoRebind'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
});

describe('rebinding a name inside a branch of a loop', () => {
  const script = `
    @inLoop = (c Boolean) {
      r = 5
      repeat while c {
        if c {
          r = 2
          return r
        }
      }
      return r
    }
  `;

  it('works in a branch inside a loop', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@inLoop'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('a loop that never runs leaves the outer value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@inLoop'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
    );
  });
});

describe('a literal return in a branch', () => {
  const script = `
    @mixed = (c Boolean) {
      if c {
        return "x"
      }
      return 9
    }
  `;

  it('is tagged for that path', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@mixed'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Text'], re: ['x'], to: 'c' } },
    );
  });
  it('leaves the other path its own tag', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@mixed'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [9], to: 'c' } },
    );
  });
});

describe('rebinding a name to another type inside a branch', () => {
  const script = `
    @otherType = (c Boolean) {
      r = 5
      if c {
        r = "x"
        return r
      }
      return r
    }
    @otherTypeInFunction = (c Boolean) {
      x = otherType(c)
      return x
    }
    otherType = (c Boolean) {
      r = 5
      if c {
        r = "x"
        return r
      }
      return r
    }
  `;

  it('returns a rebound value of another type', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@otherType'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Text'], re: ['x'], to: 'c' } },
    );
  });
  it('the path that skips a rebind to another type returns the outer value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@otherType'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [5], to: 'c' } },
    );
  });
  it('rebinds to another type in a private function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@otherTypeInFunction'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: ['x'], to: 'c' }) },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compile errors
// ═══════════════════════════════════════════════════════════════════════════════

describe('if — compile errors', () => {
  it('plain assignment to outer-scope variable inside block → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        x Integer = 0
        result Integer = if true {
          x = 1
        } else {
          x
        }
        return :result
    `)).toThrow(/re-bind.*'x'|'x'.*re-bind|cannot re-bind/i);
  });

  it('if without else assigned to non-nullable type → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        result Integer = if true 42 as Integer
        return :result
    `)).toThrow(/if without else can return null/i);
  });

  it('mismatched branch types → compile error', () => {
    expect(() => compileSource(`
      @test
        =
        result Integer = if true 1 as Integer else "text" as Text
        return :result
    `)).toThrow(/branch type mismatch/i);
  });
});
