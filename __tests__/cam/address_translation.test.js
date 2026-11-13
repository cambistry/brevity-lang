import { expectBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Address translation, one hop at a time. An address whose head token is `.` is
// relative to its sender; each parent it passes rewrites `. x` from child `c` to
// `. c x`. Any other address is global and passes through unchanged, even one
// whose head starts with a dot or `@` (`.hidden.file`, `@foreign`): only the whole
// token `.` is self. The global boundary (the node that replaces `.` with its own
// address) is the host's: see browser/address_boundary.browser.test.js.
// See notes/at-sigil-internal-and-quoted-names-2026-11-12.md.
//
// Hops here: an instance `Box 1` to the file actor, and a singleton `tally`
// inside it to `Box 1` to the file actor. The test sees what the file actor
// sends out. A call to a dependency goes out as the file actor's own, to a
// global `to`, with the caller's addresses translated on the way.
// ═══════════════════════════════════════════════════════════════════════════════

const script = `
  *
    "svc.bv": Svc {
      take (r: Text) -> ()
    }
  *
  @Box = *{
    @tally = **{
      @me = { return self }
      @refs = { return near: "#<. x>", hidden: "#<.hidden.file x>", foreign: "#<@foreign y>", global: "#<main x>" }
      @tell = { Svc.take(r: "#<. x>") }
    }

    @me = { return self }
    @refs = { return near: "#<. x>", hidden: "#<.hidden.file x>", foreign: "#<@foreign y>", global: "#<main x>" }
  }
`;

describe('child to parent', () => {
  it('re, ty and from of a self-return gain the child', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '$new'], to: '. Box', from: 'c' } },
      { output: { id: '1', re: '#<. Box 1>', ty: '. Box', to: 'c' } },
      { input: { id: '2', op: 'me', to: '. Box 1', from: 'c' } },
      { output: { id: '2', re: '#<. Box 1>', ty: '. Box', to: 'c', from: '. Box 1' } },
    );
  });

  it('a relative #<…> in the payload gains the child; a global one passes through', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '$new'], to: '. Box', from: 'c' } },
      { output: { id: '1', re: '#<. Box 1>', ty: '. Box', to: 'c' } },
      { input: { id: '2', op: 'refs', to: '. Box 1', from: 'c' } },
      { output: {
        id: '2',
        re: { near: '#<. Box 1 x>', hidden: '#<.hidden.file x>', foreign: '#<@foreign y>', global: '#<main x>' },
        ty: { near: 'Text', hidden: 'Text', foreign: 'Text', global: 'Text' },
        to: 'c',
        from: '. Box 1',
      } },
    );
  });
});

describe('grandchild to child to parent', () => {
  it('re, ty and from of a self-return gain each hop', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '$new'], to: '. Box', from: 'c' } },
      { output: { id: '1', re: '#<. Box 1>', ty: '. Box', to: 'c' } },
      { input: { id: '2', op: 'me', to: '. Box 1 tally', from: 'c' } },
      { output: { id: '2', re: '#<. Box 1 tally>', ty: '. Box 1 tally', to: 'c', from: '. Box 1 tally' } },
    );
  });

  it('a relative #<…> in the payload gains each hop; a global one passes through', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '$new'], to: '. Box', from: 'c' } },
      { output: { id: '1', re: '#<. Box 1>', ty: '. Box', to: 'c' } },
      { input: { id: '2', op: 'refs', to: '. Box 1 tally', from: 'c' } },
      { output: {
        id: '2',
        re: { near: '#<. Box 1 tally x>', hidden: '#<.hidden.file x>', foreign: '#<@foreign y>', global: '#<main x>' },
        ty: { near: 'Text', hidden: 'Text', foreign: 'Text', global: 'Text' },
        to: 'c',
        from: '. Box 1 tally',
      } },
    );
  });

  it('a call to a dependency: the global to passes through, a payload address gains each hop', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: [{}, '$new'], to: '. Box', from: 'c' } },
      { output: { id: '1', re: '#<. Box 1>', ty: '. Box', to: 'c' } },
      { input: { id: '2', op: 'tell', to: '. Box 1 tally', from: 'c' } },
      { output: expect.objectContaining({ op: [{ r: '#<. Box 1 tally x>' }, 'take'], ty: [{ r: 'Text' }], to: 'Svc' }) },
    );
  });
});
