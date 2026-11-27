import { expectBehavior, expectLocalAndRemote, compileSource } from '../helpers.js';

// `v |> f(a)` is `f(v, a)`; a bare callee takes the value alone. The lowest binary
// operator, left-associative; a line may start with `|>`
// (notes/pipe-and-clause-lists-settled-2026-11-26.md).
describe('|> — runtime', () => {
  const script = `
    inc = (a Integer) -> a + 1
    pair = (a Integer, b Integer) -> a * 10 + b
    n *Integer = 0
    note! = (a Integer) {
      n <- a
      return a
    }
    Box = *(k Integer) {
      @scaled = (by Integer) -> k * by
    }

    @call = (v Integer) {
      x Integer = v |> pair(2)
      return x
    }
    @bare = (v Integer) {
      x Integer = v |> inc
      return x
    }
    @chain = (v Integer) {
      x Integer = v |> inc |> pair(3)
      return x
    }
    @lowest = (v Integer) {
      x Integer = v + 1 |> inc
      return x
    }
    @member = (v Integer) {
      b = Box(4)
      x Integer = v |> b.scaled()
      return x
    }
    @writes! = (v Integer) {
      x Integer = v |> note!()
      return n
    }
    @lines = (v Integer) {
      x Integer = v
        |> inc
        |> pair(5)
      return x
    }
    @text = (t Text) {
      s Text = t |> Text.after("-") |> Text.trim()
      return s
    }
  `;

  it('a call takes the value first; a bare callee takes it alone', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[7], 'call'], ty: [['Integer']], from: 'c' } },
      { output: { id: '1', re: [72], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: [[7], 'bare'], ty: [['Integer']], from: 'c' } },
      { output: { id: '2', re: [8], ty: ['Integer'], to: 'c' } },
    );
  });

  it('left-associative, and the lowest operator', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[7], 'chain'], ty: [['Integer']], from: 'c' } },
      { output: { id: '1', re: [83], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: [[7], 'lowest'], ty: [['Integer']], from: 'c' } },
      { output: { id: '2', re: [9], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a member call, and a writing call', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[3], 'member'], ty: [['Integer']], from: 'c' } },
      { output: { id: '1', re: [12], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: [[6], 'writes!'], ty: [['Integer']], from: 'c' } },
      { output: { id: '2', re: [6], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a line may start with |>', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[7], 'lines'], ty: [['Integer']], from: 'c' } },
      { output: { id: '1', re: [85], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a core method', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [['a- b '], 'text'], ty: [['Text']], from: 'c' } },
      { output: { id: '1', re: ['b'], ty: ['Text'], to: 'c' } },
    );
  });
});

describe('|> — a remote call', () => {
  const service = `
    @lookup = (a Integer, b Integer) -> a * 10 + b
  `;
  const go = `
    @go = (v Integer) {
      x Integer = v |> Svc.lookup(2)
      return x
    }
  `;

  it('takes the value first, as a local one does', async () => {
    await expectLocalAndRemote({
      local: `Svc = actor {${service}}\n${go}`,
      parent: service,
      child: `use Svc = "svc"\n${go}`,
    },
      { input: { id: '1', op: [[4], 'go'], ty: [['Integer']], from: 'c' } },
      { output: { id: '1', re: [42], ty: ['Integer'], to: 'c' } },
    );
  });
});

describe('|> — compile errors', () => {
  it('a literal on the right', () => {
    expect(() => compileSource(`
      @g = (v Integer) -> v |> 3
    `)).toThrow("The right of '|>' is a call or a function: 'v |> f(a)' or 'v |> f'");
  });

  it('an unbound name on the right', () => {
    expect(() => compileSource(`
      @g = (v Integer) -> v |> nothing
    `)).toThrow("'nothing' is not defined");
  });
});
