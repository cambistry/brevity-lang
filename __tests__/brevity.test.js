import vm from 'vm';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jest } from '@jest/globals';
import compile from '../index.js';

function run(code) {
  vm.runInNewContext(code);
}

async function evaluate(compiled, exportName = 'default') {
  const tmp = join(tmpdir(), `test_${Date.now()}.mjs`);
  await writeFile(tmp, compiled);
  try {
    const mod = await import(tmp);
    return mod[exportName];
  } finally {
    await unlink(tmp);
  }
}

describe('compile', () => {
  let result;

  beforeEach(() => {
    result = compile('');
  });

  it('returns an output key', () => {
    expect(result).toHaveProperty('output');
  });

  it('returns a manifest key', () => {
    expect(result).toHaveProperty('manifest');
  });

  it('returns a sourcemap key', () => {
    expect(result).toHaveProperty('sourcemap');
  });

  it('returns an errors key', () => {
    expect(result).toHaveProperty('errors');
  });

  it('throws when input is not a string', () => {
    expect(() => compile(123)).toThrow(TypeError);
  });
});

describe('output execution', () => {
  it('empty script produces output that runs without error', () => {
    const { output } = compile('');
    expect(() => run(output)).not.toThrow();
  });

  it('malformed JS throws when run (confirms runner is not a no-op)', () => {
    expect(() => run('const = ;')).toThrow();
  });
});

describe('handlers', () => {
  it('on hello — spacious', async () => {
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

  it('on hello() — dense header, body on next line', async () => {
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

  it('reply(answer: "world") — reply with inline parens', async () => {
    const { output } = compile(`on hello()\n  reply(answer: "world")\n`);
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

  it('reply on next line — spacious reply body', async () => {
    const { output } = compile(`on hello()\n  reply\n    answer: "world"\n`);
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

  it('reply( multiline ) — dense reply with parens across lines', async () => {
    const { output } = compile(`on hello()\n  reply(\n    answer: "world"\n  )\n`);
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

  it('actor declaration — named class, named export', async () => {
    const source = `actor User\n\non hello\n\n  reply answer: "world"\n\nend#User\n`;
    const { output } = compile(source);
    const User = await evaluate(output, 'User');
    const binding = { post: jest.fn() };
    const actor = new User(binding);
    actor.receive({ id: '12345', op: 'hello', from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '12345',
      re: { hello: { answer: 'world' } },
      to: 'caller',
    });
  });

  it('multiple actor definitions — named exports', async () => {
    const source = [
      'actor Greeter',
      '',
      'on hello',
      '',
      '  reply answer: "world"',
      '',
      'end#Greeter',
      '',
      'actor Echo',
      '',
      'on echo(:text : Text) reply(:text : Text)',
      '',
      'end#Echo',
    ].join('\n');
    const { output } = compile(source);

    const Greeter = await evaluate(output, 'Greeter');
    const greeterBinding = { post: jest.fn() };
    new Greeter(greeterBinding).receive({ id: '1', op: 'hello', from: 'caller' });
    expect(greeterBinding.post).toHaveBeenCalledWith({
      id: '1',
      re: { hello: { answer: 'world' } },
      to: 'caller',
    });

    const Echo = await evaluate(output, 'Echo');
    const echoBinding = { post: jest.fn() };
    new Echo(echoBinding).receive({ id: '2', op: { echo: { text: 'abc' } }, from: 'caller' });
    expect(echoBinding.post).toHaveBeenCalledWith({
      id: '2',
      re: { echo: { text: 'abc' } },
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

    actor.receive({ id: '2', op: { echo: { text: 'abc' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '2',
      re: { echo: { text: 'abc' } },
      to: 'caller',
    });
  });

  it('local var assignment and restructure — a = x, reply(:a)', async () => {
    const source = [
      'on echo2(:x : Integer)',
      '  a = x',
      '  reply(:a : Integer)',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    const actor = new Actor(binding);
    actor.receive({ id: 'someid', op: { echo2: { x: 42 } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: 'someid',
      re: { echo2: { a: 42 } },
      to: 'caller',
    });
  });

  it('multiple params — dense inline with commas', async () => {
    const source = [
      'on add(:a : Integer, :b : Integer)',
      '  c = a + b',
      '  reply(:c : Integer)',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: 'x', op: { add: { a: 3, b: 4 } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: 'x', re: { add: { c: 7 } }, to: 'caller' });
  });

  it('multiple params — dense multiline', async () => {
    const source = [
      'on add(',
      '  :a : Integer,',
      '  :b : Integer',
      ')',
      '  c = a + b',
      '  reply :c : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: 'x', op: { add: { a: 3, b: 4 } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: 'x', re: { add: { c: 7 } }, to: 'caller' });
  });

  it('multiple params — spacious form, no commas', async () => {
    const source = [
      'on add',
      '  :a : Integer',
      '  :b : Integer',
      '',
      '  c = a + b',
      '  reply',
      '    :c : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: 'x', op: { add: { a: 3, b: 4 } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: 'x', re: { add: { c: 7 } }, to: 'caller' });
  });

  it('computed reply field — reply(c: a + b : Integer)', async () => {
    const source = 'on add(:a : Integer, :b : Integer)\n  reply(c: a + b : Integer)\n';
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: 'x', op: { add: { a: 3, b: 4 } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: 'x', re: { add: { c: 7 } }, to: 'caller' });
  });

  it('key-mapped arg — outer: inner : String', async () => {
    const source = [
      'on get(outer: inner : String)',
      '  reply(result: inner : String)',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: 'x', op: { get: { outer: 'hello' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: 'x', re: { get: { result: 'hello' } }, to: 'caller' });
  });

  it('key-mapped arg — spacious form', async () => {
    const source = [
      'on get',
      '  outer: inner : String',
      '',
      '  reply(result: inner : String)',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: 'x', op: { get: { outer: 'hello' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: 'x', re: { get: { result: 'hello' } }, to: 'caller' });
  });

  it('mixed positional + named args', async () => {
    const source = [
      'on mash',
      '  a : Integer',
      '  b : Integer',
      '  :message : Text',
      '',
      '  result = a + b',
      '  reply',
      '    result : Integer',
      '    comment: message : Text',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { mash: [1, 2, { message: 'add this' }] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1',
      re: { mash: [3, { comment: 'add this' }] },
      to: 'caller',
    });
  });

  it('positional args — dense inline', async () => {
    const source = [
      'on mult(a : Integer, b : Integer)',
      '  x = a * b',
      '  reply(x : Integer)',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { mult: [3, 5] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { mult: [15] }, to: 'caller' });
  });

  it('positional args — spacious form', async () => {
    const source = [
      'on mult',
      '  a : Integer',
      '  b : Integer',
      '',
      '  x = a * b',
      '  reply',
      '    x : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { mult: [3, 5] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({ id: '1', re: { mult: [15] }, to: 'caller' });
  });

  it('integer math — bigger = x + 1', async () => {
    const source = [
      'on inc(:x : Integer)',
      '  bigger = x + 1',
      '  reply :bigger : Integer',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    const actor = new Actor(binding);
    actor.receive({ id: 'someid', op: { inc: { x: 5 } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: 'someid',
      re: { inc: { bigger: 6 } },
      to: 'caller',
    });
  });

  it('on echo(:text : Text) — destructures and reflects arg', async () => {
    const { output } = compile(`on echo(:text : Text) reply(:text : Text)\n`);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    const actor = new Actor(binding);
    actor.receive({ id: 'someid', op: { echo: { text: 'abc' } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: 'someid',
      re: { echo: { text: 'abc' } },
      to: 'caller',
    });
  });
});
