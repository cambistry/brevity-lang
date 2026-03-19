import { runActor } from './helpers.js';

describe('spawn', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      @fireAndForget
        =
        spawn fire()
        -> answer: "ok" : Text

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
        -> 10 : Integer
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: 'fireAndForget', from: 'c' },
        { id: '2', op: 'continuity', from: 'c' },
      ],
    });
  });

  it('spawn + silent function — fire-and-forget', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'c' });
  });

  it('spawn does not block subsequent statements', () => {
    expect(outputs[1]).toEqual({ id: '2', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'c' });
  });
});

describe('spawn — side-effect (stateful)', () => {
  it('spawned function mutates actor state', async () => {
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
        { id: '1', op: 'test', from: 'c' },
      ],
    });
    expect(posts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1', re: [1], to: 'c' }),
    ]));
  });
});
