import { extract } from '../../index.js';
import { compileSource } from '../helpers.js';

// Slice 1 of types-implementation-plan-2026-04-27.md: parser support for
// inline `::Name = (positional fields)` declarations. Multi-line, lineal,
// named, and optional field forms land in later slices.

describe('shape declaration — parser', () => {
  it('parses ::Point = (x Integer, y Integer)', () => {
    const { ast } = extract('::Point = (x Integer, y Integer)\n');
    expect(ast.types).toEqual([
      {
        type: 'TypeDecl',
        name: 'Point',
        fields: [
          { type: 'TypeField', name: 'x', paramType: 'Integer' },
          { type: 'TypeField', name: 'y', paramType: 'Integer' },
        ],
      },
    ]);
    expect(ast.actors).toEqual([]);
  });

  it('parses multiple type declarations in one file', () => {
    const { ast } = extract(`
      ::Point = (x Integer, y Integer)
      ::Pair = (a Integer, b Integer)
    `);
    expect(ast.types.map(t => t.name)).toEqual(['Point', 'Pair']);
  });

  it('coexists with an actor body in the same file', () => {
    const { ast } = extract(`
      ::Point = (x Integer, y Integer)

      @ping = -> ok: 1 as Integer
    `);
    expect(ast.types).toHaveLength(1);
    expect(ast.types[0].name).toBe('Point');
    expect(ast.actors).toHaveLength(1);
    expect(ast.actors[0].functions.some(f => f.name === '@ping')).toBe(true);
  });

  it('captures field name and declared type per field', () => {
    const { ast } = extract('::Mixed = (count Integer, label Text, ok Boolean)\n');
    const [decl] = ast.types;
    expect(decl.fields).toEqual([
      { type: 'TypeField', name: 'count', paramType: 'Integer' },
      { type: 'TypeField', name: 'label', paramType: 'Text' },
      { type: 'TypeField', name: 'ok',    paramType: 'Boolean' },
    ]);
  });
});

// Slice 2: each declared type has a canonical home in its file. Validation
// enforces uppercase naming, no duplicate type names, no duplicate fields.

describe('shape declaration — registry validation', () => {
  it('accepts a well-formed declaration alongside an actor', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      @ping = -> result: 1 as Integer
    `)).not.toThrow();
  });

  it('rejects a lowercase type name', () => {
    expect(() => compileSource('::point = (x Integer)\n@ping = -> ok: 1 as Integer\n'))
      .toThrow(/uppercase letter.*::point/);
  });

  it('rejects two declarations of the same type name', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      ::Point = (a Integer, b Integer)
      @ping = -> ok: 1 as Integer
    `)).toThrow(/Duplicate type declaration.*::Point/);
  });

  it('rejects duplicate field names within a type', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, x Integer)
      @ping = -> ok: 1 as Integer
    `)).toThrow(/Duplicate field 'x' in '::Point'/);
  });
});

// Slice 3: a call whose callee identifier matches a declared type rewrites
// to a TypeConstruction node carrying the type tag and its positional args.
// Validation enforces arg count vs the type's declared field count.

describe('shape construction — Name(args)', () => {
  it('rewrites Point(1, 2) into a TypeConstruction node', () => {
    const { ast } = extract(`
      ::Point = (x Integer, y Integer)

      @use_point = {
        p = Point(3, 4)
        -> result: 1 as Integer
      }
    `);
    const fn = ast.actors[0].functions.find(f => f.name === '@use_point');
    const assign = fn.body.find(s => s.type === 'Assign' && s.name === 'p');
    expect(assign.value.type).toBe('TypeConstruction');
    expect(assign.value.typeName).toBe('Point');
    expect(assign.value.args).toHaveLength(2);
    expect(assign.value.args[0].type).toBe('IntLiteral');
    expect(assign.value.args[1].type).toBe('IntLiteral');
  });

  it('does not rewrite a call to an undeclared name', () => {
    const { ast } = extract(`
      ::Point = (x Integer, y Integer)

      @go = {
        p = Other(3, 4)
        -> result: 1 as Integer
      }
    `);
    const fn = ast.actors[0].functions.find(f => f.name === '@go');
    const assign = fn.body.find(s => s.type === 'Assign' && s.name === 'p');
    expect(assign.value.type).toBe('FunctionCallExpr');
  });

  it('rejects too few arguments', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      @go = {
        p = Point(1)
        -> result: 1 as Integer
      }
    `)).toThrow(/Type construction 'Point\(\.\.\.\)' expects 2 arguments, got 1/);
  });

  it('rejects too many arguments', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      @go = {
        p = Point(1, 2, 3)
        -> result: 1 as Integer
      }
    `)).toThrow(/Type construction 'Point\(\.\.\.\)' expects 2 arguments, got 3/);
  });

  it('compiles a construction without requiring a type annotation on the local', () => {
    expect(() => compileSource(`
      ::Point = (x Integer, y Integer)
      @go = {
        p = Point(1, 2)
        -> result: 1 as Integer
      }
    `)).not.toThrow();
  });

  it('emits a tagged structure carrying the declared field names', () => {
    const { output } = compileSource(`
      ::Point = (x Integer, y Integer)
      @go = {
        p = Point(7, 8)
        -> result: 1 as Integer
      }
    `);
    expect(output).toMatch(/__type:\s*"Point"/);
    expect(output).toMatch(/"x":\s*7n/);
    expect(output).toMatch(/"y":\s*8n/);
  });
});
