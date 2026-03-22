import { compileActor, createActor, expectActorReply } from './helpers.js';

describe('test.op — public function', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      ref x : Integer = 0

      @inc
        =
        x <- x + 1
        -> :x

      @get = -> :x
    `);
  });

  it('dispatches public function', async () => {
    await actor.sendAsync({ id: '1', test: { op: '@inc' }, from: 't' });
    await actor.sendAsync({ id: '2', test: { op: '@inc' }, from: 't' });
    await expectActorReply({
      actor, receive: { id: '3', test: { op: '@get' }, from: 't' },
      reply: expect.objectContaining({ id: '3', re: { x: 2 } }),
    });
  });
});

describe('test.op — private function', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      double
        =
        n : Integer
        =
        -> n * 2 : Integer

      @call
        =
        :n : Integer
        =
        result : Integer = double(n)
        -> :result
    `);
  });

  it('dispatches private function directly', async () => {
    await expectActorReply({
      actor,
      receive: { id: '1', test: { op: [[5], 'double'] }, from: 't' },
      reply: expect.objectContaining({ id: '1', re: [10] }),
    });
  });
});

describe('test.op — with args', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      ref x : Integer = 0

      @add
        =
        :n : Integer
        =
        x <- x + n
        -> :x
    `);
  });

  it('passes args to op', async () => {
    await actor.sendAsync({ id: '1', test: { op: [{ n: 3 }, '@add'] }, from: 't' });
    await actor.sendAsync({ id: '2', test: { op: [{ n: 7 }, '@add'] }, from: 't' });
    await expectActorReply({
      actor, receive: { id: '3', test: { get: 'x' }, from: 't' },
      reply: { id: '3', 'bv-a': 'Integer', re: 10, to: 't' },
    });
  });
});

describe('test.op — bypasses schema validation', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      @echo = |:msg : Text| -> :msg
    `);
  });

  it('no bv-a required', async () => {
    await expectActorReply({
      actor,
      receive: { id: '1', test: { op: [{ msg: 'hello' }, '@echo'] }, from: 't' },
      reply: expect.objectContaining({ id: '1', re: { msg: 'hello' } }),
    });
  });
});
