import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('reply forms', () => {
  it('reply(answer: "world" : Text) — reply with inline parens', async () => {
    const { output } = compile(`on hello()\n  reply(answer: "world" : Text)\n`);
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

  it('reply on next line — open reply body', async () => {
    const { output } = compile(`on hello()\n  reply\n    answer: "world" : Text\n`);
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

  it('reply( multiline ) — explicit reply with parens across lines', async () => {
    const { output } = compile(`on hello()\n  reply(\n    answer: "world" : Text\n  )\n`);
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
});

describe('multi-param forms', () => {
  it('multiple params — explicit inline with commas', async () => {
    const source = [
      'on add(:a : Integer, :b : Integer)',
      '  c : Integer = a + b',
      '  reply(:c : Integer)',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: 'x', op: { add: { a: 3, b: 4 } }, 'bv-a': { add: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: 'x', re: { add: { c: 7 } }, to: 'caller' });
  });

  it('multiple params — explicit multiline', async () => {
    const source = [
      'on add(',
      '  :a : Integer,',
      '  :b : Integer',
      ')',
      '  c : Integer = a + b',
      '  reply :c : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: 'x', op: { add: { a: 3, b: 4 } }, 'bv-a': { add: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: 'x', re: { add: { c: 7 } }, to: 'caller' });
  });

  it('multiple params — open form, no commas', async () => {
    const source = [
      'on add',
      '  :a : Integer',
      '  :b : Integer',
      '',
      '  c : Integer = a + b',
      '  reply',
      '    :c : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: 'x', op: { add: { a: 3, b: 4 } }, 'bv-a': { add: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: 'x', re: { add: { c: 7 } }, to: 'caller' });
  });
});
