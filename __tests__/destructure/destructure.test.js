import { expectBehavior } from '../helpers.js';

describe('destructure', () => {
  const script = `@echo = (text: Text) ->(:text)\n`;

  it('@echo — destructures and reflects arg', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{ text: 'abc' }, 'echo'], 'ty': [{ text: 'Text' }], from: 'c' } },
      { output: { id: '1', 'ty': { text: 'Text' }, re: { text: 'abc' }, to: 'c' } },
    );
  });
});
