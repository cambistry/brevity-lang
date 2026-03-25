import { expectReply } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Top-level variable declaration and binding
// ═══════════════════════════════════════════════════════════════════════════════

describe('locals — declaration and binding', () => {
  const script = `
      @typedInt = { x : Integer = 42; -> :x }
      @typedText = { msg : Text = "hello"; -> :msg }

      @rebind
        =
        x : Integer = 1
        x = 2
        x = 3
        -> :x

      @exprBind
        =
        a : Integer = 3
        b : Integer = 4
        c : Integer = a + b
        -> :c
  `;

  it('typed integer declaration', async () => {
    await expectReply({
      script, receive: { id: '1', op: '@typedInt', from: 'c' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 42 }, to: 'c' },
    });
  });

  it('typed text declaration', async () => {
    await expectReply({
      script, receive: { id: '2', op: '@typedText', from: 'c' },
      reply: { id: '2', 'bv-a': { msg: 'Text' }, re: { msg: 'hello' }, to: 'c' },
    });
  });

  it('rebinding within same scope', async () => {
    await expectReply({
      script, receive: { id: '3', op: '@rebind', from: 'c' },
      reply: { id: '3', 'bv-a': { x: 'Integer' }, re: { x: 3 }, to: 'c' },
    });
  });

  it('expression binding from other locals', async () => {
    await expectReply({
      script, receive: { id: '4', op: '@exprBind', from: 'c' },
      reply: { id: '4', 'bv-a': { c: 'Integer' }, re: { c: 7 }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Read access from child scopes
// ═══════════════════════════════════════════════════════════════════════════════

describe('locals — child scope read access', () => {
  const script = `
      @lambdaRead
        =
        x : Integer = 10
        fn = { x }
        result : Integer = fn()
        -> :result

      @lambdaReadParam
        =
        base : Integer = 100
        fn = |n| base + n
        result : Integer = fn(5)
        -> :result

      @ifRead
        =
        x : Integer = 42
        result : Integer = if true x : Integer else 0 as Integer
        -> :result
  `;

  it('lambda reads outer local', async () => {
    await expectReply({
      script, receive: { id: '1', op: '@lambdaRead', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' },
    });
  });

  it('lambda reads outer local and adds param', async () => {
    await expectReply({
      script, receive: { id: '2', op: '@lambdaReadParam', from: 'c' },
      reply: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 105 }, to: 'c' },
    });
  });

  it('if-branch reads outer local', async () => {
    await expectReply({
      script, receive: { id: '3', op: '@ifRead', from: 'c' },
      reply: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Nested lambda (grandparent scope capture)
// ═══════════════════════════════════════════════════════════════════════════════

describe('locals — nested lambda', () => {
  const script = `
      @nestedRead
        =
        x : Integer = 7
        outer = |a| {
          inner = { x + a }
          result : Integer = inner()
        }
        result : Integer = outer(3)
        -> :result
  `;

  it('nested lambda reads grandparent scope', async () => {
    await expectReply({
      script, receive: { id: '1', op: '@nestedRead', from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Header arg access
// ═══════════════════════════════════════════════════════════════════════════════

describe('locals — header arg access', () => {
  const script = `
      @echoNamed
        =
        :n : Integer
        =
        -> :n

      @doubleArg
        =
        :n : Integer
        =
        result : Integer = n * 2
        -> :result

      @argInLambda
        =
        :base : Integer
        =
        fn = |x| base + x
        result : Integer = fn(10)
        -> :result

      @multiArg
        =
        :a : Integer
        :b : Integer
        =
        -> sum: a + b as Integer
  `;

  it('direct return of header arg', async () => {
    await expectReply({
      script, receive: { id: '1', op: [{ n: 42 }, '@echoNamed'], 'bv-a': [{ n: 'Integer' }], from: 'c' },
      reply: { id: '1', 'bv-a': { n: 'Integer' }, re: { n: 42 }, to: 'c' },
    });
  });

  it('header arg used in expression', async () => {
    await expectReply({
      script, receive: { id: '2', op: [{ n: 7 }, '@doubleArg'], 'bv-a': [{ n: 'Integer' }], from: 'c' },
      reply: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 14 }, to: 'c' },
    });
  });

  it('header arg read from lambda', async () => {
    await expectReply({
      script, receive: { id: '3', op: [{ base: 100 }, '@argInLambda'], 'bv-a': [{ base: 'Integer' }], from: 'c' },
      reply: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 110 }, to: 'c' },
    });
  });

  it('multiple header args in expression', async () => {
    await expectReply({
      script, receive: { id: '4', op: [{ a: 3, b: 4 }, '@multiArg'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'c' },
      reply: { id: '4', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Nested lambda with header arg capture
// ═══════════════════════════════════════════════════════════════════════════════

describe('locals — nested lambda with header arg', () => {
  const script = `
      @argNested
        =
        :seed : Integer
        =
        fn = {
          inner = |x| seed + x
          result : Integer = inner(1)
        }
        result : Integer = fn()
        -> :result
  `;

  it('header arg read from nested lambda', async () => {
    await expectReply({
      script, receive: { id: '1', op: [{ seed: 50 }, '@argNested'], 'bv-a': [{ seed: 'Integer' }], from: 'c' },
      reply: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 51 }, to: 'c' },
    });
  });
});
