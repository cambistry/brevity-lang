import { expectReply } from './helpers.js';

describe('reply forms', () => {
  it('reply(answer: "world" : Text) — -> with inline parens', async () => {
    const source = `@hello()\n  ->(answer: "world" : Text)\n`;
    await expectReply({
      source,
      receive: { id: '12345', op: 'hello', from: 'caller' },
      reply: {
        id: '12345',
        'bv-a': { answer: 'Text' },
        re: { answer: 'world' },
        to: 'caller',
      },
    });
  });

  it('reply on next line — open -> body', async () => {
    const source = `@hello()\n  ->\n    answer: "world" : Text\n`;
    await expectReply({
      source,
      receive: { id: '12345', op: 'hello', from: 'caller' },
      reply: {
        id: '12345',
        'bv-a': { answer: 'Text' },
        re: { answer: 'world' },
        to: 'caller',
      },
    });
  });

  it('reply( multiline ) — explicit -> with parens across lines', async () => {
    const source = `@hello()\n  ->(\n    answer: "world" : Text\n  )\n`;
    await expectReply({
      source,
      receive: { id: '12345', op: 'hello', from: 'caller' },
      reply: {
        id: '12345',
        'bv-a': { answer: 'Text' },
        re: { answer: 'world' },
        to: 'caller',
      },
    });
  });
});

describe('multi-param forms', () => {
  it('multiple params — explicit inline with commas', async () => {
    const source = `
      @add
        =
        :a : Integer
        :b : Integer
        =
        c : Integer = a + b
        ->(:c : Integer)
    `;
    await expectReply({
      source,
      receive: { id: 'x', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: 'x', 'bv-a': { c: 'Integer' }, re: { c: 7 }, to: 'caller' },
    });
  });

  it('multiple params — explicit multiline', async () => {
    const source = `
      @add
        =
        :a : Integer
        :b : Integer
        =
        c : Integer = a + b
        -> :c : Integer
    `;
    await expectReply({
      source,
      receive: { id: 'x', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: 'x', 'bv-a': { c: 'Integer' }, re: { c: 7 }, to: 'caller' },
    });
  });

  it('multiple params — open form, no commas', async () => {
    const source = `
      @add
        =
        :a : Integer
        :b : Integer
        =
        c : Integer = a + b
        ->
          :c : Integer
    `;
    await expectReply({
      source,
      receive: { id: 'x', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: 'x', 'bv-a': { c: 'Integer' }, re: { c: 7 }, to: 'caller' },
    });
  });
});
