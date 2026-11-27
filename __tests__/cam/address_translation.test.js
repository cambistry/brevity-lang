import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Address translation, one hop at a time. An address that starts with `:` is
// relative to its sender; each parent it passes rewrites `:x` from child `c` to
// `:c:x`. Any other address is global and passes through unchanged, even one
// whose head starts with a dot or `@` (`.hidden.file`, `@foreign`): only a
// leading `:` is self. The global boundary (the node that replaces the leading
// `:` with its own address) is the host's: see browser/address_boundary.dom.test.js.
// See notes/opre-colon-separator-2026-11-14.md.
//
// Every address here is a typed value (notes/opre-text-and-addresses-2026-11-27.md):
// one the actor makes (`self`, `&x`), or a global one the harness sends in as an
// arg typed as a function, which comes back out. A Text is text: a `#<` in it goes
// out escaped (`\#<`), and no hop rewrites it.
//
// Hops here: an instance `Box:1` to the file actor, and a singleton `tally`
// inside it to `Box:1` to the file actor. The test sees what the file actor
// sends out. A call to a dependency goes out as the file actor's own, to a
// global `to`, with the caller's addresses translated on the way.
// ═══════════════════════════════════════════════════════════════════════════════

const fn = ['%f', { re: ['Integer'], writes: false }];

const script = `
  use Svc = "svc.bv" as {
    take (r: () -> (Integer)) -> ()
  }
  @Box = *{
    @tally = actor {
      x = () -> 1
      @me = { return self }
      @refs = { return near: &x }
      @echo = (a () -> (Integer)) -> a
      @text = { return lit: "#<:x>" }
      @tell = { Svc.take(r: &x) }
    }

    x = () -> 1
    @me = { return self }
    @refs = { return near: &x }
    @echo = (a () -> (Integer)) -> a
    @text = { return lit: "#<:x>" }
  }
`;

describe('child to parent', () => {
  it('re, ty and from of a self-return gain the child', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':Box', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
      { input: { id: '2', op: 'me', to: ':Box:1', from: 'c' } },
      { output: { id: '2', re: ['#<:Box:1>'], ty: [':Box'], to: 'c', from: ':Box:1' } },
    );
  });

  it("a relative address the child makes gains the child", async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':Box', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
      { input: { id: '2', op: 'refs', to: ':Box:1', from: 'c' } },
      { output: { id: '2', re: [{ near: '#<:Box:1:~x>' }], ty: [{ near: fn }], to: 'c', from: ':Box:1' } },
    );
  });

  it('a global address passes through, whatever its head and whatever follows it', async () => {
    const echo = (id, addr) => [
      { input: { id, op: [[addr], 'echo'], ty: [[fn]], to: ':Box:1', from: 'c' } },
      { output: { id, re: [addr], ty: [fn], to: 'c', from: ':Box:1' } },
    ];
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':Box', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
      ...echo('2', '#<main:x>'),
      ...echo('3', '#<.hidden.file:x>'),
      ...echo('4', '#<@foreign:y>'),
      ...echo('5', '#<#tag:x>'),
      ...echo('6', '#<~x:y>'),
      ...echo('7', '#<$x:y>'),
      ...echo('8', '#<@:xyz>'),
      ...echo('9', '#<main:@foreign:~x:#tag:$x>'),
      ...echo('10', '#<has space:x>'),
    );
  });

  it('a Text holding #< goes out escaped, and the hop leaves it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':Box', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
      { input: { id: '2', op: 'text', to: ':Box:1', from: 'c' } },
      { output: { id: '2', re: [{ lit: '\\#<:x>' }], ty: [{ lit: 'Text' }], to: 'c', from: ':Box:1' } },
    );
  });
});

describe('grandchild to child to parent', () => {
  // A singleton is a declared actor, so its tag is `*` and doesn't gain a hop.
  it('re and from of a self-return gain each hop', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':Box', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
      { input: { id: '2', op: 'me', to: ':Box:1:tally', from: 'c' } },
      { output: { id: '2', re: ['#<:Box:1:tally>'], ty: ['*'], to: 'c', from: ':Box:1:tally' } },
    );
  });

  it('a relative address the grandchild makes gains each hop', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':Box', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
      { input: { id: '2', op: 'refs', to: ':Box:1:tally', from: 'c' } },
      { output: { id: '2', re: [{ near: '#<:Box:1:tally:~x>' }], ty: [{ near: fn }], to: 'c', from: ':Box:1:tally' } },
    );
  });

  it('a global address passes through every hop', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':Box', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
      { input: { id: '2', op: [['#<main:@foreign:~x:#tag:$x>'], 'echo'], ty: [[fn]], to: ':Box:1:tally', from: 'c' } },
      { output: { id: '2', re: ['#<main:@foreign:~x:#tag:$x>'], ty: [fn], to: 'c', from: ':Box:1:tally' } },
    );
  });

  it('a Text holding #< goes out escaped, and no hop rewrites it', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':Box', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
      { input: { id: '2', op: 'text', to: ':Box:1:tally', from: 'c' } },
      { output: { id: '2', re: [{ lit: '\\#<:x>' }], ty: [{ lit: 'Text' }], to: 'c', from: ':Box:1:tally' } },
    );
  });

  it('a call to a dependency: the global to passes through, a payload address gains each hop', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '$new', to: ':Box', from: 'c' } },
      { output: { id: '1', re: ['#<:Box:1>'], ty: [':Box'], to: 'c' } },
      { input: { id: '2', op: 'tell', to: ':Box:1:tally', from: 'c' } },
      { output: expect.objectContaining({ op: [[{ r: '#<:Box:1:tally:~x>' }], 'take'], ty: [[{ r: fn }]], to: 'svc.bv' }) },
    );
  });
});
