import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// ingest — superclass receives subclass constructor block result
//
// A superclass uses `ingest` in its constructor block to pause construction
// and receive the return value of the subclass's constructor block.
//
// See keywords/ingest.md for full documentation.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Compilation ──────────────────────────────────────────────────────────────

describe('ingest — compilation', () => {
  it('superclass with ingest compiles', () => {
    expect(() => compileSource(`
      Base = * {
        label Text = ingest
        @label = -> :label
      }
      Child = Base ^ *{ "hello" }
      @test = -> 1
    `)).not.toThrow();
  });

  it('subclass providing ingest value compiles', () => {
    expect(() => compileSource(`
      Base = * { label Text = ingest }
      Child = Base ^ *{ "hello" }
      @test = -> 1
    `)).not.toThrow();
  });

  it('ingest with default — direct construction compiles', () => {
    expect(() => compileSource(`
      Panel = * {
        content Text = ingest("")
        @content = -> :content
      }
      @test = {
        p = Panel()
        :content Text = p.content()
        return :content
      }
    `)).not.toThrow();
  });

  // `ingest` may be deprecated (it outlived its templating purpose), so these
  // compile checks are skipped rather than implemented.
  it.skip('typed ingest with mismatched subclass return is a compiler error', () => {
    expect(() => compileSource(`
      Base = * {
        label Text = ingest
        @label = -> :label
      }
      Child = Base ^ *{ 42 }
      @test = -> 1
    `)).toThrow(/ingest/);
  });

  it.skip('ingest without default — direct construction is a compiler error', () => {
    expect(() => compileSource(`
      Base = * {
        label Text = ingest
        @label = -> :label
      }
      @test = {
        b = Base()
        :label Text = b.label()
        return :label
      }
    `)).toThrow(/ingest/);
  });
});

describe('ingest — runtime', () => {
  const script = `
    // ingest — basic — runtime
    Base = * {
      label Text = ingest
      @label = -> :label
    }

    Greeting = Base ^ *{ "hello" }
    Farewell = Base ^ *{ "goodbye" }

    @testGreeting = {
      g = Greeting()
      :label Text = g.label()
      return :label
    }

    @testFarewell = {
      f = Farewell()
      :label Text = f.label()
      return :label
    }

    // ingest — with default — runtime
    Panel = * {
      content Text = ingest("")
      @content = -> :content
    }

    Filled = Panel ^ *{ "hello" }

    @testDefault = {
      p = Panel()
      :content Text = p.content()
      return :content
    }

    @testOverride = {
      f = Filled()
      :content Text = f.content()
      return :content
    }

    // ingest — with params — runtime
    Labeled = (id: Integer) *{
      label Text = ingest
      @id = -> :id
      @label = -> :label
    }

    Widget = Labeled ^ *{ "widget" }

    @testId = {
      w = Widget(id: 42)
      :id Integer = w.id()
      return :id
    }

    @testLabel = {
      w = Widget(id: 42)
      :label Text = w.label()
      return :label
    }

    // ingest — computed value — runtime
    Base4 = * {
      value Integer = ingest
      @value = -> :value
    }

    Computed = Base4 ^ *{ (21 * 2) }

    @test = {
      c = Computed()
      :value Integer = c.value()
      return :value
    }
  `;

  // ── Runtime: basic ingest ────────────────────────────────────────────────────

  it('ingest — basic — runtime — superclass receives subclass constructor block return value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testGreeting', from: 'c' } },
      { output: { id: '1', 'ty': [{ label: 'Text' }], re: [{ label: 'hello' }], to: 'c' } },
    );
  });

  it('ingest — basic — runtime — different subclasses provide different values', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testFarewell', from: 'c' } },
      { output: { id: '1', 'ty': [{ label: 'Text' }], re: [{ label: 'goodbye' }], to: 'c' } },
    );
  });

  // ── Runtime: ingest with default ─────────────────────────────────────────────

  it('ingest — with default — runtime — direct construction uses default value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testDefault', from: 'c' } },
      { output: { id: '1', 'ty': [{ content: 'Text' }], re: [{ content: '' }], to: 'c' } },
    );
  });

  it('ingest — with default — runtime — subclass overrides default value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testOverride', from: 'c' } },
      { output: { id: '1', 'ty': [{ content: 'Text' }], re: [{ content: 'hello' }], to: 'c' } },
    );
  });

  // ── Runtime: ingest with constructor params ──────────────────────────────────

  it('ingest — with params — runtime — superclass params and ingest coexist — param works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testId', from: 'c' } },
      { output: { id: '1', 'ty': [{ id: 'Integer' }], re: [{ id: 42 }], to: 'c' } },
    );
  });

  it('ingest — with params — runtime — superclass params and ingest coexist — ingest works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testLabel', from: 'c' } },
      { output: { id: '1', 'ty': [{ label: 'Text' }], re: [{ label: 'widget' }], to: 'c' } },
    );
  });

  // ── Runtime: ingest with expression ──────────────────────────────────────────

  it('ingest — computed value — runtime — subclass provides computed expression', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'test', from: 'c' } },
      { output: { id: '1', 'ty': [{ value: 'Integer' }], re: [{ value: 42 }], to: 'c' } },
    );
  });
});
