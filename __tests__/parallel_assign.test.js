import { expectReply } from './helpers.js';

describe('parallel assign — positional inline structure', () => {
  it('a, b = 1 : Integer, 2 : Integer binds both positionals', async () => {
    const source = `
      on foo()
        a, b = 1 : Integer, 2 : Integer
        reply x: a, y: b
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'foo', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ x: 'Integer', y: 'Integer' }, 'foo'], re: [{ x: 1, y: 2 }, 'foo'], to: 'caller' },
    });
  });

  it('a, b = 10 : Integer, 20 : Integer arithmetic on results', async () => {
    const source = `
      on foo()
        a, b = 10 : Integer, 20 : Integer
        reply sum: a + b : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'foo', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ sum: 'Integer' }, 'foo'], re: [{ sum: 30 }, 'foo'], to: 'caller' },
    });
  });
});

describe('parallel assign — named inline structure', () => {
  it(':x, :y = x: 5 : Integer, y: 7 : Integer binds named fields', async () => {
    const source = `
      on foo()
        :x, :y = x: 5 : Integer, y: 7 : Integer
        reply a: x, b: y
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'foo', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ a: 'Integer', b: 'Integer' }, 'foo'], re: [{ a: 5, b: 7 }, 'foo'], to: 'caller' },
    });
  });
});

describe('parallel assign — string literals', () => {
  it('a, b = "hello" : Text, "world" : Text binds both strings', async () => {
    const source = `
      on foo()
        a, b = "hello" : Text, "world" : Text
        reply first: a, second: b
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'foo', from: 'caller' },
      reply: { id: '1', 'bv-a': [{ first: 'Text', second: 'Text' }, 'foo'], re: [{ first: 'hello', second: 'world' }, 'foo'], to: 'caller' },
    });
  });
});
