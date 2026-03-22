import { compileActor, expectActorReply } from './helpers.js';

describe('destructure', () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileActor(`@echo = |:text : Text| ->(:text)\n`);
  });

  it('@echo — destructures and reflects arg', async () => {
    await expectActorReply({
      compiled, receive: { id: '1', op: [{ text: 'abc' }, '@echo'], 'bv-a': [{ text: 'Text' }], from: 'c' },
      reply: { id: '1', 'bv-a': { text: 'Text' }, re: { text: 'abc' }, to: 'c' },
    });
  });
});
