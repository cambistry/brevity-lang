import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('// line comments', () => {
  it('full-line // before handler is ignored', async () => {
    const { output } = compile([
      '// this is a comment',
      'on hello() reply answer: "world"',
    ].join('\n'));
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', re: { hello: { answer: 'world' } }, to: 'caller',
    });
  });

  it('// inline after handler signature is ignored', async () => {
    const { output } = compile([
      'on hello() // opens the handler',
      '  reply answer: "world"',
    ].join('\n'));
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', re: { hello: { answer: 'world' } }, to: 'caller',
    });
  });

  it('// inline after a body statement is ignored', async () => {
    const { output } = compile([
      'on inc(:x : Integer)',
      '  bigger = x + 1 // increment',
      '  reply :bigger : Integer',
    ].join('\n'));
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { inc: { x: 5 } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', re: { inc: { bigger: 6 } }, to: 'caller',
    });
  });
});

describe('-- dash comments', () => {
  it('-- alone on a line is ignored', async () => {
    const { output } = compile([
      'on hello()',
      '--',
      '  reply answer: "world"',
    ].join('\n'));
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', re: { hello: { answer: 'world' } }, to: 'caller',
    });
  });

  it('-- text is a single-line comment', async () => {
    const { output } = compile([
      'on hello()',
      '  -- this comment is ignored',
      '  reply answer: "world"',
    ].join('\n'));
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', re: { hello: { answer: 'world' } }, to: 'caller',
    });
  });

  it('-- label -- (labeled stitch) is a single-line comment', async () => {
    const { output } = compile([
      'on hello()',
      '  -- labeled separator --',
      '  reply answer: "world"',
    ].join('\n'));
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', re: { hello: { answer: 'world' } }, to: 'caller',
    });
  });

  it('--- opens and closes a block comment', async () => {
    const { output } = compile([
      '---',
      'on bogus() reply bogus: "stuff"',
      '---',
      'on hello() reply answer: "world"',
    ].join('\n'));
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', re: { hello: { answer: 'world' } }, to: 'caller',
    });
  });

  it('---- (four dashes) also opens and closes a block comment', async () => {
    const { output } = compile([
      '----',
      'on bogus() reply bogus: "stuff"',
      '----',
      'on hello() reply answer: "world"',
    ].join('\n'));
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', re: { hello: { answer: 'world' } }, to: 'caller',
    });
  });

  it('block comment suppresses all content inside it', async () => {
    const { output } = compile([
      'on hello()',
      '  ---',
      '  reply bogus: "this should not appear"',
      '  ---',
      '  reply answer: "world"',
    ].join('\n'));
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', re: { hello: { answer: 'world' } }, to: 'caller',
    });
  });
});
