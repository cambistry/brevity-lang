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
        id: '1', 'bv-a': { x: 'Text' }, re: { x: 'hello' }, to: 'caller',
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
        id: '1', 'bv-a': { x: 'Integer' }, re: { x: 42 }, to: 'caller',
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
        id: '1', 'bv-a': { x: 'Decimal' }, re: { x: 3.14 }, to: 'caller',
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
        id: '1', 'bv-a': { x: 'Float' }, re: { x: 123 }, to: 'caller',
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
        id: '1', 'bv-a': { x: 'Boolean' }, re: { x: true }, to: 'caller',
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
        id: '1', 'bv-a': { x: 'Boolean' }, re: { x: false }, to: 'caller',
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
        id: '1', 'bv-a': { x: 'null' }, re: { x: null }, to: 'caller',
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
        id: '1', 'bv-a': ['Integer'], re: [99], to: 'caller',
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
        id: '1', 'bv-a': { msg: 'Text' }, re: { msg: 'hi' }, to: 'caller',
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
        id: '1', 'bv-a': { ok: 'Boolean' }, re: { ok: true }, to: 'caller',
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
        id: '1', 'bv-a': { pi: 'Decimal' }, re: { pi: 3.14 }, to: 'caller',
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
        id: '1', 'bv-a': { value: 'null' }, re: { value: null }, to: 'caller',
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
        id: '1', 'bv-a': { result: 'Integer' }, re: { result: 11 }, to: 'caller',
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
        id: '1', 'bv-a': { result: 'Text' }, re: { result: 'world' }, to: 'caller',
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
        id: '1', 'bv-a': { result: 'Boolean' }, re: { result: true }, to: 'caller',
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
        id: '1', 'bv-a': { count: 'Integer' }, re: { count: 7 }, to: 'caller',
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
        id: '1', 'bv-a': { label: 'Text' }, re: { label: 'hello' }, to: 'caller',
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
        id: '1', 'bv-a': { x: 'Integer' }, re: { x: 5 }, to: 'caller',
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
        id: '1', 'bv-a': { x: 'Text' }, re: { x: 'hi' }, to: 'caller',
      },
    });
  });
});
