import { compileActor } from '../helpers.js';

// Perspective translation of a type's authority address.
//
// A local type tag is emitted in local form `#<::Name>` (empty authority).
// It is an address like any other, so when the value rises through a parent
// the parent prepends its own address — exactly as it does for a local
// endpoint `#<@N>`. The local-vs-global discriminator is the leading char
// inside the angles: non-word (`@`, `#`, `:`) = local (prepend); word =
// global (leave alone). The `:` arm is what carries type tags.
//
// This exercises the browser harness's parent-layer translation
// (rewriteLocalAddresses in src/codegen/browser/brevity.js), the only
// in-repo relayer. rust/erlang emit the same local form but defer
// translation to their external CAM host (they do not relay payloads
// in-process), so there is no in-codegen seam to mirror the discriminator
// into for those targets. See notes/type-authority-address-tags-2026-10-26.

async function forwardingActor(selfAddr) {
  const compiled = await compileActor(`
    ::Point = (x Integer, y Integer)
    *(
      "Sink": (Sink) {
        take: (p: Point) -> ()
      }
    )
    =
    @fwd
      =
      p: Point
      =
      Sink.take(:p)
      -> ()
  `, { compileOptions: { selfAddr } });
  return compiled.spawn();
}

describe('type authority tag — perspective translation (browser)', () => {
  it('local #<::Name> tag gets the parent address prepended on the way out', async () => {
    const actor = await forwardingActor('main');
    await actor.sendAsync({ id: '1', op: [{ p: [3, 4] }, '@fwd'], from: 'Tester', 'bv-a': [{ p: '#<::Point>' }] });
    // The parent ('main') prepends itself: local-form `#<::Point>` →
    // global-form `#<main ::Point>`. Payload stays wire-shaped.
    expect(actor.posts[0]).toEqual(expect.objectContaining({
      op: [{ p: [3, 4] }, '@take'],
      to: 'Sink',
      'bv-a': [{ p: '#<main ::Point>' }],
    }));
  });

  it('without a parent frame the tag stays local form (same-process)', async () => {
    const actor = await forwardingActor(undefined);
    await actor.sendAsync({ id: '1', op: [{ p: [3, 4] }, '@fwd'], from: 'Tester', 'bv-a': [{ p: '#<::Point>' }] });
    expect(actor.posts[0]).toEqual(expect.objectContaining({
      'bv-a': [{ p: '#<::Point>' }],
    }));
  });
});
