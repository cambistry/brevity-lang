import { compileActor, expectActorBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// List of Self! — peers hold an actor-ref to a list of their own kind.
//
// Each Peer is constructed with `P: peers`, where `peers` is the outer
// list-actor. P is a live ref (shared identity, snapshot on read), so when
// Aaron's @names runs `over(P) (p) { p.name }`, P reads the current list
// contents — including refs back to Aaron, Betsy, and Charlie themselves.
//
// The entry that is Aaron's own ref routes back to Aaron through the parent
// dispatcher (parent owns address resolution; child does not know its own
// address). No address-equality check needed at the call site.
//
// Coverage:
//   - `List of Self!` as a constructor param type
//   - `peers <- [Peer(...), ...]` — typed list-actor write of actor refs
//   - `over(<remote-list-ref>)` — fetch contents from list-actor, iterate locally
//   - Auto-getter on constructor param (`p.name` → @name reply)
//   - Self-routing via parent (one of the iterated peers is the caller itself)
// ═══════════════════════════════════════════════════════════════════════════════

const SCRIPT = `
Peer = *(:name Text, :P List of Self!) {
  peers List = []
  P.subscribe (p List) { peers <- p }
  @names = { over(peers) (p) { p.name() } }
}

peers List of Peer! = []
@peers = { peers }

@run = {
  peers <- [Peer(name: "Aaron", P: peers), Peer(name: "Betsy", P: peers), Peer(name: "Charlie", P: peers)]
  p Peer = peers.first
  :ns List = p.names()
  -> names: ns
}
`;

describe('List of Self! — peers iterate a shared list-actor of their own kind', () => {
  it('peers.first.names returns all three names, including the caller via self-routing', async () => {
    const compiled = await compileActor(SCRIPT);
    const actor = await compiled.spawn();
    await expectActorBehavior(actor,
      { input: { id: '1', op: '@run', from: 'caller' } },
      { output: expect.objectContaining({
        id: '1',
        re: expect.objectContaining({
          names: ['Aaron', 'Betsy', 'Charlie'],
        }),
        to: 'caller',
      }) },
    );
  });
});
