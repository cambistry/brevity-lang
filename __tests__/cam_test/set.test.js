import { expectBehavior } from '../helpers.js';

describe('test.set — single positional via set handler', () => {
  const script = `
      value *Integer = 0

      set
        =
        n Integer
        =
        value <- n .

      @get = -> :value
  `;

  it('sets value through `set` dispatch', async () => {
    await expectBehavior(script,
      { input: { test: { set: 42 }, from: 't' } },
      { input: { id: '1', test: { get: 'value' }, from: 't' } },
      { output: { id: '1', 'bv-a': 'Integer', re: 42, to: 't' } },
    );
  });

  it('overwrites previous value', async () => {
    await expectBehavior(script,
      { input: { test: { set: 10 }, from: 't' } },
      { input: { test: { set: 20 }, from: 't' } },
      { input: { id: '1', test: { get: 'value' }, from: 't' } },
      { output: { id: '1', 'bv-a': 'Integer', re: 20, to: 't' } },
    );
  });
});

describe('test.set — mixed positional + named args', () => {
  const script = `
      p *Integer = 0
      label *Text = ""

      set
        =
        val Integer
        label: (l) Text
        =
        p <- val
        label <- l
        .

      @getP = -> :p
      @getLabel = -> :label
  `;

  it('sets with positional + named args', async () => {
    await expectBehavior(script,
      { input: { test: { set: [11, { label: 'eleven' }] }, from: 't' }} ,
      { input: { id: '1', test: { get: 'p' }, from: 't' }} ,
      { input: { id: '2', test: { get: 'label' }, from: 't' }} ,
      { output: { id: '1', 'bv-a': 'Integer', re: 11, to: 't' }} ,
      { output: { id: '2', 'bv-a': 'Text', re: 'eleven', to: 't' } },
    );
  });
});

describe('test.set — then mutate with public function', () => {
  const script = `
      count *Integer = 0

      set
        =
        n Integer
        =
        count <- n .

      @inc = {
        count <- count + 1
        -> :count
      }

      @get = -> :count
  `;

  it('set state then increment', async () => {
    await expectBehavior(script,
      { input: { test: { set: 10 }, from: 't' } },
      { input: { id: '1', test: { op: '@inc' }, from: 't' } },
      { input: { id: '2', test: { get: 'count' }, from: 't' } },
      { output: expect.objectContaining({ id: '1', re: { count: 11 } }) },
      { output: { id: '2', 'bv-a': 'Integer', re: 11, to: 't'  }},
    );
  });
});

// Cross-target: child actor set handler (works on all targets)
describe('test.set — child actor via normal dispatch', () => {
  const script = `
      Box
        <
        seed Integer
        >
        =
        value *Integer = seed

        set
          =
          n Integer
          =
          value <- n .

        @get = -> value: value as Integer
        .
      end#Box

      @setAndGet
        =
        b = *Box(0)
        b <- 42
        :value = b.get()
        -> :value as Integer
  `;

  it('set handler works through child dispatch', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@setAndGet', from: 'c' } },
      { output: { id: '1', 'bv-a': { value: 'Integer' }, re: { value: 42 }, to: 'c' } },
    );
  });
});

describe('test.set — target child actor', () => {
  const script = `
      Box
        <
        seed Integer
        >
        =
        value *Integer = seed

        set
          =
          n Integer
          =
          value <- n .

        @get = -> value: value as Integer
        .
      end#Box

      b = *Box(0)
      @noop = -> :ok
  `;

  it('sets child state via target then reads via target', async () => {
    await expectBehavior(script,
      { input: { test: { set: 99, target: 'b' }, from: 't' } },
      { input: { id: '1', test: { get: 'value', target: 'b' }, from: 't' } },
      { output: { id: '1', 'bv-a': 'Integer', re: 99, to: 't' } },
    );
  });
});

describe('test.set — nested target', () => {
  const script = `
      Inner
        <>
        =
        val *Integer = 0
        set = |n Integer| val <- n .
        @get = -> val: val as Integer
        .

      Outer
        <>
        =
        inner = *Inner()
        @get = -> ok: "ok" as Text
        .

      o = *Outer()
      @noop = -> :ok
  `;

  it('sets grandchild state via dotted target', async () => {
    await expectBehavior(script,
      { input: { test: { set: 77, target: 'o.inner' }, from: 't' } },
      { input: { id: '1', test: { get: 'val', target: 'o.inner' }, from: 't' } },
      { output: { id: '1', 'bv-a': 'Integer', re: 77, to: 't' } },
    );
  });
});

describe('test.get — target child actor', () => {
  const script = `
      Box
        <
        seed Integer
        >
        =
        value *Integer = seed
        @get = -> value: value as Integer
        .

      b = *Box(42)
      @noop = -> :ok
  `;

  it('reads child state via target', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { get: 'value', target: 'b' }, from: 't' } },
      { output: { id: '1', 'bv-a': 'Integer', re: 42, to: 't' } },
    );
  });
});
