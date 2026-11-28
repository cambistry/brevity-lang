import { expectBehavior } from '../helpers.js';

describe('test.get — read state vars', () => {
  const script = `
    x *Integer = 42
    name *Text = "hello"
    flag *Boolean = true
  `;

  it('reads integer state var with type', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { get: '~x' }, from: 't' } },
      { output: { id: '1', 'ty': ['Integer'], re: [42], to: 't' } },
    );
  });

  it('reads text state var with type', async () => {
    await expectBehavior(script,
      { input: { id: '2', test: { get: '~name' }, from: 't' } },
      { output: { id: '2', 'ty': ['Text'], re: ['hello'], to: 't' } },
    );
  });

  it('reads boolean state var with type', async () => {
    await expectBehavior(script,
      { input: { id: '3', test: { get: '~flag' }, from: 't' } },
      { output: { id: '3', 'ty': ['Boolean'], re: [true], to: 't' } },
    );
  });
});

describe('test.get — after mutation', () => {
  const script = `
    x *Integer = 0
    @inc! = { x <- x + 1; return :x }
  `;

  it('reads initial value', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { get: '~x' }, from: 't' } },
      { output: { id: '1', 'ty': ['Integer'], re: [0], to: 't' } },
    );
  });

  it('reads mutated value after increments', async () => {
    await expectBehavior(script,
      { input: { id: '2', op: 'inc!', from: 'c' } },
      { input: { id: '3', op: 'inc!', from: 'c' } },
      { input: { id: '4', test: { get: '~x' }, from: 't' } },
      { output: expect.objectContaining({ id: '2', re: [{ x: 1 }] }) },
      { output: expect.objectContaining({ id: '3', re: [{ x: 2 }] }) },
      { output: { id: '4', 'ty': ['Integer'], re: [2], to: 't' } },
    );
  });
});

// A cell is read by its wire label: protected `a` is `.a`, public `@a` is `@a`.
describe('test.get — by wire label', () => {
  const script = `
    a *Integer = 1
    @a *Integer = 2
  `;

  it('reads each cell by its own label', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { get: '~a' }, from: 't' } },
      { output: { id: '1', 'ty': ['Integer'], re: [1], to: 't' } },
      { input: { id: '2', test: { get: 'a' }, from: 't' } },
      { output: { id: '2', 'ty': ['Integer'], re: [2], to: 't' } },
    );
  });

  it('a source spelling is not a wire name', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { get: '@a' }, from: 't' } },
      { output: { id: '1', re: [null], to: 't' } },
    );
  });
});

// A function reads as what it is as a value, its address relative to the actor
// (`#<:~f>`, as `&f` replies), typed with its signature, the service document's form.
describe('test.get — a function', () => {
  const script = `
    n *Integer = 0
    f = (k Integer) -> k * 2
    bump! = (by Integer) { n <- n + by }
    @ref = () -> &f
  `;

  it('reads its address, typed with its signature', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { get: '~f' }, from: 't' } },
      { output: { id: '1', re: ['#<:~f>'], ty: [['%f', { args: ['Integer'], re: ['Integer'], writes: false }]], to: 't' } },
    );
  });

  it('a function that writes', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { get: '~bump!' }, from: 't' } },
      { output: { id: '1', re: ['#<:~bump!>'], ty: [['%f', { args: ['Integer'], re: [], writes: true }]], to: 't' } },
    );
  });

  it('is the address replying &f gives', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'ref', from: 't' } },
      { output: { id: '1', re: ['#<:~f>'], ty: [['%f', { args: ['Integer'], re: ['Integer'], writes: false }]], to: 't' } },
    );
  });
});

// A cell reads as a handler replying it does: the same value, in its wire form.
describe('test.get — a cell reads as a reply of it', () => {
  const script = `
    type Point(Integer, Integer)
    C = *{ @a = () -> 1 }
    l *List[Integer] = [1, 2]
    p *Point = Point(3, 4)
    o *Object = Object(1, k: 2)
    c = *C()
    @readC = { return c }
    @readL = { return l }
    @readP = { return p }
    @readO = { return o }
  `;

  it('a List', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { get: '~l' }, from: 't' } },
      { output: { id: '1', re: [[1, 2]], ty: ['List[Integer]'], to: 't' } },
      { input: { id: '2', op: 'readL', from: 't' } },
      { output: { id: '2', re: [[1, 2]], ty: ['List[Integer]'], to: 't' } },
    );
  });

  it('a user type', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { get: '~p' }, from: 't' } },
      { output: { id: '1', re: [[3, 4]], ty: [':Point'], to: 't' } },
      { input: { id: '2', op: 'readP', from: 't' } },
      { output: { id: '2', re: [[3, 4]], ty: [':Point'], to: 't' } },
    );
  });

  it('an actor: its address and its class', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { get: '~c' }, from: 't' } },
      { output: { id: '1', re: ['#<:~C:1>'], ty: [':~C'], to: 't' } },
      { input: { id: '2', op: 'readC', from: 't' } },
      { output: { id: '2', re: ['#<:~C:1>'], ty: [':~C'], to: 't' } },
    );
  });

  it('an Object', async () => {
    await expectBehavior(script,
      { input: { id: '1', test: { get: '~o' }, from: 't' } },
      { output: { id: '1', re: [[1, { k: 2 }]], ty: ['Object'], to: 't' } },
      { input: { id: '2', op: 'readO', from: 't' } },
      { output: { id: '2', re: [[1, { k: 2 }]], ty: ['Object'], to: 't' } },
    );
  });
});
