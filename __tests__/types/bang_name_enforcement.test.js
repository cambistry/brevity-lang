import { compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════
// The trailing `!` is part of a member's NAME, not a call-site marker. A `.foo`
// and a `.foo!` are distinct members; invoking with the wrong bang-ness resolves
// to a member that does not exist. Only a function member may carry a `!` — a
// value field never can.
//
// Fictional types/service only — no DOM, no browser.
// ═══════════════════════════════════════════════════════════════════════════

// ── Type reference fields: a field name is never bang-suffixed, so any `!` at
//    the call site is spurious. (This was the hole: the bang was silently
//    stripped and the call resolved to the no-bang field.)
describe('bang enforcement — type reference fields', () => {
  const TYPES = `
    ::Signal = (dismiss: () -> ., code: Integer)
    ::Panel = (onpress: (s: Signal) -> ., label: Text)
  `;

  it('rejects a spurious bang on a silent reference field', () => {
    expect(() => compileSource(`${TYPES}
      @h = (s: Signal) { s.dismiss! . }
    `)).toThrow(/declared without '!'|invoke it as '\.dismiss'/);
  });

  it('accepts the declared (no-bang) form', () => {
    expect(() => compileSource(`${TYPES}
      @h = (s: Signal) { s.dismiss() . }
    `)).not.toThrow();
  });

  it('rejects a bang on a value field (a value is not a function)', () => {
    expect(() => compileSource(`${TYPES}
      @h = (s: Signal) { s.code! . }
    `)).toThrow(/is a value, not a function|cannot be invoked with '!'/);
  });

  it('rejects a spurious bang on a callback field invoked with args', () => {
    expect(() => compileSource(`${TYPES}
      @h = (sig: Signal) { p = Panel(onpress: (s) { s.dismiss() }, label: "x") p.onpress!(sig) . }
    `)).toThrow(/declared without '!'/);
  });
});

// ── Service / interface methods: the method name keeps its bang, so the call's
//    bang-ness must match the declared name — both directions.
describe('bang enforcement — interface methods (bidirectional)', () => {
  const WIDGET = `{
    ::Signal = (dismiss: () -> ., code: Integer)
    watch: (on: (s: Signal) -> .) -> .
    poke!: () -> .
  }`;
  const remotes = [{ path: 'Widget', service: WIDGET }];
  const dep = (body) => `*( "Widget": (Widget) )\n=\n${body}`;

  it('accepts a no-bang method called without a bang', () => {
    expect(() => compileSource(dep(`@go = { Widget.watch(on: (s) { s.dismiss() }) . }`), { remotes })).not.toThrow();
  });

  it('rejects a spurious bang on a no-bang method', () => {
    expect(() => compileSource(dep(`@go = { Widget.watch!(on: (s) { s.dismiss() }) . }`), { remotes }))
      .toThrow(/has no function 'watch!'/);
  });

  it('accepts a bang method called with its bang', () => {
    expect(() => compileSource(dep(`@go = { Widget.poke!() . }`), { remotes })).not.toThrow();
  });

  it('rejects a bang method called without its bang (distinct member)', () => {
    expect(() => compileSource(dep(`@go = { Widget.poke() . }`), { remotes }))
      .toThrow(/has no function 'poke'/);
  });
});

// ── Class methods: a spurious bang resolves to a distinct, undeclared method.
describe('bang enforcement — class methods', () => {
  it('accepts a declared no-bang method called without a bang', () => {
    expect(() => compileSource(`
      Box = *(v Integer) { @get = -> r: v () }
      @h = { b = Box(1) x: Integer = b.get() . }
    `)).not.toThrow();
  });

  it('rejects a spurious bang on a class method', () => {
    expect(() => compileSource(`
      Box = *(v Integer) { @get = -> r: v () }
      @h = { b = Box(1) x: Integer = b.get!() . }
    `)).toThrow(/has no method 'get!'/);
  });
});
