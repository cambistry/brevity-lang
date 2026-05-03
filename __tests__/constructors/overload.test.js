import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Constructor overloading and optional args
//
// Every constructor binding is an Overload — an ordered list of clauses.
//   = creates a new overload (single clause)
//   << appends a clause (tail — tried last)
// Dispatch: first match wins, so place more-specific clauses before general ones.
// Optional args: if a missing arg can be supplied by a default, the match succeeds.
// Duplicate = on the same name is a redefinition error.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Compilation: basic constructor overload forms ────────────────────────────

describe('constructor overload — compilation', () => {
  it('single clause with = compiles', () => {
    expect(() => compileSource(`
      Pair = <a Integer, b Integer> {
        @sum = -> total: (a + b)
      }
      @test = { p = Pair(1, 2); :total = p.sum(); -> :total as Integer }
    `)).not.toThrow();
  });

  it('<< appends constructor clause — compiles', () => {
    expect(() => compileSource(`
      Box = <value Integer> {
        @get = -> result: value
      }
      Box << <label Text> {
        @get = -> result: 0
      }
      @test = { b = Box(42); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('duplicate = on same constructor name is a redefinition error', () => {
    expect(() => compileSource(`
      Box = <value Integer> {
        @get = -> result: value
      }
      Box = <label Text> {
        @get = -> result: 0
      }
      @test = -> 1
    `)).toThrow();
  });

  it('<< without prior = is an error', () => {
    expect(() => compileSource(`
      Box << <value Integer> {
        @get = -> result: value
      }
      @test = -> 1
    `)).toThrow();
  });
});

// ── Compilation: lineal constructor overload ─────────────────────────────────

describe('constructor overload — lineal form — compilation', () => {
  it('lineal = followed by lineal << compiles', () => {
    expect(() => compileSource(`
      Box =
      <
        value Integer
      >
      =
        @get = -> result: value
      .

      Box <<
      <
        label Text
      >
      =
        @get = -> result: 0
      .

      @test = { b = Box(42); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('lineal duplicate = on same constructor is a redefinition error', () => {
    expect(() => compileSource(`
      Box =
      <
        value Integer
      >
      =
        @get = -> result: value
      .

      Box =
      <
        label Text
      >
      =
        @get = -> result: 0
      .

      @test = -> 1
    `)).toThrow();
  });
});

// ── Compilation: sugared constructor overload ────────────────────────────────

describe('constructor overload — sugared form — compilation', () => {
  it('sugared = followed by sugared << compiles', () => {
    expect(() => compileSource(`
      Box = <
        value Integer
        @get = -> result: value
      >
      Box << <
        label Text
        @get = -> result: 0
      >
      @test = { b = Box(42); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });
});

// ── Runtime: << appends constructor clause ───────────────────────────────────

describe('constructor overload — << append — runtime', () => {
  const script = `
    Wrapper = <value Integer> {
      @get = -> result: value
      @kind = -> result: "integer"
    }
    Wrapper << <label Text> {
      @get = -> result: 0
      @kind = -> result: "text"
    }

    @testInteger
      =
      w = Wrapper(42)
      :result = w.get()
      -> :result as Integer

    @testText
      =
      w = Wrapper("hello")
      :result = w.kind()
      -> :result as Text
  `;

  it('integer arg matches first clause', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testInteger', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 42 }, to: 'c' } },
    );
  });

  it('text arg matches appended clause', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testText', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'text' }, to: 'c' } },
    );
  });
});

// ── Runtime: arity-based constructor dispatch ───────────────────────────────

describe('constructor overload — arity dispatch — runtime', () => {
  const script = `
    Point = <x Integer> {
      @coords = -> result: x
    }
    Point << <x Integer, y Integer> {
      @coords = -> result: (x + y)
    }
    Point << <x Integer, y Integer, z Integer> {
      @coords = -> result: (x + y + z)
    }

    @test1d
      =
      p = Point(5)
      :result = p.coords()
      -> :result as Integer

    @test2d
      =
      p = Point(3, 4)
      :result = p.coords()
      -> :result as Integer

    @test3d
      =
      p = Point(1, 2, 3)
      :result = p.coords()
      -> :result as Integer
  `;

  it('1-arg matches first clause', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@test1d', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' } },
    );
  });

  it('2-arg matches second clause', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@test2d', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 7 }, to: 'c' } },
    );
  });

  it('3-arg matches third clause', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@test3d', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Integer' }, re: { result: 6 }, to: 'c' } },
    );
  });
});

// ── Runtime: lineal constructor overload ─────────────────────────────────────

describe('constructor overload — lineal form — runtime', () => {
  const script = `
    Container =
    <
      value Integer
    >
    =
      @get = -> result: value
    .

    Container <<
    <
      label Text
    >
    =
      @get = -> result: 0
      @label = -> result: label
    .

    @testInt
      =
      c = Container(99)
      :result = c.get()
      -> :result as Integer

    @testLabel
      =
      c = Container("hello")
      :result = c.label()
      -> :result as Text
  `;

  it('integer arg matches first clause', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testInt', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 99 }, to: 'c' } },
    );
  });

  it('text arg matches appended clause', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testLabel', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' } },
    );
  });
});

// ── Runtime: subclass constructor overload ────────────────────────────────────

describe('constructor overload — subclasses — runtime', () => {
  const script = `
    Base = <a Integer> {
      @get = -> result: a
    }

    Sub = <Base | b Integer> {
      @sum = -> result: (a + b)
    }
    Sub << <Base | b Text> {
      @sum = -> result: a
    }

    @testIntSub
      =
      s = Sub(3, 7)
      :result = s.sum()
      -> :result as Integer

    @testTextSub
      =
      s = Sub(3, "hello")
      :result = s.sum()
      -> :result as Integer
  `;

  it('integer subclass arg matches first clause', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testIntSub', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('text subclass arg matches appended clause', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testTextSub', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Constructor optional args and overloading
// ═══════════════════════════════════════════════════════════════════════════════

// ── Delimited form: <params> { body } ───────────────────────────────────────

describe('constructor optional args — delimited form', () => {
  const script = `
    --- typed positional default ---

    Pair = <a Integer, b Integer = 0> {
      @sum = -> total: (a + b)
    }

    --- inferred positional default ---

    Offset = <a Integer, b=10> {
      @sum = -> total: (a + b)
    }

    --- named default ---

    Labeled = <:label Text = "unnamed"> {
      @get = -> label: label
    }

    @testPairBoth
      =
      p = Pair(3, 4)
      :total = p.sum()
      -> :total as Integer

    @testPairDefault
      =
      p = Pair(3)
      :total = p.sum()
      -> :total as Integer

    @testOffsetBoth
      =
      p = Offset(5, 20)
      :total = p.sum()
      -> :total as Integer

    @testOffsetDefault
      =
      p = Offset(5)
      :total = p.sum()
      -> :total as Integer

    @testLabeledProvided
      =
      l = Labeled(label: "hello")
      :label = l.get()
      -> :label as Text

    @testLabeledDefault
      =
      l = Labeled()
      :label = l.get()
      -> :label as Text
  `;

  it('typed positional — both provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testPairBoth', from: 'c' } },
      { output: { id: '1', 'bv-a': { total: 'Integer' }, re: { total: 7 }, to: 'c' } },
    );
  });

  it('typed positional — default fills in', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testPairDefault', from: 'c' } },
      { output: { id: '2', 'bv-a': { total: 'Integer' }, re: { total: 3 }, to: 'c' } },
    );
  });

  it('inferred positional — both provided', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@testOffsetBoth', from: 'c' } },
      { output: { id: '3', 'bv-a': { total: 'Integer' }, re: { total: 25 }, to: 'c' } },
    );
  });

  it('inferred positional — default 10 fills in', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@testOffsetDefault', from: 'c' } },
      { output: { id: '4', 'bv-a': { total: 'Integer' }, re: { total: 15 }, to: 'c' } },
    );
  });

  it('named — provided', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@testLabeledProvided', from: 'c' } },
      { output: { id: '5', 'bv-a': { label: 'Text' }, re: { label: 'hello' }, to: 'c' } },
    );
  });

  it('named — default fills in', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: '@testLabeledDefault', from: 'c' } },
      { output: { id: '6', 'bv-a': { label: 'Text' }, re: { label: 'unnamed' }, to: 'c' } },
    );
  });
});

// ── Sugared form: < params body > ───────────────────────────────────────────

describe('constructor optional args — sugared form', () => {
  const script = `
    --- typed positional default ---

    Box = <
      value Integer
      scale Integer = 1
      @get = -> result: (value * scale)
    >

    --- named shorthand default (:name literal) ---

    Tag = <
      query Text
      :label "default"
      @get = -> result: label
    >

    --- named with = (:name = value) ---

    Note = <
      :a = "unknown"
      @get = -> result: a
    >

    @testBoxBoth
      =
      b = Box(5, 3)
      :result = b.get()
      -> :result as Integer

    @testBoxDefault
      =
      b = Box(5)
      :result = b.get()
      -> :result as Integer

    @testTagProvided
      =
      t = Tag("search", label: "custom")
      :result = t.get()
      -> :result as Text

    @testTagDefault
      =
      t = Tag("search")
      :result = t.get()
      -> :result as Text

    @testNoteProvided
      =
      n = Note(a: "hello")
      :result = n.get()
      -> :result as Text

    @testNoteDefault
      =
      n = Note()
      :result = n.get()
      -> :result as Text
  `;

  it('positional — both provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testBoxBoth', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' } },
    );
  });

  it('positional — default 1 fills in', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testBoxDefault', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 5 }, to: 'c' } },
    );
  });

  it('named shorthand — provided', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@testTagProvided', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'custom' }, to: 'c' } },
    );
  });

  it('named shorthand — default fills in', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@testTagDefault', from: 'c' } },
      { output: { id: '4', 'bv-a': { result: 'Text' }, re: { result: 'default' }, to: 'c' } },
    );
  });

  it('named = shorthand — provided', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: '@testNoteProvided', from: 'c' } },
      { output: { id: '5', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' } },
    );
  });

  it('named = shorthand — default fills in', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: '@testNoteDefault', from: 'c' } },
      { output: { id: '6', 'bv-a': { result: 'Text' }, re: { result: 'unknown' }, to: 'c' } },
    );
  });
});

// ── Mixed positional + named optional ───────────────────────────────────────

describe('constructor optional args — mixed', () => {
  const script = `
    Config = <a Text, b=15, :c Text, :d = 20> {
      @info = -> result: (b + d)
      @label = -> result: (a + " " + c)
    }

    @testAllProvided
      =
      cfg = Config("x", 5, c: "y", d: 10)
      :result = cfg.info()
      -> :result as Integer

    @testDefaultsUsed
      =
      cfg = Config("x", c: "y")
      :result = cfg.info()
      -> :result as Integer

    @testLabels
      =
      cfg = Config("hello", c: "world")
      :result = cfg.label()
      -> :result as Text
  `;

  it('all args provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testAllProvided', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 15 }, to: 'c' } },
    );
  });

  it('optional positional + named use defaults', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testDefaultsUsed', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 35 }, to: 'c' } },
    );
  });

  it('text params passed through correctly', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@testLabels', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'hello world' }, to: 'c' } },
    );
  });
});

// ── Lineal constructor form ─────────────────────────────────────────────────

describe('constructor optional args — lineal form', () => {
  const script = `
    Item =
    <
      query Text
      :xyz "pdq"
    >
    =
      @getQuery = -> result: query
      @getXyz = -> result: xyz
    .

    @testLinealProvided
      =
      i = Item("search", xyz: "custom")
      :result = i.getXyz()
      -> :result as Text

    @testLinealDefault
      =
      i = Item("search")
      :result = i.getXyz()
      -> :result as Text

    @testLinealQuery
      =
      i = Item("hello")
      :result = i.getQuery()
      -> :result as Text
  `;

  it('lineal — named arg provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testLinealProvided', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'custom' }, to: 'c' } },
    );
  });

  it('lineal — named arg defaults', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testLinealDefault', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'pdq' }, to: 'c' } },
    );
  });

  it('lineal — positional arg works', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@testLinealQuery', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' } },
    );
  });
});

// ── Compilation checks ──────────────────────────────────────────────────────

describe('constructor optional args — compilation', () => {
  it('positional default after required compiles', () => {
    expect(() => compileSource(`
      C = <a Integer, b Integer = 0> {
        @get = -> result: a
      }
      @test = { c = C(1); :result = c.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('inferred type from default compiles', () => {
    expect(() => compileSource(`
      C = <a Integer, b=0> {
        @get = -> result: a
      }
      @test = { c = C(1); :result = c.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('named default compiles', () => {
    expect(() => compileSource(`
      C = <:label Text = "hi"> {
        @get = -> result: label
      }
      @test = { c = C(); :result = c.get(); -> :result as Text }
    `)).not.toThrow();
  });

  it('named shorthand literal default compiles', () => {
    expect(() => compileSource(`
      C = <:label "hi"> {
        @get = -> result: label
      }
      @test = { c = C(); :result = c.get(); -> :result as Text }
    `)).not.toThrow();
  });

  it('named := default compiles', () => {
    expect(() => compileSource(`
      C = <:label = "hi"> {
        @get = -> result: label
      }
      @test = { c = C(); :result = c.get(); -> :result as Text }
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Function() — empty constructor overload initialization
//
// Function() creates an empty overload with zero clauses.
// All clauses are added via <<.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Function() — empty overload — compilation', () => {
  it('Function() compiles', () => {
    expect(() => compileSource(`
      Box = Function()
      Box << <value Integer> {
        @get = -> result: value
      }
      @test = { b = Box(42); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('Function() with multiple << clauses compiles', () => {
    expect(() => compileSource(`
      Box = Function()
      Box << <value Integer> {
        @get = -> result: value
      }
      Box << <label Text> {
        @get = -> result: 0
      }
      @test = { b = Box(42); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('bare Function() with no clauses compiles', () => {
    expect(() => compileSource(`
      Box = Function()
      @test = -> 1
    `)).not.toThrow();
  });
});

describe('Function() — empty overload — runtime', () => {
  const script = `
    Shape = Function()
    Shape << <side Integer> {
      @area = -> result: (side * side)
      @kind = -> result: "square"
    }
    Shape << <width Integer, height Integer> {
      @area = -> result: (width * height)
      @kind = -> result: "rect"
    }

    @testSquare
      =
      s = Shape(5)
      :result = s.area()
      -> :result as Integer

    @testRect
      =
      s = Shape(3, 4)
      :result = s.area()
      -> :result as Integer

    @testSquareKind
      =
      s = Shape(5)
      :result = s.kind()
      -> :result as Text

    @testRectKind
      =
      s = Shape(3, 4)
      :result = s.kind()
      -> :result as Text
  `;

  it('1-arg matches square clause', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testSquare', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 25 }, to: 'c' } },
    );
  });

  it('2-arg matches rect clause', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testRect', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 12 }, to: 'c' } },
    );
  });

  it('square kind returns "square"', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: '@testSquareKind', from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'square' }, to: 'c' } },
    );
  });

  it('rect kind returns "rect"', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: '@testRectKind', from: 'c' } },
      { output: { id: '4', 'bv-a': { result: 'Text' }, re: { result: 'rect' }, to: 'c' } },
    );
  });
});

