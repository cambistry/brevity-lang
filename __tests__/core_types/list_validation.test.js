import { extract, compile } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// List method element-type validation — compile-time rejection of mismatches.
//
// `_bv_eq` would silently fall through to identity for cross-type comparisons,
// so a typo like `List.contains([1,2,3], "x")` would always return false rather
// than telling the user it's wrong. validate.js rejects these at compile time.
//
// Wildcards: `List of Anything` accepts any element; `Anything` matches anything.
// Anything that can't be inferred at the validate stage is allowed through —
// the rule is "reject confidently-known mismatches", not "require explicit types".
// ═══════════════════════════════════════════════════════════════════════════════

const compileSrc = (src) => {
  const { ast } = extract(src);
  return compile(ast);
};

describe('element-position arg checks (contains / index_of / before / after)', () => {
  it('contains with matching element type — OK', () => {
    expect(() => compileSrc(`
      @ok = -> result: List.contains([1, 2, 3], 2)
    `)).not.toThrow();
  });

  it('contains with Text on List of Integers — rejected', () => {
    expect(() => compileSrc(`
      @bad = -> result: List.contains([1, 2, 3], "x")
    `)).toThrow(/contains.*not compatible with element type Integer/);
  });

  it('index_of with mismatched type — rejected', () => {
    expect(() => compileSrc(`
      @bad = -> result: List.index_of([1, 2, 3], "x")
    `)).toThrow(/index_of.*not compatible with element type Integer/);
  });

  it('before with mismatched type — rejected', () => {
    expect(() => compileSrc(`
      @bad
        =
        ns List of Integers = [1, 2, 3]
        n Text = "hi"
        -> result: List.before(ns, n)
    `)).toThrow(/before.*not compatible with element type Integer/);
  });

  it('after with mismatched type — rejected', () => {
    expect(() => compileSrc(`
      @bad
        =
        ns List of Texts = ["a", "b"]
        x Integer = 1
        -> result: List.after(ns, x)
    `)).toThrow(/after.*not compatible with element type Text/);
  });

  it('List of Anything accepts any element type', () => {
    expect(() => compileSrc(`
      @ok
        =
        mixed List = [1, "two", true]
        -> result: List.contains(mixed, "two")
    `)).not.toThrow();
  });
});

describe('replace / replace_first arg checks', () => {
  it('matching old + new — OK', () => {
    expect(() => compileSrc(`
      @ok = -> result: List.replace([1, 2, 1], 1, 9)
    `)).not.toThrow();
  });

  it('mismatched old — rejected', () => {
    expect(() => compileSrc(`
      @bad = -> result: List.replace([1, 2, 1], "x", 9)
    `)).toThrow(/replace.*needle type Text is not compatible with element type Integer/);
  });

  it('mismatched new — rejected', () => {
    expect(() => compileSrc(`
      @bad = -> result: List.replace([1, 2, 1], 1, "x")
    `)).toThrow(/replace.*replacement type Text is not compatible with element type Integer/);
  });

  it('replace_first mismatch — rejected', () => {
    expect(() => compileSrc(`
      @bad = -> result: List.replace_first([1, 2, 1], "x", 9)
    `)).toThrow(/replace_first.*needle type Text is not compatible/);
  });
});

describe('list-position arg checks (starts_with / ends_with / concat)', () => {
  it('starts_with matching list — OK', () => {
    expect(() => compileSrc(`
      @ok = -> result: List.starts_with([1, 2, 3], [1, 2])
    `)).not.toThrow();
  });

  it('starts_with mismatched element type — rejected', () => {
    expect(() => compileSrc(`
      @bad
        =
        ns List of Integers = [1, 2, 3]
        prefix List of Texts = ["a", "b"]
        -> result: List.starts_with(ns, prefix)
    `)).toThrow(/starts_with.*element type Text is not compatible with Integer/);
  });

  it('concat mismatched — rejected', () => {
    expect(() => compileSrc(`
      @bad
        =
        a List of Integers = [1, 2]
        b List of Texts = ["x", "y"]
        -> result: List.concat(a, b)
    `)).toThrow(/concat.*element type Text is not compatible with Integer/);
  });

  it('concat non-List arg — rejected', () => {
    expect(() => compileSrc(`
      @bad = -> result: List.concat([1, 2], "not-a-list")
    `)).toThrow(/concat.*argument must be a List, got Text/);
  });
});

describe('element-position arg checks (append / prepend single element)', () => {
  it('append matching element type — OK', () => {
    expect(() => compileSrc(`
      @ok = -> result: List.append([1, 2], 3)
    `)).not.toThrow();
  });

  it('prepend matching element type — OK', () => {
    expect(() => compileSrc(`
      @ok = -> result: List.prepend([2, 3], 1)
    `)).not.toThrow();
  });

  it('append with mismatched element type — rejected', () => {
    expect(() => compileSrc(`
      @bad = -> result: List.append([1, 2, 3], "x")
    `)).toThrow(/append.*not compatible with element type Integer/);
  });

  it('prepend with mismatched element type — rejected', () => {
    expect(() => compileSrc(`
      @bad = -> result: List.prepend([1, 2, 3], "x")
    `)).toThrow(/prepend.*not compatible with element type Integer/);
  });
});

describe('Integer-position arg checks (at / take / from / repeat / slice)', () => {
  it('at with Integer — OK', () => {
    expect(() => compileSrc(`
      @ok = -> result: List.at([1, 2, 3], 1)
    `)).not.toThrow();
  });

  it('at with Text — rejected', () => {
    expect(() => compileSrc(`
      @bad
        =
        ns List of Integers = [1, 2, 3]
        idx Text = "1"
        -> result: List.at(ns, idx)
    `)).toThrow(/at requires an Integer index, got Text/);
  });

  it('take with Text — rejected', () => {
    expect(() => compileSrc(`
      @bad
        =
        ns List of Integers = [1, 2, 3]
        n Text = "1"
        -> result: List.take(ns, n)
    `)).toThrow(/take requires an Integer index, got Text/);
  });

  it('repeat with Text — rejected', () => {
    expect(() => compileSrc(`
      @bad
        =
        ns List of Integers = [1, 2]
        n Text = "3"
        -> result: List.repeat(ns, n)
    `)).toThrow(/repeat requires an Integer index, got Text/);
  });

  it('slice with non-Integer start — rejected', () => {
    expect(() => compileSrc(`
      @bad
        =
        ns List of Integers = [1, 2, 3, 4, 5]
        start Text = "1"
        -> result: List.slice(ns, start)
    `)).toThrow(/slice requires an Integer start, got Text/);
  });

  it('slice with non-Integer end — rejected', () => {
    expect(() => compileSrc(`
      @bad
        =
        ns List of Integers = [1, 2, 3, 4, 5]
        stopAt Text = "4"
        -> result: List.slice(ns, 1, stopAt)
    `)).toThrow(/slice requires an Integer end, got Text/);
  });
});

describe('join — restricted to List of Texts', () => {
  it('List of Texts → OK', () => {
    expect(() => compileSrc(`
      @ok = -> result: List.join(["a", "b", "c"], "-")
    `)).not.toThrow();
  });

  it('List of Integers — rejected', () => {
    expect(() => compileSrc(`
      @bad = -> result: List.join([1, 2, 3], "-")
    `)).toThrow(/join is only valid on List of Texts, got List of Integers/);
  });

  it('List of Anything — accepted (wildcard)', () => {
    expect(() => compileSrc(`
      @ok
        =
        mixed List = ["a", 1]
        -> result: List.join(mixed, "-")
    `)).not.toThrow();
  });

  it('non-Text separator — rejected', () => {
    expect(() => compileSrc(`
      @bad
        =
        words List of Texts = ["a", "b"]
        sep Integer = 5
        -> result: List.join(words, sep)
    `)).toThrow(/join separator must be Text, got Integer/);
  });
});

describe('flatten — restricted to List of Lists', () => {
  it('List of Lists of Integers → OK', () => {
    expect(() => compileSrc(`
      @ok = -> result: List.flatten([[1, 2], [3]])
    `)).not.toThrow();
  });

  it('List of Integers — rejected', () => {
    expect(() => compileSrc(`
      @bad = -> result: List.flatten([1, 2, 3])
    `)).toThrow(/flatten is only valid on a List of Lists, got List of Integers/);
  });

  it('List of Anything — accepted', () => {
    expect(() => compileSrc(`
      @ok
        =
        mixed List = [[1], "x"]
        -> result: List.flatten(mixed)
    `)).not.toThrow();
  });
});

describe('error positions across statement contexts', () => {
  it('catches misuse inside Reply', () => {
    expect(() => compileSrc(`
      @bad = -> r: List.contains([1,2,3], "x")
    `)).toThrow(/contains/);
  });

  it('catches misuse inside Assign', () => {
    expect(() => compileSrc(`
      @bad
        =
        x Boolean = List.contains([1,2,3], "x")
        -> :x
    `)).toThrow(/contains/);
  });

  it('catches misuse inside ref method receiver', () => {
    expect(() => compileSrc(`
      @bad
        =
        ns List of Integers! = [1,2,3]
        -> result: ns.contains("x")
    `)).toThrow(/contains/);
  });
});
