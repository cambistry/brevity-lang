import { compileActor, createActor, expectActorReply } from './helpers.js';

describe('test.update — dispatch to accumulator', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      ref x : Integer = 0
      @add
        =
        :delta : Integer
        =
        x <- x + delta
        -> :x
      @get = -> :x
    `);
  });

  it('dispatches accumulation op', async () => {
    await expectActorReply({
      actor,
      receive: { id: '1', test: { op: [{ delta: 5 }, '@add'] }, from: 't' },
      reply: expect.objectContaining({ id: '1', re: { x: 5 } }),
    });
  });

  it('state reflects the update', async () => {
    await expectActorReply({
      actor, receive: { id: '2', test: { get: 'x' }, from: 't' },
      reply: { id: '2', 'bv-a': 'Integer', re: 5, to: 't' },
    });
  });
});

describe('test.update — accumulation', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      ref x : Integer = 0
      @add
        =
        :delta : Integer
        =
        x <- x + delta
        -> :x
      @get = -> :x
    `);
  });

  it('updates accumulate', async () => {
    await actor.sendAsync({ id: '1', test: { op: [{ delta: 3 }, '@add'] }, from: 't' });
    await actor.sendAsync({ id: '2', test: { op: [{ delta: 7 }, '@add'] }, from: 't' });
    await expectActorReply({
      actor, receive: { id: '3', test: { get: 'x' }, from: 't' },
      reply: { id: '3', 'bv-a': 'Integer', re: 10, to: 't' },
    });
  });
});
