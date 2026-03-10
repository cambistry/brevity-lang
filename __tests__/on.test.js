import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('on', () => {
  it('on hello — open', async () => {
    const { output } = compile(`on hello\n\n  reply answer: "world" : Text\n`);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    const actor = new Actor(binding);
    actor.receive({ id: '12345', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '12345',
      'bv-a': { hello: { answer: 'Text' } },
      re: { hello: { answer: 'world' } },
      to: 'caller',
    });
  });

  it('on hello() — explicit header, body on next line', async () => {
    const { output } = compile(`on hello()\n  reply answer: "world" : Text\n`);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    const actor = new Actor(binding);
    actor.receive({ id: '12345', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '12345',
      'bv-a': { hello: { answer: 'Text' } },
      re: { hello: { answer: 'world' } },
      to: 'caller',
    });
  });

  it('on hello() reply — fully inline', async () => {
    const { output } = compile(`on hello() reply answer: "world" : Text\n`);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    const actor = new Actor(binding);
    actor.receive({ id: '12345', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '12345',
      'bv-a': { hello: { answer: 'Text' } },
      re: { hello: { answer: 'world' } },
      to: 'caller',
    });
  });

  it('multiple handlers in one actor — both cases reachable', async () => {
    const source = [
      'on hello',
      '',
      '  reply answer: "world" : Text',
      '',
      'on echo(:text : Text) reply(:text : Text)',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    const actor = new Actor(binding);

    actor.receive({ id: '1', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      'bv-a': { hello: { answer: 'Text' } },
      re: { hello: { answer: 'world' } },
      to: 'caller',
    });

    actor.receive({ id: '2', op: { echo: { text: 'abc' } }, 'bv-a': { echo: { text: 'Text' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '2',
      'bv-a': { echo: { text: 'Text' } },
      re: { echo: { text: 'abc' } },
      to: 'caller',
    });
  });
});

// ─── whitespace-only blank line ───────────────────────────────────────────────

describe('on — spacious handler with whitespace-only blank line', () => {
  it('whitespace-only blank line between params and body acts as BLOCK_SEP', async () => {
    const source = `
      on add
        :a : Integer
        :b : Integer
    ${'  '}
        x : Integer = a + b
        reply :x
    `;
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { add: { a: 3, b: 4 } }, 'bv-a': { add: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', 'bv-a': { add: { x: 'Integer' } }, re: { add: { x: 7 } }, to: 'caller',
    });
  });
});
