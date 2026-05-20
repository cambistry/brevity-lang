import { compileSource, expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Lineal constructor grammar — body-opener `=` (or overload `<<`) is required
// before `*(...)`. The trailing `=` after `)` opens a lineal body and is illegal
// before `{` (delimited body).
// ═══════════════════════════════════════════════════════════════════════════════

describe('lineal class grammar — accepted forms', () => {
  it('Cls = *(...) = body . (all on one line)', () => {
    expect(() => compileSource(`
      Box = *(value Integer) =
        @get = -> result: value
        .

      @test = { b = Box(7); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('Cls =\\n*(...)\\n=\\nbody. (lineal everywhere)', () => {
    expect(() => compileSource(`
      Box =
        *(value Integer)
        =
        @get = -> result: value
        .

      @test = { b = Box(7); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('Cls\\n=\\n*(...)\\n=\\nbody. (header `=` on its own line)', () => {
    expect(() => compileSource(`
      Box
        =
        *(value Integer)
        =
        @get = -> result: value
        .

      @test = { b = Box(7); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('Cls = *(...) { body } (delimited body)', () => {
    expect(() => compileSource(`
      Box = *(value Integer) {
        @get = -> result: value
      }

      @test = { b = Box(7); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('Cls << *(...) = body . (overload form, no leading `=`)', () => {
    expect(() => compileSource(`
      Box = *(value Integer) {
        @get = -> result: value
      }

      Box << *(label Text) =
        @get = -> result: 0
        .
    `)).not.toThrow();
  });

  it('end-to-end runtime: Cls =\\n*(...)\\n=\\nbody.', async () => {
    await expectBehavior(`
      Box =
        *(value Integer)
        =
        @get = -> result: value
        .

      @test = { b = Box(99); :result = b.get(); -> :result as Integer }
    `,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 99 }, to: 'c' } },
    );
  });
});

describe('lineal class grammar — rejected forms', () => {
  it('Cls\\n*\\n params (lineal with-params, missing opening `=`) is a parse error', () => {
    expect(() => compileSource(`
      Box *
        value Integer
      =
        @get = -> result: value
        .
    `)).toThrow(/requires '=' before '\*'/);
  });

  it("Cls = *(params) = { body } (closing '=' before '{') is a parse error", () => {
    expect(() => compileSource(`
      Box = *(value Integer) = {
        @get = -> result: value
      }
    `)).toThrow(/'=' is not valid before '\{'/);
  });

  it("@op\\n*\\nparams (public method, lineal with-params, missing opening '=') is a parse error", () => {
    expect(() => compileSource(`
      @get *
        count: Integer
      =
        -> count: count
    `)).toThrow(/requires '=' before '\*'/);
  });

  it('Cls = *\\n params (lineal header, missing body opener `=` before EOF) is a parse error', () => {
    expect(() => compileSource(`
      Box = *
        value Integer
    `)).toThrow();
  });

  it('Cls = *\\n params (lineal header, missing body opener `=` before next decl) is a parse error', () => {
    expect(() => compileSource(`
      Box = *
        value Integer
      @test = -> 1
    `)).toThrow();
  });

  it('Cls = *(params)\\n direct-content (no `=` body opener) is a parse error', () => {
    // The body must be opened by `{`, `=`, or `->`. Direct lineal content
    // without an opener (the old silent-absorb path) is rejected.
    expect(() => compileSource(`
      Box = *(value Integer)
        @get = -> result: value
        .
      @test = -> 1
    `)).toThrow(/requires a body/);
  });
});
