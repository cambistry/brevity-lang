import { compileActor, createActor, expectActorReply } from './helpers.js';

describe('test.set — scalar ref', () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileActor(`
      ref x : Integer = 0
      @get = -> :x
    `);
  });

  it('sets a scalar ref value', async () => {
    await expectActorReply({
      compiled,
      receive: [
        { id: '1', test: { set: { x: 42 } }, from: 't' },
        { id: '2', test: { get: 'x' }, from: 't' },
      ],
      reply: [
        { id: '1', re: 'ok', to: 't' },
        { id: '2', 'bv-a': 'Integer', re: 42, to: 't' },
      ],
    });
  });

  it('overwrites previous value', async () => {
    await expectActorReply({
      compiled,
      receive: [
        { id: '1', test: { set: { x: 10 } }, from: 't' },
        { id: '2', test: { set: { x: 20 } }, from: 't' },
        { id: '3', test: { get: 'x' }, from: 't' },
      ],
      reply: [
        { id: '1', re: 'ok', to: 't' },
        { id: '2', re: 'ok', to: 't' },
        { id: '3', 'bv-a': 'Integer', re: 20, to: 't' },
      ],
    });
  });
});

describe('test.set — multiple fields', () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileActor(`
      ref x : Integer = 0
      ref label : Text = ""
      @getX = -> :x
      @getLabel = -> :label
    `);
  });

  it('sets multiple fields in one call', async () => {
    await expectActorReply({
      compiled,
      receive: [
        { id: '1', test: { set: { x: 99, label: 'hello' } }, from: 't' },
        { id: '2', test: { get: 'x' }, from: 't' },
        { id: '3', test: { get: 'label' }, from: 't' },
      ],
      reply: [
        { id: '1', re: 'ok', to: 't' },
        { id: '2', 'bv-a': 'Integer', re: 99, to: 't' },
        { id: '3', 'bv-a': 'Text', re: 'hello', to: 't' },
      ],
    });
  });
});

describe('test.set — verified by public function', () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileActor(`
      ref count : Integer = 0

      @inc = {
        count <- count + 1
        -> :count
      }

      @get = -> :count
    `);
  });

  it('set state then mutate with public function', async () => {
    await expectActorReply({
      compiled,
      receive: [
        { id: '1', test: { set: { count: 10 } }, from: 't' },
        { id: '2', test: { op: '@inc' }, from: 't' },
        { id: '3', test: { get: 'count' }, from: 't' },
      ],
      reply: [
        { id: '1', re: 'ok', to: 't' },
        expect.objectContaining({ id: '2', re: { count: 11 } }),
        { id: '3', 'bv-a': 'Integer', re: 11, to: 't' },
      ],
    });
  });
});
