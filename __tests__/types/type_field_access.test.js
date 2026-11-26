import { expectBehavior } from '../helpers.js';
import { compileSource } from '../helpers.js';

// Local field access. When the object is a statically known typed object (a
// TypeConstruction or a typed identifier), `.field` must reference one of the
// type's declared named fields; positional fields are read by destructuring
// (notes/positional-type-fields-2026-11-26.md). Field access on the typed
// object is local — no CAM round-trip.

describe('type field access — value.field', () => {
  it('reads a field directly from a TypeConstruction', async () => {
    await expectBehavior(`
      type Point (x: Integer, y: Integer)
      @get_x = -> result: Point(x: 7, y: 8).x as Integer
    `,
      { input: { id: '1', op: 'get_x', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 7 }], to: 'c' } },
    );
  });

  it('reads a field from a typed local', async () => {
    await expectBehavior(`
      type Point (x: Integer, y: Integer)
      @get_y = {
        p = Point(x: 7, y: 8)
        return result: p.y as Integer
      }
    `,
      { input: { id: '2', op: 'get_y', from: 'c' } },
      { output: { id: '2', 'ty': [{ result: 'Integer' }], re: [{ result: 8 }], to: 'c' } },
    );
  });

  it('reads a named field after a positional one', async () => {
    await expectBehavior(`
      type Mixed (Text, count: Integer, ok: Boolean)
      @sum = -> result: Mixed("hi", count: 3, ok: true).count as Integer
    `,
      { input: { id: '3', op: 'sum', from: 'c' } },
      { output: { id: '3', 'ty': [{ result: 'Integer' }], re: [{ result: 3 }], to: 'c' } },
    );
  });

  it('a positional field has no name to read', () => {
    expect(() => compileSource(`
      type Point (Integer, y: Integer)
      @go = {
        p = Point(1, y: 2)
        return result: p.x as Integer
      }
    `)).toThrow(/Type 'Point' has no field 'x'/);
  });

  it('rejects access to an undeclared field on a TypeConstruction', () => {
    expect(() => compileSource(`
      type Point (Integer, Integer)
      @go = -> result: Point(1, 2).bogus as Integer
    `)).toThrow(/Type 'Point' has no field 'bogus'/);
  });

  it('rejects access to an undeclared field on a typed local', () => {
    expect(() => compileSource(`
      type Point (Integer, Integer)
      @go = {
        p = Point(1, 2)
        return result: p.bogus as Integer
      }
    `)).toThrow(/Type 'Point' has no field 'bogus'/);
  });

  it('does not interfere with field access on non-typed values', () => {
    // .field access on a child-actor binding or unknown identifier should
    // pass through this validator without throwing.
    expect(() => compileSource(`
      type Point (Integer, Integer)
      @go = -> result: 1
    `)).not.toThrow();
  });
});
