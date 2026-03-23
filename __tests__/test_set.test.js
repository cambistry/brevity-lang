import { expectReply } from './helpers.js';

const _target = globalThis.BREVITY_TARGET || process.env.BREVITY_TARGET || 'js';
const isJs = _target === 'js';

describe('test.set — single positional via set handler', () => {
  const script = `
      ref value : Integer = 0

      set
        =
        n : Integer
        =
        value <- n .

      @get = -> :value
  `;

  it('sets value through ::set dispatch', async () => {
    await expectReply({
      script,
      receive: [
        { test: { set: 42 }, from: 't' },
        { id: '1', test: { get: 'value' }, from: 't' },
      ],
      reply: { id: '1', 'bv-a': 'Integer', re: 42, to: 't' },
    });
  });

  it('overwrites previous value', async () => {
    await expectReply({
      script,
      receive: [
        { test: { set: 10 }, from: 't' },
        { test: { set: 20 }, from: 't' },
        { id: '1', test: { get: 'value' }, from: 't' },
      ],
      reply: { id: '1', 'bv-a': 'Integer', re: 20, to: 't' },
    });
  });
});

describe('test.set — mixed positional + named args', () => {
  const script = `
      ref p : Integer = 0
      ref label : Text = ""

      set
        =
        val : Integer
        label: l : Text
        =
        p <- val
        label <- l
        .

      @getP = -> :p
      @getLabel = -> :label
  `;

  it('sets with positional + named args', async () => {
    await expectReply({
      script,
      receive: [
        { test: { set: [11, { label: 'eleven' }] }, from: 't' },
        { id: '1', test: { get: 'p' }, from: 't' },
        { id: '2', test: { get: 'label' }, from: 't' },
      ],
      reply: [
        { id: '1', 'bv-a': 'Integer', re: 11, to: 't' },
        { id: '2', 'bv-a': 'Text', re: 'eleven', to: 't' },
      ],
    });
  });
});

describe('test.set — then mutate with public function', () => {
  const script = `
      ref count : Integer = 0

      set
        =
        n : Integer
        =
        count <- n .

      @inc = {
        count <- count + 1
        -> :count
      }

      @get = -> :count
  `;

  it('set state then increment', async () => {
    await expectReply({
      script,
      receive: [
        { test: { set: 10 }, from: 't' },
        { id: '1', test: { op: '@inc' }, from: 't' },
        { id: '2', test: { get: 'count' }, from: 't' },
      ],
      reply: [
        expect.objectContaining({ id: '1', re: { count: 11 } }),
        { id: '2', 'bv-a': 'Integer', re: 11, to: 't' },
      ],
    });
  });
});

// Cross-target: child actor set handler (works on all targets)
describe('test.set — child actor via normal dispatch', () => {
  const script = `
      Box
        =
        seed : Integer
        =
        ref value : Integer = seed

        set
          =
          n : Integer
          =
          value <- n .

        @get = -> value: value : Integer
        -> self
      end#Box

      @setAndGet
        =
        ref b = Box(0)
        b <- 42
        :value = b.get()
        -> :value : Integer
  `;

  it('set handler works through child dispatch', async () => {
    await expectReply({
      script,
      receive: { id: '1', op: '@setAndGet', from: 'c' },
      reply: { id: '1', 'bv-a': { value: 'Integer' }, re: { value: 42 }, to: 'c' },
    });
  });
});

// test.set with target — JS only (target routing is JS-only for now)
const targetDescribe = isJs ? describe : describe.skip;

targetDescribe('test.set — target child actor', () => {
  const script = `
      Box
        =
        seed : Integer
        =
        ref value : Integer = seed

        set
          =
          n : Integer
          =
          value <- n .

        @get = -> value: value : Integer
        -> self
      end#Box

      ref b = Box(0)
      @noop = -> :ok
  `;

  it('sets child state via target then reads via target', async () => {
    await expectReply({
      script,
      receive: [
        { test: { set: 99, target: 'b' }, from: 't' },
        { id: '1', test: { get: 'value', target: 'b' }, from: 't' },
      ],
      reply: { id: '1', 'bv-a': 'Integer', re: 99, to: 't' },
    });
  });
});

targetDescribe('test.set — nested target', () => {
  const script = `
      Inner
        =
        ref val : Integer = 0

        set = |n : Integer| val <- n .

        @get = -> val: val : Integer
        -> self
      end#Inner

      Outer
        =
        ref inner = Inner()

        @get = -> ok: "ok" as Text
        -> self
      end#Outer

      ref o = Outer()
      @noop = -> :ok
  `;

  it('sets grandchild state via dotted target', async () => {
    await expectReply({
      script,
      receive: [
        { test: { set: 77, target: 'o.inner' }, from: 't' },
        { id: '1', test: { get: 'val', target: 'o.inner' }, from: 't' },
      ],
      reply: { id: '1', 'bv-a': 'Integer', re: 77, to: 't' },
    });
  });
});

targetDescribe('test.get — target child actor', () => {
  const script = `
      Box
        =
        seed : Integer
        =
        ref value : Integer = seed

        @get = -> value: value : Integer
        -> self
      end#Box

      ref b = Box(42)
      @noop = -> :ok
  `;

  it('reads child state via target', async () => {
    await expectReply({
      script,
      receive: { id: '1', test: { get: 'value', target: 'b' }, from: 't' },
      reply: { id: '1', 'bv-a': 'Integer', re: 42, to: 't' },
    });
  });
});
