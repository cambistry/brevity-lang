import { tokenize } from '../src/lexer.js';
import { parse } from '../src/parser.js';

// Helper — parse source and return the first (anonymous) actor's functions
function parseFns(source) {
  const ast = parse(tokenize(source));
  return ast.actors[0].functions;
}

// ── // line comments ────────────────────────────────────────────────────────

describe('// line comments', () => {
  it('full-line // before function is ignored', () => {
    const fns = parseFns(`
      // this is a comment
      @hello = -> answer: "world" : Text
    `);
    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe('hello');
  });

  it('// inline after function signature is ignored', () => {
    const fns = parseFns(`
      @hello = // opens the function
        -> answer: "world" : Text
    `);
    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe('hello');
    expect(fns[0].body.find(s => s.type === 'Reply')).toBeDefined();
  });

  it('// inline after a body statement is ignored', () => {
    const fns = parseFns(`
      @inc
        =
        :x : Integer
        =
        bigger : Integer = x + 1 // increment
        -> :bigger : Integer
    `);
    expect(fns[0].params).toHaveLength(1);
    expect(fns[0].body).toHaveLength(2); // TypedAssign + Reply
  });
});

// ── -- dash comments and --- block comments ─────────────────────────────────

describe('-- dash comments', () => {
  it('-- alone on a line is ignored', () => {
    const fns = parseFns(`
      @hello
        =
      --
        -> answer: "world" : Text
    `);
    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe('hello');
  });

  it('-- text is a single-line comment', () => {
    const fns = parseFns(`
      @hello
        =
        -- this comment is ignored
        -> answer: "world" : Text
    `);
    expect(fns).toHaveLength(1);
    expect(fns[0].body.find(s => s.type === 'Reply')).toBeDefined();
  });

  it('-- label -- (labeled stitch) is a single-line comment', () => {
    const fns = parseFns(`
      @hello
        =
        -- labeled separator --
        -> answer: "world" : Text
    `);
    expect(fns).toHaveLength(1);
  });

  it('--- opens and closes a block comment — @bogus is suppressed', () => {
    const fns = parseFns(`
      ---
      @bogus = -> bogus: "stuff" : Text
      ---
      @hello = -> answer: "world" : Text
    `);
    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe('hello');
    expect(fns.find(f => f.name === 'bogus')).toBeUndefined();
  });

  it('---- (four dashes) also opens and closes a block comment', () => {
    const fns = parseFns(`
      ----
      @bogus = -> bogus: "stuff" : Text
      ----
      @hello = -> answer: "world" : Text
    `);
    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe('hello');
  });

  it('block comment suppresses all content inside a function body', () => {
    const fns = parseFns(`
      @hello
        =
        ---
        -> bogus: "this should not appear" : Text
        ---
        -> answer: "world" : Text
    `);
    expect(fns).toHaveLength(1);
    // Only the reply after the block comment survives
    const replies = fns[0].body.filter(s => s.type === 'Reply');
    expect(replies).toHaveLength(1);
    expect(replies[0].fields[0].key).toBe('answer');
  });
});

// ── Comment as open-form header/body separator ──────────────────────────────

describe('comment as open-form header/body separator', () => {
  it('= separates multi-arg open header from body', () => {
    const fns = parseFns(`
      @add
        =
        :a : Integer
        :b : Integer
        =
        c : Integer = a + b
        -> :c : Integer
    `);
    expect(fns[0].params).toHaveLength(2);
    expect(fns[0].params[0].name).toBe('a');
    expect(fns[0].params[1].name).toBe('b');
  });

  it('= separates no-arg open header from body', () => {
    const fns = parseFns(`
      @hello
        =
        -> answer: "world" : Text
    `);
    expect(fns[0].params).toHaveLength(0);
    expect(fns[0].body.find(s => s.type === 'Reply')).toBeDefined();
  });

  it('non-empty // comment between params is transparent — both params parsed', () => {
    const fns = parseFns(`
      @add
        =
        :a : Integer
        // :b is the second arg (this comment must not act as a separator)
        :b : Integer
        =
        c : Integer = a + b
        -> :c : Integer
    `);
    expect(fns[0].params).toHaveLength(2);
    expect(fns[0].params[0].name).toBe('a');
    expect(fns[0].params[1].name).toBe('b');
  });

  it('non-empty -- comment between params is transparent — both params parsed', () => {
    const fns = parseFns(`
      @add
        =
        :a : Integer
        -- :b is the second arg (this comment must not act as a separator)
        :b : Integer
        =
        c : Integer = a + b
        -> :c : Integer
    `);
    expect(fns[0].params).toHaveLength(2);
  });

  it('block comment between params is transparent — both params parsed', () => {
    const fns = parseFns(`
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
    `);
    expect(fns[0].params).toHaveLength(2);
  });
});
