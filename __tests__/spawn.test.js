import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate, expectReply } from './helpers.js';

async function initThenReceive(source, exportName, messages) {
  const { output } = compile(source);
  const Actor = await evaluate(output, exportName);
  const binding = { post: jest.fn() };
  const actor = new Actor(binding);
  actor.receive({ id: 'init-0', cam: 'init', from: 'system' });
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const msg of messages) {
    actor.receive(msg);
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  return binding;
}

describe('spawn', () => {
  it('spawn + end — fire-and-forget', async () => {
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

  it('side-effect — spawned proc mutates actor state', async () => {
    const binding = await initThenReceive(`
      actor T

      init
        $x : Integer = 0

      on test()
        spawn fire()
        repeat while ($x == 0) __tick__()
        reply $x : Integer

      proc fire()
        $x = 1
        end

      end
    `, 'T', [{ id: '1', op: 'test', from: 'caller' }]);
    expect(binding.post).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ id: '1', re: [1], to: 'caller' })
    );
  });

  it('continuity — spawn does not block subsequent statements', async () => {
    const source = `
      on test()
        spawn fire()
        x : Integer = get()
        reply :x : Integer

      proc fire()
        end

      proc get()
        reply 10 : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 10 }, to: 'caller' },
    });
  });
});
