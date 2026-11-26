import { extract } from '../../index.js';
import { compileSource } from '../helpers.js';

// Parser support for `type Name (fields)` declarations. A positional field is
// a bare type, keyed by its index among the positional fields; a named field
// is `name: Type` (notes/positional-type-fields-2026-11-26.md).

describe('type declaration — parser', () => {
  it('parses type Point (Integer, Integer)', () => {
    const { ast } = extract('type Point (Integer, Integer)\n');
    expect(ast.types).toEqual([
      {
        type: 'TypeDecl',
        name: 'Point',
        fields: [
          { type: 'TypeField', name: '0', paramTypeEnc: 'Integer' },
          { type: 'TypeField', name: '1', paramTypeEnc: 'Integer' },
        ],
      },
    ]);
    expect(ast.actors).toEqual([]);
  });

  it('parses multiple type declarations in one file', () => {
    const { ast } = extract(`
      type Point (Integer, Integer)
      type Pair (Integer, Integer)
    `);
    expect(ast.types.map(t => t.name)).toEqual(['Point', 'Pair']);
  });

  it('coexists with an actor body in the same file', () => {
    const { ast } = extract(`
      type Point (Integer, Integer)

      @ping = -> ok: 1
    `);
    expect(ast.types).toHaveLength(1);
    expect(ast.types[0].name).toBe('Point');
    expect(ast.actors).toHaveLength(1);
    expect(ast.actors[0].functions.some(f => f.name === '@ping')).toBe(true);
  });

  it('captures each field\'s key and declared type, positional fields first', () => {
    const { ast } = extract('type Mixed (Integer, Text, ok: Boolean)\n');
    const [decl] = ast.types;
    expect(decl.fields).toEqual([
      { type: 'TypeField', name: '0', paramTypeEnc: 'Integer' },
      { type: 'TypeField', name: '1', paramTypeEnc: 'Text' },
      { type: 'TypeField', name: 'ok', paramTypeEnc: 'Boolean', named: true },
    ]);
  });

  it('a positional field after a named one is a parse error', () => {
    expect(() => extract('type Mixed (ok: Boolean, Integer)\n'))
      .toThrow('A positional field follows a named one: positional fields come first (line 1)');
  });

  it('a required positional field after an optional one is a parse error', () => {
    expect(() => extract('type T (? Boolean, Integer)\n'))
      .toThrow('A required positional field follows an optional one (line 1)');
  });

  it('a field name without its colon is a parse error', () => {
    expect(() => extract('type Point (x Integer)\n@go = -> 1\n')).toThrow();
  });

  it('lineal: the fields start on the line below the name', () => {
    expect(extract('type Point\n  Integer\n  y: Integer\n\n@go = -> 1\n').ast.types[0].fields.map(f => f.name)).toEqual(['0', 'y']);
    expect(() => extract('type Point  Integer\n  Integer\n\n@go = -> 1\n'))
      .toThrow("'type Point': its fields go on the lines below it, or in parens: 'type Point (…)' (line 1)");
  });
});

// Slice 2: each declared type has a canonical home in its file. Validation
// enforces uppercase naming, no duplicate type names, no duplicate fields.

describe('type declaration — registry validation', () => {
  it('accepts a well-formed declaration alongside an actor', () => {
    expect(() => compileSource(`
      type Point (Integer, Integer)
      @ping = -> result: 1
    `)).not.toThrow();
  });

  it('accepts a lowercase type name — capitalization is convention', () => {
    expect(() => compileSource('type point (Integer)\n@ping = -> ok: 1\n')).not.toThrow();
  });

  it('rejects two declarations of the same type name', () => {
    expect(() => compileSource(`
      type Point (Integer, Integer)
      type Point (Integer, Integer)
      @ping = -> ok: 1
    `)).toThrow(/Duplicate type declaration: 'Point'/);
  });

  it('rejects duplicate field names within a type', () => {
    expect(() => compileSource(`
      type Point (x: Integer, x: Integer)
      @ping = -> ok: 1
    `)).toThrow(/Duplicate field 'x' in 'Point'/);
  });
});

// Slice 3: a call whose callee identifier matches a declared type rewrites
// to a TypeConstruction node carrying the type tag and its positional args.
// Validation enforces arg count vs the type's declared field count.

describe('type construction — Name(args)', () => {
  it('rewrites Point(1, 2) into a TypeConstruction node', () => {
    const { ast } = extract(`
      type Point (Integer, Integer)

      @use_point = {
        p = Point(3, 4)
        return result: 1
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
      type Point (Integer, Integer)

      @go = {
        p = Other(3, 4)
        return result: 1
      }
    `);
    const fn = ast.actors[0].functions.find(f => f.name === '@go');
    const assign = fn.body.find(s => s.type === 'Assign' && s.name === 'p');
    expect(assign.value.type).toBe('FunctionCallExpr');
  });

  it('rejects too few arguments', () => {
    expect(() => compileSource(`
      type Point (Integer, Integer)
      @go = {
        p = Point(1)
        return result: 1
      }
    `)).toThrow(/Type construction 'Point\(\.\.\.\)' expects 2 positional arguments, got 1/);
  });

  it('rejects too many arguments', () => {
    expect(() => compileSource(`
      type Point (Integer, Integer)
      @go = {
        p = Point(1, 2, 3)
        return result: 1
      }
    `)).toThrow(/Type construction 'Point\(\.\.\.\)' expects 2 positional arguments, got 3/);
  });

  it('compiles a construction without requiring a type annotation on the local', () => {
    expect(() => compileSource(`
      type Point (Integer, Integer)
      @go = {
        p = Point(1, 2)
        return result: 1
      }
    `)).not.toThrow();
  });

  it('emits a tagged object carrying the field keys', () => {
    const { output } = compileSource(`
      type Point (Integer, y: Integer)
      @go = {
        p = Point(7, y: 8)
        return result: 1
      }
    `);
    expect(output).toMatch(/__type:\s*":Point"/);
    expect(output).toMatch(/"0":\s*7n/);
    expect(output).toMatch(/"y":\s*8n/);
  });
});
