import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Constructors don't return a value via the service block — they return the
// instance address. So a trailing `()` (or `-> ()`) at the end of a service
// block is literally a literal of no value, and must be ignored: the
// constructor still produces a working instance, all handlers still resolve.
// ═══════════════════════════════════════════════════════════════════════════════

describe('constructor — trailing () in service block is ignored', () => {
  const script = `
    --- delimited service block, trailing () ---

    Box = *(value Integer) {
      @get = -> result: value
      ()
    }

    --- delimited service block, trailing -> () ---

    BoxArrow = *(value Integer) {
      @get = -> result: value
      -> ()
    }

    --- lineal service block, trailing () before . ---

    LinealBox = *(value Integer) =
      @get = -> result: value
      ()
      .

    --- lineal service block, trailing -> () before . ---

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

  it('delimited body — trailing () is a no-op, instance still works', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testBox', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: { result: 7 }, to: 'c' }) },
    );
  });

  it('delimited body — trailing -> () is a no-op, instance still works', async () => {
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

describe('constructor — service block consisting only of ()', () => {
  it('delimited service block of just () compiles and yields a usable (empty) instance', () => {
    expect(() => compileSource(`
      Empty = * { () }
      @test
        =
        e = Empty()
        -> ack: "ok"
    `)).not.toThrow();
  });

  it('lineal service block of just () compiles', () => {
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
