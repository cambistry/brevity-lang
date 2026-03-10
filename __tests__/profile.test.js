import { expectReply } from './helpers.js';

describe('reply forms', () => {
  it('reply(answer: "world" : Text) — reply with inline parens', async () => {
    const source = `on hello()\n  reply(answer: "world" : Text)\n`;
    await expectReply({
      source,
      receive: { id: '12345', op: 'hello', from: 'caller' },
      reply: {
        id: '12345',
        'bv-a': [{ answer: 'Text' }, 'hello'],
        re: [{ answer: 'world' }, 'hello'],
        to: 'caller',
      },
    });
  });

  it('reply on next line — open reply body', async () => {
    const source = `on hello()\n  reply\n    answer: "world" : Text\n`;
    await expectReply({
      source,
      receive: { id: '12345', op: 'hello', from: 'caller' },
      reply: {
        id: '12345',
        'bv-a': [{ answer: 'Text' }, 'hello'],
        re: [{ answer: 'world' }, 'hello'],
        to: 'caller',
      },
    });
  });

  it('reply( multiline ) — explicit reply with parens across lines', async () => {
    const source = `on hello()\n  reply(\n    answer: "world" : Text\n  )\n`;
    await expectReply({
      source,
      receive: { id: '12345', op: 'hello', from: 'caller' },
      reply: {
        id: '12345',
        'bv-a': [{ answer: 'Text' }, 'hello'],
        re: [{ answer: 'world' }, 'hello'],
        to: 'caller',
      },
    });
  });
});

describe('multi-param forms', () => {
  it('multiple params — explicit inline with commas', async () => {
    const source = `
      on add(:a : Integer, :b : Integer)
        c : Integer = a + b
        reply(:c : Integer)
    `;
    await expectReply({
      source,
      receive: { id: 'x', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }, 'add'], from: 'caller' },
      reply: { id: 'x', 'bv-a': [{ c: 'Integer' }, 'add'], re: [{ c: 7 }, 'add'], to: 'caller' },
    });
  });

  it('multiple params — explicit multiline', async () => {
    const source = `
      on add(
        :a : Integer,
        :b : Integer
      )
        c : Integer = a + b
        reply :c : Integer
    `;
    await expectReply({
      source,
      receive: { id: 'x', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }, 'add'], from: 'caller' },
      reply: { id: 'x', 'bv-a': [{ c: 'Integer' }, 'add'], re: [{ c: 7 }, 'add'], to: 'caller' },
    });
  });

  it('multiple params — open form, no commas', async () => {
    const source = `
      on add
        :a : Integer
        :b : Integer

        c : Integer = a + b
        reply
          :c : Integer
    `;
    await expectReply({
      source,
      receive: { id: 'x', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }, 'add'], from: 'caller' },
      reply: { id: 'x', 'bv-a': [{ c: 'Integer' }, 'add'], re: [{ c: 7 }, 'add'], to: 'caller' },
    });
  });
});
