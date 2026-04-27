import { extract, compile } from '../../index.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Bang form validation — `*x.method!()` is a separate method name, not a modifier.
//
// The bang form exists only on the receiver-ref form, and only when the method's
// return type matches the receiver type — i.e. there's a same-type result to
// write back into the ref. `size!`, `empty?!`, `index_of!`, `contains!`, `split!`
// etc. simply aren't methods; calling them is "no such method".
//
// Enforcement lives at the method-parse site in src/parser.js so that invalid
// bangs are caught uniformly regardless of how the call is shaped (statement-
// level mutation, expression-position read, special-cased SizeExpr).
// ═══════════════════════════════════════════════════════════════════════════════

const compileSrc = (src) => {
  const { ast } = extract(src);
  return compile(ast);
};

describe('bang form on receiver ref: same-type-return rule (Text)', () => {
  it.each([
    'size', 'empty?', 'index_of', 'contains', 'starts_with', 'ends_with', 'split', 'lines',
  ])('Text has no method `%s!`', (method) => {
    const args = method === 'index_of' || method === 'contains' || method === 'starts_with' || method === 'ends_with'
      ? '("x")' : method === 'split' ? '(",")' : '';
    const src = `
      @bad
        =
        t Text! = "hello"
        t.${method}!${args}
        -> result: t
    `;
    expect(() => compileSrc(src)).toThrow(
      new RegExp(`Text has no method .${method.replace('?', '\\?')}!.`),
    );
  });

  it.each([
    'upper', 'lower', 'trim', 'trim_start', 'trim_end',
    'reverse', 'append', 'concat', 'before', 'after',
  ])('Text.%s! compiles (returns Text)', (method) => {
    const args = method === 'before' || method === 'after' || method === 'append' || method === 'concat' ? '("x")' : '';
    const src = `
      @ok
        =
        t Text! = "hello"
        t.${method}!${args}
        -> result: t
    `;
    expect(() => compileSrc(src)).not.toThrow();
  });
});

describe('bang form on receiver ref: same-type-return rule (Blob)', () => {
  it('Blob has no method `size!`', () => {
    const src = `
      @bad
        =
        b Blob! = "hi"
        b.size!
        -> result: b
    `;
    expect(() => compileSrc(src)).toThrow(/Blob has no method .size!./);
  });

  it('Blob has no method `contains!`', () => {
    const src = `
      @bad
        =
        b Blob! = "hi"
        b.contains!("x")
        -> result: b
    `;
    expect(() => compileSrc(src)).toThrow(/Blob has no method .contains!./);
  });

  it('Blob.reverse! compiles', () => {
    const src = `
      @ok
        =
        b Blob! = "hi"
        b.reverse!
        -> result: b
    `;
    expect(() => compileSrc(src)).not.toThrow();
  });
});

describe('bang form on receiver ref: same-type-return rule (GraphemeText)', () => {
  it('GraphemeText has no method `size!`', () => {
    const src = `
      @bad
        =
        g GraphemeText! = "hello"
        g.size!
        -> result: g
    `;
    expect(() => compileSrc(src)).toThrow(/GraphemeText has no method .size!./);
  });

  it('GraphemeText has no method `index_of!`', () => {
    const src = `
      @bad
        =
        g GraphemeText! = "hello"
        g.index_of!("l")
        -> result: g
    `;
    expect(() => compileSrc(src)).toThrow(/GraphemeText has no method .index_of!./);
  });

  it('GraphemeText.reverse! compiles', () => {
    const src = `
      @ok
        =
        g GraphemeText! = "hello"
        g.reverse!
        -> result: g
    `;
    expect(() => compileSrc(src)).not.toThrow();
  });
});

describe('bang form on functional call: never valid', () => {
  // Functional form `Text.method!(arg)` has no receiver ref to mutate. The
  // bang there is structurally meaningless regardless of return type.
  it('Text.upper!(t) is rejected', () => {
    const src = `
      @bad
        =
        t Text! = "hi"
        x Text = Text.upper!(t)
        -> :x
    `;
    expect(() => compileSrc(src)).toThrow(/Text\.upper!\(\.\.\.\) is not a valid form/);
  });

  it('Blob.reverse!(b) is rejected', () => {
    const src = `
      @bad
        =
        b Blob! = "hi"
        x Blob = Blob.reverse!(b)
        -> :x
    `;
    expect(() => compileSrc(src)).toThrow(/Blob\.reverse!\(\.\.\.\) is not a valid form/);
  });
});
