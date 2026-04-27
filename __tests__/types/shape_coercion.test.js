import { extract } from '../../index.js';
import { expectBehavior, compileSource } from '../helpers.js';

// Slice 9 of types-implementation-plan-2026-04-27: tuple→Type coercion at
// typed assignment. `p Point = 1, 2` produces the same value as
// `p Point = Point(1, 2)`. The coercion fires when the LHS type is a
// declared `::Name` and the RHS is a positional Structure.

describe('shape coercion — typed assignment', () => {
  it('rewrites a positional Structure RHS to a TypeConstruction', () => {
    const { ast } = extract(`
      ::Point = (x Integer, y Integer)
      @go = {
        p Point = 1, 2
        -> result: p.x as Integer
      }
    `);
    const fn = ast.actors[0].functions.find(f => f.name === '@go');
    const decl = fn.body.find(s => s.type === 'TypedAssign');
    expect(decl.value.type).toBe('TypeConstruction');
    expect(decl.value.typeName).toBe('Point');
  });

  it('runs end-to-end with field access on the coerced value', async () => {
    await expectBehavior(`
      ::Point = (x Integer, y Integer)
      @go = {
        p Point = 1, 2
        -> result: p.x as Integer
      }
    `,
      { input: { id: '1', op: '@go', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 1 }, to: 'c' } },
    );
  });

  it('explicit construction still works alongside coercion', async () => {
    await expectBehavior(`
      ::Point = (x Integer, y Integer)
      @go = {
        p Point = Point(1, 2)
        -> result: p.y as Integer
      }
    `,
      { input: { id: '1', op: '@go', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 2 }, to: 'c' } },
    );
  });

  it('rejects coercion when arg count does not match field count', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      @go = {
        p Point = 1, 2, 3
        -> result: 1 as Integer
      }
    `)).toThrow();
  });
});
