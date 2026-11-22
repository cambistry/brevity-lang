import { extract } from '../../index.js';

// A file's types are its service document's `types`, each an entry list: positional
// fields as items, named ones in an object after them, the positional fields' names
// as its `%names` (notes/opre-type-encoding-2026-11-21.md). Field names are part of
// the contract.

describe('type interface — the document\'s types', () => {
  it('positional fields', () => {
    const { interface: iface } = extract(`
      type Point (x Integer, y Integer)
      @noop = -> ok: true
    `);
    expect(iface.service.types).toEqual({ ':Point': ['Integer', 'Integer', { '%names': ['x', 'y'] }] });
  });

  it('optional fields', () => {
    const { interface: iface } = extract(`
      type Game (? started Boolean, ? turn: Integer, ? players: List of Texts)
      @noop = -> ok: true
    `);
    expect(iface.service.types).toEqual({
      ':Game': [{ '%opt': 'Boolean' }, { turn: { '%opt': 'Integer' }, players: { '%opt': [['Text'], { '%t': 'List' }] }, '%names': ['started'] }],
    });
  });

  it('named fields', () => {
    const { interface: iface } = extract(`
      type Rank (score Integer, kind: Text)
      @noop = -> ok: true
    `);
    expect(iface.service.types).toEqual({ ':Rank': ['Integer', { kind: 'Text', '%names': ['score'] }] });
  });

  it('a type reached through another actor', () => {
    const { interface: iface } = extract(`
      type User (profile Geom::Profile)
      @noop = -> ok: true
    `);
    expect(iface.service.types).toEqual({ ':User': ['Geom:Profile', { '%names': ['profile'] }] });
  });

  it('a type with no fields', () => {
    const { interface: iface } = extract(`
      type Empty ()
      @noop = -> ok: true
    `);
    expect(iface.service.types).toEqual({ ':Empty': [] });
  });

  it('multiple type declarations all appear in interface', () => {
    const { interface: iface } = extract(`
      type Point (x Integer, y Integer)
      type Pair (a Integer, b Integer)
      @noop = -> ok: true
    `);
    expect(iface.service.types).toEqual({
      ':Point': ['Integer', 'Integer', { '%names': ['x', 'y'] }],
      ':Pair': ['Integer', 'Integer', { '%names': ['a', 'b'] }],
    });
  });

  it('a node has its ops, then its types', () => {
    const { interface: iface } = extract(`
      type Point (x Integer, y Integer)
      @get = -> coords: 1
    `);
    expect(iface.service).toEqual({
      public: { get: [{ re: [{ coords: 'Integer' }], writes: false }] },
      types: { ':Point': ['Integer', 'Integer', { '%names': ['x', 'y'] }] },
    });
  });
});
