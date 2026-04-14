import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Public constants: @name = expr  (auto getter, no public setter)
// ═══════════════════════════════════════════════════════════════════════════════

describe('public constants — literal initializers', () => {
  const script = `
      @magic = "magic_string"
      @answer = 42
      @yes = true
      @xs = [1, 2, 3]
  `;

  it('text literal constant', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@magic', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Text'], re: ['magic_string'], to: 'c' } },
    );
  });

  it('integer literal constant', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@answer', from: 'c' } },
      { output: { id: '2', 'bv-a': ['Integer'], re: [42], to: 'c' } },
    );
  });

  it('boolean literal constant', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@yes', from: 'c' } },
      { output: { id: '3', 'bv-a': ['Boolean'], re: [true], to: 'c' } },
    );
  });

  it('list literal constant', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@xs', from: 'c' } },
      { output: { id: '4', 'bv-a': ['List'], re: [[1, 2, 3]], to: 'c' } },
    );
  });
});

describe('public constants — constructor-initialized', () => {
  const script = `
      @t = Text("constant")
      @n = Integer(7)
  `;

  it('Text(...) constant', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@t', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Text'], re: ['constant'], to: 'c' } },
    );
  });

  it('Integer(...) constant', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@n', from: 'c' } },
      { output: { id: '2', 'bv-a': ['Integer'], re: [7], to: 'c' } },
    );
  });
});

describe('public constants — in-script constructor', () => {
  const script = `
      C = <> { @tag = "hello" }

      @readTag
        =
        c = C()
        :v = c.tag
        -> :v as Text
  `;

  it('wrapper reads constant from child', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@readTag', from: 'c' } },
      { output: { id: '1', 'bv-a': { v: 'Text' }, re: { v: 'hello' }, to: 'c' } },
    );
  });
});

describe('public constants — compile errors', () => {
  it('attempting to `set` a public binding → compile error', () => {
    expect(() => compileSource(`
      @magic = "x"
      @magic <- "new"
    `)).toThrow();
  });

  it('duplicate public constant → compile error', () => {
    expect(() => compileSource(`
      @magic = "x"
      @magic = "y"
    `)).toThrow();
  });

  it('duplicate public binding (constant + handler) → compile error', () => {
    expect(() => compileSource(`
      @magic = "x"
      @magic = { -> 1 as Integer }
    `)).toThrow();
  });
});
