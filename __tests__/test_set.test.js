import { compileActor, expectActorReply } from './helpers.js';

describe('test.set — single positional via set handler', () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileActor(`
      ref value : Integer = 0

      set
        =
        n : Integer
        =
        value <- n .

      @get = -> :value
    `);
  });

  it('sets value through ::set dispatch', async () => {
    await expectActorReply({
      compiled,
      receive: [
        { id: '1', test: { set: 42 }, from: 't' },
        { id: '2', test: { get: 'value' }, from: 't' },
      ],
      reply: [
        expect.objectContaining({ id: '1' }),
        { id: '2', 'bv-a': 'Integer', re: 42, to: 't' },
      ],
    });
  });

  it('overwrites previous value', async () => {
    await expectActorReply({
      compiled,
      receive: [
        { id: '1', test: { set: 10 }, from: 't' },
        { id: '2', test: { set: 20 }, from: 't' },
        { id: '3', test: { get: 'value' }, from: 't' },
      ],
      reply: [
        expect.objectContaining({ id: '1' }),
        expect.objectContaining({ id: '2' }),
        { id: '3', 'bv-a': 'Integer', re: 20, to: 't' },
      ],
    });
  });
});

describe('test.set — mixed positional + named args', () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileActor(`
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
    `);
  });

  it('sets with positional + named args', async () => {
    await expectActorReply({
      compiled,
      receive: [
        { id: '1', test: { set: [11, { label: 'eleven' }] }, from: 't' },
        { id: '2', test: { get: 'p' }, from: 't' },
        { id: '3', test: { get: 'label' }, from: 't' },
      ],
      reply: [
        expect.objectContaining({ id: '1' }),
        { id: '2', 'bv-a': 'Integer', re: 11, to: 't' },
        { id: '3', 'bv-a': 'Text', re: 'eleven', to: 't' },
      ],
    });
  });
});

describe('test.set — then mutate with public function', () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileActor(`
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
    `);
  });

  it('set state then increment', async () => {
    await expectActorReply({
      compiled,
      receive: [
        { id: '1', test: { set: 10 }, from: 't' },
        { id: '2', test: { op: '@inc' }, from: 't' },
        { id: '3', test: { get: 'count' }, from: 't' },
      ],
      reply: [
        expect.objectContaining({ id: '1' }),
        expect.objectContaining({ id: '2', re: { count: 11 } }),
        { id: '3', 'bv-a': 'Integer', re: 11, to: 't' },
      ],
    });
  });
});

// Cross-target: child actor set handler (works on all targets)
describe('test.set — child actor via normal dispatch', () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileActor(`
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
    `);
  });

  it('set handler works through child dispatch', async () => {
    await expectActorReply({
      compiled,
      receive: { id: '1', op: '@setAndGet', from: 'c' },
      reply: { id: '1', 'bv-a': { value: 'Integer' }, re: { value: 42 }, to: 'c' },
    });
  });
});

// Cross-target: no set handler
describe('test.set — no set handler → unhandled', () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileActor(`
      ref x : Integer = 0
      @get = -> :x
    `);
  });

  it('actor without set handler returns unhandled', async () => {
    await expectActorReply({
      compiled,
      receive: { id: '1', test: { set: 42 }, from: 't' },
      reply: expect.objectContaining({ id: '1', ex: { '::set': 'unhandled' } }),
    });
  });
});
