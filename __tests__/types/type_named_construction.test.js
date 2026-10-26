import { extract } from '../../index.js';
import { expectBehavior, compileSource } from '../helpers.js';

// Named / mixed attribute construction. A type's fields can be filled at the
// construction site positionally, by name, or with a mixture of both:
//
//   ::Point = (x Integer, y Integer)
//   Point(1, 2)          — positional
//   Point(x: 1, y: 2)    — named (order-independent)
//   Point(1, y: 2)       — mixed
//
// Each field may be supplied one way or the other, never both. Named filling
// works for required fields, for several fields at once, and interoperates
// with optional (`?`) fields. (Before this slice, named construction only
// slipped through validation when at most one field was named and the field
// count happened to match — see validate.js checkTypeConstructions.)

// ─────────────────────────────────────────────────────────────────────────────
// Parser: how named / mixed args land in the TypeConstruction node
// ─────────────────────────────────────────────────────────────────────────────

describe('named construction — parser', () => {
  const firstConstruction = (ast) => {
    let found = null;
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (n.type === 'TypeConstruction') found ??= n;
      for (const k of Object.keys(n)) if (k !== 'type') walk(n[k]);
    };
    walk(ast);
    return found;
  };

  it('all-named args collect into a single trailing NamedArgsBag', () => {
    const { ast } = extract(`
      ::Point = (x Integer, y Integer)
      @go = { p = Point(x: 1, y: 2)
        -> r: 1 }
    `);
    const c = firstConstruction(ast);
    expect(c.typeName).toBe('Point');
    const bag = c.args.find(a => a.type === 'NamedArgsBag');
    expect(bag).toBeTruthy();
    expect(Object.keys(bag.fields)).toEqual(['x', 'y']);
    expect(c.args.filter(a => a.type !== 'NamedArgsBag')).toHaveLength(0);
  });

  it('mixed args keep positional expressions ahead of the NamedArgsBag', () => {
    const { ast } = extract(`
      ::Point = (x Integer, y Integer)
      @go = { p = Point(1, y: 2)
        -> r: 1 }
    `);
    const c = firstConstruction(ast);
    const positional = c.args.filter(a => a.type !== 'NamedArgsBag');
    const bag = c.args.find(a => a.type === 'NamedArgsBag');
    expect(positional).toHaveLength(1);
    expect(positional[0].type).toBe('IntLiteral');
    expect(Object.keys(bag.fields)).toEqual(['y']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Compile acceptance: named / mixed / optional forms that must be legal
// ─────────────────────────────────────────────────────────────────────────────

describe('named construction — accepted forms', () => {
  it('all required fields by name', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      @go = { p = Point(x: 1, y: 2)
        -> result: 1 }
    `)).not.toThrow();
  });

  it('named fields in a different order than declared', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      @go = { p = Point(y: 2, x: 1)
        -> result: 1 }
    `)).not.toThrow();
  });

  it('mixed: leading positional, trailing named', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      @go = { p = Point(1, y: 2)
        -> result: 1 }
    `)).not.toThrow();
  });

  it('three required fields, all named', () => {
    expect(() => compileSource(`
      ::Vec3 = (x Integer, y Integer, z Integer)
      @go = { p = Vec3(z: 3, x: 1, y: 2)
        -> result: 1 }
    `)).not.toThrow();
  });

  it('mixed with more than one named field', () => {
    expect(() => compileSource(`
      ::Vec3 = (x Integer, y Integer, z Integer)
      @go = { p = Vec3(1, z: 3, y: 2)
        -> result: 1 }
    `)).not.toThrow();
  });

  it('named fills a required field and omits a trailing optional', () => {
    expect(() => compileSource(`
      ::User = (id Text, ? nickname: Text)
      @go = { u = User(id: "a")
        -> result: 1 }
    `)).not.toThrow();
  });

  it('named fills both a required and an optional field', () => {
    expect(() => compileSource(`
      ::User = (id Text, ? nickname: Text)
      @go = { u = User(id: "a", nickname: "ace")
        -> result: 1 }
    `)).not.toThrow();
  });

  it('named can supply an optional while skipping another optional', () => {
    expect(() => compileSource(`
      ::Opts = (? a: Integer, ? b: Integer)
      @go = { o = Opts(b: 2)
        -> result: 1 }
    `)).not.toThrow();
  });

  it('all-optional type constructed with every field named', () => {
    expect(() => compileSource(`
      ::Opts = (? a: Integer, ? b: Integer)
      @go = { o = Opts(a: 1, b: 2)
        -> result: 1 }
    `)).not.toThrow();
  });

  // The exact boundary the old validator mis-handled: a single required field
  // named counted as one arg, so it was accepted (for 1 field) or rejected
  // (for more). Pin down that a lone required field by name is legal.
  it('single required field, supplied by name', () => {
    expect(() => compileSource(`
      ::Id = (v Integer)
      @go = { i = Id(v: 7)
        -> result: 1 }
    `)).not.toThrow();
  });

  it('a nested construction may fill a named field', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      ::Line = (a: Point, b: Point)
      @go = { l = Line(a: Point(x: 1, y: 2), b: Point(x: 3, y: 4))
        -> result: 1 }
    `)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Compile rejection: malformed named / mixed constructions
// ─────────────────────────────────────────────────────────────────────────────

describe('named construction — rejected forms', () => {
  it('rejects a named key that is not a declared field', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      @go = { p = Point(x: 1, z: 2)
        -> result: 1 }
    `)).toThrow(/has no field named 'z'/);
  });

  it('rejects a field supplied both positionally and by name', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      @go = { p = Point(1, x: 9)
        -> result: 1 }
    `)).toThrow(/supplies field 'x' both positionally and by name/);
  });

  it('rejects a missing required field under named construction', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      @go = { p = Point(x: 1)
        -> result: 1 }
    `)).toThrow(/missing required field 'y'/);
  });

  it('rejects more than one missing required field, naming both', () => {
    expect(() => compileSource(`
      ::Vec3 = (x Integer, y Integer, z Integer)
      @go = { p = Vec3(x: 1)
        -> result: 1 }
    `)).toThrow(/missing required fields 'y', 'z'/);
  });

  it('rejects too many positional args when a named arg is also present', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      @go = { p = Point(1, 2, 3, x: 9)
        -> result: 1 }
    `)).toThrow(/at most 2 positional arguments, got 3/);
  });

  it('rejects a required field left unfilled by a mix of pos + named', () => {
    expect(() => compileSource(`
      ::Vec3 = (x Integer, y Integer, z Integer)
      @go = { p = Vec3(1, z: 3)
        -> result: 1 }
    `)).toThrow(/missing required field 'y'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Runtime: values land in the field named, not the slot they were written in
//
// One shared fixture program carries all runtime cases — a handler per
// assertion, selected by `op`. Identical source across the `it`s means the
// harness compiles (and, on the Rust target, builds) it once for the whole
// block rather than once per test.
// ─────────────────────────────────────────────────────────────────────────────

describe('named construction — runtime field placement', () => {
  const fixture = `
    ::Point = (x Integer, y Integer)
    ::Vec3 = (x Integer, y Integer, z Integer)
    ::User = (id Integer, ? nickname: Integer)
    ::Person = (name Text, age Integer)

    @allNamed = -> result: (Point(x: 10, y: 20).x)

    @allNamedReversed = -> result: (Point(y: 20, x: 10).x)

    @mixedNamedField = -> result: (Point(3, y: 4).y)

    @mixedPositionalField = -> result: (Point(3, y: 4).x)

    @threeNamed = -> result: (Vec3(z: 3, x: 1, y: 2).z)

    @optOmitted = -> result: (User(id: 7).nickname ?? 99)

    @optSupplied = -> result: (User(id: 7, nickname: 42).nickname ?? 99)

    @computedNamed = {
      a = 5 as Integer
      p = Point(y: a * 2, x: a + 1)
      -> result: p.y
    }

    @textNamed = -> result: (Person(age: 30, name: "ann").name)
  `;

  const expectOp = (op, re, bvA) => expectBehavior(
    fixture,
    { input: { id: '1', op, from: 'c' } },
    { output: { id: '1', ...(bvA ? { 'bv-a': { result: bvA } } : {}), re: { result: re }, to: 'c' } },
  );

  it('all-named, declared order → fields carry their values', async () => {
    await expectOp('@allNamed', 10);
  });

  it('all-named, reversed order → values follow the name, not the slot', async () => {
    await expectOp('@allNamedReversed', 10);
  });

  it('mixed: positional x, named y → the named field reads back correctly', async () => {
    await expectOp('@mixedNamedField', 4);
  });

  it('mixed: the positional field reads back its own value', async () => {
    await expectOp('@mixedPositionalField', 3);
  });

  it('three named fields out of order each land correctly', async () => {
    await expectOp('@threeNamed', 3);
  });

  it('named required field + omitted optional → optional falls back', async () => {
    await expectOp('@optOmitted', 99, 'Integer');
  });

  it('named required field + supplied optional → optional reads its value', async () => {
    await expectOp('@optSupplied', 42, 'Integer');
  });

  it('a named arg may be a computed expression, not just a literal', async () => {
    await expectOp('@computedNamed', 10);
  });

  it('a non-Integer named field reads back its value', async () => {
    await expectOp('@textNamed', 'ann');
  });
});
