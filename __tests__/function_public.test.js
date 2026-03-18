import { expectReply } from './helpers.js';

describe('public function', () => {
  it('@hello — open', async () => {
    const source = `@hello\n\n  -> answer: "world" : Text\n`;
    await expectReply({
      source,
      receive: { id: '12345', op: 'hello', from: 'caller' },
      reply: { id: '12345', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'caller' },
    });
  });

  it('@hello() — explicit header, body on next line', async () => {
    const source = `@hello()\n  -> answer: "world" : Text\n`;
    await expectReply({
      source,
      receive: { id: '12345', op: 'hello', from: 'caller' },
      reply: { id: '12345', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'caller' },
    });
  });

  it('@hello() -> — fully inline', async () => {
    const source = `@hello() -> answer: "world" : Text\n`;
    await expectReply({
      source,
      receive: { id: '12345', op: 'hello', from: 'caller' },
      reply: { id: '12345', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'caller' },
    });
  });

  it('multiple handlers in one actor — both cases reachable', async () => {
    const source = `
      @hello

        -> answer: "world" : Text

      @echo(:text : Text) ->(:text : Text)
    `;
    await expectReply({
      source,
      receive: [
        { id: '1', op: 'hello', from: 'caller' },
        { id: '2', op: [{ text: 'abc' }, 'echo'], 'bv-a': [{ text: 'Text' }], from: 'caller' },
      ],
      reply: [
        { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'caller' },
        { id: '2', 'bv-a': { text: 'Text' }, re: { text: 'abc' }, to: 'caller' },
      ],
    });
  });
});

// ─── whitespace-only blank line ───────────────────────────────────────────────

describe('public function — spacious handler with whitespace-only blank line', () => {
  it('whitespace-only blank line between params and body acts as BLOCK_SEP', async () => {
    const source = `
      @add
        =
        :a : Integer
        :b : Integer
        =
        x : Integer = a + b
        -> :x
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { x: 'Integer' }, re: { x: 7 }, to: 'caller' },
    });
  });
});
