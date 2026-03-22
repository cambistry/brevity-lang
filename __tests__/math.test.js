import { compileActor, expectActorReply } from './helpers.js';

describe('math', () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileActor(`
      @inc
        =
        :x : Integer
        =
        bigger : Integer = x + 1
        -> :bigger
    `);
  });

  it('integer math — bigger = x + 1', async () => {
    await expectActorReply({
      compiled,
      receive: { id: '1', op: [{ x: 5 }, '@inc'], 'bv-a': [{ x: 'Integer' }], from: 'c' },
      reply: { id: '1', 'bv-a': { bigger: 'Integer' }, re: { bigger: 6 }, to: 'c' },
    });
  });
});
