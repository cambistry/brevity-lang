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
      { input: { id: '1', op: 'boolTrue', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('false literal is falsy', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'boolFalse', from: 'c' } },
      { output: { id: '2', 'ty': { result: 'Integer' }, re: { result: 0 }, to: 'c' } },
    );
  });

  it('null is falsy', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: 'nullFalsy', from: 'c' } },
      { output: { id: '3', 'ty': { result: 'Integer' }, re: { result: 0 }, to: 'c' } },
    );
  });

  it('0 (integer zero) is truthy', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: 'zeroTruthy', from: 'c' } },
      { output: { id: '4', 'ty': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
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
      { input: { id: '1', op: 'eqTrue', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('!= true case', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'neqTrue', from: 'c' } },
      { output: { id: '2', 'ty': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('> true case', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: 'gtTrue', from: 'c' } },
      { output: { id: '3', 'ty': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('< true case', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: 'ltTrue', from: 'c' } },
      { output: { id: '4', 'ty': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('>= true case', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: 'gteTrue', from: 'c' } },
      { output: { id: '5', 'ty': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('<= true case', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: 'lteTrue', from: 'c' } },
      { output: { id: '6', 'ty': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
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

      @newName
        =
        x Integer = 10
        result Integer = if true {
          y Integer = 99
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
      { input: { id: '1', op: 'singleLine', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('block form — last expression is the value', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'blockForm', from: 'c' } },
      { output: { id: '2', 'ty': { result: 'Text' }, re: { result: 'abc' }, to: 'c' } },
    );
  });

  it('else if chain', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: 'elseIf', from: 'c' } },
      { output: { id: '3', 'ty': { result: 'Integer' }, re: { result: 20 }, to: 'c' } },
    );
  });

  it('a new name in a block leaves the outer name unchanged', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: 'newName', from: 'c' } },
      { output: { id: '4', 'ty': { x: 'Integer', result: 'Integer' }, re: { x: 10, result: 99 }, to: 'c' } },
    );
  });

  it('block reads outer scope variables', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: 'readOuter', from: 'c' } },
      { output: { id: '5', 'ty': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
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
      { input: { id: '1', op: 'noElseFalse', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'null' }, re: { result: null }, to: 'c' } },
    );
  });

  it('no-else if with true condition → result is value', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'noElseTrue', from: 'c' } },
      { output: { id: '2', 'ty': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('function call inside if block branch', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: 'fnCallInIf', from: 'c' } },
      { output: { id: '3', 'ty': { result: 'Integer' }, re: { result: 25 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Shadowing a name inside a branch
// ═══════════════════════════════════════════════════════════════════════════════

describe('a new name inside a branch', () => {
  const script = `
    @Box = *{
      @one = { return 1 }
      @rebound = (c Boolean) {
        r = 5
        if c {
          s Integer = 2
          return s
        }
        return r
      }
    }

    @plain = (c Boolean) {
      r = 5
      if c {
        s Integer = 2
        return s
      }
      return r
    }
    @instance = (c Boolean) {
      b = @Box()
      r = 5
      if c {
        s Integer = b.one()
        return s
      }
      return r
    }
    @fromItself = (c Boolean) {
      r = 5
      if c {
        s Integer = r + 1
        return s
      }
      return r
    }
    @twice = (c Boolean) {
      r = 5
      if c {
        s Integer = 2
        s = s + 1
        return s
      }
      return r
    }
    @inExpression = (c Boolean) {
      r = 5
      if c {
        s Integer = 2
        return s + 10
      }
      return r + 10
    }
    @elseBranch = (c Boolean) {
      r = 5
      if c {
        return r
      } else {
        s Integer = 2
        return s
      }
    }
    @elseIf = (c Boolean) {
      r = 5
      if c {
        return r
      } else if true {
        s Integer = 2
        return s
      }
      return r
    }
    @nested = (c Boolean) {
      r = 5
      if c {
        s Integer = 2
        if c {
          t Integer = 3
          return t
        }
        return s
      }
      return r
    }
    @nestedOuter = (c Boolean) {
      r = 5
      if c {
        s Integer = 2
        if false {
          t Integer = 3
        }
        return s
      }
      return r
    }
    @fallsThrough = (c Boolean) {
      r = 5
      if c {
        s Integer = 2
      }
      return r
    }
    @onInstance = (c Boolean) {
      b = @Box()
      return b.rebound(c)
    }
    @viaFunction = (c Boolean) {
      return rebound(c)
    }
    rebound = (c Boolean) {
      r = 5
      if c {
        s Integer = 2
        return s
      }
      return r
    }
    @viaFunctionCall = (c Boolean) {
      return reboundCall(c)
    }
    reboundCall = (c Boolean) {
      b = @Box()
      r = 5
      if c {
        s Integer = b.one()
        return s
      }
      return r
    }
    @instanceTag = (c Boolean) {
      b = @Box()
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
        s Integer = 2
        return :s
      }
      return :r
    }
  `;

  it('returns a new name holding a plain value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'plain'], 'ty': [['Boolean']], from: 'c' } },
      { output: { id: '1', 'ty': ['Integer'], re: [2], to: 'c' } },
    );
  });
  it('a new name leaves the path that skips the branch alone', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], 'plain'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
    );
  });
  it('returns a new name bound from an instance call', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'instance'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1], to: 'c' }) },
    );
  });
  it('an instance call leaves the path that skips the branch alone', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], 'instance'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
    );
  });
  it('reads the outer name on the right of a new name', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'fromItself'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [6], to: 'c' }) },
    );
  });
  it('rebinds a new name within its branch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'twice'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [3], to: 'c' }) },
    );
  });
  it('reads the new name inside an expression', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'inExpression'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [12], to: 'c' }) },
    );
  });
  it('binds a new name in an else branch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], 'elseBranch'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('the then branch still reads the outer value when else binds a new name', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'elseBranch'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
    );
  });
  it('binds a new name in an else-if branch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], 'elseIf'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('binds a new name in a nested branch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'nested'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [3], to: 'c' }) },
    );
  });
  it('a nested branch that is skipped leaves the enclosing name', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'nestedOuter'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('a new name stays inside its branch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'fallsThrough'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
    );
  });
  it('works in a handler on an instance', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'onInstance'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('works in a private function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'viaFunction'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('works with an instance call in a private function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'viaFunctionCall'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1], to: 'c' }) },
    );
  });
  it('a bind in the enclosing body reads the old value too', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'outerFromItself', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [6], to: 'c' }) },
    );
  });
  it('claims no type for an untyped bind from an instance call', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'instanceTag'], 'ty': [['Boolean']], from: 'c' } },
      { output: { id: '1', re: [1], to: 'c' } },
    );
  });
  it('returns the new name by name', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'byName'], 'ty': [['Boolean']], from: 'c' } },
      { output: { id: '1', 'ty': { s: 'Integer' }, re: { s: 2 }, to: 'c' } },
    );
  });
  it('the path that skips the branch returns the outer value by name', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], 'byName'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { r: 5 }, to: 'c' }) },
    );
  });
});

describe('a new name inside a branch of a lambda', () => {
  const script = `
    @inLambda = (c Boolean) {
      f = (d Boolean) {
        r = 5
        if d {
          s Integer = 2
          return s
        }
        return r
      }
      return f(c)
    }
    @inLambdaBound = (c Boolean) {
      f = (d Boolean) {
        r = 5
        if d {
          s Integer = 2
          return s
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
          s Integer = 2
          return s
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
      { input: { id: '1', op: [[true], 'inLambda'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('works in a lambda whose result is bound', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'inLambdaBound'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('works in a lambda returned from a private function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'lambdaInFunction'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('a returned lambda call with a branch and no new name', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'lambdaGuardNoRebind'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
});

describe('a new name in a loop', () => {
  const script = `
    @inLoop = (c Boolean) {
      r = 5
      repeat while c {
        if c {
          s Integer = 2
          return s
        }
      }
      return r
    }
    @inLoopBody = (c Boolean) {
      r Integer = 5
      repeat while c {
        s Integer = 2
        return s
      }
      return r
    }
    @fromOuterInLoopBody = (c Boolean) {
      r Integer = 5
      repeat while c {
        s Integer = r + 1
        return s
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
      { input: { id: '1', op: [[true], 'inLoopBody'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('a loop body that never runs leaves the outer value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], 'inLoopBody'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
    );
  });
  it('reads the outer name on the right of a new name in a loop body', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'fromOuterInLoopBody'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [6], to: 'c' }) },
    );
  });
  it('binds a new name in a loop body', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'freshInLoopBody'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('works in a branch inside a loop', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'inLoop'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('a loop that never runs leaves the outer value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], 'inLoop'], 'ty': [['Boolean']], from: 'c' } },
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
      { input: { id: '1', op: [[true], 'statement!'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
      { input: { id: '2', op: 'read', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: [0], to: 'c' }) },
    );
  });
  it('a statement call after a branch runs on the path past it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], 'statement!'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5, 1], to: 'c' }) },
    );
  });
  it('a write after a branch that returns does not run', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'written!'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
      { input: { id: '2', op: 'read', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: [0], to: 'c' }) },
    );
  });
  it('a function reads a cell', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'reader', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [0], to: 'c' }) },
    );
  });
  it('the branch reads the value from before it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'rebound'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
    );
  });
  it('the path past the branch reads the later value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], 'rebound'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [6], to: 'c' }) },
    );
  });
  it('the branch reads the earlier value inside an expression', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'reboundInExpression'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [15], to: 'c' }) },
    );
  });
  it('the first of two branches', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true, false], 'twoBranches'], 'ty': [['Boolean', 'Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1], to: 'c' }) },
    );
  });
  it('the second of two branches', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false, true], 'twoBranches'], 'ty': [['Boolean', 'Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [2], to: 'c' }) },
    );
  });
  it('past both branches', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false, false], 'twoBranches'], 'ty': [['Boolean', 'Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [3], to: 'c' }) },
    );
  });
  it('a call after a branch that returns does not run', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'effect!'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [0], to: 'c' }) },
      { input: { id: '2', op: 'read', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: [0], to: 'c' }) },
    );
  });
  it('a call after a branch runs on the path past it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], 'effect!'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1], to: 'c' }) },
      { input: { id: '2', op: 'read', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: [1], to: 'c' }) },
    );
  });
  it('a call after a branch that reads an earlier bind does not run', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'effectAfterBind!'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
      { input: { id: '2', op: 'read', from: 'c' } },
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
      { input: { id: '1', op: [[true], 'mixed'], 'ty': [['Boolean']], from: 'c' } },
      { output: { id: '1', 'ty': ['Text'], re: ['x'], to: 'c' } },
    );
  });
  it('leaves the other path its own tag', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], 'mixed'], 'ty': [['Boolean']], from: 'c' } },
      { output: { id: '1', 'ty': ['Integer'], re: [9], to: 'c' } },
    );
  });
});

describe('a new name of another type inside a branch', () => {
  const script = `
    @otherType = (c Boolean) {
      r = 5
      if c {
        s Text = "x"
        return s
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
        s Text = "x"
        return s
      }
      return r
    }
  `;

  it('returns a new name of another type', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'otherType'], 'ty': [['Boolean']], from: 'c' } },
      { output: { id: '1', 'ty': ['Text'], re: ['x'], to: 'c' } },
    );
  });
  it('the path that skips the branch returns the outer value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[false], 'otherType'], 'ty': [['Boolean']], from: 'c' } },
      { output: { id: '1', 'ty': ['Integer'], re: [5], to: 'c' } },
    );
  });
  it('binds another type in a private function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'otherTypeInFunction'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: ['x'], to: 'c' }) },
    );
  });
});

describe('a function param named like an outer name', () => {
  const script = `
    @positional = {
      r = 5
      f = (r Integer) { return r + 1 }
      x Integer = f(10)
      return r, x
    }
    @untyped = {
      r = 5
      f = (r) { r + 1 }
      x Integer = f(10)
      return r, x
    }
    @arrow = {
      r = 5
      f = (r) -> r + 1
      x Integer = f(10)
      return r, x
    }
    @named = {
      r = 5
      f = (r:) { r + 1 }
      x Integer = f(r: 10)
      return r, x
    }
    @namedTyped = {
      r = 5
      f = (r: Integer) { return r + 1 }
      x Integer = f(r: 10)
      return r, x
    }
    @keyMapped = {
      r = 5
      f = (label: r) { r + 1 }
      x Integer = f(label: 10)
      return r, x
    }
    @rebound = {
      r = 5
      f = (r Integer) {
        r = r + 1
        return r
      }
      x Integer = f(10)
      return r, x
    }
    @boundAfter = {
      f = (r Integer) { return r + 1 }
      x Integer = f(10)
      r = 5
      return r, x
    }
    @fromFile = {
      x Integer = addOne(10)
      return k, x
    }
    k = 5
    addOne = (k Integer) { return k + 1 }
    @handlerParam = (k Integer) {
      return k
    }
    @handlerNamed = (k: Integer) {
      return k
    }
    @handlerParamByName = (k Integer) {
      return :k
    }
    @handlerParamInBranch = (k Integer) {
      if k > 0 {
        return k
      }
      return 0
    }
  `;

  for (const op of ['positional', 'untyped', 'arrow', 'named', 'namedTyped', 'keyMapped', 'rebound', 'boundAfter']) {
    it(`${op}: the param inside the function, the outer value after it`, async () => {
      await expectBehavior(script,
        { input: { id: '1', op, from: 'c' } },
        { output: expect.objectContaining({ id: '1', re: [5, 11], to: 'c' }) },
      );
    });
  }
  it('a private function param can reuse a name from the file', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'fromFile', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5, 11], to: 'c' }) },
    );
  });
  it('a handler param can reuse a name from the file', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[7], 'handlerParam'], 'ty': [['Integer']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [7], to: 'c' }) },
    );
  });
  it('keeps its name in a reply', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[7], 'handlerParamByName'], 'ty': [['Integer']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { k: 7 }, to: 'c' }) },
    );
  });
  it('is the param inside a branch too', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[7], 'handlerParamInBranch'], 'ty': [['Integer']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [7], to: 'c' }) },
    );
  });
  it('a named handler param keeps its key', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{ k: 7 }, 'handlerNamed'], 'ty': [{ k: 'Integer' }], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [7], to: 'c' }) },
    );
  });
});

describe('a function bound in a branch', () => {
  const script = `
    n *Integer = 0

    @inBranch = (c Boolean) {
      r = 5
      if c {
        f = (r Integer) { return r + 1 }
        x Integer = f(10)
        return r, x
      }
      return r
    }
    @returned = (c Boolean) {
      if c {
        f = (a Integer) { return a + 1 }
        return f(10)
      }
      return 0
    }
    @untyped = (c Boolean) {
      if c {
        f = (a) { a + 1 }
        x = f(10)
        return x
      }
      return 0
    }
    @arrow = (c Boolean) {
      if c {
        f = (a) -> a + 1
        return f(10)
      }
      return 0
    }
    @captures = (c Boolean) {
      r = 5
      if c {
        s = 2
        f = (a) { a + r + s }
        x Integer = f(10)
        return x
      }
      return r
    }
    @inElse = (c Boolean) {
      if c {
        return 0
      } else {
        f = (a Integer) { return a + 1 }
        return f(10)
      }
    }
    @siblings = (c Boolean) {
      if c {
        f = (a Integer) { return a + 1 }
        return f(10)
      } else {
        f = (a Integer) { return a + 2 }
        return f(10)
      }
    }
    @calledInNested = (c Boolean) {
      if c {
        f = (a Integer) { return a + 1 }
        if c {
          return f(10)
        }
        return 0
      }
      return 1
    }
    @inLoop = (c Boolean) {
      repeat while c {
        f = (a Integer) { return a + 1 }
        return f(10)
      }
      return 0
    }
    @writes! = (c Boolean) {
      if c {
        bump! = {
          n <- n + 1
          return n
        }
        x Integer = bump!()
        return x
      }
      return n
    }
    @read = {
      return n
    }
  `;
  const call = (op, c, re) => expectBehavior(script,
    { input: { id: '1', op: [[c], op], 'ty': [['Boolean']], from: 'c' } },
    { output: expect.objectContaining({ id: '1', re, to: 'c' }) },
  );

  it('runs, with a param named like an outer name', () => call('inBranch', true, [5, 11]));
  it('the path that skips it', () => call('inBranch', false, [5]));
  it('returns its call', () => call('returned', true, [11]));
  it('returns past it', () => call('returned', false, [0]));
  it('binds its call untyped', () => call('untyped', true, [11]));
  it('works in arrow form', () => call('arrow', true, [11]));
  it('captures outer and branch names', () => call('captures', true, [17]));
  it('works in an else branch', () => call('inElse', false, [11]));
  it('separate branches keep their own: then', () => call('siblings', true, [11]));
  it('separate branches keep their own: else', () => call('siblings', false, [12]));
  it('can be called from a nested branch', () => call('calledInNested', true, [11]));
  it('works in a loop body', () => call('inLoop', true, [11]));
  it('can write a cell', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[true], 'writes!'], 'ty': [['Boolean']], from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1], to: 'c' }) },
      { input: { id: '2', op: 'read', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: [1], to: 'c' }) },
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
  it('a typed bind on an outer name → compile error', () => {
    expect(() => compileSource(`
      @test = (c Boolean) {
        r = 5
        if c {
          r Integer = 2
          return r
        }
        return r
      }
    `)).toThrow(rebindError);
  });
  it('a typed destructure on an outer name → compile error', () => {
    expect(() => compileSource(`
      f = { return 1, 2 }
      @test = (c Boolean) {
        r = 5
        if c {
          (r Integer, s Integer) = f()
        }
        return r
      }
    `)).toThrow(rebindError);
  });
  it('a cell declared in a block on an outer name → compile error', () => {
    expect(() => compileSource(`
      @test = (c Boolean) {
        r = 5
        if c {
          r *Integer = 2
        }
        return r
      }
    `)).toThrow(rebindError);
  });
  it('a typed bind in a loop body → compile error', () => {
    expect(() => compileSource(`
      @test = (c Boolean) {
        r Integer = 5
        repeat while c {
          r Integer = 2
          return r
        }
        return r
      }
    `)).toThrow(rebindError);
  });
  it('a name bound after the block → compile error', () => {
    expect(() => compileSource(`
      @test = (c Boolean) {
        if c {
          r = 2
          return r
        }
        r = 5
        return r
      }
    `)).toThrow(rebindError);
  });
  it('a name bound after the block with a type → compile error', () => {
    expect(() => compileSource(`
      @test = (c Boolean) {
        if c { r Integer = 2 }
        r Integer = 5
        return r
      }
    `)).toThrow(rebindError);
  });
  it('a local of an assigned function on an outer name → compile error', () => {
    expect(() => compileSource(`
      @test = {
        r = 5
        f = {
          r = 2
          return r
        }
        return f()
      }
    `)).toThrow(rebindError);
  });
  it('a local of a function on a name bound after it → compile error', () => {
    expect(() => compileSource(`
      @test = {
        f = (a) {
          r = a + 1
          return :r
        }
        :r = f(5)
        return :r
      }
    `)).toThrow(rebindError);
  });
  it('a local of an inline function on an outer name → compile error', () => {
    expect(() => compileSource(`
      @test = {
        r = 5
        return run({
          r = 2
          return r
        })
      }
      run = (f) { return f() }
    `)).toThrow(rebindError);
  });
  it('a local of a handler on a name from the file → compile error', () => {
    expect(() => compileSource(`
      r = 5
      @test = {
        r = 2
        return r
      }
    `)).toThrow(rebindError);
  });
  it('a block in a function binding that function\'s param → compile error', () => {
    expect(() => compileSource(`
      @test = (c Boolean) {
        f = (r Integer) {
          if c { r = 2 }
          return r
        }
        return f(1)
      }
    `)).toThrow(rebindError);
  });
  it('setting a param named like a cell → compile error', () => {
    expect(() => compileSource(`
      r *Integer = 1
      @test = (r Integer) {
        r <- 2
        return r
      }
    `)).toThrow(/cannot set 'r'/i);
  });
  it('allows a name of its own, and rebinding it', () => {
    expect(() => compileSource(`
      @test = (c Boolean) {
        r = 5
        if c {
          s Integer = 3
          s = s + 1
          return s
        }
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
  it('allows a key that matches a name bound after the function', () => {
    expect(() => compileSource(`
      @test = {
        f = (a) {
          y = a + 1
          return x: y
        }
        :x = f(5)
        return :x
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
