import { expectBehavior } from '../helpers.js';

describe('spawn', () => {
  const script = `
    @fireAndForget
      =
      spawn fire()
      -> answer: "ok"

    @continuity
      =
      spawn fire()
      x Integer = get()
      -> :x

    fire
      =
      .

    get
      =
      -> 10
  `;

  it('spawn + silent function — fire-and-forget', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@fireAndForget', from: 'c' } },
      { output: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'c' } },
    );
  });

  it('spawn does not block subsequent statements', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@continuity', from: 'c' } },
      { output: { id: '2', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'c' } },
    );
  });
});

describe('spawn — side-effect (stateful)', () => {
  it('spawned function mutates actor state', async () => {
    const script = `
      x *Integer = 0

      @test
        =
        spawn fire()
        repeat while (x == 0) __tick__()
        -> x
      fire
        =
        x <- 1 .
    `;
    await expectBehavior(script,
      { input: { id: '1', op: '@test', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: [1], to: 'c' }) },
    );
  });
});
