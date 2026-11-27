import { extract } from '../../index.js';

// A file's types are its service document's `types`, each an entry list: positional
// fields as items, named ones in an object after them
// (notes/opre-type-encoding-2026-11-21.md, notes/positional-type-fields-2026-11-26.md).
// Named fields' names are part of the contract.

describe('type interface — the document\'s types', () => {
  it('positional fields', () => {
    const { interface: iface } = extract(`
      type Point(Integer, Integer)
    `);
    expect(iface.service.types).toEqual({ ':Point': ['Integer', 'Integer'] });
  });

  it('optional fields', () => {
    const { interface: iface } = extract(`
      type Game(? Boolean, ? turn: Integer, ? players: List of Texts)
    `);
    expect(iface.service.types).toEqual({
      ':Game': [{ '%opt': 'Boolean' }, { turn: { '%opt': 'Integer' }, players: { '%opt': [['Text'], { '%t': 'List' }] } }],
    });
  });

  it('named fields', () => {
    const { interface: iface } = extract(`
      type Rank(Integer, kind: Text)
    `);
    expect(iface.service.types).toEqual({ ':Rank': ['Integer', { kind: 'Text' }] });
  });

  it('a type reached through another actor', () => {
    const { interface: iface } = extract(`
      type User(Geom::Profile)
    `);
    expect(iface.service.types).toEqual({ ':User': ['Geom:Profile'] });
  });

  it('a type with no fields', () => {
    const { interface: iface } = extract(`
      type Empty()
    `);
    expect(iface.service.types).toEqual({ ':Empty': [] });
  });

  it('multiple type declarations all appear in interface', () => {
    const { interface: iface } = extract(`
      type Point(Integer, Integer)
      type Pair(Integer, Integer)
    `);
    expect(iface.service.types).toEqual({
      ':Point': ['Integer', 'Integer'],
      ':Pair': ['Integer', 'Integer'],
    });
  });

  it('a node has its ops, then its types', () => {
    const { interface: iface } = extract(`
      type Point(Integer, Integer)
      @get = () -> coords: 1
    `);
    expect(iface.service).toEqual({
      public: { get: [{ re: [{ coords: 'Integer' }], writes: false }] },
      types: { ':Point': ['Integer', 'Integer'] },
    });
  });
});
