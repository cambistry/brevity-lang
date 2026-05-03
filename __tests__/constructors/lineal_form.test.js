import { compileSource, expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Lineal constructor grammar — body-opener `=` (or overload `<<`) is required
// before `<...>`. The trailing `=` after `>` opens a lineal body and is illegal
// before `{` (delimited body).
// ═══════════════════════════════════════════════════════════════════════════════

describe('lineal constructor grammar — accepted forms', () => {
  it('Cls = <...> = body . (all on one line)', () => {
    expect(() => compileSource(`
      Box = <value Integer> =
        @get = -> result: value
        .

      @test = { b = Box(7); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('Cls =\\n<...>\\n=\\nbody. (lineal everywhere)', () => {
    expect(() => compileSource(`
      Box =
        <value Integer>
        =
        @get = -> result: value
        .

      @test = { b = Box(7); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('Cls\\n=\\n<...>\\n=\\nbody. (header `=` on its own line)', () => {
    expect(() => compileSource(`
      Box
        =
        <value Integer>
        =
        @get = -> result: value
        .

      @test = { b = Box(7); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('Cls = <...> { body } (delimited body)', () => {
    expect(() => compileSource(`
      Box = <value Integer> {
        @get = -> result: value
      }

      @test = { b = Box(7); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('Cls << <...> = body . (overload form, no leading `=`)', () => {
    expect(() => compileSource(`
      Box = <value Integer> {
        @get = -> result: value
      }

      Box << <label Text> =
        @get = -> result: 0
        .
    `)).not.toThrow();
  });

  it('end-to-end runtime: Cls =\\n<...>\\n=\\nbody.', async () => {
    await expectBehavior(`
      Box =
        <value Integer>
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

describe('lineal constructor grammar — rejected forms', () => {
  it('Cls\\n<...>\\nbody. (missing opening `=`) is a parse error', () => {
    expect(() => compileSource(`
      Box
        <value Integer>
        =
        @get = -> result: value
        .
    `)).toThrow(/requires '=' before '<\.\.\.>'/);
  });

  it("Cls = <...> = { body } (closing '=' before '{') is a parse error", () => {
    expect(() => compileSource(`
      Box = <value Integer> = {
        @get = -> result: value
      }
    `)).toThrow(/'=' is not valid before '\{'/);
  });

  it("@op\\n<...>\\nbody (public method, missing opening '=') is a parse error", () => {
    expect(() => compileSource(`
      @get
        <>
        =
        -> count: 0
    `)).toThrow(/requires '=' before '<\.\.\.>'/);
  });
});
