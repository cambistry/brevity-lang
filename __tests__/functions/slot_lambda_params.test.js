import { expectBehavior, compileSource } from '../helpers.js';

// A lambda's params take their types from the slot it's in: each element in `over`
// (and `List.map`, `filter`, `find`, which are `over`) and `List.sort`; the seed and
// each element in `reduce`; the value a `sub` delivers from a cell; the subject
// piped into a clause list. Its body is checked with them.

describe('slot lambdas — run with the types their slot gives', () => {
  const script = `
    T = *(x Integer) { @a = () -> x }
    ts *List[T] = [T(1), T(2), T(3)]
    xs *List[Integer] = [4, 5, 6]
    @n *Integer = 0
    seen *Integer = 0
    @calls = { r List[Integer] = over(ts) (t) { t.a() }; return r }
    @sum = { r Integer = reduce(0, xs) (acc, x) { acc + x }; return r }
    @found = { r Integer = List.find(xs, (x) -> x > 4); return r }
    @watch. = { sub @n, (v) { seen <- seen + v } }
    @bump! = { @n <- 7; x Integer = seen; return x }
    @piped = (k Integer) {
      r Integer = k |> [
        (k > 5) -> 0
        y -> y + 1
      ]
      return r
    }
  `;

  it("over: a class's method through each untyped element", async () => {
    await expectBehavior(script, { input: { id: '1', op: 'calls', from: 'c' } }, { output: { id: '1', ty: ['List[Integer]'], re: [[1, 2, 3]], to: 'c' } });
  });

  it('reduce: an untyped seed and element', async () => {
    await expectBehavior(script, { input: { id: '2', op: 'sum', from: 'c' } }, { output: { id: '2', ty: ['Integer'], re: [15], to: 'c' } });
  });

  it('List.find: an untyped element', async () => {
    await expectBehavior(script, { input: { id: '3', op: 'found', from: 'c' } }, { output: { id: '3', ty: ['Integer'], re: [5], to: 'c' } });
  });

  it('a clause list: an untyped head takes the subject', async () => {
    await expectBehavior(script, { input: { id: '4', op: [[2], 'piped'], ty: [['Integer']], from: 'c' } }, { output: { id: '4', ty: ['Integer'], re: [3], to: 'c' } });
  });
});

describe('slot lambdas — checked with the types their slot gives', () => {
  const head = `
    T = *(x Integer) { @a = () -> x }
    ts *List[T] = []
    xs *List[Integer] = [1, 2]
    @n *Integer = 0
    k *Text = ""
  `;

  it("over: an element's method is checked", () => {
    expect(() => compileSource(`${head}
      @f = { r List = over(ts) (t) { t.nope() }; return r }
    `)).toThrow("'T' has no method 'nope' (available: a)");
  });

  it('over: a bind of an element is checked', () => {
    expect(() => compileSource(`${head}
      @f = { r List = over(xs) (x) { t Text = x; t }; return r }
    `)).toThrow("Cannot bind 't Text' to 'x', which is Integer");
  });

  it('List.map is over', () => {
    expect(() => compileSource(`${head}
      @f = { r List = List.map(xs, (x) -> { t Text = x; t }); return r }
    `)).toThrow("Cannot bind 't Text' to 'x', which is Integer");
  });

  it('reduce: the element is checked', () => {
    expect(() => compileSource(`${head}
      @f = { r Integer = reduce(0, xs) (acc, x) { t Text = x; acc }; return r }
    `)).toThrow("Cannot bind 't Text' to 'x', which is Integer");
  });

  it('sub: the delivered value is checked', () => {
    expect(() => compileSource(`${head}
      @f. = { sub @n, (v) { t Text = v; k <- t } }
    `)).toThrow("Cannot bind 't Text' to 'v', which is Integer");
  });

  it('an explicit param type the slot cannot pass is an error', () => {
    expect(() => compileSource(`${head}
      @f = { r List = over(xs) (x Text) { x }; return r }
    `)).toThrow("'over' of List[Integer] passes 'x' an Integer, which isn't a Text");
  });

  it('an explicit param type the slot passes compiles', () => {
    expect(() => compileSource(`${head}
      @f = { r List = over(xs) (x Integer) { x + 1 }; return r }
    `)).not.toThrow();
  });
});
