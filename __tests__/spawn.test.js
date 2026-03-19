import { expectReply, runActor } from './helpers.js';

describe('spawn', () => {
  it('spawn + silent function — fire-and-forget', async () => {
    const source = `
      @test
        =
        spawn fire()
        -> answer: "ok" : Text

      fire
        =
        .
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'caller' },
    });
  });

  it('side-effect — spawned function mutates actor state', async () => {
    const posts = await runActor({
      source: `
        init
          $x : Integer = 0

        @test
          =
          spawn fire()
          repeat while ($x == 0) __tick__()
          -> $x : Integer

        fire
          =
          $x = 1 .
      `,
      receive: [
        { id: 'init-0', cam: 'init', from: 'system' },
        { id: '1', op: 'test', from: 'caller' },
      ],
    });
    expect(posts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1', re: [1], to: 'caller' }),
    ]));
  });

  it('continuity — spawn does not block subsequent statements', async () => {
    const source = `
      @test
        =
        spawn fire()
        x : Integer = get()
        -> :x : Integer

      fire
        =
        .

      get
        =
        -> 10 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'caller' },
    });
  });
});
