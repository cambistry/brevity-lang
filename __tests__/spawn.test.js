import { createActor, expectActorReply } from './helpers.js';

describe('spawn', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`
      @fireAndForget
        =
        spawn fire()
        -> answer: "ok" as Text

      @continuity
        =
        spawn fire()
        x : Integer = get()
        -> :x : Integer

      fire
        =
        .

      get
        =
        -> 10 as Integer
    `);
  });

  it('spawn + silent function — fire-and-forget', async () => {
    await expectActorReply({
      actor, receive: { id: '1', op: '@fireAndForget', from: 'c' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'c' },
    });
  });

  it('spawn does not block subsequent statements', async () => {
    await expectActorReply({
      actor, receive: { id: '2', op: '@continuity', from: 'c' },
      reply: { id: '2', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'c' },
    });
  });
});

describe('spawn — side-effect (stateful)', () => {
  it('spawned function mutates actor state', async () => {
    const actor = await createActor(`
      ref x : Integer = 0

      @test
        =
        spawn fire()
        repeat while (x == 0) __tick__()
        -> x : Integer

      fire
        =
        x <- 1 .
    `);
    const before = actor.posts.length;
    await actor.sendAsync({ id: '1', op: '@test', from: 'c' });
    const newPosts = actor.posts.slice(before);
    expect(newPosts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1', re: [1], to: 'c' }),
    ]));
  });
});
