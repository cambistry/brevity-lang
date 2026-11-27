import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// A constructor block returns no value: its result is the constructed actor. So
// a `()` at the end of a constructor block is a literal of no value, and is
// ignored: the class still constructs a working actor, all handlers still resolve.
// ═══════════════════════════════════════════════════════════════════════════════

describe('class — trailing () in constructor block is ignored', () => {
  const script = `
    --- delimited constructor block, trailing () ---

    Box = (value Integer) *{
      @get = () -> result: value
      ()
    }

    --- lineal constructor block, trailing () before . ---

    LinealBox =
      *
        value Integer
      *
      @get = () -> result: value
      ()
      .

    @testBox
      =
      b = Box(7)
      :result Integer = b.get()
      return :result

    @testLinealBox
      =
      b = LinealBox(7)
      :result Integer = b.get()
      return :result
  `;

  it('delimited body — trailing () is a no-op, actor still works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'testBox', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [{ result: 7 }], to: 'c' }) },
    );
  });

  it('lineal body — trailing () before . is a no-op', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: 'testLinealBox', from: 'c' } },
      { output: expect.objectContaining({ id: '3', re: [{ result: 7 }], to: 'c' }) },
    );
  });
});

describe('class — empty constructor block', () => {
  it('delimited empty block `{}` compiles and yields a usable (empty) actor', () => {
    expect(() => compileSource(`
      Empty = * {}
      @test
        =
        e = Empty()
        return ack: "ok"
    `)).not.toThrow();
  });

  it('delimited constructor block of just () compiles (`{ () }` ≡ `{}`)', () => {
    expect(() => compileSource(`
      Empty = * { () }
      @test
        =
        e = Empty()
        return ack: "ok"
    `)).not.toThrow();
  });

  it('lineal constructor block of just () compiles', () => {
    expect(() => compileSource(`
      Empty =
        *
        ()
        .
      @test
        =
        e = Empty()
        return ack: "ok"
    `)).not.toThrow();
  });
});
