import { expectBehavior } from '../helpers.js';

describe('unhandled op', () => {
  const script = `
    @hello = -> answer: "world" as Text
    @inc = |x: Integer| -> bigger: (x + 1) as Integer
  `;

  it('string op with no matching function → ex unhandled', async () => {
    await expectBehavior({
      script,
      receive: { id: '1', op: '@goodbye', from: 'c' },
      reply: { id: '1', ex: { '@goodbye': 'unhandled' }, to: 'c' },
    });
  });

  it('object op with no matching function → ex unhandled', async () => {
    await expectBehavior({
      script,
      receive: { id: '2', op: [{ x: 5 }, '@compute'], 'bv-a': [{ x: 'Integer' }], from: 'c' },
      reply: { id: '2', ex: { '@compute': 'unhandled' }, to: 'c' },
    });
  });

  it('multi-function actor — unrecognised op → ex unhandled', async () => {
    await expectBehavior({
      script,
      receive: { id: '3', op: '@nope', from: 'c' },
      reply: { id: '3', ex: { '@nope': 'unhandled' }, to: 'c' },
    });
  });

  it('multi-function actor — recognised op replies normally', async () => {
    await expectBehavior({
      script,
      receive: { id: '4', op: [{ x: 5 }, '@inc'], 'bv-a': [{ x: 'Integer' }], from: 'c' },
      reply: { id: '4', 'bv-a': { bigger: 'Integer' }, re: { bigger: 6 }, to: 'c' },
    });
  });
});
