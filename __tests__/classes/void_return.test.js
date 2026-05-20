import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// A class doesn't return a value via the constructor block — it returns the
// constructed actor's address. So a trailing `()` (or `-> ()`) at the end of
// a constructor block is literally a literal of no value, and must be ignored:
// the class still constructs a working actor, all handlers still resolve.
// ═══════════════════════════════════════════════════════════════════════════════

describe('class — trailing () in constructor block is ignored', () => {
  const script = `
    --- delimited constructor block, trailing () ---

    Box = *(value Integer) {
      @get = -> result: value
      ()
    }

    --- delimited constructor block, trailing -> () ---

    BoxArrow = *(value Integer) {
      @get = -> result: value
      -> ()
    }

    --- lineal constructor block, trailing () before . ---

    LinealBox = *(value Integer) =
      @get = -> result: value
      ()
      .

    --- lineal constructor block, trailing -> () before . ---

    LinealBoxArrow = *(value Integer) =
      @get = -> result: value
      -> ()
      .

    @testBox
      =
      b = Box(7)
      :result Integer = b.get()
      -> :result

    @testBoxArrow
      =
      b = BoxArrow(7)
      :result Integer = b.get()
      -> :result

    @testLinealBox
      =
      b = LinealBox(7)
      :result Integer = b.get()
      -> :result

    @testLinealBoxArrow
      =
      b = LinealBoxArrow(7)
      :result Integer = b.get()
      -> :result
  `;

  it('delimited body — trailing () is a no-op, actor still works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testBox', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { result: 7 }, to: 'c' }) },
    );
  });

  it('delimited body — trailing -> () is a no-op, actor still works', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testBoxArrow', from: 'c' } },
      { output: expect.objectContaining({ id: '2', re: { result: 7 }, to: 'c' }) },
    );
  });

  it('lineal body — trailing () before . is a no-op', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@testLinealBox', from: 'c' } },
      { output: expect.objectContaining({ id: '3', re: { result: 7 }, to: 'c' }) },
    );
  });

  it('lineal body — trailing -> () before . is a no-op', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@testLinealBoxArrow', from: 'c' } },
      { output: expect.objectContaining({ id: '4', re: { result: 7 }, to: 'c' }) },
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
        -> ack: "ok"
    `)).not.toThrow();
  });

  it('delimited constructor block of just () compiles (`{ () }` ≡ `{}`)', () => {
    expect(() => compileSource(`
      Empty = * { () }
      @test
        =
        e = Empty()
        -> ack: "ok"
    `)).not.toThrow();
  });

  it('lineal constructor block of just () compiles', () => {
    expect(() => compileSource(`
      Empty = * =
        ()
        .
      @test
        =
        e = Empty()
        -> ack: "ok"
    `)).not.toThrow();
  });
});
