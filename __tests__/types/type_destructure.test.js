import { expectBehavior, compileSource } from '../helpers.js';

// Spec tests for typed-value destructuring (notes/types-implementation-plan-
// 2026-04-27.md, "Destructuring"; notes/positional-type-fields-2026-11-26.md):
// positional destructure reads the positional fields, named destructure the
// named ones, with permissive selection and strict existence.
//
// Codegen detects when the destructure source is a typed value and reads
// fields by key on the tagged object instead of going through the
// generic-Object unpacker (`p.positional[i]`). Validation in src/validate.js
// rejects over-arity and undeclared-field references.

describe('type destructure — runtime', () => {
  const script = `
    type Point(Integer, Integer)
    type Pair(x: Integer, y: Integer)
    type Mixed(Integer, label: Text)
    type Game(? Boolean, ? turn: Integer)

    @parenPositional = {
      p = Point(1, 2)
      (x, y) = p
      return rx: x, ry: y
    }

    @barePositional = {
      p = Point(1, 2)
      x, y = p
      return rx: x, ry: y
    }

    @singlePositional = {
      p = Point(7, 8)
      (x) = p
      return rx: x
    }

    @renamedPositional = {
      p = Point(1, 2)
      (a, b) = p
      return ra: a, rb: b
    }

    @fullNamed = {
      p = Pair(x: 1, y: 2)
      :x, :y = p
      return rx: x, ry: y
    }

    @selectiveNamed = {
      p = Pair(x: 7, y: 8)
      :x = p
      return rx: x
    }

    @aliasNamed = {
      p = Pair(x: 7, y: 8)
      x: alias_x = p
      return rx: alias_x
    }

    @reorderedNamed = {
      p = Pair(x: 1, y: 2)
      :y, :x = p
      return rx: x, ry: y
    }

    @mixedDeclared = {
      m = Mixed(3, label: "hi")
      count, :label = m
      return rc: count, rl: label
    }

    @optionalPresent = {
      g = Game(true, turn: 5)
      :turn = g
      return rt: turn as Integer
    }

    @optionalFallback = {
      g = Game(true)
      :turn = g
      return rt: (turn ?? 99)
    }

    @optionalPresence = {
      g = Game(true)
      :turn = g
      return rp: (turn)?
    }
  `;

  // ── positional ──

  it('positional — (x, y) = p — paren positional pulls all fields', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'parenPositional', from: 'c' } },
      { output: { id: '1', 'ty': [{ rx: 'Integer', ry: 'Integer' }], re: [{ rx: 1, ry: 2 }], to: 'c' } },
    );
  });

  it('positional — x, y = p — bare positional (no parens) pulls all fields', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'barePositional', from: 'c' } },
      { output: { id: '2', 'ty': [{ rx: 'Integer', ry: 'Integer' }], re: [{ rx: 1, ry: 2 }], to: 'c' } },
    );
  });

  it('positional — (x) = p — single positional drops trailing fields', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: 'singlePositional', from: 'c' } },
      { output: { id: '3', 'ty': [{ rx: 'Integer' }], re: [{ rx: 7 }], to: 'c' } },
    );
  });

  it('positional — (a, b) = p — locals named freely (renamed positions)', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: 'renamedPositional', from: 'c' } },
      { output: { id: '4', 'ty': [{ ra: 'Integer', rb: 'Integer' }], re: [{ ra: 1, rb: 2 }], to: 'c' } },
    );
  });

  // ── named ──

  it('named — :x, :y = p — full named destructure', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: 'fullNamed', from: 'c' } },
      { output: { id: '5', 'ty': [{ rx: 'Integer', ry: 'Integer' }], re: [{ rx: 1, ry: 2 }], to: 'c' } },
    );
  });

  it('named — :x = p — selective single-field destructure', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: 'selectiveNamed', from: 'c' } },
      { output: { id: '6', 'ty': [{ rx: 'Integer' }], re: [{ rx: 7 }], to: 'c' } },
    );
  });

  it('named — x: alias_x = p — rename on extraction', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: 'aliasNamed', from: 'c' } },
      { output: { id: '7', 'ty': [{ rx: 'Integer' }], re: [{ rx: 7 }], to: 'c' } },
    );
  });

  it('named — :y, :x = p — order-insensitive', async () => {
    await expectBehavior(script,
      { input: { id: '8', op: 'reorderedNamed', from: 'c' } },
      { output: { id: '8', 'ty': [{ rx: 'Integer', ry: 'Integer' }], re: [{ rx: 1, ry: 2 }], to: 'c' } },
    );
  });

  // ── mixed-form types ──

  it('mixed-form — the positional field by position, the named field by name', async () => {
    await expectBehavior(script,
      { input: { id: '12', op: 'mixedDeclared', from: 'c' } },
      { output: { id: '12', 'ty': [{ rc: 'Integer', rl: 'Text' }], re: [{ rc: 3, rl: 'hi' }], to: 'c' } },
    );
  });

  // ── optional fields ──

  it('optional — field present: destructures to its value', async () => {
    // Required-field destructure propagates the field type to the local.
    // Optional fields deliberately do NOT propagate — the local stays
    // polymorphic so `??` and `(expr)?` can still see absence. A caller
    // who wants to use the value as a typed value supplies an explicit
    // `as` cast (or an annotation on the destructure pattern).
    await expectBehavior(script,
      { input: { id: '13', op: 'optionalPresent', from: 'c' } },
      { output: { id: '13', 'ty': [{ rt: 'Integer' }], re: [{ rt: 5 }], to: 'c' } },
    );
  });

  it('optional — field absent: destructure with ?? fallback yields the fallback', async () => {
    // Mirrors type_optionality's `?? falls back when omitted` but applied
    // after destructuring a typed value.
    await expectBehavior(script,
      { input: { id: '14', op: 'optionalFallback', from: 'c' } },
      { output: { id: '14', 'ty': [{ rt: 'Integer' }], re: [{ rt: 99 }], to: 'c' } },
    );
  });

  it('optional — field absent: presence check on destructured local is false', async () => {
    await expectBehavior(script,
      { input: { id: '15', op: 'optionalPresence', from: 'c' } },
      { output: { id: '15', 'ty': [{ rp: 'Boolean' }], re: [{ rp: false }], to: 'c' } },
    );
  });
});

describe('type destructure — compile errors', () => {
  it('rejects positional destructure with more locals than fields', () => {
    expect(() => compileSource(`
      type Point(Integer, Integer)
      @go = {
        p = Point(1, 2)
        x, y, z = p
        return result: 1
      }
    `)).toThrow();
  });

  it('rejects positional destructure of a named field', () => {
    expect(() => compileSource(`
      type Pair(x: Integer, y: Integer)
      @go = {
        p = Pair(x: 1, y: 2)
        (a, b) = p
        return result: 1
      }
    `)).toThrow("Type 'Pair' has 0 positional fields; positional destructure requested 1");
  });

  it('rejects named destructure of a positional field', () => {
    expect(() => compileSource(`
      type Point(Integer, y: Integer)
      @go = {
        p = Point(1, y: 2)
        :x = p
        return result: 1
      }
    `)).toThrow("Type 'Point' has no field 'x'");
  });

  it('rejects named destructure of an undeclared field', () => {
    expect(() => compileSource(`
      type Point(Integer, Integer)
      @go = {
        p = Point(1, 2)
        :z = p
        return result: 1
      }
    `)).toThrow();
  });
});
