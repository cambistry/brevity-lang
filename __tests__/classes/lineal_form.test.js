import { compileSource, expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Lineal constructor grammar — `Name =` (or `Name\n=`, or an overload `<<`),
// then `*` alone on its line, params one per line, and a closing `*` alone on
// its line (optionally followed by `{`). LFs are part of the syntax. With no
// params the opening `*` is followed directly by the body.
// ═══════════════════════════════════════════════════════════════════════════════

describe('lineal class grammar — accepted forms', () => {
  it('Cls =\\n*\\nparams\\n*\\nbody .', () => {
    expect(() => compileSource(`
      Box =
        *
        value Integer
        *
        @get = -> result: value
        .

      @test = { b = Box(7); :result = b.get(); return :result as Integer }
    `)).not.toThrow();
  });

  it('Cls\\n=\\n*\\nparams\\n*\\nbody . (header `=` on its own line)', () => {
    expect(() => compileSource(`
      Box.
        =
        *
        value Integer
        *
        @get = -> result: value

      @test = { b = Box(7); :result = b.get(); return :result as Integer }
    `)).not.toThrow();
  });

  it('Cls =\\n*\\nparams\\n* { body } (delimited body)', () => {
    expect(() => compileSource(`
      Box =
        *
        value Integer
        * {
          @get = -> result: value
        }

      @test = { b = Box(7); :result = b.get(); return :result as Integer }
    `)).not.toThrow();
  });

  it('Cls <<\\n*\\nparams\\n*\\nbody . (overload form)', () => {
    expect(() => compileSource(`
      Box = (value Integer) *{
        @get = -> result: value
      }

      Box <<
        *
        label Text
        *
        @get = -> result: 0
        .
    `)).not.toThrow();
  });

  it('end-to-end runtime: Cls =\\n*\\nparams\\n*\\nbody .', async () => {
    await expectBehavior(`
      Box =
        *
        value Integer
        *
        @get = -> result: value
        .

      @test = { b = Box(99); :result = b.get(); return :result as Integer }
    `,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 99 }, to: 'c' } },
    );
  });

  it('end-to-end runtime: no-params Cls =\\n*\\nbody .', async () => {
    await expectBehavior(`
      Box =
        *
        @get = -> result: 5
        .

      @test = { b = Box(); :result = b.get(); return :result as Integer }
    `,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' } },
    );
  });
});

describe('lineal class grammar — rejected forms', () => {
  it('Cls\\n*\\nparams (missing opening `=`) is a parse error', () => {
    expect(() => compileSource(`
      Box.
        *
        value Integer
        *
        @get = -> result: value
    `)).toThrow(/requires '=' before '\*'/);
  });

  it('Cls = *(params) = { body } is a parse error', () => {
    expect(() => compileSource(`
      Box = *(value Integer) = {
        @get = -> result: value
      }
    `)).toThrow(/is retired/);
  });

  it("@op\\n*\\nparams (public, missing opening '=') is a parse error", () => {
    expect(() => compileSource(`
      @get
        *
        count: Integer
        *
        -> count: count
    `)).toThrow(/requires '=' before '\*'/);
  });

  it('Cls = *(params) =\\nbody . (paren header, lineal body) is a parse error', () => {
    expect(() => compileSource(`
      Box = *(value Integer) =
        @get = -> result: value
        .
    `)).toThrow(/is retired/);
  });

  it('Cls = *(params)\\n direct-content (no body opener) is a parse error', () => {
    expect(() => compileSource(`
      Box = *(value Integer)
        @get = -> result: value
        .
      @test = -> 1
    `)).toThrow(/is retired/);
  });
});
