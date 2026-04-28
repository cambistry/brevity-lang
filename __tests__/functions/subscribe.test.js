import { expectBehavior, createActor } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Subscribe on functions and closures — same multi-re protocol as cells.
//
// Public (@), private (#), and parameterized functions are auto-provisioned
// with @subscribe. Subscribers receive an initial `re` (current computed
// value) and subsequent `re`s whenever any `*` ref captured by the body
// changes. Parameterized fns carry the caller's args on the subscribe; each
// (subscriber, args) tuple is its own subscription on the publisher side.
//
// Type disambiguator on the wire (`subscribe@pub<Type>`) only appears when the
// publisher casts as multiple types and the caller must pick one. In the
// single-projection cases exercised here, the service interface resolves the
// shape on both ends and no inlined <Type> is emitted.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Section 1 ─────────────────────────────────────────────────────────────────
// In-file: single actor subscribes to its own @-public, #-private, and
// parameterized fns. Behavior-only — no wire assertions.
// ───────────────────────────────────────────────────────────────────────────────

describe('subscribe — in-file fns', () => {
  const script = `
    body Integer! = 0

    @pub = { body * 2 }
    #priv = { body + 1 }
    #parameterized = |:p Integer| { body + p }

    lastPub Integer! = 0
    lastPriv Integer! = 0
    lastParam Integer! = 0

    @doSubs = {
      @pub.subscribe |v| { lastPub <- v } ;
      #priv.subscribe |v| { lastPriv <- v } ;
      #parameterized.subscribe(p: 100) |v| { lastParam <- v } ;
      .
    }

    @bump = |:n Integer| { body <- n . }

    @readAll
      =
      -> :lastPub as Integer, :lastPriv as Integer, :lastParam as Integer
  `;

  it('initial subscribe captures each fn\'s current projected value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@doSubs', from: 'c' } },
      { input: { id: '2', op: '@readAll', from: 'c' } },
      { output: {
        id: '2',
        'bv-a': { lastPub: 'Integer', lastPriv: 'Integer', lastParam: 'Integer' },
        re: { lastPub: 0, lastPriv: 1, lastParam: 100 },
        to: 'c',
      } },
    );
  });

  it('set on captured ref replays to every subscription', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@doSubs', from: 'c' } },
      { input: { id: '2', op: [{ n: 5 }, '@bump'], 'bv-a': [{ n: 'Integer' }], from: 'c' } },
      { input: { id: '3', op: '@readAll', from: 'c' } },
      { output: {
        id: '3',
        'bv-a': { lastPub: 'Integer', lastPriv: 'Integer', lastParam: 'Integer' },
        re: { lastPub: 10, lastPriv: 6, lastParam: 105 },
        to: 'c',
      } },
    );
  });

  it('parameterized subscription uses its own captured args on each re', async () => {
    // Two subscriptions to the same parameterized fn with different prefixes.
    // Each must re-evaluate against its own args on dep change.
    const twoSubsScript = `
      body Integer! = 0

      #parameterized = |:p Integer| { body + p }

      lastA Integer! = 0
      lastB Integer! = 0

      @doSubs = {
        #parameterized.subscribe(p: 10) |v| { lastA <- v } ;
        #parameterized.subscribe(p: 20) |v| { lastB <- v } ;
        .
      }

      @bump = |:n Integer| { body <- n . }

      @readBoth = -> :lastA as Integer, :lastB as Integer
    `;

    await expectBehavior(twoSubsScript,
      { input: { id: '1', op: '@doSubs', from: 'c' } },
      { input: { id: '2', op: [{ n: 3 }, '@bump'], 'bv-a': [{ n: 'Integer' }], from: 'c' } },
      { input: { id: '3', op: '@readBoth', from: 'c' } },
      { output: {
        id: '3',
        'bv-a': { lastA: 'Integer', lastB: 'Integer' },
        re: { lastA: 13, lastB: 23 },
        to: 'c',
      } },
    );
  });
});

// ─── Section 2 ─────────────────────────────────────────────────────────────────
// In-script: parent actor subscribes to a locally-declared child's public fns.
// Behavior-only; matches the existing cell call-site test style.
// ───────────────────────────────────────────────────────────────────────────────

describe('subscribe — in-script fns (local child actor)', () => {
  const script = `
    C = <> {
      @body Integer! = 0
      @pub = { @body * 2 }
      @pub_w_params = |:p Integer| { @body + p }
    }

    c = C()
    last Integer! = 0

    @doPubSub   = { c.pub.subscribe |v| { last <- v } ; . }
    @doParamSub = { c.pub_w_params.subscribe(p: 100) |v| { last <- v } ; . }
    @bumpC      = |:n Integer| { c.body <- n . }
    @readLast   = -> :last as Integer
  `;

  it('c.pub.subscribe — initial value after subscribe', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@doPubSub', from: 'caller' } },
      { input: { id: '2', op: '@readLast', from: 'caller' } },
      { output: { id: '2', 'bv-a': { last: 'Integer' }, re: { last: 0 }, to: 'caller' } },
    );
  });

  it('c.pub.subscribe — replays on set of captured body ref', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@doPubSub', from: 'caller' } },
      { input: { id: '2', op: [{ n: 5 }, '@bumpC'], 'bv-a': [{ n: 'Integer' }], from: 'caller' } },
      { input: { id: '3', op: '@readLast', from: 'caller' } },
      { output: { id: '3', 'bv-a': { last: 'Integer' }, re: { last: 10 }, to: 'caller' } },
    );
  });

  it('c.pub_w_params.subscribe(p: 100) — initial evaluation uses caller args', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@doParamSub', from: 'caller' } },
      { input: { id: '2', op: '@readLast', from: 'caller' } },
      { output: { id: '2', 'bv-a': { last: 'Integer' }, re: { last: 100 }, to: 'caller' } },
    );
  });

  it('c.pub_w_params.subscribe — replays with stored args on dep change', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: '@doParamSub', from: 'caller' } },
      { input: { id: '2', op: [{ n: 5 }, '@bumpC'], 'bv-a': [{ n: 'Integer' }], from: 'caller' } },
      { input: { id: '3', op: '@readLast', from: 'caller' } },
      { output: { id: '3', 'bv-a': { last: 'Integer' }, re: { last: 105 }, to: 'caller' } },
    );
  });
});

// ─── Section 3 ─────────────────────────────────────────────────────────────────
// Remote with stubbed publisher — subscriber imports via DI alias. Tests capture
// the outbound `subscribe@<field>` on the wire, inject stubbed `re` replies,
// and verify subscriber state.
// ───────────────────────────────────────────────────────────────────────────────

describe('subscribe — remote fn (stubbed publisher)', () => {
  const script = `
    < "Pub": (Pub) { pub: () -> Integer, pub_w_params: (:p Integer) -> Integer } >
    =

    last Integer! = 0

    @doPubSub   = { Pub.pub.subscribe |v| { last <- v } ; . }
    @doParamSub = { Pub.pub_w_params.subscribe(p: 100) |v| { last <- v } ; . }
    @readLast   = -> :last as Integer
  `;

  it('subscribe@pub posted to Pub alias, no inline <Type> for single projection', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: '@doPubSub', from: 'caller' } },
        { output: expect.objectContaining({ op: '@subscribe', to: '#<Pub @pub>' }) },
      ],
    });
  });

  it('parameterized subscribe carries args in op prefix', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: '@doParamSub', from: 'caller' } },
        { output: expect.objectContaining({
          op: [{ p: 100 }, '@subscribe'],
          'bv-a': [{ p: 'Integer' }],
          to: '#<Pub @pub_w_params>',
        }) },
      ],
    });
  });

  it('stubbed initial re drives subscriber state', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: '@doPubSub', from: 'caller' } },
        { output: expect.objectContaining({ id: '1', op: '@subscribe', to: '#<Pub @pub>' }) },
        { input: { id: '1', re: [0] } },
        { input: { id: '2', op: '@readLast', from: 'caller' } },
        { output: { id: '2', 'bv-a': { last: 'Integer' }, re: { last: 0 }, to: 'caller' } },
      ],
    });
  });

  it('stubbed later re replays to subscriber handler', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: '@doPubSub', from: 'caller' } },
        { output: expect.objectContaining({ id: '1', op: '@subscribe', to: '#<Pub @pub>' }) },
        { input: { id: '1', re: [0] } },
        { input: { id: '1', re: [10] } },
        { input: { id: '1', re: [42] } },
        { input: { id: '2', op: '@readLast', from: 'caller' } },
        { output: { id: '2', 'bv-a': { last: 'Integer' }, re: { last: 42 }, to: 'caller' } },
      ],
    });
  });

  it('parameterized: stubbed re propagates through handler', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: '@doParamSub', from: 'caller' } },
        { output: expect.objectContaining({
          id: '1',
          op: [{ p: 100 }, '@subscribe'],
          to: '#<Pub @pub_w_params>',
        }) },
        { input: { id: '1', re: [100] } },
        { input: { id: '1', re: [105] } },
        { input: { id: '2', op: '@readLast', from: 'caller' } },
        { output: { id: '2', 'bv-a': { last: 'Integer' }, re: { last: 105 }, to: 'caller' } },
      ],
    });
  });
});

// ─── Section 4 ─────────────────────────────────────────────────────────────────
// Interop — two actors compiled separately, messages manually shepherded.
// Mirrors keywords/subscribe.test.js:224-277 for cells.
// ───────────────────────────────────────────────────────────────────────────────

describe('subscribe — interop fn (two actors, manually shepherded)', () => {
  function toAliasOf(toStr) {
    if (typeof toStr !== 'string') return null;
    const m = /^#<([^\s>]+)(?:\s+[^>]*)?>/.exec(toStr);
    return m ? m[1] : toStr;
  }
  async function routeNew(srcActor, srcPrev, dstAddr, srcAddr, dstActor) {
    const fresh = srcActor.posts.slice(srcPrev);
    for (const msg of fresh) {
      if (toAliasOf(msg.to) === dstAddr) {
        await dstActor.sendAsync({ ...msg, from: srcAddr });
      }
    }
    return srcActor.posts.length;
  }

  const publisher = `
    @body Integer! = 0
    @pub = { @body * 2 }
    @pub_w_params = |:p Integer| { @body + p }
  `;

  const subscriber = `
    < "pub": (Pub) { body: Integer!, pub: () -> Integer, pub_w_params: (:p Integer) -> Integer } >
    =

    last Integer! = 0

    @doPubSub   = { Pub.pub.subscribe |v| { last <- v } ; . }
    @doParamSub = { Pub.pub_w_params.subscribe(p: 100) |v| { last <- v } ; . }
    @setRemote  = |:n Integer| { Pub.body <- n . }
    @readLast   = -> :last as Integer
  `;

  it('public fn subscriber receives initial then replay after remote set', async () => {
    const pub = await createActor(publisher);
    const sub = await createActor(subscriber);
    let pubPrev = pub.posts.length;
    let subPrev = sub.posts.length;

    // 1. Subscribe: caller -> sub. sub posts subscribe@pub to Pub.
    await sub.sendAsync({ id: '1', op: '@doPubSub', from: 'caller' });
    await routeNew(sub, subPrev, 'Pub', 'sub', pub);
    //    pub replies with re:[0] addressed back to sub.
    pubPrev = await routeNew(pub, pubPrev, 'sub', 'pub', sub);
    subPrev = sub.posts.length;

    // 2. Set: caller -> sub. sub posts set@body(5) to Pub. body <- 5 -> @pub re-evaluates -> re:[10].
    await sub.sendAsync({ id: '2', op: [{ n: 5 }, '@setRemote'], 'bv-a': [{ n: 'Integer' }], from: 'caller' });
    await routeNew(sub, subPrev, 'Pub', 'sub', pub);
    await routeNew(pub, pubPrev, 'sub', 'pub', sub);
    subPrev = sub.posts.length;

    // 3. Read: caller -> sub.
    await sub.sendAsync({ id: '3', op: '@readLast', from: 'caller' });
    const reply = sub.posts.slice(subPrev).find(p => p.id === '3');
    expect(reply).toEqual(expect.objectContaining({
      id: '3', re: { last: 10 }, to: 'caller',
    }));
  });

  it('parameterized subscriber carries args across the wire and tracks updates', async () => {
    const pub = await createActor(publisher);
    const sub = await createActor(subscriber);
    let pubPrev = pub.posts.length;
    let subPrev = sub.posts.length;

    await sub.sendAsync({ id: '1', op: '@doParamSub', from: 'caller' });
    await routeNew(sub, subPrev, 'Pub', 'sub', pub);
    pubPrev = await routeNew(pub, pubPrev, 'sub', 'pub', sub);
    subPrev = sub.posts.length;

    await sub.sendAsync({ id: '2', op: [{ n: 5 }, '@setRemote'], 'bv-a': [{ n: 'Integer' }], from: 'caller' });
    await routeNew(sub, subPrev, 'Pub', 'sub', pub);
    await routeNew(pub, pubPrev, 'sub', 'pub', sub);
    subPrev = sub.posts.length;

    await sub.sendAsync({ id: '3', op: '@readLast', from: 'caller' });
    const reply = sub.posts.slice(subPrev).find(p => p.id === '3');
    expect(reply).toEqual(expect.objectContaining({
      id: '3', re: { last: 105 }, to: 'caller',
    }));
  });
});
