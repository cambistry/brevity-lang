import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('// line comments', () => {
  it('full-line // before handler is ignored', async () => {
    const { output } = compile([
      '// this is a comment',
      'on hello() reply answer: "world" : Text',
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
      '  reply answer: "world" : Text',
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
      '  bigger : Integer = x + 1 // increment',
      '  reply :bigger : Integer',
    ].join('\n'));
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { inc: { x: 5 } }, 'bv-a': { inc: { x: 'Integer' } }, from: 'caller' });
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
      '  reply answer: "world" : Text',
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
      '  reply answer: "world" : Text',
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
      '  reply answer: "world" : Text',
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
      'on bogus() reply bogus: "stuff" : Text',
      '---',
      'on hello() reply answer: "world" : Text',
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
      'on bogus() reply bogus: "stuff" : Text',
      '----',
      'on hello() reply answer: "world" : Text',
    ].join('\n'));
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', re: { hello: { answer: 'world' } }, to: 'caller',
    });
  });

  it('block comment suppresses all content inside it (inline ---)', async () => {
    const { output } = compile([
      'on hello()',
      '  ---',
      '  reply bogus: "this should not appear" : Text',
      '  ---',
      '  reply answer: "world" : Text',
    ].join('\n'));
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', re: { hello: { answer: 'world' } }, to: 'caller',
    });
  });
});

describe('comment as open-form header/body separator', () => {
  // In the open style (no parens), a double newline (BLOCK_SEP) normally
  // separates the header from the body. A comment line is also accepted —
  // it produces a NEWLINE token that the params loop treats as a non-param,
  // breaking out of param collection and into body parsing.

  it('// separates multi-arg open header from body', async () => {
    const source = [
      'on add',
      '  :a : Integer',
      '  :b : Integer',
      '//',
      '  c : Integer = a + b',
      '  reply :c : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { add: { a: 3, b: 4 } }, 'bv-a': { add: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { add: { c: 7 } }, to: 'caller' });
  });

  it('-- separates multi-arg open header from body', async () => {
    const source = [
      'on add',
      '  :a : Integer',
      '  :b : Integer',
      '--',
      '  c : Integer = a + b',
      '  reply :c : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { add: { a: 3, b: 4 } }, 'bv-a': { add: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { add: { c: 7 } }, to: 'caller' });
  });

  it('// separates no-arg open header (on hello) from body', async () => {
    const source = [
      'on hello',
      '//',
      '  reply answer: "world" : Text',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { hello: { answer: 'world' } }, to: 'caller' });
  });

  it('-- separates no-arg open header (on hello) from body', async () => {
    const source = [
      'on hello',
      '--',
      '  reply answer: "world" : Text',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { hello: { answer: 'world' } }, to: 'caller' });
  });

  it('non-empty // comment between params is transparent — both params still parsed', async () => {
    // A non-empty // comment must NOT terminate the param section.
    // If it did, only :a would be a param and b would be undefined, giving NaN.
    const source = [
      'on add',
      '  :a : Integer',
      '  // :b is the second arg (this comment must not act as a separator)',
      '  :b : Integer',
      '//',
      '  c : Integer = a + b',
      '  reply :c : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { add: { a: 3, b: 4 } }, 'bv-a': { add: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { add: { c: 7 } }, to: 'caller' });
  });

  it('non-empty -- comment between params is transparent — both params still parsed', async () => {
    const source = [
      'on add',
      '  :a : Integer',
      '  -- :b is the second arg (this comment must not act as a separator)',
      '  :b : Integer',
      '--',
      '  c : Integer = a + b',
      '  reply :c : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { add: { a: 3, b: 4 } }, 'bv-a': { add: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { add: { c: 7 } }, to: 'caller' });
  });

  it('block comment between params is transparent — both params still parsed', async () => {
    const source = [
      'on add',
      '  :a : Integer',
      '  ---',
      '  :b is the second arg (this comment must not act as a separator)',
      '  ---',
      '  :b : Integer',
      '--',
      '  c : Integer = a + b',
      '  reply :c : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { add: { a: 3, b: 4 } }, 'bv-a': { add: { a: 'Integer', b: 'Integer' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { add: { c: 7 } }, to: 'caller' });
  });
});
