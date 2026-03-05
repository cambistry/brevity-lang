import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

// ...args binds the entire op payload as a Structure:
//   { positional: [...], named: {...}, positional_types: null, named_types: null }
// reply(...args) splats the Structure back to wire format.
// Pack+splat is identity for the standard payload shapes tested here.

describe('...args rest binding', () => {
  it('named payload passes through — pack/splat roundtrip', async () => {
    const { output } = compile('on import(...args) reply(...args)\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { import: { a: 1, b: 2 } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', re: { import: { a: 1, b: 2 } }, to: 'caller',
    });
  });

  it('positional payload passes through — pack/splat roundtrip', async () => {
    const { output } = compile('on import(...args) reply(...args)\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { import: [1, 2] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', re: { import: [1, 2] }, to: 'caller',
    });
  });

  it('mixed payload passes through — pack/splat roundtrip', async () => {
    const { output } = compile('on import(...args) reply(...args)\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { import: [1, 2, { c: 3 }] }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', re: { import: [1, 2, { c: 3 }] }, to: 'caller',
    });
  });

  it('explicit : Structure type annotation is accepted', async () => {
    const { output } = compile('on import(...args : Structure) reply(...args : Structure)\n');
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { import: { x: 42 } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', re: { import: { x: 42 } }, to: 'caller',
    });
  });

  it('open form with ...args : Structure and stitch separator', async () => {
    const source = [
      'on import',
      '  ...args : Structure',
      '--',
      '  reply',
      '    ...args : Structure',
    ].join('\n');
    const { output } = compile(source);
    const Actor = await evaluate(output);
    const binding = { post: jest.fn() };
    new Actor(binding).receive({ id: '1', op: { import: { a: 1, b: 2 } }, from: 'caller' });
    expect(binding.post).toHaveBeenCalledWith({
      id: '1', re: { import: { a: 1, b: 2 } }, to: 'caller',
    });
  });
});
