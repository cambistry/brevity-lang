import compile from '../index.js';
import { expectReply } from './helpers.js';

describe('end in proc', () => {
  it('compiler error when calling silent proc without spawn', () => {
    expect(() => compile(`
      on test()
        fire()
        reply answer: "done" : Text

      proc fire()
        end
    `)).toThrow(/Silent proc invocation requires 'spawn'/);
  });

  it('spawn + silent proc compiles and runs', async () => {
    const source = `
      on test()
        spawn fire()
        reply answer: "ok" : Text

      proc fire()
        end
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'ok' }, to: 'caller' },
    });
  });
});
