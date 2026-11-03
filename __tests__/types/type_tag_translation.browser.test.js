import { compileActor } from '../helpers.js';

// Perspective translation of `ty` tags.
//
// `ty` is a translated field, like `to` and `from`, so its tags carry no
// `#<…>`. A tag that starts with a delimiter is local (`::Point`, `@Box`); a
// parent puts its own address in front as the value rises. A tag that starts
// with a word character is global (`Integer`, `main ::Point`) and is left
// alone. This is the Opre convention for addresses too.
//
// This exercises the browser harness's parent-layer translation
// (rewriteLocalAddresses in src/codegen/browser/brevity.js). rust/erlang emit
// the same local form but defer translation to their external CAM host.
// See notes/session-2026-11-03-ty-without-brackets.md.

async function forwardingActor(selfAddr) {
  const compiled = await compileActor(`
    ::Point (x Integer, y Integer)
    *
      "Sink": Sink {
        take (p: Point) -> ()
      }
    *
    @fwd
      =
      p: Point
      =
      Sink.take(:p)
      return ()
  `, { compileOptions: { selfAddr } });
  return compiled.spawn();
}

describe('type authority tag — perspective translation (browser)', () => {
  it('a local ::Name tag gets the parent address prepended on the way out', async () => {
    const actor = await forwardingActor('main');
    await actor.sendAsync({ id: '1', op: [{ p: [3, 4] }, '@fwd'], from: 'Tester', 'ty': [{ p: '::Point' }] });
    // The parent ('main') prepends itself: `::Point` → `main ::Point`.
    // Payload stays wire-shaped.
    expect(actor.posts[0]).toEqual(expect.objectContaining({
      op: [{ p: [3, 4] }, '@take'],
      to: 'Sink',
      'ty': [{ p: 'main ::Point' }],
    }));
  });

  it('without a parent frame the tag stays local form (same-process)', async () => {
    const actor = await forwardingActor(undefined);
    await actor.sendAsync({ id: '1', op: [{ p: [3, 4] }, '@fwd'], from: 'Tester', 'ty': [{ p: '::Point' }] });
    expect(actor.posts[0]).toEqual(expect.objectContaining({
      'ty': [{ p: '::Point' }],
    }));
  });

  // Two parents: the file actor that made the `@Box` actor, then the harness.
  describe('class tags', () => {
    const source = `
      @Box = *{
        n *Integer = 0

        @bump! = { n <- n + 1 }
        @pair! = {
          n <- n + 1
          return (self, n)
        }
      }
    `;

    it('the reply to #new tags its class, translated to global form', async () => {
      const actor = await (await compileActor(source, { compileOptions: { selfAddr: 'main' } })).spawn();
      await actor.sendAsync({ id: '1', op: [{}, '#new'], to: '@Box', from: 'Tester' });
      expect(actor.posts[0]).toEqual(expect.objectContaining({ id: '1', re: '#<main @Box/1>', 'ty': 'main @Box' }));
    });

    it('a self-return leaves out its @ tag, and both parents fill it in', async () => {
      const actor = await (await compileActor(source, { compileOptions: { selfAddr: 'main' } })).spawn();
      await actor.sendAsync({ id: '1', op: [{}, '#new'], to: '@Box', from: 'Tester' });
      await actor.sendAsync({ id: '2', op: '@bump!', to: '@Box/1', from: 'Tester' });
      expect(actor.posts[1]).toEqual(expect.objectContaining({ id: '2', re: '#<main @Box/1>', 'ty': 'main @Box' }));
    });

    it('self as one slot of several: both parents fill in the slot and its @', async () => {
      const actor = await (await compileActor(source, { compileOptions: { selfAddr: 'main' } })).spawn();
      await actor.sendAsync({ id: '1', op: [{}, '#new'], to: '@Box', from: 'Tester' });
      await actor.sendAsync({ id: '2', op: '@pair!', to: '@Box/1', from: 'Tester' });
      expect(actor.posts[1]).toEqual(expect.objectContaining({ id: '2', re: ['#<main @Box/1>', 1], 'ty': ['main @Box', 'Integer'] }));
    });
  });
});
