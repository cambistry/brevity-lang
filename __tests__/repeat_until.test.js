import { expectReply } from './helpers.js';

// ── repeat until — inverted condition tests ─────────────────────────────────

describe('repeat until — block body', () => {
  it('repeat until x <= 0 (same result as repeat while x > 0)', async () => {
    await expectReply({
      source: `
        on test()
          ref x : Integer = 5
          repeat until x <= 0 {
            x <- x - 1
          }
          reply :x
      `,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 0 }, to: 'caller' },
    });
  });
});

describe('repeat until — single-line body', () => {
  it('repeat until x <= 0 single-line', async () => {
    await expectReply({
      source: `
        on test()
          ref x : Integer = 3
          repeat until x <= 0 x <- x - 1
          reply :x
      `,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 0 }, to: 'caller' },
    });
  });
});

describe('repeat until — parenthesized condition', () => {
  it('parens around until condition with block body', async () => {
    await expectReply({
      source: `
        on test()
          ref x : Integer = 4
          repeat until (x <= 0) {
            x <- x - 1
          }
          reply :x
      `,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 0 }, to: 'caller' },
    });
  });
});

describe('repeat until — accumulator', () => {
  it('repeat until x >= limit (same as repeat while x < limit)', async () => {
    await expectReply({
      source: `
        on test(limit : Integer)
          ref x : Integer = 0
          repeat until x >= limit {
            x <- x + 1
          }
          reply :x
      `,
      receive: { id: '1', op: [[5], 'test'], 'bv-a': [['Integer']], from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 5 }, to: 'caller' },
    });
  });
});
