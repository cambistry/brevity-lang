import { compileActor, expectActorBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Self in type position — peer-shaped @-cells.
//
// `@peer *Self | null = null` declares a public ref cell whose value is
// either an instance of the enclosing class or null. Two instances peered
// to each other can gossip without either side importing an interface —
// the class definition is the contract.
//
// Coverage:
//   - Self in type position (the @-cell field)
//   - Auto-setter for Self-typed @-cells (`a.peer <- b` from outside)
//   - Method dispatch on a ref-cell-held actor reference (`peer.gossip(t)`)
//   - Gossip's intentional non-propagation: a 2-peer ring stays consistent
//     because every add hits exactly two news lists.
// ═══════════════════════════════════════════════════════════════════════════════

const SCRIPT = `
Chatter = * {
  news *List = []
  @news = { news }
  @peer *Self | null = null
  @add = (t Text) {
    news.append!(t)
    if (@peer) {
      @peer.gossip(t)
    }
  }
  @gossip = (t Text) { news.append!(t) }
}

@run = {
  a Chatter = Chatter()
  b Chatter = Chatter()
  a.peer <- b
  b.peer <- a
  a.add("breaking news")
  :a1 List = a.news()
  :b1 List = b.news()
  b.add("this just in")
  :a2 List = a.news()
  :b2 List = b.news()
  -> a1: a1, b1: b1, a2: a2, b2: b2
}
`;

describe('Self — peer-shaped @-cell, two-actor gossip ring', () => {
  it('after wiring a↔b and a.add(X), both news lists hold [X]', async () => {
    const compiled = await compileActor(SCRIPT);
    const actor = await compiled.spawn();
    await expectActorBehavior(actor,
      { input: { id: '1', op: '@run', from: 'caller' } },
      { output: expect.objectContaining({
        id: '1',
        re: expect.objectContaining({
          a1: ['breaking news'],
          b1: ['breaking news'],
        }),
        to: 'caller',
      }) },
    );
  });

  it('after a second add from b, both news lists agree on [X, Y]', async () => {
    const compiled = await compileActor(SCRIPT);
    const actor = await compiled.spawn();
    await expectActorBehavior(actor,
      { input: { id: '1', op: '@run', from: 'caller' } },
      { output: expect.objectContaining({
        id: '1',
        re: expect.objectContaining({
          a2: ['breaking news', 'this just in'],
          b2: ['breaking news', 'this just in'],
        }),
        to: 'caller',
      }) },
    );
  });
});
