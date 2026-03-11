import compile from '../index.js';
import { expectReply } from './helpers.js';

describe('fold — with initial value', () => {
  it('fold(0) sums a list of integers', async () => {
    const source = `
      on test()
        nums : List of Integers = [1, 2, 3, 4] : List of Integers
        result : Integer = fold(0) nums (acc : Integer, it : Integer) { return acc + it : Integer } : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ result: 'Integer' }],
        re: [{ result: 10 }, 'test'],
        to: 'caller',
      },
    });
  });

  it('fold(1) computes product', async () => {
    const source = `
      on test()
        nums : List of Integers = [2, 3, 4] : List of Integers
        result : Integer = fold(1) nums (acc : Integer, it : Integer) { return acc * it : Integer } : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ result: 'Integer' }],
        re: [{ result: 24 }, 'test'],
        to: 'caller',
      },
    });
  });
});

describe('fold — without initial value', () => {
  it('fold without initial sums multi-element list', async () => {
    const source = `
      on test()
        nums : List of Integers = [10, 20, 30] : List of Integers
        result : Integer | null = fold nums (acc : Integer, it : Integer) { return acc + it : Integer } : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ result: 'Integer | null' }],
        re: [{ result: 60 }, 'test'],
        to: 'caller',
      },
    });
  });

  it('fold without initial on single-element list returns the element', async () => {
    const source = `
      on test()
        nums : List of Integers = [42] : List of Integers
        result : Integer | null = fold nums (acc : Integer, it : Integer) { return acc + it : Integer } : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ result: 'Integer | null' }],
        re: [{ result: 42 }, 'test'],
        to: 'caller',
      },
    });
  });

  it('fold without initial on empty list returns null', async () => {
    const source = `
      on test()
        nums : List of Integers = []
        result : Integer | null = fold nums (acc : Integer, it : Integer) { return acc + it : Integer } : Integer
        reply :result
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': [{ result: 'Integer | null' }],
        re: [{ result: null }, 'test'],
        to: 'caller',
      },
    });
  });
});

describe('fold — compile errors', () => {
  it('fold used standalone (not assigned) throws a compile error', () => {
    expect(() => compile([
      'on test()',
      '  nums : List of Integers = [1, 2] : List of Integers',
      '  fold nums (acc : Integer, it : Integer) { return acc + it : Integer } : Integer',
      '  reply result: 0 : Integer',
    ].join('\n'))).toThrow(/'fold' must be assigned/);
  });
});
