import { compileActor, expectActorReply } from './helpers.js';

describe('test.update — single named param via update handler', () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileActor(`
      ref name : Text = "anonymous"

      update = |name: n : Text| name <- n .

      @get = -> :name
    `);
  });

  it('updates value through ::update dispatch', async () => {
    await expectActorReply({
      compiled,
      receive: [
        { test: { update: { name: 'Alice' } }, from: 't' },
        { id: '1', test: { get: 'name' }, from: 't' },
      ],
      reply: { id: '1', 'bv-a': 'Text', re: 'Alice', to: 't' },
    });
  });

  it('overwrites previous value', async () => {
    await expectActorReply({
      compiled,
      receive: [
        { test: { update: { name: 'Bob' } }, from: 't' },
        { test: { update: { name: 'Carol' } }, from: 't' },
        { id: '1', test: { get: 'name' }, from: 't' },
      ],
      reply: { id: '1', 'bv-a': 'Text', re: 'Carol', to: 't' },
    });
  });
});

describe('test.update — mixed positional + named args', () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileActor(`
      ref p : Integer = 0
      ref label : Text = ""

      update
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

  it('updates with positional + named args', async () => {
    await expectActorReply({
      compiled,
      receive: [
        { test: { update: [11, { label: 'eleven' }] }, from: 't' },
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

describe('test.update — then mutate with public function', () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileActor(`
      ref count : Integer = 0

      update = |n : Integer| count <- n .

      @inc = {
        count <- count + 1
        -> :count
      }

      @get = -> :count
    `);
  });

  it('update state then increment', async () => {
    await expectActorReply({
      compiled,
      receive: [
        { test: { update: 10 }, from: 't' },
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

// Cross-target: child actor update handler (works on all targets)
describe('test.update — child actor via normal dispatch', () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileActor(`
      Person
        =
        ref name : Text = "anonymous"

        update = |name: n : Text| name <- n .

        @get = -> name: name : Text
        -> self
      end#Person

      @updateAndGet
        =
        ref p = Person()
        p <| name: "Alice"
        :name = p.get()
        -> :name : Text
    `);
  });

  it('update handler works through child dispatch', async () => {
    await expectActorReply({
      compiled,
      receive: { id: '1', op: '@updateAndGet', from: 'c' },
      reply: { id: '1', 'bv-a': { name: 'Text' }, re: { name: 'Alice' }, to: 'c' },
    });
  });
});
