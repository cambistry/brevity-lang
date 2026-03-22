import { compileActor, createActor, expectActorReply } from './helpers.js';

describe('test.set — dispatch to @<- handler', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      ref x : Integer = 0
      @put
        =
        :n : Integer
        =
        x <- n
        -> :x
      @get = -> :x
    `);
  });

  it('op dispatches set handler', async () => {
    await expectActorReply({
      actor,
      receive: { id: '1', test: { op: [{ n: 42 }, '@put'] }, from: 't' },
      reply: expect.objectContaining({ id: '1', re: { x: 42 } }),
    });
  });

  it('state reflects the set value', async () => {
    await expectActorReply({
      actor, receive: { id: '2', test: { get: 'x' }, from: 't' },
      reply: { id: '2', 'bv-a': 'Integer', re: 42, to: 't' },
    });
  });
});

describe('test.set — multiple sets', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      ref x : Integer = 0
      @put
        =
        :n : Integer
        =
        x <- n
        -> :x
      @get = -> :x
    `);
  });

  it('last set wins', async () => {
    await actor.sendAsync({ id: '1', test: { op: [{ n: 10 }, '@put'] }, from: 't' });
    await actor.sendAsync({ id: '2', test: { op: [{ n: 20 }, '@put'] }, from: 't' });
    await expectActorReply({
      actor, receive: { id: '3', test: { get: 'x' }, from: 't' },
      reply: { id: '3', 'bv-a': 'Integer', re: 20, to: 't' },
    });
  });
});
