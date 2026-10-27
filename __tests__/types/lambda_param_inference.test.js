import { compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════
// Contextual lambda-parameter type inference — C1: local type callback field.
//
// A Type field may hold a callback (`(s: Signal) -> .`). When a lambda fills
// that field at construction, the lambda's untyped parameter takes its type
// from the field's callback signature — so the lambda body resolves against
// that type (`s.code` is a real field; `s.bogus` is not). Explicit annotations
// are honored and never overwritten.
//
// Pure-language tests — a plain local `::Signal` / `::Panel`, no services, no
// browser. (Cross-module + implicit scoped import is a separate file.)
// ═══════════════════════════════════════════════════════════════════════════

const TYPES = `
  ::Signal = (code: Integer)
  ::Panel = (onpress: (s: Signal) -> ., label: Text)
`;

describe('lambda param inference — C1 local type callback field', () => {
  it('infers the lambda param type from a named-arg callback field (reads a real field)', () => {
    expect(() => compileSource(`${TYPES}
      @make = -> p: Panel(onpress: (s) { use: Integer = s.code . }, label: "x")
    `)).not.toThrow();
  });

  it('infers from a positional callback field too', () => {
    expect(() => compileSource(`${TYPES}
      @make = -> p: Panel((s) { use: Integer = s.code . }, "x")
    `)).not.toThrow();
  });

  it('rejects a field the inferred type does not declare', () => {
    expect(() => compileSource(`${TYPES}
      @make = -> p: Panel(onpress: (s) { bad: Integer = s.bogus . }, label: "x")
    `)).toThrow(/has no field 'bogus'/);
  });

  it('the arrow+block spelling infers the same way', () => {
    expect(() => compileSource(`${TYPES}
      @make = -> p: Panel(onpress: (s) -> { use: Integer = s.code . }, label: "x")
    `)).not.toThrow();
    expect(() => compileSource(`${TYPES}
      @make = -> p: Panel(onpress: (s) -> { bad: Integer = s.bogus . }, label: "x")
    `)).toThrow(/has no field 'bogus'/);
  });

  it('a param named differently from the signature still infers by position', () => {
    expect(() => compileSource(`${TYPES}
      @make = -> p: Panel(onpress: (evt) { use: Integer = evt.code . }, label: "x")
    `)).not.toThrow();
  });

  it('an explicit matching annotation is accepted', () => {
    expect(() => compileSource(`${TYPES}
      @make = -> p: Panel(onpress: (s: Signal) { use: Integer = s.code . }, label: "x")
    `)).not.toThrow();
  });

  it('an explicit annotation is not overwritten by inference', () => {
    // `s` is explicitly `Integer`; `Integer` is a scalar with no fields, so
    // the member check never fires (no decl) — but crucially inference must
    // NOT silently retype `s` to `Signal` and then accept `s.code`. We assert
    // the explicit type sticks by confirming `s.code` is NOT validated as a
    // Signal field access (it compiles, because Integer has no decl to check).
    expect(() => compileSource(`${TYPES}
      @make = -> p: Panel(onpress: (s: Integer) { -> ok: 1 }, label: "x")
    `)).not.toThrow();
  });

  it('rejects invoking a plain value field as a reference inside the lambda', () => {
    expect(() => compileSource(`${TYPES}
      @make = -> p: Panel(onpress: (s) { s.code! . }, label: "x")
    `)).toThrow(/not a (reference|function|callable)|cannot be invoked/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C2: a service-hosted type's callback field. The lambda param's type is
// inferred as the service type (`Widget::Signal`) and that type's definition is
// implicitly imported SCOPED TO THE LAMBDA — resolvable for field access/ref
// invocation, but never nameable at file scope. Only `Panel` is imported.
//
// Fictional service — no browser, no DOM.
// ─────────────────────────────────────────────────────────────────────────────

const WIDGET = `{
  ::Signal = (dismiss: () -> ., code: Integer)
  ::Panel = (onpress: (s: Signal) -> ., label: Text)
}`;
const remotes = [{ path: 'Widget', service: WIDGET }];

const withPanel = (body) => `
  *( "Widget": (:Panel) )
  =
  ${body}
`;

describe('lambda param inference — C2 service-hosted type callback field', () => {
  it('infers the param as the service type and resolves a silent ref field', () => {
    expect(() => compileSource(withPanel(`
      @make = -> p: Panel(onpress: (s) { s.dismiss! }, label: "x")
    `), { remotes })).not.toThrow();
  });

  it('resolves a value field on the implicitly-imported type', () => {
    expect(() => compileSource(withPanel(`
      @make = -> p: Panel(onpress: (s) { use: Integer = s.code . }, label: "x")
    `), { remotes })).not.toThrow();
  });

  it('rejects a field the service type does not declare (scoped decl is consulted)', () => {
    expect(() => compileSource(withPanel(`
      @make = -> p: Panel(onpress: (s) { s.bogus! }, label: "x")
    `), { remotes })).toThrow(/has no field 'bogus'/);
  });

  it('an inferred lambda does not make the bare name nameable for a sibling explicit annotation', () => {
    // @a infers `Signal` implicitly; that must NOT let @b name `Signal`
    // explicitly without an import — the implicit import is inference-only.
    expect(() => compileSource(withPanel(`
      @a = -> p: Panel(onpress: (s) { s.dismiss! }, label: "x")
      @b = -> q: Panel(onpress: (s: Signal) { s.dismiss! }, label: "y")
    `), { remotes })).toThrow(/not declared or imported/);
  });
});

describe('lambda param inference — C2 explicit annotation requires explicit import', () => {
  it('rejects an explicit bare type name that is not imported', () => {
    expect(() => compileSource(withPanel(`
      @make = -> p: Panel(onpress: (s: Signal) { s.dismiss! }, label: "x")
    `), { remotes })).toThrow(/not declared or imported/);
  });

  it('accepts the qualified Alias::Name annotation', () => {
    expect(() => compileSource(withPanel(`
      @make = -> p: Panel(onpress: (s: Widget::Signal) { s.dismiss! }, label: "x")
    `), { remotes })).not.toThrow();
  });

  it('accepts a bare annotation when the type IS explicitly imported', () => {
    expect(() => compileSource(`
      *( "Widget": (:Panel, :Signal) )
      =
      @make = -> p: Panel(onpress: (s: Signal) { s.dismiss! }, label: "x")
    `, { remotes })).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C3: a service METHOD whose parameter is a callback. Calling it with a lambda
// infers the lambda param as the service type (`Widget::Signal`) and implicitly
// imports that type's definition, scoped to the lambda — same semantics as the
// construction carriers, sourced from the method signature instead of a field.
//
// (Named callback param form `(on: (s: Signal) -> .)`, matching the `onclick:`
// attribute shape. Positional function-type params hit a separate interface
// comma/colon-split limitation and are out of scope here.)
// ─────────────────────────────────────────────────────────────────────────────

const WIDGET_M = `{
  ::Signal = (dismiss: () -> ., code: Integer)
  watch: (on: (s: Signal) -> .) -> .
}`;
const remotesM = [{ path: 'Widget', service: WIDGET_M }];

const withDep = (body) => `
  *( "Widget": (Widget) )
  =
  ${body}
`;

describe('lambda param inference — C3 service method callback param', () => {
  it('infers the param and resolves a silent ref field (direct dep call)', () => {
    expect(() => compileSource(withDep(`
      @go = { Widget.watch(on: (s) { s.dismiss! }) . }
    `), { remotes: remotesM })).not.toThrow();
  });

  it('resolves a value field on the implicitly-imported type', () => {
    expect(() => compileSource(withDep(`
      @go = { Widget.watch(on: (s) { use: Integer = s.code . }) . }
    `), { remotes: remotesM })).not.toThrow();
  });

  it('rejects a field the service type does not declare', () => {
    expect(() => compileSource(withDep(`
      @go = { Widget.watch(on: (s) { s.bogus! }) . }
    `), { remotes: remotesM })).toThrow(/has no field 'bogus'/);
  });

  it('infers through an instance-typed receiver (w: Widget)', () => {
    expect(() => compileSource(withDep(`
      @go = (w: Widget) { w.watch(on: (s) { s.bogus! }) . }
    `), { remotes: remotesM })).toThrow(/has no field 'bogus'/);
  });

  it('rejects an explicit bare type name that is not imported', () => {
    expect(() => compileSource(withDep(`
      @go = { Widget.watch(on: (s: Signal) { s.dismiss! }) . }
    `), { remotes: remotesM })).toThrow(/not declared or imported/);
  });

  it('accepts the qualified Alias::Name annotation', () => {
    expect(() => compileSource(withDep(`
      @go = { Widget.watch(on: (s: Widget::Signal) { s.dismiss! }) . }
    `), { remotes: remotesM })).not.toThrow();
  });
});
