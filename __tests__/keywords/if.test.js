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
// Shadowing a name inside a branch
// ═══════════════════════════════════════════════════════════════════════════════

describe('shadowing a name inside a branch', () => {
  const script = `
    @Box = *{
      @one = { return 1 }
      @rebound = (c Boolean) {
        r = 5
        if c {
          r Integer = 2
          return r
        }
        return r
      }
    }

    @plain = (c Boolean) {
      r = 5
      if c {
        r Integer = 2
        return r
      }
      return r
    }
    @instance = (c Boolean) {
      b = Box()
      r = 5
      if c {
        r Integer = b.one()
        return r
      }
      return r
    }
    @fromItself = (c Boolean) {
      r = 5
      if c {
        r Integer = r + 1
        return r
      }
      return r
    }
    @twice = (c Boolean) {
      r = 5
      if c {
        r Integer = 2
        r = r + 1
        return r
      }
      return r
    }
    @inExpression = (c Boolean) {
      r = 5
      if c {
        r Integer = 2
        return r + 10
      }
      return r + 10
    }
    @elseBranch = (c Boolean) {
      r = 5
      if c {
        return r
      } else {
        r Integer = 2
        return r
      }
    }
    @elseIf = (c Boolean) {
      r = 5
      if c {
        return r
      } else if true {
        r Integer = 2
        return r
      }
      return r
    }
    @nested = (c Boolean) {
      r = 5
      if c {
        r Integer = 2
        if c {
          r Integer = 3
          return r
        }
        return r
      }
      return r
    }
    @nestedOuter = (c Boolean) {
      r = 5
      if c {
        r Integer = 2
        if false {
          r Integer = 3
        }
        return r
      }
      return r
    }
    @fallsThrough = (c Boolean) {
      r = 5
      if c {
        r Integer = 2
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
        r Integer = 2
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
        r Integer = b.one()
        return r
      }
      return r
    }
    @instanceTag = (c Boolean) {
      b = Box()
      r = 5
      if c {
        s = b.one()
        return s
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
        r Integer = 2
        return :r
      }
      return :r
    }
  `;

  it('returns a shadow of a plain value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@plain'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [2], to: 'c' } },
    );
  });
  it('a shadow leaves the path that skips the branch alone', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@plain'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
    );
  });
  it('returns a shadow bound from an instance call', async () => {
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
  it('reads the outer value on the right of its own shadow', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@fromItself'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [6], to: 'c' }) },
    );
  });
  it('rebinds a shadow within its branch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@twice'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [3], to: 'c' }) },
    );
  });
  it('reads the shadow inside an expression', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@inExpression'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [12], to: 'c' }) },
    );
  });
  it('shadows in an else branch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@elseBranch'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('the then branch still reads the outer value when else shadows', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@elseBranch'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
    );
  });
  it('shadows in an else-if branch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@elseIf'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('shadows in a nested branch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@nested'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [3], to: 'c' }) },
    );
  });
  it('a nested branch that is skipped leaves the enclosing shadow', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@nestedOuter'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('a shadow stays inside its branch', async () => {
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
  it('claims no type for an untyped bind from an instance call', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@instanceTag'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', re: [1], to: 'c' } },
    );
  });
  it('returns the shadow by name', async () => {
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

describe('shadowing a name inside a branch of a lambda', () => {
  const script = `
    @inLambda = (c Boolean) {
      f = (d Boolean) {
        r = 5
        if d {
          r Integer = 2
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
          r Integer = 2
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
          r Integer = 2
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
  it('a returned lambda call with a branch and no shadow', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@lambdaGuardNoRebind'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
});

describe('shadowing a name in a loop', () => {
  const script = `
    @inLoop = (c Boolean) {
      r = 5
      repeat while c {
        if c {
          r Integer = 2
          return r
        }
      }
      return r
    }
    @inLoopBody = (c Boolean) {
      r Integer = 5
      repeat while c {
        r Integer = 2
        return r
      }
      return r
    }
    @fromOuterInLoopBody = (c Boolean) {
      r Integer = 5
      repeat while c {
        r Integer = r + 1
        return r
      }
      return r
    }
    @freshInLoopBody = (c Boolean) {
      repeat while c {
        s = 2
        return s
      }
      return 5
    }
  `;

  it('works directly in a loop body', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@inLoopBody'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('a loop body that never runs leaves the outer value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@inLoopBody'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
    );
  });
  it('reads the outer value on the right of a shadow in a loop body', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@fromOuterInLoopBody'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [6], to: 'c' }) },
    );
  });
  it('binds a new name in a loop body', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@freshInLoopBody'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
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

describe('a bind after a branch', () => {
  const script = `
    n *Integer = 0

    bump! = {
      n <- n + 1
      return n
    }

    @rebound = (c Boolean) {
      r = 5
      if c { return r }
      r = 6
      return r
    }
    @reboundInExpression = (c Boolean) {
      r = 5
      if c { return r + 10 }
      r = 6
      return r + 10
    }
    @twoBranches = (a Boolean, b Boolean) {
      r = 1
      if a { return r }
      r = 2
      if b { return r }
      r = 3
      return r
    }
    @effect! = (c Boolean) {
      if c { return 0 }
      x = bump!()
      return x
    }
    @effectAfterBind! = (c Boolean) {
      r = 5
      if c { return r }
      x = bump!()
      return r, x
    }
    @statement! = (c Boolean) {
      r = 5
      if c { return r }
      bump!()
      return r, n
    }
    @written! = (c Boolean) {
      r = 5
      if c { return r }
      n <- 9
      return r, n
    }
    total = { return n }
    @reader = {
      x = total()
      return x
    }
    @read = {
      return n
    }
  `;

  it('a statement call after a branch that returns does not run', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@statement!'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
      { input: { id: '2', op: '@read', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: [0], to: 'c' }) },
    );
  });
  it('a statement call after a branch runs on the path past it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@statement!'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5, 1], to: 'c' }) },
    );
  });
  it('a write after a branch that returns does not run', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@written!'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
      { input: { id: '2', op: '@read', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: [0], to: 'c' }) },
    );
  });
  it('a function reads a cell', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@reader', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [0], to: 'c' }) },
    );
  });
  it('the branch reads the value from before it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@rebound'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
    );
  });
  it('the path past the branch reads the later value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@rebound'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [6], to: 'c' }) },
    );
  });
  it('the branch reads the earlier value inside an expression', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@reboundInExpression'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [15], to: 'c' }) },
    );
  });
  it('the first of two branches', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true, false], '@twoBranches'], 'bv-a': [['Boolean', 'Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1], to: 'c' }) },
    );
  });
  it('the second of two branches', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false, true], '@twoBranches'], 'bv-a': [['Boolean', 'Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('past both branches', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false, false], '@twoBranches'], 'bv-a': [['Boolean', 'Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [3], to: 'c' }) },
    );
  });
  it('a call after a branch that returns does not run', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@effect!'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [0], to: 'c' }) },
      { input: { id: '2', op: '@read', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: [0], to: 'c' }) },
    );
  });
  it('a call after a branch runs on the path past it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@effect!'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1], to: 'c' }) },
      { input: { id: '2', op: '@read', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: [1], to: 'c' }) },
    );
  });
  it('a call after a branch that reads an earlier bind does not run', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@effectAfterBind!'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
      { input: { id: '2', op: '@read', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: [0], to: 'c' }) },
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

describe('shadowing a name with another type inside a branch', () => {
  const script = `
    @otherType = (c Boolean) {
      r = 5
      if c {
        r Text = "x"
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
        r Text = "x"
        return r
      }
      return r
    }
  `;

  it('returns a shadow of another type', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], '@otherType'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Text'], re: ['x'], to: 'c' } },
    );
  });
  it('the path that skips the shadow returns the outer value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], '@otherType'], 'bv-a': [['Boolean']], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [5], to: 'c' } },
    );
  });
  it('shadows with another type in a private function', async () => {
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

  const rebindError = /cannot re-bind 'r'/i;
  it('untyped bind on an outer name in a statement if → compile error', () => {
    expect(() => compileSource(`
      @test = (c Boolean) {
        r = 5
        if c {
          r = 2
          return r
        }
        return r
      }
    `)).toThrow(rebindError);
  });
  it('in an else branch → compile error', () => {
    expect(() => compileSource(`
      @test = (c Boolean) {
        r = 5
        if c { return r } else { r = 2 }
        return r
      }
    `)).toThrow(rebindError);
  });
  it('in an else-if branch → compile error', () => {
    expect(() => compileSource(`
      @test = (c Boolean) {
        r = 5
        if c { return r } else if true { r = 2 }
        return r
      }
    `)).toThrow(rebindError);
  });
  it('on a value from a call → compile error', () => {
    expect(() => compileSource(`
      f = { return 1 }
      @test = (c Boolean) {
        r = f()
        if c { r = 2 }
        return r
      }
    `)).toThrow(rebindError);
  });
  it('on a param → compile error', () => {
    expect(() => compileSource(`
      @test = (r Integer) {
        if true { r = 2 }
        return r
      }
    `)).toThrow(rebindError);
  });
  it('on a name from an enclosing branch → compile error', () => {
    expect(() => compileSource(`
      @test = (c Boolean) {
        if c {
          r = 1
          if c { r = 2 }
        }
        return 0
      }
    `)).toThrow(rebindError);
  });
  it('in a branch inside a loop → compile error', () => {
    expect(() => compileSource(`
      @test = (c Boolean) {
        r = 5
        repeat while c {
          if c { r = 2 }
        }
        return r
      }
    `)).toThrow(rebindError);
  });
  it('in a catch block → compile error', () => {
    expect(() => compileSource(`
      @test = {
        r = 5
        catch #done {
          r = 2
        }
        return r
      }
    `)).toThrow(rebindError);
  });
  it('by destructuring → compile error', () => {
    expect(() => compileSource(`
      f = { return 1, 2 }
      @test = (c Boolean) {
        r = 5
        if c {
          (r, s) = f()
        }
        return r
      }
    `)).toThrow(rebindError);
  });
  it('in a branch of a function → compile error', () => {
    expect(() => compileSource(`
      @test = (c Boolean) {
        r = 5
        f = (d Boolean) {
          if d { r = 2 }
          return 0
        }
        return f(c)
      }
    `)).toThrow(rebindError);
  });
  it('allows a typed shadow, a name of its own, and rebinding it', () => {
    expect(() => compileSource(`
      @test = (c Boolean) {
        r = 5
        if c {
          r Integer = 2
          s = 3
          s = s + 1
          return s
        }
        return r
      }
    `)).not.toThrow();
  });
  it('allows a name first bound after the block', () => {
    expect(() => compileSource(`
      @test = (c Boolean) {
        if c {
          r = 2
          return r
        }
        r = 5
        return r
      }
    `)).not.toThrow();
  });
  it('allows the same name in separate branches', () => {
    expect(() => compileSource(`
      @test = (c Boolean) {
        if c {
          r = 2
          return r
        } else {
          r = 3
          return r
        }
      }
    `)).not.toThrow();
  });
  it('allows a function param named like an outer name', () => {
    expect(() => compileSource(`
      @test = (c Boolean) {
        r = 5
        f = (r Integer) {
          r = r + 1
          return r
        }
        return f(r)
      }
    `)).not.toThrow();
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
