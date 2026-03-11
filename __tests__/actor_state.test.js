import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

// Helper that sends cam:init then a sequence of messages, returns the mock binding
async function initThenReceive(source, exportName, messages) {
  const { output } = compile(source);
  const Actor = await evaluate(output, exportName);
  const binding = { post: jest.fn() };
  const actor = new Actor(binding);
  actor.receive({ cam: 'init' });
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const msg of messages) {
    actor.receive(msg);
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  return binding;
}

const COUNTER = `
actor Counter

init
$value : Integer = 0

on get

reply $value : Integer

end
`;

describe('actor state variables', () => {

  // ── reads ─────────────────────────────────────────────────────────────────

  it('reads initial state after init', async () => {
    const binding = await initThenReceive(COUNTER, 'Counter', [
      { id: '1', op: 'get', from: 'client' },
    ]);
    expect(binding.post).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', re: [0], to: 'client' })
    );
  });

  // ── writes ────────────────────────────────────────────────────────────────

  it('writes state and persists across dispatches', async () => {
    const source = `
actor Counter

init
$value : Integer = 0

on set n : Integer
$value = n
reply $value : Integer

on get

reply $value : Integer

end
`;
    const binding = await initThenReceive(source, 'Counter', [
      { id: '1', op: [[42], 'set'], from: 'client', 'bv-a': [['Integer']] },
    ]);
    await new Promise(resolve => setTimeout(resolve, 0));

    const { output } = compile(source);
    const Counter = await evaluate(output, 'Counter');
    const b2 = { post: jest.fn() };
    const actor = new Counter(b2);
    actor.receive({ cam: 'init' });
    await new Promise(resolve => setTimeout(resolve, 0));
    actor.receive({ id: '1', op: [[42], 'set'], from: 'client', 'bv-a': [['Integer']] });
    await new Promise(resolve => setTimeout(resolve, 0));
    actor.receive({ id: '2', op: 'get', from: 'client' });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(b2.post).toHaveBeenNthCalledWith(1, expect.objectContaining({ re: [42] }));
    expect(b2.post).toHaveBeenNthCalledWith(2, expect.objectContaining({ re: [42] }));
  });

  // ── if-branch write ───────────────────────────────────────────────────────

  it('writes state inside an if branch', async () => {
    const source = `
actor Clipper

init
$value : Integer = 15

on clip

result : Integer = if $value > 10 { $value = 10
10 } else { $value }
reply result : Integer

end
`;
    const binding = await initThenReceive(source, 'Clipper', [
      { id: '1', op: 'clip', from: 'client' },
    ]);
    expect(binding.post).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', re: [10] })
    );
  });

  // ── separated declaration and assignment ──────────────────────────────────

  it('supports separated declaration then assignment in init', async () => {
    const source = `
actor Counter

init
$value : Integer
$value = 0

on get

reply $value : Integer

end
`;
    const binding = await initThenReceive(source, 'Counter', [
      { id: '1', op: 'get', from: 'client' },
    ]);
    expect(binding.post).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', re: [0] })
    );
  });

  // ── pre-init guard ────────────────────────────────────────────────────────

  it('blocks messages sent before init', async () => {
    const { output } = compile(COUNTER);
    const Counter = await evaluate(output, 'Counter');
    const binding = { post: jest.fn() };
    const actor = new Counter(binding);

    actor.receive({ id: '1', op: 'get', from: 'client' });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      ex: 'stateful actor not initialized',
      to: 'client',
    });
  });

  it('unblocks after init is called', async () => {
    const { output } = compile(COUNTER);
    const Counter = await evaluate(output, 'Counter');
    const binding = { post: jest.fn() };
    const actor = new Counter(binding);

    // blocked first
    actor.receive({ id: '1', op: 'get', from: 'client' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith(
      expect.objectContaining({ ex: 'stateful actor not initialized' })
    );

    // init then works
    actor.receive({ cam: 'init' });
    await new Promise(resolve => setTimeout(resolve, 0));
    actor.receive({ id: '2', op: 'get', from: 'client' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: '2', re: [0] })
    );
  });

  // ── empty init is not stateful ────────────────────────────────────────────

  it('actor without state vars is not stateful — no init guard', async () => {
    // On-only actor with no init block at all — messages work immediately
    const source = `
actor Greeter

on hello

reply 42 : Integer

end
`;
    const { output } = compile(source);
    const Greeter = await evaluate(output, 'Greeter');
    const binding = { post: jest.fn() };
    const actor = new Greeter(binding);

    actor.receive({ id: '1', op: 'hello', from: 'client' });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(binding.post).toHaveBeenCalledWith(
      expect.objectContaining({ re: [42] })
    );
  });

  // ── compile errors ────────────────────────────────────────────────────────

  it('compile error: state var declared but never assigned in init', () => {
    const source = `
actor Bad

init
$x : Integer

on go

reply 0 : Integer

end
`;
    expect(() => compile(source)).toThrow(/never assigned/);
  });

  it('compile error: write to state var inside function literal', () => {
    const source = `
actor Bad

init
$x : Integer = 0

on go

fn : (Integer) -> (Integer) = (n : Integer) { $x = 1
n }
reply fn

end
`;
    expect(() => compile(source)).toThrow(/Cannot write to state variable/);
  });

});
