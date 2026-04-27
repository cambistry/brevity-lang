import { extract } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Interface render for subclass constructors
//
// The extracted service document now preserves the superclass relationship
// rather than erasing it. Input side reads `<Parent | own>`; body side leads
// with `...Parent` spread markers before any own methods.
// ═══════════════════════════════════════════════════════════════════════════════

const svc = (source) => extract(source).interface.service;

describe('subclass interface — input side', () => {
  it('empty subclass renders Parent | with nothing on the right', () => {
    const s = svc(`
      @T = <:x Integer> { @a = -> v: x as Integer }
      @U = <T |>
    `);
    expect(s).toContain('U: <T |>');
  });

  it('subclass with own named param renders after the pipe', () => {
    const s = svc(`
      @T = <:x Integer> { @a = -> v: x as Integer }
      @U = <T | :y Integer>
    `);
    expect(s).toContain('U: <T | :y Integer>');
  });

  it('subclass with own positional param renders after the pipe', () => {
    const s = svc(`
      @T = <x Integer> { @a = -> v: x as Integer }
      @U = <T | y Integer>
    `);
    expect(s).toContain('U: <T | Integer>');
  });

  it('multi-parent renders both parents comma-separated', () => {
    const s = svc(`
      @A = <:a Integer> { @ga = -> v: a as Integer }
      @B = <:b Integer> { @gb = -> v: b as Integer }
      @C = <A, B | :c Integer>
    `);
    expect(s).toContain('C: <A, B | :c Integer>');
  });

  it('wrapped-as marker is hidden from the rendered interface', () => {
    const s = svc(`
      @T = <> { @a = -> v: 1 as Integer }
      @U = <T *sup |> { @b = -> v: 2 as Integer }
    `);
    expect(s).toContain('U: <T |>');
    expect(s).not.toContain('*sup');
  });
});

describe('subclass interface — body side', () => {
  it('empty subclass body is just the parent spread', () => {
    const s = svc(`
      @T = <:x Integer> { @a = -> v: x as Integer }
      @U = <T |>
    `);
    expect(s).toContain('U: <T |> -> {\n    ...T\n  }');
  });

  it('own methods follow the spread on separate lines', () => {
    const s = svc(`
      @T = <:x Integer> { @a = -> v: x as Integer }
      @U = <T | :y Integer> { @b = -> v: y as Integer }
    `);
    expect(s).toContain('...T');
    expect(s).toContain('b: () -> (:v Integer)');
    const uBody = s.slice(s.indexOf('U:'));
    expect(uBody.indexOf('...T')).toBeLessThan(uBody.indexOf('b:'));
  });

  it('multi-parent body has one spread per parent, in order', () => {
    const s = svc(`
      @A = <:a Integer> { @ga = -> v: a as Integer }
      @B = <:b Integer> { @gb = -> v: b as Integer }
      @C = <A, B | :c Integer>
    `);
    expect(s).toContain('...A');
    expect(s).toContain('...B');
    const cBody = s.slice(s.indexOf('C:'));
    expect(cBody.indexOf('...A')).toBeLessThan(cBody.indexOf('...B'));
  });
});

describe('subclass interface — chain depth', () => {
  it('renders the direct parent reference, not flattened ancestors', () => {
    // Grandparent chain A < B < C — C's render references B only.
    // Consumers expand through B's own entry to resolve A's material.
    const s = svc(`
      @A = <:a Integer> { @ga = -> v: a as Integer }
      @B = <A | :b Integer> { @gb = -> v: b as Integer }
      @C = <B | :c Integer> { @gc = -> v: c as Integer }
    `);
    expect(s).toContain('C: <B | :c Integer>');
    const cBody = s.slice(s.indexOf('C:'));
    // C's body spreads B only — not A. A's inclusion is implied through B.
    expect(cBody).toContain('...B');
    expect(cBody.split('\n').slice(0, 6).join('\n')).not.toContain('...A');
  });
});

describe('subclass interface — parent render unchanged', () => {
  it('parent type still renders its own full signature', () => {
    // The parent does NOT get a `...` spread — spreads only appear on children.
    const s = svc(`
      @T = <:x Integer> { @a = -> v: x as Integer }
      @U = <T | :y Integer>
    `);
    const tBody = s.slice(s.indexOf('T:'), s.indexOf('U:'));
    expect(tBody).toContain('a: () -> (:v Integer)');
    expect(tBody).not.toContain('...');
  });
});
