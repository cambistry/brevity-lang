import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

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

const DRAINER = `
actor Drainer

init
$x : Integer = 10
$y : Integer = 0

on drain()

while $x > 0 {
  $x = $x - 1
  $y = $y + 1
}
reply $x, $y : Integer

end
`;

describe('while — state mutation loop', () => {
  it('drains $x to 0 and accumulates $y to 10', async () => {
    const binding = await initThenReceive(DRAINER, 'Drainer', [
      { id: '1', op: 'drain', from: 'caller' },
    ]);
    expect(binding.post).toHaveBeenNthCalledWith(1, { id: 'init-0', re: 'init', to: 'system' });
    expect(binding.post).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ id: '1', re: [0, 10], to: 'caller' })
    );
  });
});
