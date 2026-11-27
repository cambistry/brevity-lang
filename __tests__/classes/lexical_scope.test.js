import { compileSource, expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Lexical scope: an inner scope reaches every name of every scope lexically
// containing it — public (`@x`), protected (bare `x`) and private (`#x`) — and
// interacts with it directly: read, write (`*` cells only), call, subscribe. No
// exceptions by visibility or by kind of inner scope.
// See notes/private-names-lexical-2026-11-16.md.
//
// The matrix is crossed pairwise: every inner scope meets every name kind and
// visibility, and each containing scope meets every inner scope, with the
// operation varied across them. Each handler sums one row, so a value names its
// row: reads are 1 + 2 + 4 (`@pc`, `c`, `k`), calls 8 + 16 + 32 (`@pf`, `f`,
// `#f`), calls with args 64 + 128 + 256 (`@pg`, `g`, `#g`).
//
// Private cells and constants outside a function body don't parse yet (the
// private-values ticket); their cases join the matrix when it lands.
// ═══════════════════════════════════════════════════════════════════════════════

const ask = (op, value, id = '1') => [
  { input: { id, op, from: 'c' } },
  { output: { id, re: [value], ty: ['Integer'], to: 'c' } },
];
const askAt = (to, op, value, id) => [
  { input: { id, op, to, from: 'c' } },
  { output: { id, re: [value], ty: ['Integer'], to: 'c', from: to } },
];
const build = (to, id = '1') => [
  { input: { id, op: '$new', to, from: 'c' } },
  { output: { id, re: [`#<${to}:1>`], ty: [to], to: 'c' } },
];

// ── The file actor contains it ──────────────────────────────────────────────

const fileScript = `
  @pc *Integer = 1
  c *Integer = 2
  k = 4
  @pf = () -> 8
  f = () -> 16
  #f = () -> 32
  @pg = (n Integer) -> n + 64
  g = (n Integer) -> n + 128
  #g = (n Integer) -> n + 256
  @pw! = { @pc <- @pc + 1000 }
  w! = { c <- c + 1000 }
  #w! = { c <- c + 2000 }
  last *Integer = 0

  @readC = { return c }
  @readPc = { return @pc }
  @readLast = { return last }

  // A function-local function, plain and private.
  @localRead = {
    h = () -> @pc + c + k
    x Integer = h()
    return x
  }
  @localCall = {
    #h = (z Integer) -> @pf() + f() + #f() + z
    x Integer = #h(0)
    return x
  }
  @localArgs = {
    h = (z Integer) -> @pg(z) + g(z) + #g(z)
    x Integer = h(0)
    return x
  }
  @localWrite! = {
    h! = () { c <- c + 1 }
    h!()
  }
  @localWriter! = {
    h! = () { w!() }
    h!()
  }
  // A function inside a function inside a function.
  @nestedRead = {
    h = () {
      i = () -> @pc + c + k
      return i()
    }
    x Integer = h()
    return x
  }
  @nestedCall = {
    h = () {
      #i = () -> @pf() + f() + #f()
      return #i()
    }
    x Integer = h()
    return x
  }
  // A lambda passed to \`over\` and \`reduce\`.
  @overRead = {
    xs List of Integers = over([0]) (z Integer) { z + @pc + c + k }
    x Integer = reduce(0, xs) (a Integer, b Integer) { a + b }
    return x
  }
  @reduceCall = {
    x Integer = reduce(0, [0]) (a Integer, b Integer) { a + b + @pf() + f() + #f() }
    return x
  }
  @overArgs = {
    xs List of Integers = over([0]) (z Integer) { @pg(z) + g(z) + #g(z) }
    x Integer = reduce(0, xs) (a Integer, b Integer) { a + b }
    return x
  }
  // A branch and a loop.
  @branchRead = {
    if c > 0 {
      x Integer = @pc + c + k
      return x
    }
    return 0
  }
  @branchCall = {
    if c > 0 {
      x Integer = @pf() + f() + #f()
      return x
    }
    return 0
  }
  @loopArgs = {
    x *Integer = 0
    i *Integer = 0
    repeat while i < 1 {
      x <- x + @pg(0) + g(0) + #g(0)
      i <- i + 1
    }
    return x
  }
  @loopWrite! = {
    i *Integer = 0
    repeat while i < 2 {
      c <- c + 1
      i <- i + 1
    }
  }
  @branchWriter! = {
    if c > 0 { #w!() }
  }
  // Subscribing, from the actor's own handler and from a local function.
  @subscribe. = { sub c, (v Integer) { last <- v + k } }
  @subscribeLocal. = {
    h. = () { sub @pc, (v Integer) { last <- v + f() } }
    h.()
  }

  // A class, at depth 1 and 2.
  @C1 = *{
    @read = () -> @pc + c + k
    @call = { x Integer = @pf() + f() + #f(); return x }
    @args = { x Integer = @pg(0) + g(0) + #g(0); return x }
    @write! = { c <- c + 1 }
    @writer! = { #w!() }
    @lambda = {
      h = () -> @pc + c + k + @pf() + f() + #f()
      x Integer = h()
      return x
    }
  }
  @C2 = *{
    D = *{
      @read = () -> @pc + c + k
      @call = { x Integer = @pf() + f() + #f(); return x }
      @args = { x Integer = @pg(0) + g(0) + #g(0); return x }
    }
    @read = { d = D(); x Integer = d.read(); return x }
    @call = { d = D(); x Integer = d.call(); return x }
    @args = { d = D(); x Integer = d.args(); return x }
  }
  // A constructor block, and a param's default.
  @K = *{
    s Integer = @pc + c + k
    t Integer = @pf() + f() + #f()
    @s = () -> s
    @t = () -> t
  }
  @P = (v Integer = @pg(0) + g(0) + #g(0)) *{
    @v = () -> v
  }
  // A class block's nested \`new\`: its constructor block, methods and closures.
  @B = actor {
    new = () *{
      s Integer = @pc + c + k
      @s = () -> s
      @call = { x Integer = @pf() + f() + #f(); return x }
      @closure = {
        h = () -> @pg(0) + g(0) + #g(0)
        x Integer = h()
        return x
      }
    }
  }
`;

describe('the file actor contains it — a function-local function', () => {
  it('reads', async () => { await expectBehavior(fileScript, ...ask('localRead', 7)); });
  it('calls', async () => { await expectBehavior(fileScript, ...ask('localCall', 56)); });
  it('calls with args', async () => { await expectBehavior(fileScript, ...ask('localArgs', 448)); });
  it('writes', async () => {
    await expectBehavior(fileScript,
      { input: { id: '1', op: 'localWrite!', from: 'c' } },
      { output: { id: '1', re: ['#<:>'], ty: ['*'], to: 'c' } },
      ...ask('readC', 3, '2'),
    );
  });
  it('calls a writing function', async () => {
    await expectBehavior(fileScript,
      { input: { id: '1', op: 'localWriter!', from: 'c' } },
      { output: { id: '1', re: ['#<:>'], ty: ['*'], to: 'c' } },
      ...ask('readC', 1002, '2'),
    );
  });
  it('nested: reads', async () => { await expectBehavior(fileScript, ...ask('nestedRead', 7)); });
  it('nested: calls', async () => { await expectBehavior(fileScript, ...ask('nestedCall', 56)); });
  it('subscribes', async () => {
    await expectBehavior(fileScript,
      { input: { id: '1', op: 'subscribeLocal.', from: 'c' } },
      ...ask('readLast', 17, '2'),
    );
  });
});

describe('the file actor contains it — a lambda', () => {
  it('in `over`: reads', async () => { await expectBehavior(fileScript, ...ask('overRead', 7)); });
  it('in `reduce`: calls', async () => { await expectBehavior(fileScript, ...ask('reduceCall', 56)); });
  it('in `over`: calls with args', async () => { await expectBehavior(fileScript, ...ask('overArgs', 448)); });
});

describe('the file actor contains it — a branch and a loop', () => {
  it('a branch reads', async () => { await expectBehavior(fileScript, ...ask('branchRead', 7)); });
  it('a branch calls', async () => { await expectBehavior(fileScript, ...ask('branchCall', 56)); });
  it('a loop calls with args', async () => { await expectBehavior(fileScript, ...ask('loopArgs', 448)); });
  it('a loop writes', async () => {
    await expectBehavior(fileScript,
      { input: { id: '1', op: 'loopWrite!', from: 'c' } },
      { output: { id: '1', re: ['#<:>'], ty: ['*'], to: 'c' } },
      ...ask('readC', 4, '2'),
    );
  });
  it('a branch calls a writing function', async () => {
    await expectBehavior(fileScript,
      { input: { id: '1', op: 'branchWriter!', from: 'c' } },
      { output: { id: '1', re: ['#<:>'], ty: ['*'], to: 'c' } },
      ...ask('readC', 2002, '2'),
    );
  });
});

describe('the file actor contains it — a subscribe callback', () => {
  it('reads a constant', async () => {
    await expectBehavior(fileScript,
      { input: { id: '1', op: 'subscribe.', from: 'c' } },
      ...ask('readLast', 6, '2'),
    );
  });
});

describe('the file actor contains it — a class', () => {
  it('depth 1: reads', async () => { await expectBehavior(fileScript, ...build(':C1'), ...askAt(':C1:1', 'read', 7, '2')); });
  it('depth 1: calls', async () => { await expectBehavior(fileScript, ...build(':C1'), ...askAt(':C1:1', 'call', 56, '2')); });
  it('depth 1: calls with args', async () => { await expectBehavior(fileScript, ...build(':C1'), ...askAt(':C1:1', 'args', 448, '2')); });
  it('depth 1: a lambda in a method', async () => { await expectBehavior(fileScript, ...build(':C1'), ...askAt(':C1:1', 'lambda', 63, '2')); });
  it('depth 1: writes', async () => {
    await expectBehavior(fileScript, ...build(':C1'),
      { input: { id: '2', op: 'write!', to: ':C1:1', from: 'c' } },
      { output: { id: '2', re: ['#<:C1:1>'], ty: [':C1'], to: 'c', from: ':C1:1' } },
      ...ask('readC', 3, '3'),
    );
  });
  it('depth 1: calls a writing function', async () => {
    await expectBehavior(fileScript, ...build(':C1'),
      { input: { id: '2', op: 'writer!', to: ':C1:1', from: 'c' } },
      { output: { id: '2', re: ['#<:C1:1>'], ty: [':C1'], to: 'c', from: ':C1:1' } },
      ...ask('readC', 2002, '3'),
    );
  });
  it('depth 2: reads', async () => { await expectBehavior(fileScript, ...build(':C2'), ...askAt(':C2:1', 'read', 7, '2')); });
  it('depth 2: calls', async () => { await expectBehavior(fileScript, ...build(':C2'), ...askAt(':C2:1', 'call', 56, '2')); });
  it('depth 2: calls with args', async () => { await expectBehavior(fileScript, ...build(':C2'), ...askAt(':C2:1', 'args', 448, '2')); });
});

describe('the file actor contains it — a constructor block and a param default', () => {
  it('a constructor block reads', async () => { await expectBehavior(fileScript, ...build(':K'), ...askAt(':K:1', 's', 7, '2')); });
  it('a constructor block calls', async () => { await expectBehavior(fileScript, ...build(':K'), ...askAt(':K:1', 't', 56, '2')); });
  it('a param default calls with args', async () => { await expectBehavior(fileScript, ...build(':P'), ...askAt(':P:1', 'v', 448, '2')); });
});

describe('the file actor contains it — a class block\'s nested `new`', () => {
  it('its constructor block reads', async () => { await expectBehavior(fileScript, ...build(':B'), ...askAt(':B:1', 's', 7, '2')); });
  it('a method calls', async () => { await expectBehavior(fileScript, ...build(':B'), ...askAt(':B:1', 'call', 56, '2')); });
  it('a closure in a method calls with args', async () => { await expectBehavior(fileScript, ...build(':B'), ...askAt(':B:1', 'closure', 448, '2')); });
});

// ── A class contains it ──────────────────────────────────────────────────────

const classScript = `
  @C = *{
    @pc *Integer = 1
    c *Integer = 2
    k = 4
    @pf = () -> 8
    f = () -> 16
    #f = () -> 32
    @pg = (n Integer) -> n + 64
    g = (n Integer) -> n + 128
    #g = (n Integer) -> n + 256
    w! = { c <- c + 1000 }
    last *Integer = 0

    @readC = { return c }
    @readLast = { return last }

    @localRead = {
      h = () -> @pc + c + k
      x Integer = h()
      return x
    }
    @localCall = {
      #h = (z Integer) -> @pf() + f() + #f() + z
      x Integer = #h(0)
      return x
    }
    @nestedArgs = {
      h = () {
        i = () -> @pg(0) + g(0) + #g(0)
        return i()
      }
      x Integer = h()
      return x
    }
    @localWriter! = {
      h! = () { w!() }
      h!()
    }
    @overRead = {
      xs List of Integers = over([0]) (z Integer) { z + @pc + c + k }
      x Integer = reduce(0, xs) (a Integer, b Integer) { a + b }
      return x
    }
    @reduceCall = {
      x Integer = reduce(0, [0]) (a Integer, b Integer) { a + b + @pf() + f() + #f() }
      return x
    }
    @branchArgs = {
      if c > 0 {
        x Integer = @pg(0) + g(0) + #g(0)
        return x
      }
      return 0
    }
    @loopWrite! = {
      i *Integer = 0
      repeat while i < 2 {
        c <- c + 1
        i <- i + 1
      }
    }
    @subscribe. = { sub c, (v Integer) { last <- v + k } }
    @subscribePublic. = { sub @pc, (v Integer) { last <- v + f() } }

    // A class inside it, at depth 1 and 2; a constructor block; a param default.
    D = *{
      @read = () -> @pc + c + k
      @call = { x Integer = @pf() + f() + #f(); return x }
      @write! = { c <- c + 1 }
      E = *{
        @args = { x Integer = @pg(0) + g(0) + #g(0); return x }
      }
      @deep = { e = E(); x Integer = e.args(); return x }
    }
    K = *{
      s Integer = @pc + c + k
      @s = () -> s
    }
    P = (v Integer = @pg(0) + g(0) + #g(0)) *{
      @value = () -> v
    }
    @viaRead = { d = D(); x Integer = d.read(); return x }
    @viaCall = { d = D(); x Integer = d.call(); return x }
    @viaDeep = { d = D(); x Integer = d.deep(); return x }
    @viaWrite! = { d = D(); d.write!() }
    @viaCtor = { q = K(); x Integer = q.s(); return x }
    @viaDefault = { q = P(); x Integer = q.value(); return x }
  }
`;

const inC = (op, value) => [...build(':C'), ...askAt(':C:1', op, value, '2')];
const inCWrites = (op, readOp, value) => [
  ...build(':C'),
  { input: { id: '2', op, to: ':C:1', from: 'c' } },
  { output: expect.objectContaining({ id: '2', to: 'c', from: ':C:1' }) },
  ...askAt(':C:1', readOp, value, '3'),
];

describe('a class contains it — a function-local function, a lambda, a branch and a loop', () => {
  it('a local function reads', async () => { await expectBehavior(classScript, ...inC('localRead', 7)); });
  it('a private local function calls', async () => { await expectBehavior(classScript, ...inC('localCall', 56)); });
  it('nested local functions call with args', async () => { await expectBehavior(classScript, ...inC('nestedArgs', 448)); });
  it('a local function calls a writing function', async () => { await expectBehavior(classScript, ...inCWrites('localWriter!', 'readC', 1002)); });
  it('a lambda in `over` reads', async () => { await expectBehavior(classScript, ...inC('overRead', 7)); });
  it('a lambda in `reduce` calls', async () => { await expectBehavior(classScript, ...inC('reduceCall', 56)); });
  it('a branch calls with args', async () => { await expectBehavior(classScript, ...inC('branchArgs', 448)); });
  it('a loop writes', async () => { await expectBehavior(classScript, ...inCWrites('loopWrite!', 'readC', 4)); });
});

describe('a class contains it — a subscribe callback', () => {
  it('subscribes to a protected cell and reads a constant', async () => {
    await expectBehavior(classScript, ...build(':C'),
      { input: { id: '2', op: 'subscribe.', to: ':C:1', from: 'c' } },
      ...askAt(':C:1', 'readLast', 6, '3'),
    );
  });
  it('runs again on a write to the cell', async () => {
    await expectBehavior(classScript, ...build(':C'),
      { input: { id: '2', op: 'subscribe.', to: ':C:1', from: 'c' } },
      { input: { id: '3', op: 'loopWrite!', to: ':C:1', from: 'c' } },
      { output: expect.objectContaining({ id: '3', to: 'c', from: ':C:1' }) },
      ...askAt(':C:1', 'readLast', 8, '4'),
    );
  });
  it('subscribes to a public cell and calls a function', async () => {
    await expectBehavior(classScript, ...build(':C'),
      { input: { id: '2', op: 'subscribePublic.', to: ':C:1', from: 'c' } },
      ...askAt(':C:1', 'readLast', 17, '3'),
    );
  });
});

describe('a class contains it — classes inside it', () => {
  it('depth 1 reads', async () => { await expectBehavior(classScript, ...inC('viaRead', 7)); });
  it('depth 1 calls', async () => { await expectBehavior(classScript, ...inC('viaCall', 56)); });
  it('depth 2 calls with args', async () => { await expectBehavior(classScript, ...inC('viaDeep', 448)); });
  it('depth 1 writes', async () => { await expectBehavior(classScript, ...inCWrites('viaWrite!', 'readC', 3)); });
  it('a constructor block reads', async () => { await expectBehavior(classScript, ...inC('viaCtor', 7)); });
  it('a param default calls with args', async () => { await expectBehavior(classScript, ...inC('viaDefault', 448)); });
});

// ── A class block contains it ───────────────────────────────────────────────

const blockScript = `
  @B = actor {
    @pc *Integer = 1
    c *Integer = 2
    k = 4
    @pf = () -> 8
    f = () -> 16
    #f = () -> 32
    @pg = (n Integer) -> n + 64
    g = (n Integer) -> n + 128
    #g = (n Integer) -> n + 256
    w! = { c <- c + 1000 }

    @readC = { return c }

    new = () *{
      s Integer = @pc + c + k
      @s = () -> s
      @read = () -> @pc + c + k
      @call = { x Integer = @pf() + f() + #f(); return x }
      @closure = {
        h = () -> @pg(0) + g(0) + #g(0)
        x Integer = h()
        return x
      }
      @overRead = {
        xs List of Integers = over([0]) (z Integer) { z + @pc + c + k }
        x Integer = reduce(0, xs) (a Integer, b Integer) { a + b }
        return x
      }
      @branchCall = {
        if c > 0 {
          x Integer = @pf() + f() + #f()
          return x
        }
        return 0
      }
      @write! = { c <- c + 1 }
      @writer! = { w!() }
    }
  }
`;

const inB = (op, value) => [...build(':B'), ...askAt(':B:1', op, value, '2')];
const inBWrites = (op, value) => [
  ...build(':B'),
  { input: { id: '2', op, to: ':B:1', from: 'c' } },
  { output: expect.objectContaining({ id: '2', to: 'c', from: ':B:1' }) },
  { input: { id: '3', op: 'readC', to: ':B', from: 'c' } },
  { output: expect.objectContaining({ id: '3', re: [value] }) },
];

describe('a class block contains it — its nested `new`', () => {
  it('the constructor block reads', async () => { await expectBehavior(blockScript, ...inB('s', 7)); });
  it('a method reads', async () => { await expectBehavior(blockScript, ...inB('read', 7)); });
  it('a method calls', async () => { await expectBehavior(blockScript, ...inB('call', 56)); });
  it('a closure in a method calls with args', async () => { await expectBehavior(blockScript, ...inB('closure', 448)); });
  it('a lambda in `over` reads', async () => { await expectBehavior(blockScript, ...inB('overRead', 7)); });
  it('a branch calls', async () => { await expectBehavior(blockScript, ...inB('branchCall', 56)); });
  it('a method writes', async () => { await expectBehavior(blockScript, ...inBWrites('write!', 3)); });
  it('a method calls a writing function', async () => { await expectBehavior(blockScript, ...inBWrites('writer!', 1002)); });
});

// ── A function body contains it ─────────────────────────────────────────────

const bodyScript = `
  @localRead = {
    c *Integer = 2
    k = 4
    #t Integer = 1
    h = () -> c + k + #t
    x Integer = h()
    return x
  }
  @privateRead = {
    #t Integer = 3
    return #t
  }
  @localCall = {
    f = () -> 16
    #f = () -> 32
    h = () -> f() + #f()
    x Integer = h()
    return x
  }
  @lambdaPrivate = {
    #g = (n Integer) -> n + 1
    h = () -> #g(2)
    x Integer = h()
    return x
  }
  @lambdaPrivateConst = {
    #t Integer = 3
    h = () -> #t + 1
    x Integer = h()
    return x
  }
  @nestedArgs = {
    g = (n Integer) -> n + 128
    #g = (n Integer) -> n + 256
    h = () {
      i = () -> g(0) + #g(0)
      return i()
    }
    x Integer = h()
    return x
  }
  @overRead = {
    c *Integer = 2
    k = 4
    xs List of Integers = over([0]) (z Integer) { z + c + k }
    x Integer = reduce(0, xs) (a Integer, b Integer) { a + b }
    return x
  }
  @reduceCall = {
    f = () -> 16
    #f = () -> 32
    x Integer = reduce(0, [0]) (a Integer, b Integer) { a + b + f() + #f() }
    return x
  }
  @branchRead = {
    c *Integer = 2
    #t Integer = 1
    if c > 0 {
      x Integer = c + #t
      return x
    }
    return 0
  }
  @loopWrite = {
    c *Integer = 2
    i *Integer = 0
    repeat while i < 2 {
      c <- c + 1
      i <- i + 1
    }
    return c
  }
  @localWrite = {
    c *Integer = 2
    h! = () { c <- c + 1 }
    h!()
    return c
  }
`;

describe('a function body contains it', () => {
  it('a local function reads a cell, a constant and a private constant', async () => { await expectBehavior(bodyScript, ...ask('localRead', 7)); });
  it('a private constant reads in its own body', async () => { await expectBehavior(bodyScript, ...ask('privateRead', 3)); });
  it('a local function calls local functions', async () => { await expectBehavior(bodyScript, ...ask('localCall', 48)); });
  it('a local function calls a private local function', async () => { await expectBehavior(bodyScript, ...ask('lambdaPrivate', 3)); });
  it('a local function reads a private local constant', async () => { await expectBehavior(bodyScript, ...ask('lambdaPrivateConst', 4)); });
  it('nested local functions call with args', async () => { await expectBehavior(bodyScript, ...ask('nestedArgs', 384)); });
  it('a lambda in `over` reads', async () => { await expectBehavior(bodyScript, ...ask('overRead', 6)); });
  it('a lambda in `reduce` calls', async () => { await expectBehavior(bodyScript, ...ask('reduceCall', 48)); });
  it('a branch reads', async () => { await expectBehavior(bodyScript, ...ask('branchRead', 3)); });
  it('a loop writes', async () => { await expectBehavior(bodyScript, ...ask('loopWrite', 4)); });
  it('a local function writes', async () => { await expectBehavior(bodyScript, ...ask('localWrite', 3)); });
});

// Code that isn't lexically inside a scope doesn't reach its names, and says so; a
// name bound in a scope isn't bound again inside it. Each error names its boundary.
// The trailing constructor's cases, one per member kind, are in class_scope.test.js
// ('class scope — closure: the trailing constructor skips the class block'), the
// `.`/`::` sigil cases in the same file ('class scope — sigils after a dot'), and a
// block re-binding its own scope's local in if.test.js, repeat_while.test.js and
// function.test.js.
describe('boundaries', () => {
  it('a trailing constructor doesn\'t close over its class block', () => {
    expect(() => compileSource(`
      C = (seed Integer) *{
        @get = { return count }
      } ^ {
        count *Integer = 0
      }
    `)).toThrow("'count' is a member of the class 'C', and a trailing constructor doesn't close over its class block");
  });

  it('…nor does a subclass using its parent\'s class block', () => {
    expect(() => compileSource(`
      C = actor {
        count *Integer = 0
        new = (seed Integer) *{ @x = () -> 1 }
      }
      D = C ^ (n Integer) *{
        super(n)
        @get = { return count }
      }
    `)).toThrow("'count' is a member of the class 'C', and a subclass of 'C' doesn't close over its class block");
  });

  it('a subclass doesn\'t reach its parent\'s private names', () => {
    expect(() => compileSource(`
      A = *{
        #secret = () -> 5
        @x = () -> 1
      }
      B = A ^ *{
        @get = { return #secret() }
      }
    `)).toThrow("Subclass 'B' cannot access private function '#secret' from superclass");
  });

  it('a file\'s `use` name isn\'t bound again in the file', () => {
    expect(() => compileSource(`
      use Svc = "svc.bv" as { n () -> (Integer) }
      Svc = 3
    `)).toThrow("'Svc' is bound by 'use' in this file, so it can't be bound or assigned again here");
  });

  it('…nor inside it', () => {
    expect(() => compileSource(`
      use Svc = "svc.bv" as { n () -> (Integer) }
      @go = {
        Svc = 3
        return 1
      }
    `)).toThrow("Cannot re-bind 'Svc' inside a function — it's bound in the enclosing scope, so use a new name");
  });

  it('an inner `use` name isn\'t bound again in its scope', () => {
    expect(() => compileSource(`
      @go = {
        use DB = "/db" as { n () -> (Integer) }
        DB = 3
        return 1
      }
    `)).toThrow("'DB' is bound by 'use DB = \"/db\" as { n () -> (Integer) }' in this scope, so it can't be bound or assigned again here");
  });

  it('a handler doesn\'t bind a name of its file', () => {
    expect(() => compileSource(`
      k Integer = 5
      @h = {
        k = 2
        return k
      }
    `)).toThrow("Cannot re-bind 'k' inside a function — it's bound in the enclosing scope, so use a new name");
  });
});

// Where a name may be reused: a class's own name wins over an outer one, and a
// function's param may reuse an outer name, for that function's body.
describe('boundaries — a name reused where it may be', () => {
  const script = `
    n Integer = 1
    m *Integer = 10

    @C = (n Integer) *{
      @get = { return n }
    }

    bump = (m Integer) -> m + 1

    @viaParam = {
      x Integer = bump(5)
      return x
    }
  `;

  it('a class\'s own param wins over the file\'s name', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [[4], '$new'], ty: [['Integer']], to: ':C', from: 'c' } },
      { output: { id: '1', re: ['#<:C:1>'], ty: [':C'], to: 'c' } },
      { input: { id: '2', op: 'get', to: ':C:1', from: 'c' } },
      { output: { id: '2', re: [4], ty: ['Integer'], to: 'c', from: ':C:1' } },
    );
  });

  it('a function\'s param reuses the file\'s name', async () => {
    await expectBehavior(script, ...ask('viaParam', 6));
  });
});

// A class subscribes to a cell of an actor it's declared in, as it reads one: it
// sees the current value, and each later write. (Private cells outside a function
// body don't parse yet; they join when they do.)
describe('a class subscribes to the cells of the actors it\'s declared in', () => {
  const script = `
    c *Integer = 1
    @p *Integer = 10

    @Watcher = *{
      seenC *Integer = 0
      seenP *Integer = 0

      Inner = *{
        deep *Integer = 0
        mine *Integer = 0
        @watch. = { sub c, (v Integer) { deep <- v } }
        @watchMine. = { sub seenC, (v Integer) { mine <- v } }
        @deep = { return deep }
        @mine = { return mine }
      }
      inner = Inner()

      @watchC. = { sub c, (v Integer) { seenC <- v } }
      @watchP. = { sub @p, (v Integer) { seenP <- v } }
      @watchDeep. = { inner.watch()... }
      @watchMine. = { inner.watchMine()... }
      @mine = {
        x Integer = inner.mine()
        return x
      }
      @setSeen! = { seenC <- 5 }
      @seenC = { return seenC }
      @seenP = { return seenP }
      @deep = {
        x Integer = inner.deep()
        return x
      }
    }

    @bumpC! = { c <- c + 1 }
    @bumpP! = { @p <- @p + 1 }
  `;
  const watching = (watch, read, bump, before, after) => [
    { input: { id: '1', op: '$new', to: ':Watcher', from: 'c' } },
    { output: { id: '1', re: ['#<:Watcher:1>'], ty: [':Watcher'], to: 'c' } },
    { input: { id: '2', op: watch, to: ':Watcher:1', from: 'c' } },
    { input: { id: '3', op: read, to: ':Watcher:1', from: 'c' } },
    { output: { id: '3', re: [before], ty: ['Integer'], to: 'c', from: ':Watcher:1' } },
    { input: { id: '4', op: bump, from: 'c' } },
    { output: { id: '4', re: ['#<:>'], ty: ['*'], to: 'c' } },
    { input: { id: '5', op: read, to: ':Watcher:1', from: 'c' } },
    { output: { id: '5', re: [after], ty: ['Integer'], to: 'c', from: ':Watcher:1' } },
  ];

  it('depth 1, a protected cell', async () => {
    await expectBehavior(script, ...watching('watchC.', 'seenC', 'bumpC!', 1, 2));
  });

  it('depth 1, a public cell', async () => {
    await expectBehavior(script, ...watching('watchP.', 'seenP', 'bumpP!', 10, 11));
  });

  it('depth 2, a protected cell', async () => {
    await expectBehavior(script, ...watching('watchDeep.', 'deep', 'bumpC!', 1, 2));
  });

  it('depth 1, its enclosing class\'s protected cell', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':Watcher', from: 'c' } },
      { output: { id: '1', re: ['#<:Watcher:1>'], ty: [':Watcher'], to: 'c' } },
      { input: { id: '2', op: 'watchMine.', to: ':Watcher:1', from: 'c' } },
      { input: { id: '3', op: 'mine', to: ':Watcher:1', from: 'c' } },
      { output: { id: '3', re: [0], ty: ['Integer'], to: 'c', from: ':Watcher:1' } },
      { input: { id: '4', op: 'setSeen!', to: ':Watcher:1', from: 'c' } },
      { output: { id: '4', re: ['#<:Watcher:1>'], ty: [':Watcher'], to: 'c', from: ':Watcher:1' } },
      { input: { id: '5', op: 'mine', to: ':Watcher:1', from: 'c' } },
      { output: { id: '5', re: [5], ty: ['Integer'], to: 'c', from: ':Watcher:1' } },
    );
  });

  // From outside, a protected cell isn't there to subscribe to, and later writes
  // tell nobody.
  it('a protected cell refuses a subscribe from outside', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$sub', to: ':~c', from: 'c' } },
      { output: { id: '1', ex: { $sub: 'unhandled' }, to: 'c' } },
      { input: { id: '2', op: 'bumpC!', from: 'c' } },
      { output: { id: '2', re: ['#<:>'], ty: ['*'], to: 'c' } },
      { input: { id: '3', op: '$sub', to: ':p', from: 'c' } },
      { output: { id: '3', re: [10], ty: ['Integer'], to: 'c' } },
    );
  });
});
