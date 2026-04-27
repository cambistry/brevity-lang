import { extract, compile } from '../../index.js';
import { parseInterface } from '../../src/codegen/javascript/types.js';

// Slice 15 of types-implementation-plan-2026-04-27: import binding plumbing
// for type imports. Reuses the destructure grammar — `(:Point)` and
// `(Point: P)` — and routes via the source service's `__typeDecls`.
// Aliases are source-local; the wire tag stays canonical.

const remoteIface = extract(`
  ::Point = (x Integer, y Integer)
  ::Pair = (a Integer, b Integer)
  @get_origin = -> coords: Point(0, 0) as Point
`).interface.service;

describe('shape imports — interface parser captures `::Name = (...)`', () => {
  it('parses a single typedecl into __typeDecls', () => {
    const parsed = parseInterface('{ ::Point = (x Integer, y Integer) }');
    expect(parsed.__typeDecls).toEqual({
      Point: {
        fields: [
          { type: 'TypeField', name: 'x', paramType: 'Integer' },
          { type: 'TypeField', name: 'y', paramType: 'Integer' },
        ],
      },
    });
  });

  it('parses optional/named field forms', () => {
    const parsed = parseInterface(`{
      ::Game = (
        ? started Boolean,
        ? turn: Integer,
        ? players: List of Texts
      )
    }`);
    expect(parsed.__typeDecls.Game.fields).toEqual([
      { type: 'TypeField', name: 'started', paramType: 'Boolean', optional: true },
      { type: 'TypeField', name: 'turn', paramType: 'Integer', optional: true, named: true },
      { type: 'TypeField', name: 'players', paramType: 'List of Texts', optional: true, named: true },
    ]);
  });

  it('parses the empty type', () => {
    const parsed = parseInterface('{ ::Empty = () }');
    expect(parsed.__typeDecls.Empty).toEqual({ fields: [] });
  });

  it('keeps method entries alongside typedecls', () => {
    const parsed = parseInterface(`{
      ::Point = (x Integer, y Integer)
      get_origin: () -> (coords: Point)
    }`);
    expect(Object.keys(parsed.__typeDecls)).toEqual(['Point']);
    expect(parsed.get_origin).toBeDefined();
  });
});

describe('shape imports — destructured type binding', () => {
  it('imports a type via :sigil destructure and constructs locally', () => {
    const { ast } = extract(`
      < "geometry.bv": (:Point) >
      =
      @origin = -> p: Point(0, 0) as Point
    `);
    expect(() => compile(ast, { remotes: [{ path: 'geometry.bv', service: remoteIface }] })).not.toThrow();
    expect(ast.importedTypes?.Point).toMatchObject({ remote: 'Point', sourceAlias: 'geometry.bv' });
  });

  it('aliased import: P(0, 0) becomes a TypeConstruction with canonical name Point', () => {
    const { ast } = extract(`
      < "geometry.bv": (Point: P) >
      =
      @origin = -> p: P(0, 0) as P
    `);
    compile(ast, { remotes: [{ path: 'geometry.bv', service: remoteIface }] });
    expect(ast.importedTypes?.P?.remote).toBe('Point');
    const fn = ast.actors[0].functions.find(f => f.name === '@origin');
    const reply = fn.body.find(s => s.type === 'Reply');
    expect(reply.fields[0].value).toMatchObject({ type: 'TypeConstruction', typeName: 'Point' });
  });

  it('rejects local type colliding with destructured type name', () => {
    const { ast } = extract(`
      < "geometry.bv": (:Point) >
      =
      ::Point = (x Integer, y Integer)
      @noop = -> ok: 1 as Integer
    `);
    expect(() => compile(ast, { remotes: [{ path: 'geometry.bv', service: remoteIface }] }))
      .toThrow(/collides with local '::Point'/);
  });

  it('multiple imports in one destructure list bind together', () => {
    const { ast } = extract(`
      < "geometry.bv": (:Point, :Pair) >
      =
      @make = -> p: Point(0, 0) as Point
      @make2 = -> q: Pair(1, 2) as Pair
    `);
    compile(ast, { remotes: [{ path: 'geometry.bv', service: remoteIface }] });
    expect(Object.keys(ast.importedTypes).sort()).toEqual(['Pair', 'Point']);
  });

  it('imported type construction validates against remote field count', () => {
    const { ast } = extract(`
      < "geometry.bv": (:Point) >
      =
      @bad = -> p: Point(0) as Point
    `);
    expect(() => compile(ast, { remotes: [{ path: 'geometry.bv', service: remoteIface }] }))
      .toThrow(/expects 2 arguments, got 1/);
  });
});

describe('shape imports — cross-module type refs (Service::Name)', () => {
  it('accepts Geom::Point in a field annotation when Geom exports Point', () => {
    const { ast } = extract(`
      < "geometry.bv": (Geom) >
      =
      ::User = (profile Geom::Point)
      @noop = -> ok: 1 as Integer
    `);
    expect(() => compile(ast, { remotes: [{ path: 'geometry.bv', service: remoteIface }] })).not.toThrow();
  });

  it('rejects Geom::NoSuch when NoSuch is not exported', () => {
    const { ast } = extract(`
      < "geometry.bv": (Geom) >
      =
      ::User = (profile Geom::NoSuch)
      @noop = -> ok: 1 as Integer
    `);
    expect(() => compile(ast, { remotes: [{ path: 'geometry.bv', service: remoteIface }] }))
      .toThrow(/'::NoSuch' is not exported by 'Geom'/);
  });

  it('rejects Alias::Name when Alias is not a declared dependency', () => {
    const { ast } = extract(`
      ::User = (profile NoSuch::Point)
      @noop = -> ok: 1 as Integer
    `);
    expect(() => compile(ast)).toThrow(/unknown dependency alias 'NoSuch'/);
  });

  it('cross-module ref in a parameter annotation is validated', () => {
    const { ast } = extract(`
      < "geometry.bv": (Geom) >
      =
      @go = |:p Geom::Point| -> ok: 1 as Integer
    `);
    expect(() => compile(ast, { remotes: [{ path: 'geometry.bv', service: remoteIface }] })).not.toThrow();
  });
});

describe('shape imports — wire registry includes imported types', () => {
  it('emits canonical (remote) name even when imported under an alias', () => {
    const { ast } = extract(`
      < "geometry.bv": (Point: P) >
      =
      @origin = -> p: P(0, 0) as P
    `);
    const code = compile(ast, { remotes: [{ path: 'geometry.bv', service: remoteIface }] });
    expect(code).toMatch(/_bv_types\s*=\s*\{[^}]*"Point":\s*\{\s*fields:\s*\["x",\s*"y"\]/);
  });
});
