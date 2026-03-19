import { expectReply } from './helpers.js';

describe('// line comments', () => {
  it('full-line // before function is ignored', async () => {
    const source = `
      // this is a comment
      @hello = -> answer: "world" : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'hello', from: 'caller' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'caller' },
    });
  });

  it('// inline after function signature is ignored', async () => {
    const source = `
      @hello = // opens the function
        -> answer: "world" : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'hello', from: 'caller' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'caller' },
    });
  });

  it('// inline after a body statement is ignored', async () => {
    const source = `
      @inc
        =
        :x : Integer
        =
        bigger : Integer = x + 1 // increment
        -> :bigger : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ x: 5 }, 'inc'], 'bv-a': [{ x: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { bigger: 'Integer' }, re: { bigger: 6 }, to: 'caller' },
    });
  });
});

describe('-- dash comments', () => {
  it('-- alone on a line is ignored', async () => {
    const source = `
      @hello
        =
      --
        -> answer: "world" : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'hello', from: 'caller' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'caller' },
    });
  });

  it('-- text is a single-line comment', async () => {
    const source = `
      @hello
        =
        -- this comment is ignored
        -> answer: "world" : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'hello', from: 'caller' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'caller' },
    });
  });

  it('-- label -- (labeled stitch) is a single-line comment', async () => {
    const source = `
      @hello
        =
        -- labeled separator --
        -> answer: "world" : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'hello', from: 'caller' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'caller' },
    });
  });

  it('--- opens and closes a block comment', async () => {
    const source = `
      ---
      @bogus = -> bogus: "stuff" : Text
      ---
      @hello = -> answer: "world" : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'hello', from: 'caller' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'caller' },
    });
  });

  it('---- (four dashes) also opens and closes a block comment', async () => {
    const source = `
      ----
      @bogus = -> bogus: "stuff" : Text
      ----
      @hello = -> answer: "world" : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'hello', from: 'caller' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'caller' },
    });
  });

  it('block comment suppresses all content inside it (inline ---)', async () => {
    const source = `
      @hello
        =
        ---
        -> bogus: "this should not appear" : Text
        ---
        -> answer: "world" : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'hello', from: 'caller' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'caller' },
    });
  });
});

describe('comment as open-form header/body separator', () => {
  // In the open style (no parens), a double newline (BLOCK_SEP) normally
  // separates the header from the body. A comment line is also accepted —
  // it produces a NEWLINE token that the params loop treats as a non-param,
  // breaking out of param collection and into body parsing.

  it('// separates multi-arg open header from body', async () => {
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
      receive: { id: '1', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { c: 'Integer' }, re: { c: 7 }, to: 'caller' },
    });
  });

  it('-- separates multi-arg open header from body', async () => {
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
      receive: { id: '1', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { c: 'Integer' }, re: { c: 7 }, to: 'caller' },
    });
  });

  it('// separates no-arg open header (on hello) from body', async () => {
    const source = `
      @hello
        =
        -> answer: "world" : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'hello', from: 'caller' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'caller' },
    });
  });

  it('-- separates no-arg open header (on hello) from body', async () => {
    const source = `
      @hello
        =
        -> answer: "world" : Text
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'hello', from: 'caller' },
      reply: { id: '1', 'bv-a': { answer: 'Text' }, re: { answer: 'world' }, to: 'caller' },
    });
  });

  it('non-empty // comment between params is transparent — both params still parsed', async () => {
    // A non-empty // comment must NOT terminate the param section.
    // If it did, only :a would be a param and b would be undefined, giving NaN.
    const source = `
      @add
        =
        :a : Integer
        // :b is the second arg (this comment must not act as a separator)
        :b : Integer
        =
        c : Integer = a + b
        -> :c : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { c: 'Integer' }, re: { c: 7 }, to: 'caller' },
    });
  });

  it('non-empty -- comment between params is transparent — both params still parsed', async () => {
    const source = `
      @add
        =
        :a : Integer
        -- :b is the second arg (this comment must not act as a separator)
        :b : Integer
        =
        c : Integer = a + b
        -> :c : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { c: 'Integer' }, re: { c: 7 }, to: 'caller' },
    });
  });

  it('block comment between params is transparent — both params still parsed', async () => {
    const source = `
      @add
        =
        :a : Integer
        ---
        :b is the second arg (this comment must not act as a separator)
        ---
        :b : Integer
        =
        c : Integer = a + b
        -> :c : Integer
    `;
    await expectReply({
      source,
      receive: { id: '1', op: [{ a: 3, b: 4 }, 'add'], 'bv-a': [{ a: 'Integer', b: 'Integer' }], from: 'caller' },
      reply: { id: '1', 'bv-a': { c: 'Integer' }, re: { c: 7 }, to: 'caller' },
    });
  });
});
