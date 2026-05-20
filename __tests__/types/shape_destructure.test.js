import { expectBehavior, compileSource } from '../helpers.js';

// Spec tests for typed-value destructuring. Spec lives in
// notes/types-implementation-plan-2026-04-27.md, section "Destructuring"
// (lines 194-258): destructuring of typed values supports both positional
// and named forms with permissive selection and strict existence.
//
// Codegen detects when the destructure source is a typed value and reads
// fields by name on the tagged object (`p.x`) instead of going through
// the generic-Object unpacker (`p.positional[i]`). Validation in
// src/validate.js rejects over-arity and undeclared-field references.

describe('shape destructure — positional', () => {
  it('(x, y) = p — paren positional pulls all fields', async () => {
    await expectBehavior(`
      ::Point = (x Integer, y Integer)
      @go = {
        p = Point(1, 2)
        (x, y) = p
        -> rx: x, ry: y
      }
    `,
      { input: { id: '1', op: '@go', from: 'c' } },
      { output: { id: '1', 'bv-a': { rx: 'Integer', ry: 'Integer' }, re: { rx: 1, ry: 2 }, to: 'c' } },
    );
  });

  it('x, y = p — bare positional (no parens) pulls all fields', async () => {
    await expectBehavior(`
      ::Point = (x Integer, y Integer)
      @go = {
        p = Point(1, 2)
        x, y = p
        -> rx: x, ry: y
      }
    `,
      { input: { id: '2', op: '@go', from: 'c' } },
      { output: { id: '2', 'bv-a': { rx: 'Integer', ry: 'Integer' }, re: { rx: 1, ry: 2 }, to: 'c' } },
    );
  });

  it('(x) = p — single positional drops trailing fields', async () => {
    await expectBehavior(`
      ::Point = (x Integer, y Integer)
      @go = {
        p = Point(7, 8)
        (x) = p
        -> rx: x
      }
    `,
      { input: { id: '3', op: '@go', from: 'c' } },
      { output: { id: '3', 'bv-a': { rx: 'Integer' }, re: { rx: 7 }, to: 'c' } },
    );
  });

  it('(a, b) = p — locals named freely (renamed positions)', async () => {
    await expectBehavior(`
      ::Point = (x Integer, y Integer)
      @go = {
        p = Point(1, 2)
        (a, b) = p
        -> ra: a, rb: b
      }
    `,
      { input: { id: '4', op: '@go', from: 'c' } },
      { output: { id: '4', 'bv-a': { ra: 'Integer', rb: 'Integer' }, re: { ra: 1, rb: 2 }, to: 'c' } },
    );
  });

  it('rejects positional destructure with more locals than fields', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      @go = {
        p = Point(1, 2)
        x, y, z = p
        -> result: 1
      }
    `)).toThrow();
  });
});

describe('shape destructure — named', () => {
  it(':x, :y = p — full named destructure', async () => {
    await expectBehavior(`
      ::Point = (x Integer, y Integer)
      @go = {
        p = Point(1, 2)
        :x, :y = p
        -> rx: x, ry: y
      }
    `,
      { input: { id: '5', op: '@go', from: 'c' } },
      { output: { id: '5', 'bv-a': { rx: 'Integer', ry: 'Integer' }, re: { rx: 1, ry: 2 }, to: 'c' } },
    );
  });

  it(':x = p — selective single-field destructure', async () => {
    await expectBehavior(`
      ::Point = (x Integer, y Integer)
      @go = {
        p = Point(7, 8)
        :x = p
        -> rx: x
      }
    `,
      { input: { id: '6', op: '@go', from: 'c' } },
      { output: { id: '6', 'bv-a': { rx: 'Integer' }, re: { rx: 7 }, to: 'c' } },
    );
  });

  it('x: alias_x = p — rename on extraction', async () => {
    await expectBehavior(`
      ::Point = (x Integer, y Integer)
      @go = {
        p = Point(7, 8)
        x: alias_x = p
        -> rx: alias_x
      }
    `,
      { input: { id: '7', op: '@go', from: 'c' } },
      { output: { id: '7', 'bv-a': { rx: 'Integer' }, re: { rx: 7 }, to: 'c' } },
    );
  });

  it(':y, :x = p — order-insensitive', async () => {
    await expectBehavior(`
      ::Point = (x Integer, y Integer)
      @go = {
        p = Point(1, 2)
        :y, :x = p
        -> rx: x, ry: y
      }
    `,
      { input: { id: '8', op: '@go', from: 'c' } },
      { output: { id: '8', 'bv-a': { rx: 'Integer', ry: 'Integer' }, re: { rx: 1, ry: 2 }, to: 'c' } },
    );
  });

  it('rejects named destructure of an undeclared field', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      @go = {
        p = Point(1, 2)
        :z = p
        -> result: 1
      }
    `)).toThrow();
  });
});

describe('shape destructure — mixed-form types', () => {
  it('positional-declared fields are reachable by named destructure', async () => {
    // From spec lines 244-257: field-name identity is what matters at the
    // destructure boundary. A type declared positionally (`x Integer`) is
    // still named-destructurable as `:x`.
    await expectBehavior(`
      ::Point = (x Integer, y Integer)
      @go = {
        p = Point(1, 2)
        :x, :y = p
        -> rx: x, ry: y
      }
    `,
      { input: { id: '9', op: '@go', from: 'c' } },
      { output: { id: '9', 'bv-a': { rx: 'Integer', ry: 'Integer' }, re: { rx: 1, ry: 2 }, to: 'c' } },
    );
  });

  it('named-declared fields are reachable by named destructure', async () => {
    // The reverse of the above: a type declared with the named-field form
    // (`x: Integer`) is named-destructurable. Field-name identity is the
    // contract; declaration form is implementation detail.
    await expectBehavior(`
      ::Pair = (x: Integer, y: Integer)
      @go = {
        p = Pair(1, 2)
        :x, :y = p
        -> rx: x, ry: y
      }
    `,
      { input: { id: '10', op: '@go', from: 'c' } },
      { output: { id: '10', 'bv-a': { rx: 'Integer', ry: 'Integer' }, re: { rx: 1, ry: 2 }, to: 'c' } },
    );
  });

  it('named-declared fields are reachable by positional destructure', async () => {
    // Spec line 203: "Pulls field values by position." — applies regardless
    // of declaration form. Declaration order is the position.
    await expectBehavior(`
      ::Pair = (x: Integer, y: Integer)
      @go = {
        p = Pair(1, 2)
        (a, b) = p
        -> ra: a, rb: b
      }
    `,
      { input: { id: '11', op: '@go', from: 'c' } },
      { output: { id: '11', 'bv-a': { ra: 'Integer', rb: 'Integer' }, re: { ra: 1, rb: 2 }, to: 'c' } },
    );
  });

  it('mixed positional/named declaration: both forms reach both fields', async () => {
    // ::Mixed has one positional-declared field and one named-declared field.
    // Field-name identity dominates: each can be reached either way.
    await expectBehavior(`
      ::Mixed = (count Integer, label: Text)
      @go = {
        m = Mixed(3, "hi")
        :count, :label = m
        -> rc: count, rl: label
      }
    `,
      { input: { id: '12', op: '@go', from: 'c' } },
      { output: { id: '12', 'bv-a': { rc: 'Integer', rl: 'Text' }, re: { rc: 3, rl: 'hi' }, to: 'c' } },
    );
  });
});

describe('shape destructure — optional fields', () => {
  it('optional field present: destructures to its value', async () => {
    // Required-field destructure propagates the field type to the local.
    // Optional fields deliberately do NOT propagate — the local stays
    // polymorphic so `??` and `(expr)?` can still see absence. A caller
    // who wants to use the value as a typed value supplies an explicit
    // `as` cast (or an annotation on the destructure pattern).
    await expectBehavior(`
      ::Game = (? started Boolean, ? turn: Integer)
      @go = {
        g = Game(true, 5)
        :turn = g
        -> rt: turn as Integer
      }
    `,
      { input: { id: '13', op: '@go', from: 'c' } },
      { output: { id: '13', 'bv-a': { rt: 'Integer' }, re: { rt: 5 }, to: 'c' } },
    );
  });

  it('optional field absent: destructure with ?? fallback yields the fallback', async () => {
    // Mirrors shape_optionality's `?? falls back when omitted` but applied
    // after destructuring a typed value.
    await expectBehavior(`
      ::Game = (? started Boolean, ? turn: Integer)
      @go = {
        g = Game(true)
        :turn = g
        -> rt: (turn ?? 99)
      }
    `,
      { input: { id: '14', op: '@go', from: 'c' } },
      { output: { id: '14', 'bv-a': { rt: 'Integer' }, re: { rt: 99 }, to: 'c' } },
    );
  });

  it('optional field absent: presence check on destructured local is false', async () => {
    await expectBehavior(`
      ::Game = (? started Boolean, ? turn: Integer)
      @go = {
        g = Game(true)
        :turn = g
        -> rp: (turn)?
      }
    `,
      { input: { id: '15', op: '@go', from: 'c' } },
      { output: { id: '15', 'bv-a': { rp: 'Boolean' }, re: { rp: false }, to: 'c' } },
    );
  });
});
