import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// ingest — supertype receives subtype declaration result
//
// A supertype uses `ingest` in its declaration body to pause initialization
// and receive the return value of the subtype's declaration block.
//
// See keywords/ingest.md for full documentation.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Compilation ──────────────────────────────────────────────────────────────

describe('ingest — compilation', () => {
  it('supertype with ingest compiles', () => {
    expect(() => compileSource(`
      Base = <> {
        label Text = ingest
        @label = -> :label as Text
      }
      Child = <Base |> -> "hello"
      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('subtype providing ingest value compiles', () => {
    expect(() => compileSource(`
      Base = <> { label Text = ingest }
      Child = <Base |> -> "hello"
      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('ingest with default — direct construction compiles', () => {
    expect(() => compileSource(`
      Panel = <> {
        content Text = ingest("")
        @content = -> :content as Text
      }
      @test = {
        p = Panel()
        :content = p.content()
        -> :content as Text
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
      @label = -> :label as Text
    }

    Greeting = <Base |> -> "hello"
    Farewell = <Base |> -> "goodbye"

    @testGreeting = {
      g = Greeting()
      :label = g.label()
      -> :label as Text
    }

    @testFarewell = {
      f = Farewell()
      :label = f.label()
      -> :label as Text
    }
  `;

  it('supertype receives subtype declaration return value', async () => {
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
      @content = -> :content as Text
    }

    Filled = <Panel |> -> "hello"

    @testDefault = {
      p = Panel()
      :content = p.content()
      -> :content as Text
    }

    @testOverride = {
      f = Filled()
      :content = f.content()
      -> :content as Text
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
    Labeled = <id: Integer> {
      label Text = ingest
      @id = -> :id as Integer
      @label = -> :label as Text
    }

    Widget = <Labeled |> -> "widget"

    @testId = {
      w = Widget(id: 42)
      :id = w.id()
      -> :id as Integer
    }

    @testLabel = {
      w = Widget(id: 42)
      :label = w.label()
      -> :label as Text
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
      @value = -> :value as Integer
    }

    Computed = <Base |> -> (21 * 2)

    @test = {
      c = Computed()
      :value = c.value()
      -> :value as Integer
    }
  `;

  it('subtype provides computed expression', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { value: 'Integer' }, re: { value: 42 }, to: 'c' } },
    );
  });
});
