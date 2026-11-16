import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Single-expression function forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('single-expression — fn = (params) -> return_vals', () => {
  const script = `
    @sum
      =
      add = (a, b) -> (a + b) as Integer
      result Integer = add(2, 3)
      return :result

    @greet
      =
      echo = (name) -> name as Text
      result Text = echo("Ada")
      return :result
  `;

  it('fn = (a, b) -> (a + b) as Integer — lambda arrow return', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'sum', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 5 }, to: 'c' } },
    );
  });

  it('fn = (name) -> name as Text — lambda arrow string return', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'greet', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Text' }, re: { result: 'Ada' }, to: 'c' } },
    );
  });
});

describe('single-expression — fn = (params) ->  side_effect .', () => {
  const script = `
    count *Integer = 0

    @test!
      =
      fn! = (n) ->  count <- count + n .
      fn!(5)
      fn!(3)
      return :count
  `;

  it('fn = (n) ->  side_effect . — silent function mutates state', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'test!', from: 'c' } },
      { output: { id: '1', 'ty': { count: 'Integer' }, re: { count: 8 }, to: 'c' } },
    );
  });
});

describe('single-expression — fn = -> return_vals (no params)', () => {
  const script = `
    @answer
      =
      fn = -> 42 as Integer
      result Integer = fn()
      return :result

    @hello
      =
      fn = -> "hello" as Text
      result Text = fn()
      return :result
  `;

  it('fn = -> 42 as Integer — no-param lambda arrow return', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'answer', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('fn = -> "hello" as Text — no-param lambda string return', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'hello', from: 'c' } },
      { output: { id: '1', 'ty': { result: 'Text' }, re: { result: 'hello' }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Public function single-expression forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('single-expression — public function forms', () => {
  const script = `
    @greet = -> "Hello from Brevity!"
    @answer = -> 42
    @echo = (n: Integer) -> :n
    @alive = -> true
  `;

  it('@op = -> "Hello" as Text', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'greet', from: 'c' } },
      { output: { id: '1', 'ty': ['Text'], re: ['Hello from Brevity!'], to: 'c' } },
    );
  });

  it('@op = -> 42 as Integer', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'answer', from: 'c' } },
      { output: { id: '1', 'ty': ['Integer'], re: [42], to: 'c' } },
    );
  });

  it('@op = (n: Integer) -> :n', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[{ n: 7 }], 'echo'], 'ty': [[{ n: 'Integer' }]], from: 'c' } },
      { output: { id: '1', 'ty': { n: 'Integer' }, re: { n: 7 }, to: 'c' } },
    );
  });

  it('@op = -> true as Boolean', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'alive', from: 'c' } },
      { output: { id: '1', 'ty': ['Boolean'], re: [true], to: 'c' } },
    );
  });
});
