import { expectBehavior, compileSource } from '../helpers.js';

describe('arguments', () => {
  const script = `
    @multInline
      =
      a Integer
      b Integer
      =
      x Integer = a * b
      return (x)

    @multOpen
      =
      a Integer
      b Integer
      =
      x Integer = a * b
      return
        x

    @keyMapped
      =
      outer: inner Text
      =
      ->(result: inner)

    @mixed
      =
      a Integer
      b Integer
      message: Text
      =
      result Integer = a + b
      return
        result
        comment: message
  `;

  it('positional args — explicit inline', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[3, 5], '@multInline'], 'bv-a': [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [15], to: 'c' } },
    );
  });

  it('positional args — lineal form', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [[3, 5], '@multOpen'], 'bv-a': [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '2', 'bv-a': ['Integer'], re: [15], to: 'c' } },
    );
  });

  it('key-mapped arg — outer: inner Text', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [{ outer: 'hello' }, '@keyMapped'], 'bv-a': [{ outer: 'Text' }], from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'hello' }, to: 'c' } },
    );
  });

  it('mixed positional + named args', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [[1, 2, { message: 'add this' }], '@mixed'], 'bv-a': [['Integer', 'Integer', { message: 'Text' }]], from: 'c' } },
      { output: { id: '4', 'bv-a': ['Integer', { comment: 'Text' }], re: [3, { comment: 'add this' }], to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Optional arguments — positional
// ═══════════════════════════════════════════════════════════════════════════════

describe('optional arguments — positional', () => {
  const script = `
    --- typed positional with default ---

    @posTyped
      =
      a Integer
      b Integer = 0
      =
      result Integer = a + b
      return (result)

    --- inferred positional (no type annotation) ---

    @posInferred
      =
      a Integer
      b=100
      =
      result Integer = a + b
      return (result)

    --- delimited form ---

    @posDelimited = (a Integer, b Integer = 5) {
      result Integer = a + b
      return (result)
    }

    --- type-inferred delimited ---

    @posInferredDelimited = (a Integer, b=50) {
      result Integer = a + b
      return (result)
    }
  `;

  it('typed — both args provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[3, 7], '@posTyped'], 'bv-a': [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [10], to: 'c' } },
    );
  });

  it('typed — optional omitted, default fills in', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [[3], '@posTyped'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '2', 'bv-a': ['Integer'], re: [3], to: 'c' } },
    );
  });

  it('inferred — both args provided', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [[3, 7], '@posInferred'], 'bv-a': [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '3', 'bv-a': ['Integer'], re: [10], to: 'c' } },
    );
  });

  it('inferred — optional omitted, default 100 fills in', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [[3], '@posInferred'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '4', 'bv-a': ['Integer'], re: [103], to: 'c' } },
    );
  });

  it('delimited — both args provided', async () => {
    await expectBehavior(script,
      { input: { id: '5', op: [[10, 20], '@posDelimited'], 'bv-a': [['Integer', 'Integer']], from: 'c' } },
      { output: { id: '5', 'bv-a': ['Integer'], re: [30], to: 'c' } },
    );
  });

  it('delimited — optional omitted, default 5 fills in', async () => {
    await expectBehavior(script,
      { input: { id: '6', op: [[10], '@posDelimited'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '6', 'bv-a': ['Integer'], re: [15], to: 'c' } },
    );
  });

  it('delimited inferred — optional omitted, default 50 fills in', async () => {
    await expectBehavior(script,
      { input: { id: '7', op: [[10], '@posInferredDelimited'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '7', 'bv-a': ['Integer'], re: [60], to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Optional arguments — named
// ═══════════════════════════════════════════════════════════════════════════════

describe('optional arguments — named', () => {
  const script = `
    --- typed named with default ---

    @namedTyped
      =
      a: Text
      b: Text = "world"
      =
      -> result: a + " " + b

    --- named, no type, = value ---

    @namedInferred
      =
      a: Text
      b: = "default"
      =
      -> result: a + " " + b
  `;

  it('typed — both named args provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{ a: 'hey', b: 'there' }, '@namedTyped'], 'bv-a': [{ a: 'Text', b: 'Text' }], from: 'c' } },
      { output: { id: '1', 'bv-a': { result: 'Text' }, re: { result: 'hey there' }, to: 'c' } },
    );
  });

  it('typed — optional named omitted, default fills in', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [{ a: 'hello' }, '@namedTyped'], 'bv-a': [{ a: 'Text' }], from: 'c' } },
      { output: { id: '2', 'bv-a': { result: 'Text' }, re: { result: 'hello world' }, to: 'c' } },
    );
  });

  it('inferred — both named args provided', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [{ a: 'hey', b: 'there' }, '@namedInferred'], 'bv-a': [{ a: 'Text', b: 'Text' }], from: 'c' } },
      { output: { id: '3', 'bv-a': { result: 'Text' }, re: { result: 'hey there' }, to: 'c' } },
    );
  });

  it('inferred — optional named omitted, default fills in', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [{ a: 'hello' }, '@namedInferred'], 'bv-a': [{ a: 'Text' }], from: 'c' } },
      { output: { id: '4', 'bv-a': { result: 'Text' }, re: { result: 'hello default' }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Optional arguments — mixed positional + named
// ═══════════════════════════════════════════════════════════════════════════════

describe('optional arguments — mixed', () => {
  const script = `
    @mixedOpt
      =
      a Integer
      b: Integer = 99
      =
      result Integer = a + b
      return (result)
  `;

  it('positional + named both provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[10, { b: 5 }], '@mixedOpt'], 'bv-a': [['Integer', { b: 'Integer' }]], from: 'c' } },
      { output: { id: '1', 'bv-a': ['Integer'], re: [15], to: 'c' } },
    );
  });

  it('named optional omitted, default fills in', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: [[10], '@mixedOpt'], 'bv-a': [['Integer']], from: 'c' } },
      { output: { id: '2', 'bv-a': ['Integer'], re: [109], to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Optional arguments — lineal function form
// ═══════════════════════════════════════════════════════════════════════════════

describe('optional arguments — lineal function', () => {
  const script = `
    combine
      =
      a Integer
      b=1000
      =
      result Integer = a + b
      return result: result

    @testLinealBoth
      =
      result: r Integer = combine(5, 2)
      return :r

    @testLinealDefault
      =
      result: r Integer = combine(5)
      return :r
  `;

  it('lineal fn — both args provided', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@testLinealBoth', from: 'c' } },
      { output: { id: '1', 'bv-a': { r: 'Integer' }, re: { r: 7 }, to: 'c' } },
    );
  });

  it('lineal fn — optional uses default 1000', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@testLinealDefault', from: 'c' } },
      { output: { id: '2', 'bv-a': { r: 'Integer' }, re: { r: 1005 }, to: 'c' } },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Optional arguments — compilation checks
// ═══════════════════════════════════════════════════════════════════════════════

describe('optional arguments — compilation', () => {
  it('positional optional must come after required positionals', () => {
    expect(() => compileSource(`
      @bad
        =
        a Integer = 0
        b Integer
        =
        ->(a)
    `)).toThrow();
  });

  it('typed positional with default compiles', () => {
    expect(() => compileSource(`
      @ok
        =
        a Integer
        b Integer = 5
        =
        result Integer = a + b
        return (result)
    `)).not.toThrow();
  });

  it('inferred type from default compiles', () => {
    expect(() => compileSource(`
      @ok
        =
        a Integer
        b=5
        =
        result Integer = a + b
        return (result)
    `)).not.toThrow();
  });

  it('named with default compiles', () => {
    expect(() => compileSource(`
      @ok
        =
        a: Text
        b: Text = "x"
        =
        -> result: a
    `)).not.toThrow();
  });

  it('named shorthand default compiles', () => {
    expect(() => compileSource(`
      @ok
        =
        a: Text
        b: = "x"
        =
        -> result: a
    `)).not.toThrow();
  });
});

describe('a call that leaves out every arg', () => {
  const bodies = `
      @one = (i Integer = 1) { return i }
      @two = (i Integer = 1, t Text = "x") { return t }
      @withNamed = (i Integer = 1, n: Text = "x") { return n }
      @onlyNamed = (i: Integer = 1) { return i }
      @positionalRequired = (a Integer, i Integer = 1) { return i }
      @namedRequired = (i Integer = 1, n: Text) { return i }
      @listRequired = (l List, i Integer = 1) { return i }
      @required = (a Integer) { return a }
  `;
  const script = `${bodies}
    @Box = *{${bodies}}
  `;
  const newBox = [
    { input: { id: '1', op: [{}, '#new'], to: '@Box', from: 'c' } },
    { output: { id: '1', re: '#<@Box/1>', 'bv-a': '#<@Box>', to: 'c' } },
  ];
  const atBox = { to: '@Box/1', from: 'c' };
  const fromBox = { to: 'c', from: '@Box/1' };

  describe.each([
    ['@one', [1], ['Integer']],
    ['@two', ['x'], ['Text']],
    ['@withNamed', ['x'], ['Text']],
    ['@onlyNamed', [1], ['Integer']],
  ])('%s has nothing required', (op, re, tag) => {
    it('uses its defaults in a file handler', async () => {
      await expectBehavior(script,
        { input: { id: '1', op, from: 'c' } },
        { output: { id: '1', re, 'bv-a': tag, to: 'c' } },
      );
    });
    it('uses its defaults in an instance', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op, ...atBox } },
        { output: { id: '2', re, 'bv-a': tag, ...fromBox } },
      );
    });
  });

  describe.each([
    ['@positionalRequired'],
    ['@namedRequired'],
    ['@listRequired'],
    ['@required'],
  ])('%s has something required', (op) => {
    it('answers unhandled in a file handler', async () => {
      await expectBehavior(script,
        { input: { id: '1', op, from: 'c' } },
        { output: { id: '1', ex: { [op]: 'unhandled' }, to: 'c' } },
      );
    });
    it('answers unhandled in an instance', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op, ...atBox } },
        { output: { id: '2', ex: { [op]: 'unhandled' }, ...fromBox } },
      );
    });
  });

  describe('an optional param given an arg', () => {
    it('still answers unhandled for a wrong tag', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: [['x'], '@one'], 'bv-a': [['Text']], ...atBox } },
        { output: { id: '2', ex: { '@one': 'unhandled' }, ...fromBox } },
        { input: { id: '3', op: [['x'], '@one'], 'bv-a': [['Text']], from: 'c' } },
        { output: { id: '3', ex: { '@one': 'unhandled' }, to: 'c' } },
      );
    });
    it('still asks for a schema with no tags', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: [[5], '@one'], ...atBox } },
        { output: { id: '2', ex: { '@one': 'schema_required' }, ...fromBox } },
        { input: { id: '3', op: [[5], '@one'], from: 'c' } },
        { output: { id: '3', ex: { '@one': 'schema_required' }, to: 'c' } },
      );
    });
    it('still takes a right tag', async () => {
      await expectBehavior(script, ...newBox,
        { input: { id: '2', op: [[5], '@one'], 'bv-a': [['Integer']], ...atBox } },
        { output: { id: '2', re: [5], 'bv-a': ['Integer'], ...fromBox } },
        { input: { id: '3', op: [[5], '@one'], 'bv-a': [['Integer']], from: 'c' } },
        { output: { id: '3', re: [5], 'bv-a': ['Integer'], to: 'c' } },
      );
    });
  });
});
