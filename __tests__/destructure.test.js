import { runActor } from './helpers.js';

describe('destructure', () => {
  let outputs;

  beforeAll(async () => {
    const source = `@echo = |:text : Text| ->(:text : Text)\n`;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', op: [{ text: 'abc' }, 'echo'], 'bv-a': [{ text: 'Text' }], from: 'c' },
      ],
    });
  });

  it('@echo — destructures and reflects arg', () => {
    expect(outputs[0]).toEqual({ id: '1', 'bv-a': { text: 'Text' }, re: { text: 'abc' }, to: 'c' });
  });
});
