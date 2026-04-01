import { expectBehavior, compileSource } from '../helpers.js';

describe('self-closing constructor — compilation', () => {
  it('C = <params />', () => {
    expect(() => compileSource(`
      Greeter = <name Text />
      @test
        =
        g = Greeter("world")
        -> "ok" as Text
    `)).not.toThrow();
  });

  it('C = </> (no params)', () => {
    expect(() => compileSource(`
      Empty = </>
      @test
        =
        e = Empty()
        -> "ok" as Text
    `)).not.toThrow();
  });

  it('lineal self-close', () => {
    expect(() => compileSource(`
      Point
      <
        x Integer
        y Integer
      />

      @test
        =
        p = Point(1, 2)
        -> "ok" as Text
    `)).not.toThrow();
  });

  it('public constructor self-close: @Name = <params />', () => {
    expect(() => compileSource(`
      @Greeter = <name Text />
      @test
        =
        g = Greeter("world")
        -> "ok" as Text
    `)).not.toThrow();
  });
});

describe('dot-terminated constructor body — compilation', () => {
  it('C = <x Integer> @get = { x } .', () => {
    expect(() => compileSource(`
      Box = <x Integer> @get = -> value: x as Integer .

      @test
        =
        b = Box(42)
        :value = b.get()
        -> :value as Integer
    `)).not.toThrow();
  });

  it('lineal header, delimited body', () => {
    expect(() => compileSource(`
      Counter
      <
        start Integer
      > {
        count *Integer = start
        @get = -> value: count as Integer
      }

      @test
        =
        c = Counter(10)
        :value = c.get()
        -> :value as Integer
    `)).not.toThrow();
  });
});

describe('dot-terminated constructor body — runtime', () => {
  const script = `
    Box = <x Integer> @get = -> value: x as Integer .

    @testBox
      =
      b = Box(42)
      :value = b.get()
      -> :value as Integer
  `;

  it('single-expression dot-terminated body works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testBox', from: 'c' } },
      { output: { id: '1', 'bv-a': { value: 'Integer' }, re: { value: 42 }, to: 'c' } },
    );
  });
});

describe('lineal header + delimited body — runtime', () => {
  const script = `
    Counter
    <
      start Integer
    > {
      count *Integer = start
      @get = -> value: count as Integer
    }

    @testCounter
      =
      c = Counter(10)
      :value = c.get()
      -> :value as Integer
  `;

  it('lineal header with braced body works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testCounter', from: 'c' } },
      { output: { id: '1', 'bv-a': { value: 'Integer' }, re: { value: 10 }, to: 'c' } },
    );
  });
});
