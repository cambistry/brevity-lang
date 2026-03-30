import { expectBehavior } from '../helpers.js';

describe('spawn', () => {
  const script = `
    @fireAndForget
      =
      spawn fire()
      -> answer: "ok" as Text

    @continuity
      =
      spawn fire()
      x Integer = get()
      -> :x as Integer

    fire
      =
      .

    get
      =
      -> 10 as Integer
  `;

  it('spawn + silent function — fire-and-forget', async () => {
    await expectBehavior(script, {
      input: { id: '1', op: '@fireAndForget', from: 'c' },
      output: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'c' },
    });
  });

  it('spawn does not block subsequent statements', async () => {
    await expectBehavior(script, {
      input: { id: '2', op: '@continuity', from: 'c' },
      output: { id: '2', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'c' },
    });
  });
});

describe('spawn — side-effect (stateful)', () => {
  it('spawned function mutates actor state', async () => {
    const script = `
      ref x Integer = 0

      @test
        =
        spawn fire()
        repeat while (x == 0) __tick__()
        -> x as Integer
      fire
        =
        x <- 1 .
    `;
    await expectBehavior(script, {
      input: { id: '1', op: '@test', from: 'c' },
      output: expect.objectContaining({ id: '1', re: [1], to: 'c' }),
    });
  });
});
