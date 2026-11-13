import { extract } from '../../index.js';

// Slice 14 of types-implementation-plan-2026-04-27: types appear in the
// interface document in the same form as their declaration (`type Name (…)`).
// Field names are retained because they are part of the contract.

describe('type interface — emission in declaration form', () => {
  it('inline single-line for short required types', () => {
    const { interface: iface } = extract(`
      type Point (x Integer, y Integer)
      @noop = -> ok: true
    `);
    expect(iface.service).toContain('type Point (x Integer, y Integer)');
  });

  it('multiline form for types with optional fields', () => {
    const { interface: iface } = extract(`
      type Game (? started Boolean, ? turn: Integer, ? players: List of Texts)
      @noop = -> ok: true
    `);
    expect(iface.service).toContain('type Game (\n    ? started Boolean,\n    ? turn: Integer,\n    ? players: List of Texts\n  )');
  });

  it('preserves named-field syntax (`name: Type`)', () => {
    const { interface: iface } = extract(`
      type Rank (score Integer, kind: Text)
      @noop = -> ok: true
    `);
    expect(iface.service).toContain('type Rank (score Integer, kind: Text)');
  });

  it('preserves cross-module references in field types', () => {
    const { interface: iface } = extract(`
      type User (profile Geom::Profile)
      @noop = -> ok: true
    `);
    expect(iface.service).toContain('type User (profile Geom::Profile)');
  });

  it('empty type emits `()`', () => {
    const { interface: iface } = extract(`
      type Empty ()
      @noop = -> ok: true
    `);
    expect(iface.service).toContain('type Empty ()');
  });

  it('multiple type declarations all appear in interface', () => {
    const { interface: iface } = extract(`
      type Point (x Integer, y Integer)
      type Pair (a Integer, b Integer)
      @noop = -> ok: true
    `);
    expect(iface.service).toContain('type Point (x Integer, y Integer)');
    expect(iface.service).toContain('type Pair (a Integer, b Integer)');
  });

  it('types appear before public function entries', () => {
    const { interface: iface } = extract(`
      type Point (x Integer, y Integer)
      @get = -> coords: 1
    `);
    const tIdx = iface.service.indexOf('type Point');
    const fIdx = iface.service.indexOf('get (');
    expect(tIdx).toBeGreaterThan(-1);
    expect(fIdx).toBeGreaterThan(tIdx);
  });
});
