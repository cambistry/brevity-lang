import { extract } from '../../index.js';
import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════
// Reference fields in types — a Type field may hold a function reference (an
// address), not only pass-by-value data.
//
// Design: notes/reference-fields-in-types-2026-10-26.md. A reference IS data —
// an address string that already travels inside an Object. Reference-ness
// falls out of the field's TYPE being behavioral (a function signature). The
// discipline is selected by the signature's output side:
//
//   silent   `() -> .`        fire-and-forget, NO reply
//   callback `(x) -> (y)` / `(x) -> ()`   reply-awaiting
//
// Invoking a reference field sends to the address it holds, mirroring the
// existing closure-route convention: the op is the address's trailing
// selector, `to` is the full address. With-args form is `[[args], selector]`;
// no-args is the bare selector.
//
// Surface: a silent reference is invoked with the bang form `v.field!`
// (a loud, reply-less effect). A reply-awaiting callback is invoked as a plain
// call `v.field(args)`.
//
// These tests are deliberately abstract — generic type and field names, plain
// actor messaging, no dependency on any target package or runtime.
//
// STATUS: TDD-red. `() -> .` as a type-field type does not parse yet
// (parseFunctionType hard-expects `-> ( … )`), and field-read call dispatch is
// unimplemented. These tests define the target contract.
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// Grammar: behavioral field types parse (the silent `-> .` output is the gap)
// ─────────────────────────────────────────────────────────────────────────────

describe('reference fields — grammar', () => {
  it('a silent reference field `() -> .` parses as a type field', () => {
    expect(() => compileSource(`
      ::Sink = (push: () -> .)
      @go = -> result: 1
    `)).not.toThrow();
  });

  it('a void-callback field `(x) -> ()` parses as a type field', () => {
    expect(() => compileSource(`
      ::Adder = (add: (value: Integer) -> ())
      @go = -> result: 1
    `)).not.toThrow();
  });

  it('a valued-callback field `() -> (n: Integer)` parses as a type field', () => {
    expect(() => compileSource(`
      ::Reader = (get: () -> (n: Integer))
      @go = -> result: 1
    `)).not.toThrow();
  });

  it('mixes value fields and reference fields in one type', () => {
    expect(() => compileSource(`
      ::Mixed = (seed: Integer, push: () -> ., check: (x: Integer) -> (ok: Boolean))
      @go = -> result: 1
    `)).not.toThrow();
  });

  it('a multi-param function-sig field keeps its comma-separated inputs', () => {
    // The nested comma must not split the surrounding field list.
    expect(() => compileSource(`
      ::Handler = (run: (a: Integer, b: Integer) -> ())
      @go = -> result: 1
    `)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Grammar: the silent field type survives into the type declaration AST
// ─────────────────────────────────────────────────────────────────────────────

describe('reference fields — captured in the type declaration', () => {
  const typeDeclNamed = (ast, name) => {
    let decl = null;
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      if ((n.type === 'TypeDecl' || n.type === 'TypeDeclaration') && n.name === name) decl ??= n;
      for (const k of Object.keys(n)) if (k !== 'type') walk(n[k]);
    };
    walk(ast);
    return decl;
  };

  it('records a silent reference field with its `() -> .` signature', () => {
    const { ast } = extract(`
      ::Sink = (push: () -> .)
      @go = -> result: 1
    `);
    const decl = typeDeclNamed(ast, 'Sink');
    expect(decl).toBeTruthy();
    // The field's declared type must retain the silent-output arrow so
    // downstream discipline selection can distinguish it from a value field.
    const field = decl.fields.find(f => f.name === 'push');
    expect(field).toBeTruthy();
    expect(field.paramType).toMatch(/->\s*\.$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Runtime: invoking a reference field sends to the held address
//
// One shared fixture program carries all runtime cases — a handler per
// assertion, selected by `op` — so the harness compiles the source once.
//
// Values with reference fields arrive as typed params on the wire: the param
// payload is a name-keyed map whose value is the type's positional array, with
// a parallel `bv-a: [{ param: '::Type' }]` tag (mirrors type_wire.test.js).
// Each reference field slot carries an address string.
// ─────────────────────────────────────────────────────────────────────────────

describe('reference fields — runtime invocation', () => {
  const fixture = `
    ::Sink = (push: () -> ., flush: () -> .)
    ::Call = (arg Integer, fn: (value: Integer) -> (out: Integer))

    // Silent reference, bang-invoked: fire-and-forget, no reply awaited;
    // handler is itself silent.
    @one = (s: Sink) { s.push! . }

    // Two silent references, bang-invoked in order.
    @both = (s: Sink) { s.push!; s.flush! . }

    // Reply-awaiting callback with an argument and a typed result. The handler
    // binds the callback's result (a typed local) and passes it through to its
    // own reply — so the result must flow back and typecheck.
    @callback = (c: Call) {
      out: Integer = c.fn(c.arg)
      -> result: out
    }
  `;

  it('bang-invoking a silent reference posts a fire-and-forget to its address', async () => {
    // push = "#<x @p>"  → selector "@p", addressed to the full address.
    await expectBehavior(fixture,
      { input: { id: '1', op: [{ s: ['#<x @p>', '#<x @f>'] }, '@one'], 'bv-a': [{ s: '::Sink' }], from: 'caller' } },
      { output: expect.objectContaining({ op: '@p', to: '#<x @p>' }) },
    );
  });

  it('a silent reference invocation consumes no reply (handler stays silent)', async () => {
    // Only the fire-and-forget post appears; no `re` to the caller. A second
    // post (a handler reply) would break this exact match.
    await expectBehavior(fixture,
      { input: { id: '2', op: [{ s: ['#<x @p>', '#<x @f>'] }, '@one'], 'bv-a': [{ s: '::Sink' }], from: 'caller' } },
      { output: { id: expect.any(String), op: '@p', to: '#<x @p>' } },
    );
  });

  it('two silent calls post in source order to their own addresses', async () => {
    await expectBehavior(fixture,
      { input: { id: '3', op: [{ s: ['#<x @p>', '#<x @f>'] }, '@both'], 'bv-a': [{ s: '::Sink' }], from: 'caller' } },
      { output: expect.objectContaining({ op: '@p', to: '#<x @p>' }) },
      { output: expect.objectContaining({ op: '@f', to: '#<x @f>' }) },
    );
  });

  it('invoking a callback field sends args, awaits a typed reply, and passes the result through', async () => {
    // External request id '50' avoids colliding with the handler's own
    // internal send ids, which start at '1'.
    await expectBehavior(fixture,
      { input: { id: '50', op: [{ c: [200, '#<caller @cb>'] }, '@callback'], 'bv-a': [{ c: '::Call' }], from: 'caller' } },
      // The callback send: arg 200, selector @cb, addressed to the closure.
      { output: expect.objectContaining({ id: '1', op: [[200], '@cb'], to: '#<caller @cb>' }) },
      // Synthesize the callback's typed reply (internal send id '1'). 999 is an
      // arbitrary value the "remote" computed — not derived from the seed —
      // so a correct pass-through can only come from consuming this reply.
      { input: { id: '1', re: { out: 999 }, 'bv-a': { out: 'Integer' } } },
      // The handler's reply carries the consumed result, typed Integer —
      // proving it awaited, bound `out`, and passed it through.
      { output: expect.objectContaining({ id: '50', re: { result: 999 }, 'bv-a': { result: 'Integer' }, to: 'caller' }) },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

describe('reference fields — validation', () => {
  it('rejects binding the result of a silent reference call (no value)', () => {
    expect(() => compileSource(`
      ::Sink = (push: () -> .)
      @go = (s: Sink) {
        x = s.push!
        -> result: 1
      }
    `)).toThrow(/silent|no value|has no reply/i);
  });

  it('rejects invoking a plain value field as if it were a reference', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      @go = (p: Point) { p.x! . }
    `)).toThrow(/not a (function|reference|callable)|cannot call/i);
  });

  it('rejects invoking a field the type does not declare', () => {
    expect(() => compileSource(`
      ::Sink = (push: () -> .)
      @go = (s: Sink) { s.bogus! . }
    `)).toThrow(/has no field 'bogus'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ordering check: a silent reference call must lexically precede the handler's
// first reply-consuming (awaited) send. Reads and fire-and-forget sends before
// it are fine. (Design note §ordering.)
// ─────────────────────────────────────────────────────────────────────────────

describe('reference fields — silent-call ordering check', () => {
  it('accepts a silent call before any awaited send', () => {
    expect(() => compileSource(`
      ::Mixed = (push: () -> ., check: (msg: Text) -> (ok: Boolean))
      @go = (m: Mixed) {
        m.push!
        ok: Boolean = m.check("done")
        -> result: 1
      }
    `)).not.toThrow();
  });

  it('accepts two silent calls before an awaited send', () => {
    expect(() => compileSource(`
      ::Mixed = (push: () -> ., flush: () -> ., check: (msg: Text) -> (ok: Boolean))
      @go = (m: Mixed) {
        m.push!
        m.flush!
        ok: Boolean = m.check("done")
        -> result: 1
      }
    `)).not.toThrow();
  });

  it('rejects a silent call after an awaited send', () => {
    expect(() => compileSource(`
      ::Mixed = (push: () -> ., check: (msg: Text) -> (ok: Boolean))
      @go = (m: Mixed) {
        ok: Boolean = m.check("first")
        m.push!
        -> result: 1
      }
    `)).toThrow(/must precede the first awaited send/i);
  });

  it('rejects a silent call after an awaited send inside an earlier branch', () => {
    expect(() => compileSource(`
      ::Mixed = (push: () -> ., check: (msg: Text) -> (ok: Boolean))
      @go = (m: Mixed, flag: Boolean) {
        if flag ok: Boolean = m.check("maybe")
        m.push!
        -> result: 1
      }
    `)).toThrow(/must precede the first awaited send/i);
  });
});
