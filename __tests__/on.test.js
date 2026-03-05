import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('on', () => {
  it('on hello — open', async () => {
    const { output } = compile(`on hello\n\n  reply answer: "world"\n`);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    const actor = new Actor(binding);
    actor.receive({ id: '12345', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '12345',
      re: { hello: { answer: 'world' } },
      to: 'caller',
    });
  });

  it('on hello() — explicit header, body on next line', async () => {
    const { output } = compile(`on hello()\n  reply answer: "world"\n`);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    const actor = new Actor(binding);
    actor.receive({ id: '12345', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '12345',
      re: { hello: { answer: 'world' } },
      to: 'caller',
    });
  });

  it('on hello() reply — fully inline', async () => {
    const { output } = compile(`on hello() reply answer: "world"\n`);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    const actor = new Actor(binding);
    actor.receive({ id: '12345', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '12345',
      re: { hello: { answer: 'world' } },
      to: 'caller',
    });
  });

  it('multiple handlers in one actor — both cases reachable', async () => {
    const source = [
      'on hello',
      '',
      '  reply answer: "world"',
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
      re: { hello: { answer: 'world' } },
      to: 'caller',
    });

    actor.receive({ id: '2', op: { echo: { text: 'abc' } }, 'bv-a': { echo: { text: 'Text' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '2',
      re: { echo: { text: 'abc' } },
      to: 'caller',
    });
  });
});
