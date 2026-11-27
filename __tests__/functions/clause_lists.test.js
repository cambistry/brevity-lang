import { expectBehavior, compileSource } from '../helpers.js';

// A list literal of clauses, `head -> value`, is a function: tried in order, the
// first clause whose heads match answers; no match is unhandled
// (notes/clause-lists-2026-11-25.md, notes/pipe-and-clause-lists-settled-2026-11-26.md).
describe('clause lists', () => {
  const script = `
    n *Integer = 0
    pair = [
      0, y -> y
      x, 0 -> x * 100
      x, y -> x + y
    ]
    sign = [
      0 -> "zero"
      (n Integer) -> if (n > 0) "plus" else "minus"
    ]

    @key = (k Text, t Integer) {
      v Integer = k |> [
        "enter" | "esc" -> 1
        "r" -> {
          w Integer = t * 2
          w + 1
        }
        (t > 5) -> 3
        else -> 4
      ]
      return v
    }
    @pair = (a Integer, b Integer) {
      v Integer = pair(a, b)
      return v
    }
    @sign = (k Integer) {
      v Text = sign(k)
      return v
    }
    @strict = (k Text) {
      v Integer = k |> [
        "a" -> 1
      ]
      return v
    }
    @bump! = (k Text) {
      v Integer = k |> [
        "up" -> {
          n <- n + 1
          n
        }
        else -> n
      ]
      return v
    }
    @answer = [
      "yes" -> 1
      "no" -> 0
    ]
  `;

  it('literal and union heads, a block body, a condition, else', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [['esc', 0], 'key'], ty: [['Text', 'Integer']], from: 'c' } },
      { output: { id: '1', re: [1], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: [['r', 4], 'key'], ty: [['Text', 'Integer']], from: 'c' } },
      { output: { id: '2', re: [9], ty: ['Integer'], to: 'c' } },
      { input: { id: '3', op: [['x', 6], 'key'], ty: [['Text', 'Integer']], from: 'c' } },
      { output: { id: '3', re: [3], ty: ['Integer'], to: 'c' } },
      { input: { id: '4', op: [['x', 1], 'key'], ty: [['Text', 'Integer']], from: 'c' } },
      { output: { id: '4', re: [4], ty: ['Integer'], to: 'c' } },
    );
  });

  it('one head per argument; a name binds it; the first match answers', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[0, 7], 'pair'], ty: [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '1', re: [7], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: [[3, 0], 'pair'], ty: [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '2', re: [300], ty: ['Integer'], to: 'c' } },
      { input: { id: '3', op: [[3, 4], 'pair'], ty: [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '3', re: [7], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a typed head binds a value of that type', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[0], 'sign'], ty: [['Integer']], from: 'c' } },
      { output: { id: '1', re: ['zero'], ty: ['Text'], to: 'c' } },
      { input: { id: '2', op: [[-2], 'sign'], ty: [['Integer']], from: 'c' } },
      { output: { id: '2', re: ['minus'], ty: ['Text'], to: 'c' } },
    );
  });

  it('a write in a clause belongs to the function that defines it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [['up'], 'bump!'], ty: [['Text']], from: 'c' } },
      { output: { id: '1', re: [1], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: [['down'], 'bump!'], ty: [['Text']], from: 'c' } },
      { output: { id: '2', re: [1], ty: ['Integer'], to: 'c' } },
    );
  });

  it('no match: a public clause list is unhandled; inside a function, the call fails', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [['yes'], 'answer'], ty: [['Text']], from: 'c' } },
      { output: { id: '1', re: [1], to: 'c' } },
      { input: { id: '2', op: [['maybe'], 'answer'], ty: [['Text']], from: 'c' } },
      { output: { id: '2', ex: { answer: 'unhandled' }, to: 'c' } },
      { input: { id: '3', op: [['b'], 'strict'], ty: [['Text']], from: 'c' } },
      { output: { id: '3', ex: { strict: 'error' }, to: 'c' } },
    );
  });
});

describe('clause lists — compile errors', () => {
  it('else comes last', () => {
    expect(() => compileSource(`
      @g = (k Text) -> k |> [
        else -> 1
        "a" -> 2
      ]
    `)).toThrow("In a clause list, a clause that takes any value ('else', or bare names) is the last: the ones after it can never match");
  });

  it('every entry is a clause', () => {
    expect(() => compileSource(`
      @g = (k Text) -> k |> [
        "a" -> 1
        2
      ]
    `)).toThrow("Every entry of a clause list is a clause: 'head -> value'");
  });

  it('the clauses take the same number of arguments', () => {
    expect(() => compileSource(`
      f = [
        0 -> 1
        x, y -> 2
      ]
    `)).toThrow('The clauses of a list take the same number of arguments: here 1 and 2');
  });

  it('a Boolean is matched with if/else', () => {
    expect(() => compileSource(`
      @g = (b Boolean) -> b |> [
        true -> 1
        else -> 0
      ]
    `)).toThrow('A Boolean is matched with if/else');
  });
});

// `Function()` and a typed `[]` are the same empty clause list, typed by the
// declaration; `<<` appends to it.
describe('the empty clause list', () => {
  const script = `
    shape (Integer) -> (Text) = []
    shape << (n Integer) -> "n"
    other (Integer) -> (Text) = Function()
    other << (n Integer) -> "o"
    @shape = (k Integer) {
      v Text = shape(k)
      return v
    }
    @other = (k Integer) {
      v Text = other(k)
      return v
    }
    @local = (k Integer) {
      f (Integer) -> (Text) = []
      f << (n Integer) -> "l"
      v Text = f(k)
      return v
    }
  `;

  it('a typed [] in a class and in a body, and Function()', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[1], 'shape'], ty: [['Integer']], from: 'c' } },
      { output: { id: '1', re: ['n'], ty: ['Text'], to: 'c' } },
      { input: { id: '2', op: [[1], 'other'], ty: [['Integer']], from: 'c' } },
      { output: { id: '2', re: ['o'], ty: ['Text'], to: 'c' } },
      { input: { id: '3', op: [[1], 'local'], ty: [['Integer']], from: 'c' } },
      { output: { id: '3', re: ['l'], ty: ['Text'], to: 'c' } },
    );
  });

  it('an untyped [] is a List, which is not called', () => {
    expect(() => compileSource(`
      @g = (k Integer) {
        xs = []
        v Integer = xs(k)
        return v
      }
    `)).toThrow("'xs' is a List, which isn't called: a clause list is written 'head -> value' per entry");
  });
});

// A clause's body is checked with the name it binds, as written.
describe('clause lists — a clause body is checked', () => {
  it('a bind of a bound head', () => {
    expect(() => compileSource(`
      @g = (key Integer) {
        r Integer = key |> [
          0 -> 1
          x -> {
            t Text = x
            2
          }
        ]
        return r
      }
    `)).toThrow("Cannot bind 't Text' to 'x', which is Integer");
  });
});
