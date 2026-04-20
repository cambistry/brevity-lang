import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// ingest — supertype receives subtype service block result
//
// A supertype uses `ingest` in its service block to pause initialization
// and receive the return value of the subtype's service block.
//
// See keywords/ingest.md for full documentation.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Compilation ──────────────────────────────────────────────────────────────

describe('ingest — compilation', () => {
  it('supertype with ingest compiles', () => {
    expect(() => compileSource(`
      Base = <> {
        label Text = ingest
        @label = -> :label
      }
      Child = <Base |> -> "hello"
      @test = -> 1
    `)).not.toThrow();
  });

  it('subtype providing ingest value compiles', () => {
    expect(() => compileSource(`
      Base = <> { label Text = ingest }
      Child = <Base |> -> "hello"
      @test = -> 1
    `)).not.toThrow();
  });

  it('ingest with default — direct construction compiles', () => {
    expect(() => compileSource(`
      Panel = <> {
        content Text = ingest("")
        @content = -> :content
      }
      @test = {
        p = Panel()
        :content Text = p.content()
        -> :content
      }
    `)).not.toThrow();
  });

  it.todo('typed ingest with mismatched subtype return is a compiler error');
  it.todo('ingest without default — direct construction is a compiler error');
});

// ── Runtime: basic ingest ────────────────────────────────────────────────────

describe('ingest — basic — runtime', () => {
  const script = `
    Base = <> {
      label Text = ingest
      @label = -> :label
    }

    Greeting = <Base |> -> "hello"
    Farewell = <Base |> -> "goodbye"

    @testGreeting = {
      g = Greeting()
      :label Text = g.label()
      -> :label
    }

    @testFarewell = {
      f = Farewell()
      :label Text = f.label()
      -> :label
    }
  `;

  it('supertype receives subtype service block return value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testGreeting', from: 'c' } },
      { output: { id: '1', 'bv-a': { label: 'Text' }, re: { label: 'hello' }, to: 'c' } },
    );
  });

  it('different subtypes provide different values', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testFarewell', from: 'c' } },
      { output: { id: '1', 'bv-a': { label: 'Text' }, re: { label: 'goodbye' }, to: 'c' } },
    );
  });
});

// ── Runtime: ingest with default ─────────────────────────────────────────────

describe('ingest — with default — runtime', () => {
  const script = `
    Panel = <> {
      content Text = ingest("")
      @content = -> :content
    }

    Filled = <Panel |> -> "hello"

    @testDefault = {
      p = Panel()
      :content Text = p.content()
      -> :content
    }

    @testOverride = {
      f = Filled()
      :content Text = f.content()
      -> :content
    }
  `;

  it('direct construction uses default value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testDefault', from: 'c' } },
      { output: { id: '1', 'bv-a': { content: 'Text' }, re: { content: '' }, to: 'c' } },
    );
  });

  it('subtype overrides default value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testOverride', from: 'c' } },
      { output: { id: '1', 'bv-a': { content: 'Text' }, re: { content: 'hello' }, to: 'c' } },
    );
  });
});

// ── Runtime: ingest with constructor params ──────────────────────────────────

describe('ingest — with params — runtime', () => {
  const script = `
    Labeled = <:id Integer> {
      label Text = ingest
      @id = -> :id
      @label = -> :label
    }

    Widget = <Labeled |> -> "widget"

    @testId = {
      w = Widget(id: 42)
      :id Integer = w.id()
      -> :id
    }

    @testLabel = {
      w = Widget(id: 42)
      :label Text = w.label()
      -> :label
    }
  `;

  it('supertype params and ingest coexist — param works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testId', from: 'c' } },
      { output: { id: '1', 'bv-a': { id: 'Integer' }, re: { id: 42 }, to: 'c' } },
    );
  });

  it('supertype params and ingest coexist — ingest works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testLabel', from: 'c' } },
      { output: { id: '1', 'bv-a': { label: 'Text' }, re: { label: 'widget' }, to: 'c' } },
    );
  });
});

// ── Runtime: ingest with expression ──────────────────────────────────────────

describe('ingest — computed value — runtime', () => {
  const script = `
    Base = <> {
      value Integer = ingest
      @value = -> :value
    }

    Computed = <Base |> -> (21 * 2)

    @test = {
      c = Computed()
      :value Integer = c.value()
      -> :value
    }
  `;

  it('subtype provides computed expression', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { value: 'Integer' }, re: { value: 42 }, to: 'c' } },
    );
  });
});
