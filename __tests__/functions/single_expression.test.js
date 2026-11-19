import { expectBehavior } from '../helpers.js';

describe('single-expression functions — runtime', () => {
  const script = `
    // single-expression — fn = (params) -> return_vals
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

    // single-expression — fn = (params) ->  side_effect .
    count *Integer = 0

    @test!
      =
      fn! = (n) ->  count <- count + n .
      fn!(5)
      fn!(3)
      return :count

    // single-expression — fn = -> return_vals (no params)
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

    // single-expression — public function forms
    @greet4 = -> "Hello from Brevity!"
    @answer4 = -> 42
    @echo = (n: Integer) -> :n
    @alive = -> true
  `;

  // ═══════════════════════════════════════════════════════════════════════════════
  // Single-expression function forms
  // ═══════════════════════════════════════════════════════════════════════════════

  it('single-expression — fn = (params) -> return_vals — fn = (a, b) -> (a + b) as Integer — lambda arrow return', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'sum', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 5 }], to: 'c' } },
    );
  });

  it('single-expression — fn = (params) -> return_vals — fn = (name) -> name as Text — lambda arrow string return', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'greet', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'Ada' }], to: 'c' } },
    );
  });

  it('single-expression — fn = (params) ->  side_effect . — fn = (n) ->  side_effect . — silent function mutates state', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'test!', from: 'c' } },
      { output: { id: '1', 'ty': [{ count: 'Integer' }], re: [{ count: 8 }], to: 'c' } },
    );
  });

  it('single-expression — fn = -> return_vals (no params) — fn = -> 42 as Integer — no-param lambda arrow return', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'answer', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Integer' }], re: [{ result: 42 }], to: 'c' } },
    );
  });

  it('single-expression — fn = -> return_vals (no params) — fn = -> "hello" as Text — no-param lambda string return', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'hello', from: 'c' } },
      { output: { id: '1', 'ty': [{ result: 'Text' }], re: [{ result: 'hello' }], to: 'c' } },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Public function single-expression forms
  // ═══════════════════════════════════════════════════════════════════════════════

  it('single-expression — public function forms — @op = -> "Hello" as Text', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'greet4', from: 'c' } },
      { output: { id: '1', 'ty': ['Text'], re: ['Hello from Brevity!'], to: 'c' } },
    );
  });

  it('single-expression — public function forms — @op = -> 42 as Integer', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'answer4', from: 'c' } },
      { output: { id: '1', 'ty': ['Integer'], re: [42], to: 'c' } },
    );
  });

  it('single-expression — public function forms — @op = (n: Integer) -> :n', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[{ n: 7 }], 'echo'], 'ty': [[{ n: 'Integer' }]], from: 'c' } },
      { output: { id: '1', 'ty': [{ n: 'Integer' }], re: [{ n: 7 }], to: 'c' } },
    );
  });

  it('single-expression — public function forms — @op = -> true as Boolean', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'alive', from: 'c' } },
      { output: { id: '1', 'ty': ['Boolean'], re: [true], to: 'c' } },
    );
  });
});
