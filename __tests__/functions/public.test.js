import { expectBehavior, compileSource } from '../helpers.js';

describe('public function', () => {
  const script = `
    @helloOpen
      =
      -> answer: "world"

    @helloInline = -> answer: "world"

    @echo = (text: Text) ->(:text)

    @add
      =
      a: Integer
      b: Integer
      =
      x Integer = a + b
      return :x
  `;

  it('@hello — lineal form', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@helloOpen', from: 'c' } },
      { output: { id: '1', 'ty': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' } },
    );
  });

  it('@hello = -> — delimited inline', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: '@helloInline', from: 'c' } },
      { output: { id: '2', 'ty': { answer: 'Text' }, re: { answer: 'world' }, to: 'c' } },
    );
  });

  it('@echo — named param round-trip', async () => {
    await expectBehavior(script,
      { input: { id: '3', op: [{ text: 'abc' }, '@echo'], 'ty': [{ text: 'Text' }], from: 'c' } },
      { output: { id: '3', 'ty': { text: 'Text' }, re: { text: 'abc' }, to: 'c' } },
    );
  });

  it('whitespace-only blank line between params and body', async () => {
    await expectBehavior(script,
      { input: { id: '4', op: [{ a: 3, b: 4 }, '@add'], 'ty': [{ a: 'Integer', b: 'Integer' }], from: 'c' } },
      { output: { id: '4', 'ty': { x: 'Integer' }, re: { x: 7 }, to: 'c' } },
    );
  });
});

describe('f, @f and #f are different functions', () => {
  const script = `
    f = { return "private" }
    @f = { return "public" }
    #f = { return "hash" }

    g = { return v: "private" }
    @g = { return v: "public" }

    @onlyPublic = { return "only" }

    @callsPrivate = {
      t Text = f()
      return t
    }
    @callsPublic = {
      t Text = @f()
      return t
    }
    @callsHash = {
      t Text = #f()
      return t
    }
    @destructuresPrivate = {
      :v Text = g()
      return :v
    }
    @destructuresPublic = {
      :v Text = @g()
      return :v
    }
    @inPlacePrivate = { return f() }
    @inPlacePublic = { return @f() }
  `;

  const reads = (op, value) => expectBehavior(script,
    { input: { id: '1', op, from: 'c' } },
    { output: { id: '1', re: [value], 'ty': ['Text'], to: 'c' } },
  );

  it('f() calls f', () => reads('@callsPrivate', 'private'));
  it('@f() calls @f', () => reads('@callsPublic', 'public'));
  it('#f() calls #f', () => reads('@callsHash', 'hash'));

  it('f() in place calls f', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@inPlacePrivate', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: ['private'], to: 'c' }) },
    );
  });

  it('@f() in place calls @f', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@inPlacePublic', from: 'c' } },
      { output: expect.objectContaining({ id: '1', re: ['public'], to: 'c' }) },
    );
  });

  it('a destructured f() calls f', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@destructuresPrivate', from: 'c' } },
      { output: { id: '1', re: { v: 'private' }, 'ty': { v: 'Text' }, to: 'c' } },
    );
  });

  it('a destructured @f() calls @f', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@destructuresPublic', from: 'c' } },
      { output: { id: '1', re: { v: 'public' }, 'ty': { v: 'Text' }, to: 'c' } },
    );
  });

  it('outside, @f answers', () => reads('@f', 'public'));

  it('outside, f doesn\'t answer', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'f', from: 'c' } },
      { output: { id: '1', ex: { f: 'unhandled' }, to: 'c' } },
    );
  });

  it('outside, .f doesn\'t answer', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '.f', from: 'c' } },
      { output: { id: '1', ex: { '.f': 'unhandled' }, to: 'c' } },
    );
  });

  // On the wire, a protected label takes a leading `.`: f is op `.f`.
  it('inside, f is op .f', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { op: '.f' }, from: 't' } },
      { output: expect.objectContaining({ id: '1', re: ['private'] }) },
    );
  });

  it('inside, op f is nothing', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { op: 'f' }, from: 't' } },
      { output: expect.objectContaining({ id: '1', ex: { f: 'unhandled' } }) },
    );
  });

  it('outside, #f doesn\'t answer', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '#f', from: 'c' } },
      { output: { id: '1', ex: { '#f': 'unhandled' }, to: 'c' } },
    );
  });

  it('the doc lists only @f, as f', () => {
    const { interface: doc } = compileSource(script);
    expect(doc.service.match(/^ {2}f /gm)).toHaveLength(1);
    expect(doc.service).toContain('f () -> (Text)');
  });

  it('a bare name doesn\'t reach @f', () => {
    expect(() => compileSource('@f = { return 1 }\n@g = { return f() }\n')).toThrow(/'f' isn't in scope — the public function is '@f'/);
    expect(() => compileSource('@f! = { return 1 }\n@g! = { return f!() }\n')).toThrow(/'f!' isn't in scope — the public function is '@f!'/);
  });

  it('a bare name doesn\'t reach #f', () => {
    expect(() => compileSource('#f = { return 1 }\n@g = { return f() }\n')).toThrow(/'f' isn't in scope — the function is '#f'/);
  });

  it('a chain from a bare name doesn\'t reach @f!', () => {
    expect(() => compileSource('@a *Integer = 0\n@f! = { @a <- 1 }\n@g! = {\n  f!().a\n}\n')).toThrow(/'f!' isn't in scope — the public function is '@f!'/);
  });

  it('a param or local named f is its own name', () => {
    expect(() => compileSource('@f = { return 1 }\n@g = (f (Integer) -> (Integer)) { return f(1) }\n')).not.toThrow();
  });
});
