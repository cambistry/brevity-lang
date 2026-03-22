import { compileActor, expectActorReply } from './helpers.js';

describe('repeat until', () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileActor(`
      @blockBody
        =
        ref x : Integer = 5
        repeat until x <= 0 {
          x <- x - 1
        }
        -> :x

      @singleLine
        =
        ref x : Integer = 3
        repeat until x <= 0 x <- x - 1
        -> :x

      @parenCondition
        =
        ref x : Integer = 4
        repeat until (x <= 0) {
          x <- x - 1
        }
        -> :x

      @accumulator
        =
        limit : Integer
        =
        ref x : Integer = 0
        repeat until x >= limit {
          x <- x + 1
        }
        -> :x
    `);
  });

  it('block body — repeat until x <= 0', async () => {
    await expectActorReply({ compiled, receive: { id: '1', op: '@blockBody', from: 'c' }, reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 0 }, to: 'c' } });
  });

  it('single-line body', async () => {
    await expectActorReply({ compiled, receive: { id: '2', op: '@singleLine', from: 'c' }, reply: { id: '2', 'bv-a': { x: 'Integer' }, re: { x: 0 }, to: 'c' } });
  });

  it('parenthesized condition', async () => {
    await expectActorReply({ compiled, receive: { id: '3', op: '@parenCondition', from: 'c' }, reply: { id: '3', 'bv-a': { x: 'Integer' }, re: { x: 0 }, to: 'c' } });
  });

  it('accumulator — repeat until x >= limit', async () => {
    await expectActorReply({ compiled, receive: { id: '4', op: [[5], '@accumulator'], 'bv-a': [['Integer']], from: 'c' }, reply: { id: '4', 'bv-a': { x: 'Integer' }, re: { x: 5 }, to: 'c' } });
  });
});
