import { expectBehavior, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Constructor overloading
//
// Every constructor binding is an Overload — an ordered list of clauses.
//   = creates a new overload (single clause)
//   << appends a clause (tail — tried last)
//   >> prepends a clause (head — tried first)
// Dispatch: first match wins based on constructor args.
// Duplicate = on the same name is a redefinition error.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Compilation: basic constructor overload forms ────────────────────────────

describe('constructor overload — compilation', () => {
  it('single clause with = compiles', () => {
    expect(() => compileSource(`
      Pair = <a Integer, b Integer> {
        @sum = -> total: (a + b) as Integer
      }
      @test = { p = Pair(1, 2); :total = p.sum(); -> :total as Integer }
    `)).not.toThrow();
  });

  it('<< appends constructor clause — compiles', () => {
    expect(() => compileSource(`
      Box = <value Integer> {
        @get = -> result: value as Integer
      }
      Box << <label Text> {
        @get = -> result: 0 as Integer
      }
      @test = { b = Box(42); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('>> prepends constructor clause — compiles', () => {
    expect(() => compileSource(`
      Box = <value Integer> {
        @get = -> result: value as Integer
      }
      Box >> <label Text> {
        @get = -> result: 0 as Integer
      }
      @test = { b = Box(42); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('duplicate = on same constructor name is a redefinition error', () => {
    expect(() => compileSource(`
      Box = <value Integer> {
        @get = -> result: value as Integer
      }
      Box = <label Text> {
        @get = -> result: 0 as Integer
      }
      @test = -> 1 as Integer
    `)).toThrow();
  });

  it('<< without prior = is an error', () => {
    expect(() => compileSource(`
      Box << <value Integer> {
        @get = -> result: value as Integer
      }
      @test = -> 1 as Integer
    `)).toThrow();
  });
});

// ── Compilation: lineal constructor overload ─────────────────────────────────

describe('constructor overload — lineal form — compilation', () => {
  it('lineal = followed by lineal << compiles', () => {
    expect(() => compileSource(`
      Box
      <
        value Integer
      >
      =
        @get = -> result: value as Integer
      .

      Box <<
      <
        label Text
      >
      =
        @get = -> result: 0 as Integer
      .

      @test = { b = Box(42); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('lineal duplicate = on same constructor is a redefinition error', () => {
    expect(() => compileSource(`
      Box
      <
        value Integer
      >
      =
        @get = -> result: value as Integer
      .

      Box
      <
        label Text
      >
      =
        @get = -> result: 0 as Integer
      .

      @test = -> 1 as Integer
    `)).toThrow();
  });
});

// ── Compilation: sugared constructor overload ────────────────────────────────

describe('constructor overload — sugared form — compilation', () => {
  it('sugared = followed by sugared << compiles', () => {
    expect(() => compileSource(`
      Box = <
        value Integer
        @get = -> result: value as Integer
      >
      Box << <
        label Text
        @get = -> result: 0 as Integer
      >
      @test = { b = Box(42); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });
});

// ── Runtime: << appends constructor clause ───────────────────────────────────

describe('constructor overload — << append — runtime', () => {
  const script = `
    Wrapper = <value Integer> {
      @get = -> result: value as Integer
      @kind = -> result: "integer" as Text
    }
    Wrapper << <label Text> {
      @get = -> result: 0 as Integer
      @kind = -> result: "text" as Text
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

// ── Runtime: >> prepends constructor clause ──────────────────────────────────

describe('constructor overload — >> prepend — runtime', () => {
  const script = `
    Wrapper = <value Integer> {
      @kind = -> result: "integer" as Text
    }
    Wrapper >> <a Integer, b Integer> {
      @kind = -> result: "pair" as Text
    }

    @testPair
      =
      w = Wrapper(1, 2)
      :result = w.kind()
      -> :result as Text

    @testSingle
      =
      w = Wrapper(42)
      :result = w.kind()
      -> :result as Text
  `;

  it('2-arg matches prepended clause (tried first)', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testPair', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'pair' }, to: 'c' } },
    );
  });

  it('1-arg matches original clause (tried second)', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testSingle', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'integer' }, to: 'c' } },
    );
  });
});

// ── Runtime: arity-based constructor dispatch ───────────────────────────────

describe('constructor overload — arity dispatch — runtime', () => {
  const script = `
    Point = <x Integer> {
      @coords = -> result: x as Integer
    }
    Point << <x Integer, y Integer> {
      @coords = -> result: (x + y) as Integer
    }
    Point << <x Integer, y Integer, z Integer> {
      @coords = -> result: (x + y + z) as Integer
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
    Container
    <
      value Integer
    >
    =
      @get = -> result: value as Integer
    .

    Container <<
    <
      label Text
    >
    =
      @get = -> result: 0 as Integer
      @label = -> result: label as Text
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

// ── Runtime: subtype constructor overload ────────────────────────────────────

describe('constructor overload — subtypes — runtime', () => {
  const script = `
    Base = <a Integer> {
      @get = -> result: a as Integer
    }

    Sub = <<Base> b Integer> {
      @sum = -> result: (a + b) as Integer
    }
    Sub << <<Base> b Text> {
      @sum = -> result: a as Integer
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

  it('integer subtype arg matches first clause', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testIntSub', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Integer' }, re: { result: 10 }, to: 'c' } },
    );
  });

  it('text subtype arg matches appended clause', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testTextSub', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Integer' }, re: { result: 3 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Function() — empty constructor overload initialization
//
// Function() creates an empty overload with zero clauses.
// All clauses are added via << / >>.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Function() — empty overload — compilation', () => {
  it('Function() compiles', () => {
    expect(() => compileSource(`
      Box = Function()
      Box << <value Integer> {
        @get = -> result: value as Integer
      }
      @test = { b = Box(42); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('Function() with multiple << clauses compiles', () => {
    expect(() => compileSource(`
      Box = Function()
      Box << <value Integer> {
        @get = -> result: value as Integer
      }
      Box << <label Text> {
        @get = -> result: 0 as Integer
      }
      @test = { b = Box(42); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('Function() with >> compiles', () => {
    expect(() => compileSource(`
      Box = Function()
      Box << <value Integer> {
        @get = -> result: value as Integer
      }
      Box >> <a Integer, b Integer> {
        @get = -> result: (a + b) as Integer
      }
      @test = { b = Box(1, 2); :result = b.get(); -> :result as Integer }
    `)).not.toThrow();
  });

  it('bare Function() with no clauses compiles', () => {
    expect(() => compileSource(`
      Box = Function()
      @test = -> 1 as Integer
    `)).not.toThrow();
  });
});

describe('Function() — empty overload — runtime', () => {
  const script = `
    Shape = Function()
    Shape << <side Integer> {
      @area = -> result: (side * side) as Integer
      @kind = -> result: "square" as Text
    }
    Shape << <width Integer, height Integer> {
      @area = -> result: (width * height) as Integer
      @kind = -> result: "rect" as Text
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

describe('Function() — reorder with >> — runtime', () => {
  const script = `
    Box = Function()
    Box << <value Integer> {
      @kind = -> result: "number" as Text
    }
    Box >> <a Integer, b Integer> {
      @kind = -> result: "pair" as Text
    }

    @testPair
      =
      b = Box(1, 2)
      :result = b.kind()
      -> :result as Text

    @testSingle
      =
      b = Box(42)
      :result = b.kind()
      -> :result as Text
  `;

  it('>> clause tried first — pair matches', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testPair', from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'pair' }, to: 'c' } },
    );
  });

  it('single arg falls through to << clause', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testSingle', from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'number' }, to: 'c' } },
    );
  });
});
