import { expectReply } from './helpers.js';

// ── Variable assignment ───────────────────────────────────────────────────────
//
// x = literal  →  type inferred; bv-a reflects inferred type

describe('literal type inference — variable assignment', () => {
  it('string literal inferred as Text', async () => {
    const source = `
      on go()
        x = "hello"
        reply :x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { go: { x: 'Text' } }, re: { go: { x: 'hello' } }, to: 'caller',
      },
    });
  });

  it('integer literal inferred as Integer', async () => {
    const source = `
      on go()
        x = 42
        reply :x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { go: { x: 'Integer' } }, re: { go: { x: 42 } }, to: 'caller',
      },
    });
  });

  it('decimal literal inferred as Decimal', async () => {
    const source = `
      on go()
        x = 3.14
        reply :x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { go: { x: 'Decimal' } }, re: { go: { x: 3.14 } }, to: 'caller',
      },
    });
  });

  it('scientific notation literal inferred as Float', async () => {
    const source = `
      on go()
        x = 1.23E+2
        reply :x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { go: { x: 'Float' } }, re: { go: { x: 123 } }, to: 'caller',
      },
    });
  });

  it('true inferred as Boolean', async () => {
    const source = `
      on go()
        x = true
        reply :x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { go: { x: 'Boolean' } }, re: { go: { x: true } }, to: 'caller',
      },
    });
  });

  it('false inferred as Boolean', async () => {
    const source = `
      on go()
        x = false
        reply :x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { go: { x: 'Boolean' } }, re: { go: { x: false } }, to: 'caller',
      },
    });
  });

  it('null literal inferred as null', async () => {
    const source = `
      on go()
        x = null
        reply :x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { go: { x: 'null' } }, re: { go: { x: null } }, to: 'caller',
      },
    });
  });
});

// ── Reply fields ──────────────────────────────────────────────────────────────
//
// reply literal  →  type inferred; no `: Type` annotation required

describe('literal type inference — reply fields', () => {
  it('integer in positional reply', async () => {
    const source = `
      on go()
        reply 99
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { go: ['Integer'] }, re: { go: [99] }, to: 'caller',
      },
    });
  });

  it('string in named reply field', async () => {
    const source = `
      on go()
        reply msg: "hi"
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { go: { msg: 'Text' } }, re: { go: { msg: 'hi' } }, to: 'caller',
      },
    });
  });

  it('boolean in named reply field', async () => {
    const source = `
      on go()
        reply ok: true
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { go: { ok: 'Boolean' } }, re: { go: { ok: true } }, to: 'caller',
      },
    });
  });

  it('decimal in named reply field', async () => {
    const source = `
      on go()
        reply pi: 3.14
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { go: { pi: 'Decimal' } }, re: { go: { pi: 3.14 } }, to: 'caller',
      },
    });
  });

  it('null in named reply field', async () => {
    const source = `
      on go()
        reply value: null
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { go: { value: 'null' } }, re: { go: { value: null } }, to: 'caller',
      },
    });
  });
});

// ── Function arguments ────────────────────────────────────────────────────────
//
// fn(literal)  →  no type annotation needed on the argument itself

describe('literal type inference — function arguments', () => {
  it('integer passed without annotation', async () => {
    const source = `
      on go()
        fn = (a) a + 1
        result : Integer = fn(10)
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { go: { result: 'Integer' } }, re: { go: { result: 11 } }, to: 'caller',
      },
    });
  });

  it('string passed without annotation', async () => {
    const source = `
      on go()
        fn = (s) s
        result : Text = fn("world")
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { go: { result: 'Text' } }, re: { go: { result: 'world' } }, to: 'caller',
      },
    });
  });

  it('boolean passed without annotation', async () => {
    const source = `
      on go()
        fn = (b) b
        result : Boolean = fn(true)
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { go: { result: 'Boolean' } }, re: { go: { result: true } }, to: 'caller',
      },
    });
  });
});

// ── Structure fields ──────────────────────────────────────────────────────────
//
// Structure(key: literal)  →  no type annotation needed on the value

describe('literal type inference — structure fields', () => {
  it('integer field without annotation', async () => {
    const source = `
      on go()
        s : Structure = Structure(count: 7)
        :count : Integer = s
        reply :count
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { go: { count: 'Integer' } }, re: { go: { count: 7 } }, to: 'caller',
      },
    });
  });

  it('string field without annotation', async () => {
    const source = `
      on go()
        s : Structure = Structure(label: "hello")
        :label : Text = s
        reply :label
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { go: { label: 'Text' } }, re: { go: { label: 'hello' } }, to: 'caller',
      },
    });
  });
});

// ── Explicit annotation still compiles (fully qualified) ──────────────────────

describe('literal type inference — explicit annotation coexists', () => {
  it('integer with explicit annotation still works', async () => {
    const source = `
      on go()
        x : Integer = 5 : Integer
        reply :x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { go: { x: 'Integer' } }, re: { go: { x: 5 } }, to: 'caller',
      },
    });
  });

  it('string with explicit annotation still works', async () => {
    const source = `
      on go()
        x : Text = "hi" : Text
        reply :x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'go', from: 'caller' },
      reply: {
        id: '1', 'bv-a': { go: { x: 'Text' } }, re: { go: { x: 'hi' } }, to: 'caller',
      },
    });
  });
});
