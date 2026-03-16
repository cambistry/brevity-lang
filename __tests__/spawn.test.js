import { expectReply, runActor } from './helpers.js';

describe('spawn', () => {
  it('spawn + silent proc — fire-and-forget', async () => {
    const source = `
      on test()
        spawn fire()
        -> answer: "ok" : Text

      proc fire() .
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'caller' },
    });
  });

  it('side-effect — spawned proc mutates actor state', async () => {
    const posts = await runActor({
      source: `
        init
          $x : Integer = 0

        on test()
          spawn fire()
          repeat while ($x == 0) __tick__()
          -> $x : Integer

        proc fire()
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
      on test()
        spawn fire()
        x : Integer = get()
        -> :x : Integer

      proc fire() .

      proc get()
        -> 10 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'caller' },
    });
  });
});
