import { expectReply } from './helpers.js';

describe('arguments', () => {
  it('positional args — explicit inline', async () => {
    const source = `
      on mult(a : Integer, b : Integer)
        x : Integer = a * b
        reply(x : Integer)
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[3, 5], 'mult'], 'bv-a': [['Integer', 'Integer']], from: 'caller' },
      reply: { id: '1', 'bv-a': [['Integer']], re: [[15], 'mult'], to: 'caller' },
    });
  });

  it('positional args — open form', async () => {
    const source = `
      on mult
        a : Integer
        b : Integer

        x : Integer = a * b
        reply
          x : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[3, 5], 'mult'], 'bv-a': [['Integer', 'Integer']], from: 'caller' },
      reply: { id: '1', 'bv-a': [['Integer']], re: [[15], 'mult'], to: 'caller' },
    });
  });

  it('key-mapped arg — outer: inner : Text', async () => {
    const source = `
      on get(outer: inner : Text)
        reply(result: inner : Text)
    `;
    await expectReply({
      source,
      receive: { id: 'x', op: [{ outer: 'hello' }, 'get'], 'bv-a': [{ outer: 'Text' }], from: 'caller' },
      reply: { id: 'x', 'bv-a': [{ result: 'Text' }], re: [{ result: 'hello' }, 'get'], to: 'caller' },
    });
  });

  it('key-mapped arg — open form', async () => {
    const source = `
      on get
        outer: inner : Text

        reply(result: inner : Text)
    `;
    await expectReply({
      source,
      receive: { id: 'x', op: [{ outer: 'hello' }, 'get'], 'bv-a': [{ outer: 'Text' }], from: 'caller' },
      reply: { id: 'x', 'bv-a': [{ result: 'Text' }], re: [{ result: 'hello' }, 'get'], to: 'caller' },
    });
  });

  it('mixed positional + named args', async () => {
    const source = `
      on mash
        a : Integer
        b : Integer
        :message : Text

        result : Integer = a + b
        reply
          result : Integer
          comment: message : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [[1, 2, { message: 'add this' }], 'mash'], 'bv-a': [['Integer', 'Integer', { message: 'Text' }]], from: 'caller' },
      reply: { id: '1', 'bv-a': [['Integer', { comment: 'Text' }]], re: [[3, { comment: 'add this' }], 'mash'], to: 'caller' },
    });
  });
});
