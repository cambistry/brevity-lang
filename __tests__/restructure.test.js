import { compileActor, expectActorReply } from './helpers.js';

describe('restructure', () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileActor(`
      @echo2
        =
        :x : Integer
        =
        a : Integer = x
        ->(:a)
    `);
  });

  it('local var assignment and restructure — a = x, ->(:a)', async () => {
    await expectActorReply({
      compiled, receive: { id: '1', op: [{ x: 42 }, '@echo2'], 'bv-a': [{ x: 'Integer' }], from: 'c' },
      reply: { id: '1', 'bv-a': { a: 'Integer' }, re: { a: 42 }, to: 'c' },
    });
  });
});
