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
// cam/address_translation.test.js.
// See notes/at-sigil-internal-and-quoted-names-2026-11-12.md.
// ═══════════════════════════════════════════════════════════════════════════════

const source = `
  *
    "svc.bv": Svc {
      take (r: Text) -> ()
    }
  *
  @Box = *{
    @tally = **{
      @me = { return self }
      @refs = { return near: "#<. x>", hidden: "#<.hidden.file x>", foreign: "#<@foreign y>" }
      @tell = { Svc.take(r: "#<. x>") }
    }
  }
`;

async function boundary() {
  const actor = await (await compileActor(source, { compileOptions: { selfAddr: 'app.bv' } })).spawn();
  await actor.sendAsync({ id: '1', op: [{}, '#new'], to: '. Box', from: 'Tester' });
  return actor;
}

describe('global boundary', () => {
  it('re, ty and from of a reply resolve the self token', async () => {
    const actor = await boundary();
    expect(actor.posts[0]).toEqual({ id: '1', re: '#<app.bv Box 1>', ty: 'app.bv Box', to: 'Tester', from: 'app.bv' });
    await actor.sendAsync({ id: '2', op: '@me', to: '. Box 1 tally', from: 'Tester' });
    expect(actor.posts[1]).toEqual({ id: '2', re: '#<app.bv Box 1 tally>', ty: 'app.bv Box 1 tally', to: 'Tester', from: 'app.bv Box 1 tally' });
  });

  it('a relative #<…> in the payload resolves; a global one passes through', async () => {
    const actor = await boundary();
    await actor.sendAsync({ id: '2', op: '@refs', to: '. Box 1 tally', from: 'Tester' });
    expect(actor.posts[1]).toEqual(expect.objectContaining({
      id: '2',
      re: { near: '#<app.bv Box 1 tally x>', hidden: '#<.hidden.file x>', foreign: '#<@foreign y>' },
    }));
  });

  it('a global to passes through, and the payload address and from resolve', async () => {
    const actor = await boundary();
    await actor.sendAsync({ id: '2', op: '@tell', to: '. Box 1 tally', from: 'Tester' });
    expect(actor.posts[1]).toEqual(expect.objectContaining({
      op: [{ r: '#<app.bv Box 1 tally x>' }, '@take'],
      to: 'Svc',
    }));
  });
});
