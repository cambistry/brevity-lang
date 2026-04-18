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
