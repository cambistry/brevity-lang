import { expectReply } from './helpers.js';

describe('on', () => {
  it('on hello — open', async () => {
    const source = `on hello\n\n  reply answer: "world" : Text\n`;
    await expectReply({
      source,
      receive: { id: '12345', op: 'hello', from: 'caller' },
      reply: { id: '12345', 'bv-a': [{ answer: 'Text' }], re: [{ answer: 'world' }, 'hello'], to: 'caller' },
    });
  });

  it('on hello() — explicit header, body on next line', async () => {
    const source = `on hello()\n  reply answer: "world" : Text\n`;
    await expectReply({
      source,
      receive: { id: '12345', op: 'hello', from: 'caller' },
      reply: { id: '12345', 'bv-a': [{ answer: 'Text' }], re: [{ answer: 'world' }, 'hello'], to: 'caller' },
    });
  });

  it('on hello() reply — fully inline', async () => {
    const source = `on hello() reply answer: "world" : Text\n`;
    await expectReply({
      source,
      receive: { id: '12345', op: 'hello', from: 'caller' },
      reply: { id: '12345', 'bv-a': [{ answer: 'Text' }], re: [{ answer: 'world' }, 'hello'], to: 'caller' },
    });
  });

  it('multiple handlers in one actor — both cases reachable', async () => {
    const source = `
      on hello

        reply answer: "world" : Text

      on echo(:text : Text) reply(:text : Text)
    `;
    await expectReply({
      source,
      receive: [
        { id: '1', op: 'hello', from: 'caller' },
        { id: '2', op: [{ text: 'abc' }, 'echo'], 'bv-a': [{ text: 'Text' }], from: 'caller' },
      ],
      reply: [
        { id: '1', 'bv-a': [{ answer: 'Text' }], re: [{ answer: 'world' }, 'hello'], to: 'caller' },
        { id: '2', 'bv-a': [{ text: 'Text' }], re: [{ text: 'abc' }, 'echo'], to: 'caller' },
      ],
    });
  });
});

// ─── whitespace-only blank line ───────────────────────────────────────────────

describe('on — spacious handler with whitespace-only blank line', () => {
  it('whitespace-only blank line between params and body acts as BLOCK_SEP', async () => {
    const source = `
      on add
        :a : Integer
        :b : Integer
    ${'  '}
        x : Integer = a + b
        reply :x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': [{ x: 'Integer' }], re: [{ x: 7 }, 'add'], to: 'caller' },
    });
  });
});
