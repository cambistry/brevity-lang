import { expectBehavior } from '../helpers.js';

// A class block that extends another sends it `$extend` as it's built, and reads and
// writes the cells it inherits there, as `$get` / `$set` of `~name`: one cell, shared.
// A cell it redeclares is its own. An actor of the extending class reaches an
// inherited cell through its own class's block, which forwards it. The parent block
// accepts a `~` op only from a recorded extender, and records only a table of names
// it declares. See notes/opre-extend-and-as-2026-11-20.md ("$extend", "In Brevity").

const blocks = `
  @A = *{} ^ {
    count *Integer = 10
    limit *Integer = 1
    @bump! = { count <- count + 1 }
    @read = () -> count
    @lim = () -> limit
  }
  @B = @A ^ {
    limit *Integer = 50
    @inc! = { count <- count + 5 }
    @mine = () -> count
  }
  @C = @B ^ {
    @inc! = { count <- count + 100 }
  }
  @V = @A ^ *{}
  @W = @V ^ *{} ^ {
    @inc! = { count <- count + 1000 }
  }
  @K = @A ^ *{
    @seen = { x Integer = class::count; return x }
    @poke! = { class::count <- class::count + 7 }
  } ^ {
    @k = () -> 1
  }
  @I = *{
    step = () -> 1
  } ^ {
    c *Integer = 0
  }
  @shared! = { @B.inc!(); @B.bump!(); x Integer = @A.read(); return x }
  @mine = { x Integer = @B.mine(); return x }
  @limits = { a Integer = @A.lim(); b Integer = @B.lim(); return a * 100 + b }
  @twoLevels! = { @C.inc!(); x Integer = @A.read(); return x }
  @emptyMiddle! = { @W.inc!(); x Integer = @A.read(); return x }
  @instance! = { k = @K(); k.poke!(); x Integer = k.seen(); y Integer = @A.read(); return x * 100 + y }
`;

describe('$extend — inherited block cells', () => {
  it("a cell the block doesn't redeclare is the parent's: read and written through it", async () => {
    await expectBehavior(blocks,
      { input: { id: '1', op: 'shared!', from: 'c' } },
      { output: { id: '1', re: [16], ty: ['Integer'], to: 'c' } },
      { input: { id: '2', op: 'mine', from: 'c' } },
      { output: { id: '2', re: [16], ty: ['Integer'], to: 'c' } },
    );
  });

  it('a cell it redeclares is its own; the parent keeps its own', async () => {
    await expectBehavior(blocks,
      { input: { id: '1', op: 'limits', from: 'c' } },
      { output: { id: '1', re: [150], ty: ['Integer'], to: 'c' } },
    );
  });

  it('an actor of the extending class reaches the cell through its own class block', async () => {
    await expectBehavior(blocks,
      { input: { id: '1', op: 'instance!', from: 'c' } },
      { output: { id: '1', re: [1717], ty: ['Integer'], to: 'c' } },
    );
  });

  it('two levels: the middle block forwards to its own', async () => {
    await expectBehavior(blocks,
      { input: { id: '1', op: 'twoLevels!', from: 'c' } },
      { output: { id: '1', re: [110], ty: ['Integer'], to: 'c' } },
    );
  });

  it('an empty block between two others is transparent', async () => {
    await expectBehavior(blocks,
      { input: { id: '1', op: 'emptyMiddle!', from: 'c' } },
      { output: { id: '1', re: [1010], ty: ['Integer'], to: 'c' } },
    );
  });
});

describe('$extend — the record', () => {
  it('a ~ op from an actor that never extended fails; once it extends, it is answered', async () => {
    await expectBehavior(blocks,
      { input: { id: '1', op: '$get', to: ':A:~count', from: 'c' } },
      { output: { id: '1', ex: { $get: 'unhandled' }, to: 'c', from: ':A' } },
      { input: { id: '2', op: [[{ block: ['~count'] }], '$extend'], to: ':A', from: 'c' } },
      { output: { id: '2', re: [], to: 'c', from: ':A' } },
      { input: { id: '3', op: '$get', to: ':A:~count', from: 'c' } },
      { output: { id: '3', re: [10], to: 'c', from: ':A' } },
    );
  });

  it("a table naming a name the block doesn't declare fails, and records nothing", async () => {
    await expectBehavior(blocks,
      { input: { id: '1', op: [[{ block: ['~count', '~nope'] }], '$extend'], to: ':A', from: 'c' } },
      { output: { id: '1', ex: { $extend: 'unknown_name' }, to: 'c', from: ':A' } },
      { input: { id: '2', op: '$get', to: ':A:~count', from: 'c' } },
      { output: { id: '2', ex: { $get: 'unhandled' }, to: 'c', from: ':A' } },
    );
  });

  it("an instance section naming a name the class's instances don't declare fails", async () => {
    await expectBehavior(blocks,
      { input: { id: '1', op: [[{ block: [], instance: ['~nope'] }], '$extend'], to: ':I', from: 'c' } },
      { output: { id: '1', ex: { $extend: 'unknown_name' }, to: 'c', from: ':I' } },
      { input: { id: '2', op: [[{ block: ['~c'], instance: ['~step'] }], '$extend'], to: ':I', from: 'c' } },
      { output: { id: '2', re: [], to: 'c', from: ':I' } },
    );
  });

  it("the extending block's own cells answer no outsider either", async () => {
    await expectBehavior(blocks,
      { input: { id: '1', op: '$get', to: ':B:~limit', from: 'c' } },
      { output: { id: '1', ex: { $get: 'unhandled' }, to: 'c', from: ':B' } },
    );
  });
});
