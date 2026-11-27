import { expectBehavior, compileSource } from '../helpers.js';

// Arithmetic on call results computes in the type it's assigned to: a reply has no
// type of its own until then. `x Integer = f() + g()`.

describe('arithmetic on untyped call results', () => {
  const script = `
    f = { 2 }
    g = { 3 }

    @own = {
      x Integer = f() + g() * f()
      return x
    }

    C = *{
      own = () -> 1
      @outer = {
        x Integer = f() + g()
        return x
      }
      @viaClass = {
        x Integer = class::h() - own() + C::h()
        return x
      }
    } ^ {
      h = () -> 4
    }

    @outer = {
      c = C()
      return c.outer()
    }

    @viaClass = {
      c = C()
      return c.viaClass()
    }
  `;

  it('own functions', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'own', from: 'c' } },
      { output: { id: '1', ty: ['Integer'], re: [8], to: 'c' } },
    );
  });

  it('an enclosing actor\'s functions, from a class', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'outer', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [5], to: 'c' }) },
    );
  });

  it('the class block\'s functions, through `class::` and `C::`', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'viaClass', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [7], to: 'c' }) },
    );
  });
});

// Where nothing types the operands (a call to a function that passes its untyped
// param back, or a recursive call, which doesn't type itself) or the result (a
// private function's reply), the runtime picks the arithmetic: an Integer past
// 64 bits stays whole.
describe('arithmetic on call results nothing types', () => {
  const script = `
    same = (x) -> x
    big = (n Integer) {
      if n > 0 { return big(n - 1) }
      return 9223372036854775807
    }

    sum = { return same(9223372036854775807) + same(1) }
    product = { return big(2) * big(1) }

    @passedBack = {
      x Integer = sum()
      return x
    }
    @recursive = {
      x Integer = product()
      return x
    }
  `;

  it('a function that passes its untyped param back', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'passedBack', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [9223372036854775808n], to: 'c' }) },
    );
  });

  it('a recursive function', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'recursive', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [85070591730234615847396907784232501249n], to: 'c' }) },
    );
  });
});

// A message send used as an operand is its reply's value: of an operator, as an
// arg, in interpolated text, as a condition.
describe('a send as an operand', () => {
  const script = `
    K = *{ @n = () -> 10 }
    double = (i Integer) -> i * 2
    @bin = {
      k = K()
      x Integer = k.n() + 1
      return x
    }
    @arg = {
      k = K()
      x Integer = double(k.n())
      y List[Integer] = List.append([1], k.n())
      z Integer = Math.max(k.n(), 3)
      return x, y, z
    }
    @interp = {
      k = K()
      t Text = "n=#{k.n()}"
      return t
    }
    @cond = {
      k = K()
      if (k.n() > 5) return "big"
      return "small"
    }
  `;

  it('of an operator', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'bin', from: 'c' } },
      { output: { id: '1', re: [11], ty: ['Integer'], to: 'c' } },
    );
  });

  it('as an arg', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'arg', from: 'c' } },
      { output: { id: '1', re: [20, [1, 10], 10], ty: ['Integer', 'List[Integer]', 'Integer'], to: 'c' } },
    );
  });

  it('in interpolated text', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'interp', from: 'c' } },
      { output: { id: '1', re: ['n=10'], ty: ['Text'], to: 'c' } },
    );
  });

  it('as a condition', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'cond', from: 'c' } },
      { output: { id: '1', re: ['big'], ty: ['Text'], to: 'c' } },
    );
  });
});

// Arithmetic takes numbers; `+` also joins two Texts or two Lists. A value known to
// be something else is an error; an unknown type is accepted.
describe('arithmetic — operands are checked by type', () => {
  it('a Boolean operand', () => {
    expect(() => compileSource(`
      @f = (n Integer) { m Integer = n + true; return m }
    `)).toThrow("'+' adds numbers, or joins two Texts or two Lists, got an Integer and a Boolean");
  });

  it('a Text and a number', () => {
    expect(() => compileSource(`
      @f = (a Text, n Integer) { c Text = a + n; return c }
    `)).toThrow("'+' adds numbers, or joins two Texts or two Lists, got a Text and an Integer");
  });

  it("'-' on Text", () => {
    expect(() => compileSource(`
      @f = (a Text, b Text) { c Text = a - b; return c }
    `)).toThrow("'-' takes numbers, got a Text");
  });

  it('an element in reduce typed by its slot', () => {
    expect(() => compileSource(`
      xs *List[Integer] = [1]
      @f = { r Integer = reduce(0, xs) (acc, x) { acc + Text.size(x) }; return r }
    `)).toThrow("'Text.size' takes a Text, got an Integer");
  });

  it('numbers, two Texts and two Lists compile', () => {
    expect(() => compileSource(`
      @f = (n Integer, d Decimal, a Text, b Text) {
        x Decimal = n + d
        t Text = a + b
        l List[Integer] = [1] + [2]
        return x
      }
    `)).not.toThrow();
  });
});
