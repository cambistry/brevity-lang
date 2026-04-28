import { extract } from '../../index.js';

// Slice 6 of types-implementation-plan-2026-04-27: parser-side support for
// `Service::Point` cross-module type references. The full import-binding
// plumbing (validating that `Service` is an alias and that `Point` is a
// type it exports) lands in slice 15. This slice just ensures the syntax
// parses everywhere a type annotation is accepted.

describe('shape cross-module reference — Foo::Bar', () => {
  it('parses Foo::Bar in a nested type field annotation', () => {
    const { ast } = extract(`
      ::User = (profile Geom::Profile)
    `);
    expect(ast.types[0]).toEqual({
      type: 'TypeDecl',
      name: 'User',
      fields: [{ type: 'TypeField', name: 'profile', paramType: 'Geom::Profile' }],
    });
  });

  it('parses Foo::Bar alongside bare local types in mixed fields', () => {
    const { ast } = extract(`
      ::Local = (x Integer)
      ::Mixed = (here Local, there Geom::Point)
    `);
    const mixed = ast.types.find(t => t.name === 'Mixed');
    expect(mixed.fields.map(f => f.paramType)).toEqual(['Local', 'Geom::Point']);
  });

  it('parses Foo::Bar in a typed parameter annotation', () => {
    const { ast } = extract(`
      @go = |:p Geom::Point| -> result: 1
    `);
    const fn = ast.actors[0].functions.find(f => f.name === '@go');
    expect(fn.params[0].name).toBe('p');
    expect(fn.params[0].type).toBe('Geom::Point');
  });

  it('parses Foo::Bar | null union', () => {
    const { ast } = extract(`
      @go = |:p Geom::Point | null| -> result: 1
    `);
    const fn = ast.actors[0].functions.find(f => f.name === '@go');
    expect(fn.params[0].type).toBe('Geom::Point | null');
  });

  it('parses Foo::Bar as a typed local declaration', () => {
    const { ast } = extract(`
      @go = {
        p Geom::Point
        -> result: 1
      }
    `);
    const fn = ast.actors[0].functions.find(f => f.name === '@go');
    const decl = fn.body.find(s => s.type === 'BareTypeDecl');
    expect(decl.name).toBe('p');
    expect(decl.typeName).toBe('Geom::Point');
  });
});
