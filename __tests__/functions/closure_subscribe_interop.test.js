import { expectBehavior, createActor } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Closure-subscribe coverage without HTML dependency.
//
// `closure_address.test.js` proves the bare-closure primitive (single-ref
// capture, numeric address @N, replay under same subscription id). This file
// fills the remaining cross-target surface that the browser/HTML integration
// tests exercise only on the browser target:
//
//   1. Multi-ref capture — `f = { a + b }` must replay when EITHER dep mutates.
//   2. Payload-carried closure address — a handler that returns `"#<@N>"` as
//      a plain string; the receiver extracts the address and posts subscribe.
//      This is the protocol that HTML uses to bind text nodes to closures,
//      generalized to any actor.
//   3. Inter-actor — two separately compiled actors, the test driver shepherds
//      messages between them, mirroring the pattern in
//      `subscribe.test.js` §4 (Section 4 — interop fn) but targeting a bare
//      closure rather than a named public fn.
//
// Targets: JS is the reference. Erlang and Rust are expected to cover the
// single-ref primitive; multi-ref and payload-address paths may surface gaps
// on either or both — those failures are intentional, to catch parity drift
// (per the per-target-test-skipping prohibition, we do not gate by target).
// ═══════════════════════════════════════════════════════════════════════════════


// ─── Section 1 ─────────────────────────────────────────────────────────────────
// Multi-ref capture — a single closure reads more than one `*` ref. Mutation
// of either ref must replay the closure to all subscribers under the original
// subscription id, with the re payload being the re-evaluated composite.
// ───────────────────────────────────────────────────────────────────────────────

describe('closure-subscribe — multi-ref capture', () => {
  const twoTextRefs = `
    a *Text = "hello"
    b *Text = "world"
    f = { a + " " + b }
    @setA = (:v Text) { a <- v . }
    @setB = (:v Text) { b <- v . }
  `;

  it('initial re reflects composite of both captured refs', async () => {
    await expectBehavior(twoTextRefs,
      { input: { id: '1', op: '@subscribe', to: '@0', from: 'c' } },
      { output: { id: '1', re: ['hello world'], to: 'c' } },
    );
  });

  it('mutation of first captured ref replays composite', async () => {
    await expectBehavior(twoTextRefs,
      { input: { id: '1', op: '@subscribe', to: '@0', from: 'c' } },
      { output: { id: '1', re: ['hello world'], to: 'c' } },
      { input: { id: '2', op: [{ v: 'hi' }, '@setA'], 'bv-a': [{ v: 'Text' }], from: 'c' } },
      { output: { id: '1', re: ['hi world'], to: 'c' } },
    );
  });

  it('mutation of second captured ref replays composite', async () => {
    await expectBehavior(twoTextRefs,
      { input: { id: '1', op: '@subscribe', to: '@0', from: 'c' } },
      { output: { id: '1', re: ['hello world'], to: 'c' } },
      { input: { id: '2', op: [{ v: 'earth' }, '@setB'], 'bv-a': [{ v: 'Text' }], from: 'c' } },
      { output: { id: '1', re: ['hello earth'], to: 'c' } },
    );
  });

  it('successive mutations of different refs each produce their own replay', async () => {
    await expectBehavior(twoTextRefs,
      { input: { id: '1', op: '@subscribe', to: '@0', from: 'c' } },
      { output: { id: '1', re: ['hello world'], to: 'c' } },
      { input: { id: '2', op: [{ v: 'hi' }, '@setA'], 'bv-a': [{ v: 'Text' }], from: 'c' } },
      { output: { id: '1', re: ['hi world'], to: 'c' } },
      { input: { id: '3', op: [{ v: 'there' }, '@setB'], 'bv-a': [{ v: 'Text' }], from: 'c' } },
      { output: { id: '1', re: ['hi there'], to: 'c' } },
    );
  });

  // Integer-valued composite — proves the mechanism isn't specific to Text
  // concatenation. Wire shape uses BigInt per the Integer type contract.
  const twoIntegerRefs = `
    a *Integer = 2
    b *Integer = 3
    sum = { a + b }
    @setA = (:v Integer) { a <- v . }
    @setB = (:v Integer) { b <- v . }
  `;

  it('Integer composite replays on either dep mutation', async () => {
    await expectBehavior(twoIntegerRefs,
      { input: { id: '1', op: '@subscribe', to: '@0', from: 'c' } },
      { output: { id: '1', re: [5], to: 'c' } },
      { input: { id: '2', op: [{ v: 10 }, '@setA'], 'bv-a': [{ v: 'Integer' }], from: 'c' } },
      { output: { id: '1', re: [13], to: 'c' } },
      { input: { id: '3', op: [{ v: 100 }, '@setB'], 'bv-a': [{ v: 'Integer' }], from: 'c' } },
      { output: { id: '1', re: [110], to: 'c' } },
    );
  });
});


// ─── Section 2 ─────────────────────────────────────────────────────────────────
// Payload-carried closure address — a handler returns the address as a string
// literal (e.g. `"#<@0>"`) rather than via template interpolation. The caller
// extracts the `<<…>>` substring and posts a subscribe to the inner selector.
//
// This is the wire-level generalization of the Phase 2→4 HTML flow: any actor
// can hand out a closure address in a reply or payload field, and any receiver
// can subscribe to it by parsing the delimiter. No template or HTML required.
//
// Note: the Brevity source spells `"#<@0>"` as a plain string literal. The
// compiler does not verify that `@0` refers to an actually-declared closure —
// the author is responsible for that bookkeeping, same as any hand-written
// wire address. For HTML-backed scenarios the compiler generates these from
// template interpolations; here we are exercising the protocol directly.
// ───────────────────────────────────────────────────────────────────────────────

describe('closure-subscribe — payload-carried address', () => {
  const publisherWithGetAddr = `
    content *Text = "initial"
    f = { content }
    @getAddr = -> ref: "#<@0>"
    @bump = (:v Text) { content <- v . }
  `;

  it('handler reply carries closure address; subscribing to it yields initial re', async () => {
    const actor = await createActor(publisherWithGetAddr);
    await actor.sendAsync({ id: 'A', op: '@getAddr', from: 'c' });
    const reply = actor.posts.find(p => p.id === 'A');
    expect(reply).toEqual(expect.objectContaining({ id: 'A', re: { ref: '#<@0>' }, to: 'c' }));

    const addr = reply.re.ref;
    const selector = /^#<(.+)>$/.exec(addr)[1];
    expect(selector).toBe('@0');

    const postsBefore = actor.posts.length;
    await actor.sendAsync({ id: 'S', op: '@subscribe', to: selector, from: 'c' });
    expect(actor.posts[postsBefore]).toEqual({ id: 'S', re: ['initial'], to: 'c' });
  });

  it('subsequent set on captured ref replays to the subscriber', async () => {
    const actor = await createActor(publisherWithGetAddr);
    await actor.sendAsync({ id: 'A', op: '@getAddr', from: 'c' });
    const reply = actor.posts.find(p => p.id === 'A');
    const selector = /^#<(.+)>$/.exec(reply.re.ref)[1];

    await actor.sendAsync({ id: 'S', op: '@subscribe', to: selector, from: 'c' });
    const postsBefore = actor.posts.length;

    await actor.sendAsync({
      id: 'B',
      op: [{ v: 'updated' }, '@bump'],
      'bv-a': [{ v: 'Text' }],
      from: 'c',
    });
    expect(actor.posts[postsBefore]).toEqual({ id: 'S', re: ['updated'], to: 'c' });
  });

  // Multiple closures — publisher hands out two distinct addresses, subscriber
  // can choose which one to bind. Proves the returned address is the handle
  // that selects the binding, not just a uniform "subscribe to me" ping.
  const publisherWithTwoClosures = `
    content *Text = "c-init"
    meta *Text = "m-init"
    fc = { content }
    fm = { meta }
    @getContentAddr = -> ref: "#<@0>"
    @getMetaAddr = -> ref: "#<@1>"
    @bumpContent = (:v Text) { content <- v . }
    @bumpMeta = (:v Text) { meta <- v . }
  `;

  it('two address handles route to independent closures', async () => {
    const actor = await createActor(publisherWithTwoClosures);

    await actor.sendAsync({ id: 'A', op: '@getContentAddr', from: 'c' });
    await actor.sendAsync({ id: 'B', op: '@getMetaAddr', from: 'c' });
    const replyA = actor.posts.find(p => p.id === 'A');
    const replyB = actor.posts.find(p => p.id === 'B');
    const selectorA = /^#<(.+)>$/.exec(replyA.re.ref)[1];
    const selectorB = /^#<(.+)>$/.exec(replyB.re.ref)[1];
    expect(selectorA).toBe('@0');
    expect(selectorB).toBe('@1');

    await actor.sendAsync({ id: 'SA', op: '@subscribe', to: selectorA, from: 'subA' });
    await actor.sendAsync({ id: 'SB', op: '@subscribe', to: selectorB, from: 'subB' });

    // Mutate content only — subA replays, subB does not.
    const postsBefore = actor.posts.length;
    await actor.sendAsync({
      id: 'M1',
      op: [{ v: 'c-new' }, '@bumpContent'],
      'bv-a': [{ v: 'Text' }],
      from: 'c',
    });
    const after = actor.posts.slice(postsBefore);
    expect(after).toEqual(expect.arrayContaining([
      { id: 'SA', re: ['c-new'], to: 'subA' },
    ]));
    expect(after.find(p => p.id === 'SB')).toBeUndefined();
  });
});


// ─── Section 3 ─────────────────────────────────────────────────────────────────
// Inter-actor with manual shepherding — two separately compiled actors, the
// test driver routes messages between them. Parallels `subscribe.test.js` §4
// but for a bare closure on the publisher. The subscriber actor has a simple
// `@routedRe` handler that the driver invokes in place of the subscribe-side
// runtime logic (which doesn't exist at the user level for bare closures —
// it's what the HTML runtime provides in the browser target).
// ───────────────────────────────────────────────────────────────────────────────

describe('closure-subscribe — inter-actor shepherded', () => {
  const publisher = `
    content *Text = "initial"
    f = { content }
    @bump = (:v Text) { content <- v . }
  `;

  const subscriber = `
    received *Text = ""
    @routedRe = (:v Text) { received <- v . }
    @readReceived = -> :received as Text
  `;

  // Route any re message addressed to 'sub' from the publisher into the
  // subscriber as an @routedRe call with the re value as :v. This models
  // the runtime-level subscribe binding that the HTML actor (or any future
  // consumer) would provide.
  async function routeReInto(pubActor, pubPrev, subActor) {
    const fresh = pubActor.posts.slice(pubPrev);
    for (const msg of fresh) {
      if (msg.to !== 'sub' || !Array.isArray(msg.re)) continue;
      await subActor.sendAsync({
        id: 'r-' + msg.id,
        op: [{ v: msg.re[0] }, '@routedRe'],
        'bv-a': [{ v: 'Text' }],
        from: 'router',
      });
    }
    return pubActor.posts.length;
  }

  it('subscriber records initial re forwarded from publisher', async () => {
    const pub = await createActor(publisher);
    const sub = await createActor(subscriber);
    let pubPrev = pub.posts.length;

    // Driver posts subscribe on behalf of `sub` — this is the role the
    // subscriber's runtime (e.g. HTML on browser) would play.
    await pub.sendAsync({ id: 'S1', op: '@subscribe', to: '@0', from: 'sub' });
    await routeReInto(pub, pubPrev, sub);

    // Read the subscriber's state — should reflect the forwarded initial re.
    await sub.sendAsync({ id: 'Q', op: '@readReceived', from: 'caller' });
    const reply = sub.posts.find(p => p.id === 'Q');
    expect(reply).toEqual(expect.objectContaining({
      id: 'Q',
      re: { received: 'initial' },
      to: 'caller',
    }));
  });

  it('subscriber records replay after publisher-side mutation', async () => {
    const pub = await createActor(publisher);
    const sub = await createActor(subscriber);
    let pubPrev = pub.posts.length;

    await pub.sendAsync({ id: 'S1', op: '@subscribe', to: '@0', from: 'sub' });
    pubPrev = await routeReInto(pub, pubPrev, sub);

    await pub.sendAsync({
      id: 'B1',
      op: [{ v: 'first' }, '@bump'],
      'bv-a': [{ v: 'Text' }],
      from: 'caller',
    });
    pubPrev = await routeReInto(pub, pubPrev, sub);

    await pub.sendAsync({
      id: 'B2',
      op: [{ v: 'second' }, '@bump'],
      'bv-a': [{ v: 'Text' }],
      from: 'caller',
    });
    await routeReInto(pub, pubPrev, sub);

    await sub.sendAsync({ id: 'Q', op: '@readReceived', from: 'caller' });
    const reply = sub.posts.find(p => p.id === 'Q');
    expect(reply).toEqual(expect.objectContaining({
      id: 'Q',
      re: { received: 'second' },
      to: 'caller',
    }));
  });

  it('two subscribers on the same publisher @0 each get their own re stream', async () => {
    const pub = await createActor(publisher);
    const subA = await createActor(subscriber);
    const subB = await createActor(subscriber);
    let pubPrev = pub.posts.length;

    // Two distinct subscribe ids from two distinct subscriber addresses.
    await pub.sendAsync({ id: 'SA', op: '@subscribe', to: '@0', from: 'subA' });
    await pub.sendAsync({ id: 'SB', op: '@subscribe', to: '@0', from: 'subB' });

    // Route the initial replies (pub addresses them to 'subA' and 'subB').
    async function drainPubTo(addr, target) {
      const fresh = pub.posts.slice(pubPrev);
      for (const msg of fresh) {
        if (msg.to !== addr || !Array.isArray(msg.re)) continue;
        await target.sendAsync({
          id: 'r-' + msg.id,
          op: [{ v: msg.re[0] }, '@routedRe'],
          'bv-a': [{ v: 'Text' }],
          from: 'router',
        });
      }
    }
    await drainPubTo('subA', subA);
    await drainPubTo('subB', subB);
    pubPrev = pub.posts.length;

    await pub.sendAsync({
      id: 'B',
      op: [{ v: 'broadcast' }, '@bump'],
      'bv-a': [{ v: 'Text' }],
      from: 'caller',
    });
    await drainPubTo('subA', subA);
    await drainPubTo('subB', subB);

    await subA.sendAsync({ id: 'QA', op: '@readReceived', from: 'caller' });
    await subB.sendAsync({ id: 'QB', op: '@readReceived', from: 'caller' });
    expect(subA.posts.find(p => p.id === 'QA')).toEqual(expect.objectContaining({
      re: { received: 'broadcast' },
    }));
    expect(subB.posts.find(p => p.id === 'QB')).toEqual(expect.objectContaining({
      re: { received: 'broadcast' },
    }));
  });
});
