import { expectReply } from '../helpers.js';

describe('destructure', () => {
  const script = `@echo = |text: Text| ->(:text)\n`;

  it('@echo — destructures and reflects arg', async () => {
    await expectReply({
      script, receive: { id: '1', op: [{ text: 'abc' }, '@echo'], 'bv-a': [{ text: 'Text' }], from: 'c' },
      reply: { id: '1', 'bv-a': { text: 'Text' }, re: { text: 'abc' }, to: 'c' },
    });
  });
});
