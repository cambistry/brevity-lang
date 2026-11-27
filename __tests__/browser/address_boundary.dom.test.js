import { compileActor } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// The global boundary: the node that replaces the self token `.` with its own
// address. Here it's the browser harness, an actor's host at `selfAddr`
// (rewriteLocalAddresses in src/codegen/browser/brevity.js). An address whose
// head token isn't exactly `.` is global and passes through, even one that
// starts with a dot or `@` (`.hidden.file`, `@foreign`).
//
// Each message crosses every hop: `tally` inside `Box 1` inside the file actor,
// then the boundary. The hops below the boundary are in
// cam/address_translation.test.js. Every address is a typed value: one the actor
// makes (`self`, `&x`), or a global one the harness sends in, typed as a function.
// A Text is text: its `#<` goes out escaped, and the boundary leaves it.
// See notes/at-sigil-internal-and-quoted-names-2026-11-12.md and
// notes/opre-text-and-addresses-2026-11-27.md.
// ═══════════════════════════════════════════════════════════════════════════════

const source = `
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
  }
`;

const fn = ['%f', { re: ['Integer'], writes: false }];

async function boundary() {
  const actor = await (await compileActor(source, { compileOptions: { selfAddr: 'app.bv' } })).spawn();
  await actor.sendAsync({ id: '1', op: '$new', to: ':Box', from: 'Tester' });
  return actor;
}

describe('global boundary', () => {
  // A singleton is a declared actor: its tag is `*`, which has no self token.
  it('re, ty and from of a reply resolve the self token', async () => {
    const actor = await boundary();
    expect(actor.posts[0]).toEqual({ id: '1', re: ['#<app.bv:Box:1>'], ty: ['app.bv:Box'], to: 'Tester', from: 'app.bv' });
    await actor.sendAsync({ id: '2', op: 'me', to: ':Box:1:tally', from: 'Tester' });
    expect(actor.posts[1]).toEqual({ id: '2', re: ['#<app.bv:Box:1:tally>'], ty: ['*'], to: 'Tester', from: 'app.bv:Box:1:tally' });
  });

  it('a relative address the actor makes resolves', async () => {
    const actor = await boundary();
    await actor.sendAsync({ id: '2', op: 'refs', to: ':Box:1:tally', from: 'Tester' });
    expect(actor.posts[1]).toEqual({ id: '2', re: [{ near: '#<app.bv:Box:1:tally:~x>' }], ty: [{ near: fn }], to: 'Tester', from: 'app.bv:Box:1:tally' });
  });

  it('a global address passes through, whatever its head', async () => {
    const actor = await boundary();
    await actor.sendAsync({ id: '2', op: [['#<.hidden.file:x>'], 'echo'], ty: [[fn]], to: ':Box:1:tally', from: 'Tester' });
    expect(actor.posts[1]).toEqual({ id: '2', re: ['#<.hidden.file:x>'], ty: [fn], to: 'Tester', from: 'app.bv:Box:1:tally' });
    await actor.sendAsync({ id: '3', op: [['#<@foreign:y>'], 'echo'], ty: [[fn]], to: ':Box:1:tally', from: 'Tester' });
    expect(actor.posts[2]).toEqual({ id: '3', re: ['#<@foreign:y>'], ty: [fn], to: 'Tester', from: 'app.bv:Box:1:tally' });
  });

  it('a Text holding #< goes out escaped, and the boundary leaves it', async () => {
    const actor = await boundary();
    await actor.sendAsync({ id: '2', op: 'text', to: ':Box:1:tally', from: 'Tester' });
    expect(actor.posts[1]).toEqual({ id: '2', re: [{ lit: '\\#<:x>' }], ty: [{ lit: 'Text' }], to: 'Tester', from: 'app.bv:Box:1:tally' });
  });

  it('a global to passes through, and the payload address and from resolve', async () => {
    const actor = await boundary();
    await actor.sendAsync({ id: '2', op: 'tell', to: ':Box:1:tally', from: 'Tester' });
    expect(actor.posts[1]).toEqual(expect.objectContaining({
      op: [[{ r: '#<app.bv:Box:1:tally:~x>' }], 'take'],
      to: 'svc.bv',
    }));
  });
});
