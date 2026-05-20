import { expectBehavior } from '../helpers.js';
import { compileSource } from '../helpers.js';

// Slice 5 of types-implementation-plan-2026-04-27: local field access. When
// the object is a statically known typed object (a TypeConstruction or a
// typed identifier), `.field` must reference one of the type's declared
// fields. Field access on the typed object is local — no CAM round-trip.

describe('shape field access — value.field', () => {
  it('reads a field directly from a TypeConstruction', async () => {
    await expectBehavior(`
      ::Point = (x Integer, y Integer)
      @get_x = -> result: Point(7, 8).x as Integer
    `,
      { input: { id: '1', op: '@get_x', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('reads a field from a typed local', async () => {
    await expectBehavior(`
      ::Point = (x Integer, y Integer)
      @get_y = {
        p = Point(7, 8)
        -> result: p.y as Integer
      }
    `,
      { input: { id: '2', op: '@get_y', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 8 }, to: 'c' } },
    );
  });

  it('reads each field of a multi-field type', async () => {
    await expectBehavior(`
      ::Mixed = (count Integer, label Text, ok Boolean)
      @sum = -> result: Mixed(3, "hi", true).count as Integer
    `,
      { input: { id: '3', op: '@sum', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } },
    );
  });

  it('rejects access to an undeclared field on a TypeConstruction', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      @go = -> result: Point(1, 2).bogus as Integer
    `)).toThrow(/Type '::Point' has no field 'bogus'/);
  });

  it('rejects access to an undeclared field on a typed local', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      @go = {
        p = Point(1, 2)
        -> result: p.bogus as Integer
      }
    `)).toThrow(/Type '::Point' has no field 'bogus'/);
  });

  it('does not interfere with field access on non-typed values', () => {
    // .field access on a child-actor binding or unknown identifier should
    // pass through this validator without throwing.
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      @go = -> result: 1
    `)).not.toThrow();
  });
});
