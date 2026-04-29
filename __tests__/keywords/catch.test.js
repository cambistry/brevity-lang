import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 1 — bare void catch
//
// Spec: kanban/2 - features/CATCH.md §§1–8 (excluding §9 label references).
// Void exits only; value-carrying form lands in Phase 2.
// ═══════════════════════════════════════════════════════════════════════════════

describe('catch — Phase 1: bare void exit', () => {
  const script = `
    @simpleExit
      =
      x Integer! = 0
      catch #done {
        x <- 1
        if true #done
        x <- 99
      }
      -> :x

    @whileExit
      =
      x Integer! = 0
      catch #done {
        repeat while x < 100 {
          x <- x + 1
          if x == 5 #done
        }
      }
      -> :x

    @parenForm
      =
      x Integer! = 0
      catch #done {
        x <- 7
        if true #done()
        x <- 999
      }
      -> :x

    @bareInvocation
      =
      x Integer! = 0
      catch #done {
        x <- 1
        #done
        x <- 999
      }
      -> :x

    @nestedExit
      =
      x Integer! = 0
      y Integer! = 0
      catch #outer {
        repeat while x < 10 {
          x <- x + 1
          if x == 3 #outer
          repeat while y < 10 {
            y <- y + 1
          }
        }
      }
      -> :x, :y
  `;

  it('exits a catch block from a single-line if', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@simpleExit', from: 'c' } },
      { output: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 1 }, to: 'c' } });
  });

  it('exits from inside a repeat while loop', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@whileExit', from: 'c' } },
      { output: { id: '2', 'bv-a': { x: 'Integer' }, re: { x: 5 }, to: 'c' } });
  });

  it('accepts the empty-paren form #label()', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@parenForm', from: 'c' } },
      { output: { id: '3', 'bv-a': { x: 'Integer' }, re: { x: 7 }, to: 'c' } });
  });

  it('bare label invocation as a statement exits catch', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@bareInvocation', from: 'c' } },
      { output: { id: '4', 'bv-a': { x: 'Integer' }, re: { x: 1 }, to: 'c' } });
  });

  it('exits both inner and outer loops when label targets the outer catch', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@nestedExit', from: 'c' } },
      { output: { id: '5', 'bv-a': { x: 'Integer', y: 'Integer' }, re: { x: 3, y: 10 }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2 — value-carrying catch
//
// Spec §2.2, §3 (type safety), §7 (catch as expression).
// ═══════════════════════════════════════════════════════════════════════════════

describe('catch — Phase 2: value-carrying exit', () => {
  const script = `
    @found
      =
      result Integer = catch #f {
        if true #f(42)
        99
      }
      -> :result

    @fallThrough
      =
      result Integer = catch #f {
        if false #f(1)
        7
      }
      -> :result

    @inWhile
      =
      x Integer! = 0
      result Integer = catch #f {
        repeat while x < 100 {
          x <- x + 1
          if x == 5 #f(x)
        }
        0
      }
      -> :result

    @directReturn
      =
      catch #f {
        if true #f(123)
        0
      }
  `;

  it('exits with a value via #label(expr)', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@found', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } });
  });

  it('falls through to the tail expression when label is not invoked', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@fallThrough', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } });
  });

  it('exits a repeat-while loop carrying the current value', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@inWhile', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' } });
  });

  it('catch as the function-tail expression returns the value directly', async () => {
    // Body's tail is `catch ... { ... }` with no `->`. ImplicitReturn(CatchExpr)
    // routes through the value-carrying-catch return path.
    await expectBehavior(script,
      { input: { id: '4', op: '@directReturn', from: 'c' } },
      { output: { id: '4', re: [123], to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3 — nested catch + multi-level exit
//
// Spec §4 (nested catch), §8 (scoping rules — strict shadowing already in
// place from Phase 1).
// ═══════════════════════════════════════════════════════════════════════════════

describe('catch — Phase 3: nested catch and multi-level exit', () => {
  const script = `
    @innerExits
      =
      x Integer! = 0
      catch #outer {
        catch #inner {
          x <- 1
          if true #inner
          x <- 99
        }
        x <- x + 10
      }
      -> :x

    @outerSkipsInner
      =
      x Integer! = 0
      catch #outer {
        catch #inner {
          x <- 1
          if true #outer
          x <- 99
        }
        x <- 999
      }
      -> :x

    @valueThroughNesting
      =
      result Integer = catch #outer {
        catch #inner {
          if true #outer(7)
          0
        }
        99
      }
      -> :result

    @outerCatchesNoMatchInner
      =
      x Integer! = 0
      catch #outer {
        catch #i1 {
          if true #outer
        }
        catch #i2 {
          x <- 99
        }
      }
      -> :x
  `;

  it('inner exit returns to inner catch, then outer continues', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@innerExits', from: 'c' } },
      { output: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 11 }, to: 'c' } });
  });

  it('outer label fires from inside inner catch — skips inner cleanup', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@outerSkipsInner', from: 'c' } },
      { output: { id: '2', 'bv-a': { x: 'Integer' }, re: { x: 1 }, to: 'c' } });
  });

  it('value carries from inner-scope #outer through both catches', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@valueThroughNesting', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } });
  });

  it('inner catch with non-matching label lets outer throw bubble past', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@outerCatchesNoMatchInner', from: 'c' } },
      { output: { id: '4', 'bv-a': { x: 'Integer' }, re: { x: 0 }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 4 — block-label loop integration
//
// Spec §5: `#label <construct>` is sugar for `catch #label { construct }`.
// Optional `end#label` validates the closing label name.
// ═══════════════════════════════════════════════════════════════════════════════

describe('catch — Phase 4: block-label syntax', () => {
  const script = `
    @blockRepeat
      =
      x Integer! = 0
      #loop repeat while x < 100 {
        x <- x + 1
        if x == 4 #loop
      }
      -> :x

    @blockBrace
      =
      x Integer! = 0
      #region {
        x <- 5
        if true #region
        x <- 999
      }
      -> :x

    @endLabelOk
      =
      x Integer! = 0
      #loop repeat while x < 10 {
        x <- x + 1
        if x == 2 #loop
      }
      end#loop
      -> :x

    @blockValueCarrying
      =
      result Integer = #region {
        if true #region(42)
        99
      }
      -> :result

    @nestedBlockLabels
      =
      x Integer! = 0
      y Integer! = 0
      #outer repeat while x < 10 {
        x <- x + 1
        y <- 0
        #inner repeat while y < 10 {
          y <- y + 1
          if x == 3 #outer
        }
      }
      -> :x, :y
  `;

  it('block label on repeat exits the loop', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@blockRepeat', from: 'c' } },
      { output: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 4 }, to: 'c' } });
  });

  it('block label on a brace block acts like catch', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@blockBrace', from: 'c' } },
      { output: { id: '2', 'bv-a': { x: 'Integer' }, re: { x: 5 }, to: 'c' } });
  });

  it('matching end#label is consumed silently', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@endLabelOk', from: 'c' } },
      { output: { id: '4', 'bv-a': { x: 'Integer' }, re: { x: 2 }, to: 'c' } });
  });

  it('block-label brace form supports value-carrying exit', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@blockValueCarrying', from: 'c' } },
      { output: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } });
  });

  it('nested block labels support multi-level exit', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: '@nestedBlockLabels', from: 'c' } },
      { output: { id: '6', 'bv-a': { x: 'Integer', y: 'Integer' }, re: { x: 3, y: 1 }, to: 'c' } });
  });
});

describe('catch — compile errors', () => {
  it('rejects shadowing an active label', () => {
    const src = `
      @t
        =
        catch #a {
          catch #a { }
        }
        -> .
    `;
    expect(() => compileSource(src)).toThrow(/shadows outer/);
  });

  it('rejects mixing void and value invocations of the same label', () => {
    const src = `
      @t
        =
        catch #m {
          if true #m
          if false #m(1)
          0
        }
        -> .
    `;
    expect(() => compileSource(src)).toThrow(/Inconsistent #m/);
  });

  it('rejects mismatched end#label', () => {
    const src = `
      @t
        =
        x Integer! = 0
        #a repeat while x < 5 {
          x <- x + 1
        }
        end#b
        -> :x
    `;
    expect(() => compileSource(src)).toThrow(/end#b does not match opening #a/);
  });
});
