import { extract } from '../../index.js';

// Slice 14 of types-implementation-plan-2026-04-27: types appear in the
// interface document in the same form as their declaration, including the
// `=`. Field names are retained because they are part of the contract.

describe('shape interface — emission with `=` form', () => {
  it('inline single-line for short required types', () => {
    const { interface: iface } = extract(`
      ::Point = (x Integer, y Integer)
      @noop = -> ok: true
    `);
    expect(iface.service).toContain('::Point = (x Integer, y Integer)');
  });

  it('multiline form for types with optional fields', () => {
    const { interface: iface } = extract(`
      ::Game = (? started Boolean, ? turn: Integer, ? players: List of Texts)
      @noop = -> ok: true
    `);
    expect(iface.service).toContain('::Game = (\n    ? started Boolean,\n    ? turn: Integer,\n    ? players: List of Texts\n  )');
  });

  it('preserves named-field syntax (`name: Type`)', () => {
    const { interface: iface } = extract(`
      ::Rank = (score Integer, kind: Text)
      @noop = -> ok: true
    `);
    expect(iface.service).toContain('::Rank = (score Integer, kind: Text)');
  });

  it('preserves cross-module references in field types', () => {
    const { interface: iface } = extract(`
      ::User = (profile Geom::Profile)
      @noop = -> ok: true
    `);
    expect(iface.service).toContain('::User = (profile Geom::Profile)');
  });

  it('empty type emits `()`', () => {
    const { interface: iface } = extract(`
      ::Empty = ()
      @noop = -> ok: true
    `);
    expect(iface.service).toContain('::Empty = ()');
  });

  it('multiple type declarations all appear in interface', () => {
    const { interface: iface } = extract(`
      ::Point = (x Integer, y Integer)
      ::Pair = (a Integer, b Integer)
      @noop = -> ok: true
    `);
    expect(iface.service).toContain('::Point = (x Integer, y Integer)');
    expect(iface.service).toContain('::Pair = (a Integer, b Integer)');
  });

  it('types appear before public function entries', () => {
    const { interface: iface } = extract(`
      ::Point = (x Integer, y Integer)
      @get = -> coords: 1 as Integer
    `);
    const tIdx = iface.service.indexOf('::Point');
    const fIdx = iface.service.indexOf('get:');
    expect(tIdx).toBeGreaterThan(-1);
    expect(fIdx).toBeGreaterThan(tIdx);
  });
});
