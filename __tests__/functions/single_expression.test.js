import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Single-expression function forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('single-expression — fn = |params| -> return_vals', () => {
  it.todo('fn = |a, b| -> (a + b) as Integer — lambda arrow return');
  it.todo('fn = |name| -> name as Text — lambda arrow string return');
});

describe('single-expression — fn = |params| side_effect .', () => {
  const script = `
    count *Integer = 0

    @test
      =
      fn = |n| count <- count + n .
      fn(5)
      fn(3)
      -> :count
  `;

  it('fn = |n| side_effect . — silent function mutates state', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: { id: '1', 'bv-a': { count: 'Integer' }, re: { count: 8 }, to: 'c' } },
    );
  });
});

describe('single-expression — fn = -> return_vals (no params)', () => {
  it.todo('fn = -> 42 as Integer — no-param lambda arrow return');
  it.todo('fn = -> "hello" as Text — no-param lambda string return');
});

describe('single-expression — fn = side_effect . (no params)', () => {
  it.todo('fn = count <- count + 1 . — no-param silent lambda');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Public function single-expression forms
// ═══════════════════════════════════════════════════════════════════════════════

describe('single-expression — public function forms', () => {
  const script = `
    @greet = -> "Hello from Brevity!" as Text
    @answer = -> 42 as Integer
    @echo = |:n Integer| -> :n
    @alive = -> true as Boolean
  `;

  it('@op = -> "Hello" as Text', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@greet', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Text'], re: ['Hello from Brevity!'], to: 'c' } },
    );
  });

  it('@op = -> 42 as Integer', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@answer', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [42], to: 'c' } },
    );
  });

  it('@op = |:n Integer| -> :n', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{ n: 7 }, '@echo'], 'bv-a': [{ n: 'Integer' }], from: 'c' } },
      { output: { id: '1', 'bv-a': { n: 'Integer' }, re: { n: 7 }, to: 'c' } },
    );
  });

  it('@op = -> true as Boolean', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@alive', from: 'c' } },
      { output: { id: '1', 'bv-a': ['Boolean'], re: [true], to: 'c' } },
    );
  });
});
