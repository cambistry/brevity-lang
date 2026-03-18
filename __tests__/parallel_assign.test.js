import { expectReply } from './helpers.js';

describe('parallel assign — positional inline structure', () => {
  it('a, b = 1 : Integer, 2 : Integer binds both positionals', async () => {
    const source = `
      @foo()
        a, b = 1 : Integer, 2 : Integer
        -> x: a, y: b
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'foo', from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer', y: 'Integer' }, re: { x: 1, y: 2 }, to: 'caller' },
    });
  });

  it('a, b = 10 : Integer, 20 : Integer arithmetic @results', async () => {
    const source = `
      @foo()
        a, b = 10 : Integer, 20 : Integer
        -> sum: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'foo', from: 'caller' },
      reply: { id: '1', 'bv-a': { sum: 'Integer' }, re: { sum: 30 }, to: 'caller' },
    });
  });
});

describe('parallel assign — named inline structure', () => {
  it(':x, :y = x: 5 : Integer, y: 7 : Integer binds named fields', async () => {
    const source = `
      @foo()
        :x, :y = x: 5 : Integer, y: 7 : Integer
        -> a: x, b: y
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'foo', from: 'caller' },
      reply: { id: '1', 'bv-a': { a: 'Integer', b: 'Integer' }, re: { a: 5, b: 7 }, to: 'caller' },
    });
  });
});

describe('parallel assign — string literals', () => {
  it('a, b = "hello" : Text, "world" : Text binds both strings', async () => {
    const source = `
      @foo()
        a, b = "hello" : Text, "world" : Text
        -> first: a, second: b
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'foo', from: 'caller' },
      reply: { id: '1', 'bv-a': { first: 'Text', second: 'Text' }, re: { first: 'hello', second: 'world' }, to: 'caller' },
    });
  });
});
