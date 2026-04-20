import { expectBehavior } from '../helpers.js';

const stmtScript = `
  x *Integer = 0
  a *Integer = 0
  b *Integer = 0

  @twoStmt
    =
    x <- 42; -> x

  @threeStmt
    =
    a <- 1; b <- 2; -> a: a, b: b
`;

const fnBodyScript = `
  a *Integer = 0
  b *Integer = 0

  @bracedFnBody
    =
    apply = |v| { a <- v; b <- v + 1; . }
    apply(10)
    -> a: a, b: b

  @spawnWhile
    =
    spawn bump(); repeat while (a == 0) __tick__()
    -> a
  bump
    =
    a <- 1; .
`;

const inlineParamScript = `@add; =; :n Integer; :m Integer\n =\n  -> sum: n + m\n`;

const refDeclScript = `
  p *Integer = 1; q *Integer = 2

  @refDecl
    =
    -> p: p, q: q
`;

const mixedScript = `
  a *Integer = 0; b *Integer = 0

  @mixedNewlines
    =
    a <- 5
    b <- 10; -> a: a, b: b
`;

describe('semicolon — statement separator', () => {
  it('two statements on one line', async () => {
    await expectBehavior(stmtScript,
      { input: { id: '1', op: '@twoStmt', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [42], to: 'c' }) },
    );
  });

  it('three statements on one line', async () => {
    await expectBehavior(stmtScript,
      { input: { id: '1', op: '@threeStmt', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { a: 1, b: 2 }, to: 'c' }) },
    );
  });
});

describe('semicolon — function body', () => {
  it('braced function body with semicolons', async () => {
    await expectBehavior(fnBodyScript,
      { input: { id: '1', op: '@bracedFnBody', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { a: 10, b: 11 }, to: 'c' }) },
    );
  });

  it('function body with semicolons + spawn', async () => {
    await expectBehavior(fnBodyScript,
      { input: { id: '1', op: '@spawnWhile', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1], to: 'c' }) },
    );
  });
});

describe('semicolon — lineal param declaration', () => {
  it('public function params separated by semicolons', async () => {
    await expectBehavior(inlineParamScript,
      { input: { id: '1', op: [{ n: 3, m: 4 }, '@add'], 'bv-a': [{ n: 'Integer', m: 'Integer' }], from: 'c' } },
      { output: { id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 7 }, to: 'c' } },
    );
  });
});

describe('semicolon — ref declaration', () => {
  it('ref state vars separated by semicolons', async () => {
    await expectBehavior(refDeclScript,
      { input: { id: '1', op: '@refDecl', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { p: 1, q: 2 }, to: 'c' }) },
    );
  });
});

describe('semicolon — mixed with newlines', () => {
  it('semicolons and newlines freely mixed', async () => {
    await expectBehavior(mixedScript,
      { input: { id: '1', op: '@mixedNewlines', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { a: 5, b: 10 }, to: 'c' }) },
    );
  });
});
