import { compileSource, expectBehavior } from '../helpers.js';

// Every name in value position is bound, or it's `'x' is not defined` (src/names.js).
// A local is bound from its line on; a cell, a function, a class and a `use`
// binding everywhere in their scope.

const compiles = (src) => expect(() => compileSource(src)).not.toThrow();

describe('an unbound name', () => {
  it('is not defined', () => {
    expect(() => compileSource('@f = () -> Thnig\n')).toThrow("'Thnig' is not defined (line 1)");
  });

  it('is not the host\'s', () => {
    expect(() => compileSource('@f = () -> globalThis\n')).toThrow("'globalThis' is not defined (line 1)");
  });

  it('says where it is', () => {
    expect(() => compileSource('@g = () -> 1\n\n@f = {\n  x Integer = 1\n  return x + nope\n}\n')).toThrow("'nope' is not defined (line 5)");
  });

  it('in a call', () => {
    expect(() => compileSource('@f = { return h(1) }\n')).toThrow("'h' is not defined");
  });

  it('as a receiver', () => {
    expect(() => compileSource('@f = { return w.get() }\n')).toThrow("'w' is not defined");
  });

  it('in a class', () => {
    expect(() => compileSource('W = *{ @g = () -> zz }\n@f = () -> 1\n')).toThrow("'zz' is not defined");
  });

  it('a local read before its line', () => {
    expect(() => compileSource('@f = {\n  y Integer = x + 1\n  x = 2\n  return y\n}\n')).toThrow("'x' is not defined (line 2)");
  });

  it('an actor a local holds, messaged before its line', () => {
    expect(() => compileSource('C = *{ @ping = () -> 1 }\n@f = {\n  r Integer = c.ping()\n  c = C()\n  return r\n}\n')).toThrow("'c' is not defined (line 3)");
  });

  it('a lambda param outside the lambda', () => {
    expect(() => compileSource('@f = {\n  g = (z Integer) -> z + 1\n  return z\n}\n')).toThrow("'z' is not defined");
  });
});

describe('an unbound name whose other form is bound', () => {
  it('the published cell', () => {
    expect(() => compileSource('@a *Integer = 1\n@f = { return a }\n')).toThrow("'a' isn't in scope — the published cell is '@a'");
  });

  it('the public function', () => {
    expect(() => compileSource('@h = () -> 1\n@f = { return h() }\n')).toThrow("'h' isn't in scope — the public function is '@h'");
  });

  it('the private function', () => {
    expect(() => compileSource('#h = () -> 1\n@f = { return h() }\n')).toThrow("'h' isn't in scope — the function is '#h'");
  });

  it('the silent function', () => {
    expect(() => compileSource('fire. = { x Integer = 1 }\n@go = {\n  fire()\n  return 1\n}\n')).toThrow("'fire' is not defined — the silent 'fire.' is called 'fire(…)...'");
  });
});

describe('a name is bound by', () => {
  it('a local, from its line on', () => compiles('@f = {\n  x = 2\n  y Integer = x + 1\n  return y\n}\n'));
  it('a param', () => compiles('@f = (n Integer) -> n + 1\n'));
  it('a param default, a later param too', () => compiles('@f = (a Integer = b, b Integer = 1) -> a + b\n'));
  it('a lambda param', () => compiles('@f = {\n  g = (z Integer) -> z + 1\n  return g(1)\n}\n'));
  it('a local function, in itself', () => compiles('@f = {\n  g = (n Integer) {\n    if n == 0 { return 0 }\n    return g(n - 1)\n  }\n  return g(3)\n}\n'));
  it('a destructure', () => compiles('@f = (args Object) {\n  a Integer, b Integer = args\n  return a + b\n}\n'));
  it('a cell of the actor', () => compiles('total *Integer = 4\n@f = () -> total\n'));
  it('a constant of the actor', () => compiles('limit = 4\n@f = () -> limit\n'));
  it('a function of the actor, declared below', () => compiles('@f = () -> h()\nh = () -> 1\n'));
  it('a class', () => compiles('C = *{ @ping = () -> 1 }\n@f = {\n  c = C()\n  return c.ping()\n}\n'));
  it('a type', () => compiles('type Point(Integer, Integer)\n@f = () -> Point(1, 2)\n'));
  it('a `use` later in the file', () => compiles('@f = () -> Svc.n()\nuse Svc = "svc.bv" as { n () -> (Integer) }\n'));
  it('a dependency destructure', () => compiles('use :n = "svc.bv" as { n () -> (Integer) }\n@f = () -> n()\n'));
  it('an enclosing actor\'s cell, from a nested class', () => compiles('total *Integer = 4\nW = *{ @get = { return total } }\n@f = () -> 1\n'));
  it('an enclosing class\'s cell, from a class inside it', () => compiles('O = *{\n  n *Integer = 1\n  I = *{ @get = { return n } }\n  @f = () -> 1\n}\n@g = () -> 1\n'));
  it('a builtin namespace', () => compiles('@f = (t Text) -> Text.upper(t)\n'));
  it('a param that shadows a builtin namespace', () => compiles('@f = (Math Integer) -> Math + 1\n'));
  it('`self`', () => compiles('@f = () -> self\n'));
  it('`class`', () => compiles('C = *{ @twin = () -> class() }\n@f = () -> 1\n'));
  it('`base`', () => compiles('T = *{ h = () -> 1 }\nU = T ^ *{ @g = () -> base::h() }\n@f = () -> 1\n'));
});

describe('a cell is bound before its line', () => {
  const script = `
    @get = { return later }
    later *Integer = 7
  `;

  it('a function reading it runs after', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'get', from: 'c' } },
      { output: { id: '1', 'ty': ['Integer'], re: [7], to: 'c' } },
    );
  });
});
