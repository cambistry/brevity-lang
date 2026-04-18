import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Text concatenation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Text concatenation — literals', () => {
  const script = `
      @concatTwo
        =
        -> result: "hello" + " world" as Text

      @concatThree
        =
        -> result: "a" + "b" + "c" as Text

      @concatEmpty
        =
        -> result: "" + "hello" as Text

      @concatBothEmpty
        =
        -> result: "" + "" as Text
  `;

  it('two literals', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@concatTwo', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hello world' }, to: 'c' } });
  });

  it('three literals', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@concatThree', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'abc' }, to: 'c' } });
  });

  it('empty + non-empty', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@concatEmpty', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' } });
  });

  it('empty + empty', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@concatBothEmpty', from: 'c' } }, { output: { id: '4', 'bv-a': { result: 'Text' }, re: { result: '' }, to: 'c' } });
  });
});

describe('Text concatenation — constants', () => {
  const script = `
      @concatConsts
        =
        greeting Text = "hello"
        name Text = "world"
        -> result: greeting + " " + name as Text

      @concatConstLiteral
        =
        prefix Text = "foo"
        -> result: prefix + "bar" as Text

      @concatLiteralConst
        =
        suffix Text = "bar"
        -> result: "foo" + suffix as Text
  `;

  it('two constants with literal between', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@concatConsts', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hello world' }, to: 'c' } });
  });

  it('constant + literal', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@concatConstLiteral', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'foobar' }, to: 'c' } });
  });

  it('literal + constant', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@concatLiteralConst', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'foobar' }, to: 'c' } });
  });
});

describe('Text concatenation — refs', () => {
  const script = `
      @concatRef
        =
        a *Text = "hello"
        -> result: a + " world" as Text

      @concatTwoRefs
        =
        a *Text = "foo"
        b *Text = "bar"
        -> result: a + b as Text

      @concatAfterMutate
        =
        a *Text = "old"
        a <- "new"
        -> result: a + "!" as Text

      @concatRefConst
        =
        a *Text = "hello"
        sep Text = " "
        -> result: a + sep + "world" as Text
  `;

  it('ref + literal', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@concatRef', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hello world' }, to: 'c' } });
  });

  it('ref + ref', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@concatTwoRefs', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'foobar' }, to: 'c' } });
  });

  it('concat after mutation uses new value', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@concatAfterMutate', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'new!' }, to: 'c' } });
  });

  it('ref + constant + literal', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@concatRefConst', from: 'c' } }, { output: { id: '4', 'bv-a': { result: 'Text' }, re: { result: 'hello world' }, to: 'c' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// .size dot access on *Text refs
// ═══════════════════════════════════════════════════════════════════════════════

describe('Text .size — ref dot access', () => {
  const script = `
      @basic
        =
        t *Text = "hello"
        -> result: t.size as Integer

      @empty
        =
        t *Text = ""
        -> result: t.size as Integer

      @afterMutate
        =
        t *Text = "hi"
        t <- "goodbye"
        -> result: t.size as Integer

      @inExpr
        =
        t *Text = "abc"
        total Integer = t.size + 10
        -> result: total as Integer

      @astral
        =
        t *Text = "\u{1F600}ok"
        -> result: t.size as Integer

      @assign
        =
        t *Text = "hello"
        sz Integer = t.size
        -> result: sz as Integer
  `;

  it('basic ref .size', async () => {
    await expectBehavior(script, { input: { id: '1', op: '@basic', from: 'c' } }, { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' } });
  });

  it('empty ref .size', async () => {
    await expectBehavior(script, { input: { id: '2', op: '@empty', from: 'c' } }, { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 0 }, to: 'c' } });
  });

  it('.size after mutation reflects new value', async () => {
    await expectBehavior(script, { input: { id: '3', op: '@afterMutate', from: 'c' } }, { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } });
  });

  it('.size in arithmetic expression', async () => {
    await expectBehavior(script, { input: { id: '4', op: '@inExpr', from: 'c' } }, { output: { id: '4', 'bv-a': { result: 'Integer' }, re: { result: 13 }, to: 'c' } });
  });

  it('.size with astral code point — counts scalars', async () => {
    await expectBehavior(script, { input: { id: '5', op: '@astral', from: 'c' } }, { output: { id: '5', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } });
  });

  it('.size assigned to typed constant', async () => {
    await expectBehavior(script, { input: { id: '6', op: '@assign', from: 'c' } }, { output: { id: '6', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' } });
  });
});
