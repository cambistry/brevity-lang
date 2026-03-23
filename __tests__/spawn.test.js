import { expectActorReply } from './helpers.js';

describe('spawn', () => {
  const script = `
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
  `;

  it('spawn + silent function — fire-and-forget', async () => {
    await expectActorReply({
      script, receive: { id: '1', op: '@fireAndForget', from: 'c' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'c' },
    });
  });

  it('spawn does not block subsequent statements', async () => {
    await expectActorReply({
      script, receive: { id: '2', op: '@continuity', from: 'c' },
      reply: { id: '2', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'c' },
    });
  });
});

describe('spawn — side-effect (stateful)', () => {
  it('spawned function mutates actor state', async () => {
    const script = `
      ref x : Integer = 0

      @test
        =
        spawn fire()
        repeat while (x == 0) __tick__()
        -> x : Integer

      fire
        =
        x <- 1 .
    `;
    await expectActorReply({
      script, receive: { id: '1', op: '@test', from: 'c' },
      reply: expect.objectContaining({ id: '1', re: [1], to: 'c' }),
    });
  });
});
