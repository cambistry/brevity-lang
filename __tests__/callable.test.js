import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

describe('Callable types', () => {
  it('basic callable type parsing and assignment', async () => {
    const source = [
      'on test()',
      '  fn : (Integer) -> (Boolean) = (x : Integer) { x > 0 } : Boolean',
      '  result : Boolean = fn(5)',
      '  reply result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: {} }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { test: ['Boolean'] }, re: { test: [true] }, to: 'caller' });
  });

  it('callable type with named arguments', async () => {
    const source = [
      'on test()',
      '  fn : (msg: Text, flag: Boolean) -> (Text) = (:msg : Text, :flag : Boolean) { "result" } : Text',
      '  result : Text = fn(msg: "hello", flag: true)',
      '  reply result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: {} }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { test: ['Text'] }, re: { test: ["result"] }, to: 'caller' });
  });

  it('callable type with named output', async () => {
    const source = [
      'on test()',
      '  fn : () -> (output: Text) = () { return(output: "result") } : (output: Text)',
      '  :output : Text = fn()',
      '  reply output : Text',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: {} }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { test: ['Text'] }, re: { test: ['result'] }, to: 'caller' });
  });

  it('mixed positional and named callable type', async () => {
    const source = [
      'on test()',
      '  fn : (Text, find: Text, replace: Text) -> (Text) = (s : Text, :find : Text, :replace : Text) { "replaced" } : Text',
      '  result : Text = fn("hello world", find: "world", replace: "earth")',
      '  reply result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: {} }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { test: ['Text'] }, re: { test: ["replaced"] }, to: 'caller' });
  });

  it('type mismatch error for incompatible callable signatures', () => {
    const source = [
      'on test()',
      '  f = (x : Text) { 100 } : Integer',
      '  f2 : () -> (Integer) = f',
      '  reply f2()',
    ].join('\n');
    expect(() => compile(source)).toThrow(/callable signature mismatch/i);
  });

  it('callable type in structure field', async () => {
    const source = [
      'on test()',
      '  s : Structure = Structure(fn: (x : Integer) { x * 2 } : Integer : (Integer) -> (Integer))',
      '  :fn = s',
      '  result : Integer = fn(10)',
      '  reply result',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { test: {} }, from: 'caller' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(binding.post).toHaveBeenCalledWith({ id: '1', 'bv-a': { test: ['Integer'] }, re: { test: [20] }, to: 'caller' });
  });
});
