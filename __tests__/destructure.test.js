import { createActor, expectActorReply } from './helpers.js';

describe('destructure', () => {
  let actor;

  beforeAll(async () => {
    actor = await createActor(`@echo = |:text : Text| ->(:text)\n`);
  });

  it('@echo — destructures and reflects arg', async () => {
    await expectActorReply({
      actor, receive: { id: '1', op: [{ text: 'abc' }, '@echo'], 'bv-a': [{ text: 'Text' }], from: 'c' },
      reply: { id: '1', 'bv-a': { text: 'Text' }, re: { text: 'abc' }, to: 'c' },
    });
  });
});
