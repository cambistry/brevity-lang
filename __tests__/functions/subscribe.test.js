import { expectBehavior, createActor, compileSource } from '../helpers.js';

describe('subscribe — runtime', () => {
  const script = `
    use Pub = "Pub" as { pub () -> (Integer), pub_w_params (p: Integer) -> (Integer) }

    // subscribe — in-file fns
    body *Integer = 0

    @pub = { body * 2 }
    #priv = { body + 1 }
    #parameterized = (p: Integer) { body + p }

    lastPub *Integer = 0
    lastPriv *Integer = 0
    lastParam *Integer = 0

    @doSubs. = {
      sub @pub, (v) { lastPub <- v } ;
      sub #priv, (v) { lastPriv <- v } ;
      sub #parameterized(p: 100), (v) { lastParam <- v }
    }

    @bump. = (n: Integer) { body <- n }

    @readAll
      =
      return :lastPub as Integer, :lastPriv as Integer, :lastParam as Integer

    // a fn's own ref isn't a capture: another fn's ref of the same name doesn't replay it
    @ownRef = { held *Integer = 7; held }
    @writeOwn = { held *Integer = 1; held <- 2; held }
    replays *Integer = 0
    @doOwnSub. = { sub @ownRef, (v) { replays <- replays + 1 } }
    @readReplays = () -> :replays as Integer

    // subscribe — in-script fns (local child actor)
    C = * {
      @body *Integer = 0
      @pub = { @body * 2 }
      @pub_w_params = (p: Integer) { @body + p }
    }

    c = C()
    last *Integer = 0

    @doPubSub.   = { sub c.pub, (v) { last <- v } }
    @doParamSub. = { sub c.pub_w_params(p: 100), (v) { last <- v } }
    @bumpC.      = (n: Integer) { c.body <- n }
    @readLast   = () -> :last as Integer

    // subscribe — remote fn (stubbed publisher)

    @doPubSub3.   = { sub Pub.pub, (v) { last <- v } }
    @doParamSub3. = { sub Pub.pub_w_params(p: 100), (v) { last <- v } }

  `;

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

  it('subscribe — in-file fns — initial subscribe captures each fn\'s current projected value', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'doSubs.', from: 'c' } },
      { input: { id: '2', op: 'readAll', from: 'c' } },
      { output: {
        id: '2',
        'ty': [{ lastPub: 'Integer', lastPriv: 'Integer', lastParam: 'Integer' }],
        re: [{ lastPub: 0, lastPriv: 1, lastParam: 100 }],
        to: 'c',
      } },
    );
  });

  it('subscribe — in-file fns — set on captured ref replays to every subscription', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'doSubs.', from: 'c' } },
      { input: { id: '2', op: [[{ n: 5 }], 'bump.'], 'ty': [[{ n: 'Integer' }]], from: 'c' } },
      { input: { id: '3', op: 'readAll', from: 'c' } },
      { output: {
        id: '3',
        'ty': [{ lastPub: 'Integer', lastPriv: 'Integer', lastParam: 'Integer' }],
        re: [{ lastPub: 10, lastPriv: 6, lastParam: 105 }],
        to: 'c',
      } },
    );
  });

  it('subscribe — in-file fns — a write to another fn\'s own ref of the same name doesn\'t replay', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'doOwnSub.', from: 'c' } },
      { input: { id: '2', op: 'writeOwn', from: 'c' } },
      { output: { id: '2', re: [2], to: 'c' } },
      { input: { id: '3', op: 'readReplays', from: 'c' } },
      { output: { id: '3', 'ty': [{ replays: 'Integer' }], re: [{ replays: 1 }], to: 'c' } },
    );
  });

  it('subscribe — in-file fns — parameterized subscription uses its own captured args on each re', async () => {
    // Two subscriptions to the same parameterized fn with different prefixes.
    // Each must re-evaluate against its own args on dep change.
    const twoSubsScript = `
      body *Integer = 0

      #parameterized = (p: Integer) { body + p }

      lastA *Integer = 0
      lastB *Integer = 0

      @doSubs. = {
        sub #parameterized(p: 10), (v) { lastA <- v } ;
        sub #parameterized(p: 20), (v) { lastB <- v }
      }

      @bump. = (n: Integer) { body <- n }

      @readBoth = () -> :lastA as Integer, :lastB as Integer
    `;

    await expectBehavior(twoSubsScript,
      { input: { id: '1', op: 'doSubs.', from: 'c' } },
      { input: { id: '2', op: [[{ n: 3 }], 'bump.'], 'ty': [[{ n: 'Integer' }]], from: 'c' } },
      { input: { id: '3', op: 'readBoth', from: 'c' } },
      { output: {
        id: '3',
        'ty': [{ lastA: 'Integer', lastB: 'Integer' }],
        re: [{ lastA: 13, lastB: 23 }],
        to: 'c',
      } },
    );
  });

  // ─── Section 2 ─────────────────────────────────────────────────────────────────
  // In-script: parent actor subscribes to a locally-declared child's public fns.
  // Behavior-only; matches the existing cell call-site test style.
  // ───────────────────────────────────────────────────────────────────────────────

  it('subscribe — in-script fns (local child actor) — sub c.pub — initial value after subscribe', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'doPubSub.', from: 'caller' } },
      { input: { id: '2', op: 'readLast', from: 'caller' } },
      { output: { id: '2', 'ty': [{ last: 'Integer' }], re: [{ last: 0 }], to: 'caller' } },
    );
  });

  it('subscribe — in-script fns (local child actor) — sub c.pub — replays on set of captured body ref', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'doPubSub.', from: 'caller' } },
      { input: { id: '2', op: [[{ n: 5 }], 'bumpC.'], 'ty': [[{ n: 'Integer' }]], from: 'caller' } },
      { input: { id: '3', op: 'readLast', from: 'caller' } },
      { output: { id: '3', 'ty': [{ last: 'Integer' }], re: [{ last: 10 }], to: 'caller' } },
    );
  });

  it('subscribe — in-script fns (local child actor) — sub c.pub_w_params(p: 100) — initial evaluation uses caller args', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'doParamSub.', from: 'caller' } },
      { input: { id: '2', op: 'readLast', from: 'caller' } },
      { output: { id: '2', 'ty': [{ last: 'Integer' }], re: [{ last: 100 }], to: 'caller' } },
    );
  });

  it('subscribe — in-script fns (local child actor) — sub c.pub_w_params — replays with stored args on dep change', async () => {
    await expectBehavior(script,
      { input: { id: '1', op: 'doParamSub.', from: 'caller' } },
      { input: { id: '2', op: [[{ n: 5 }], 'bumpC.'], 'ty': [[{ n: 'Integer' }]], from: 'caller' } },
      { input: { id: '3', op: 'readLast', from: 'caller' } },
      { output: { id: '3', 'ty': [{ last: 'Integer' }], re: [{ last: 105 }], to: 'caller' } },
    );
  });

  // ─── Section 3 ─────────────────────────────────────────────────────────────────
  // Remote with stubbed publisher — subscriber imports via DI alias. Tests capture
  // the outbound `subscribe@<field>` on the wire, inject stubbed `re` replies,
  // and verify subscriber state.
  // ───────────────────────────────────────────────────────────────────────────────

  it('subscribe — remote fn (stubbed publisher) — subscribe@pub posted to Pub alias, no inline <Type> for single projection', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: 'doPubSub3.', from: 'caller' } },
        { output: expect.objectContaining({ op: '$sub', to: 'Pub:pub' }) },
      ],
    });
  });

  it('subscribe — remote fn (stubbed publisher) — parameterized subscribe carries args in op prefix', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: 'doParamSub3.', from: 'caller' } },
        { output: expect.objectContaining({
          op: [[{ p: 100 }], '$sub'],
          'ty': [[{ p: 'Integer' }]],
          to: 'Pub:pub_w_params',
        }) },
      ],
    });
  });

  it('subscribe — remote fn (stubbed publisher) — stubbed initial re drives subscriber state', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: 'doPubSub3.', from: 'caller' } },
        { output: expect.objectContaining({ id: '1', op: '$sub', to: 'Pub:pub' }) },
        { input: { id: '1', re: [0] } },
        { input: { id: '2', op: 'readLast', from: 'caller' } },
        { output: { id: '2', 'ty': [{ last: 'Integer' }], re: [{ last: 0 }], to: 'caller' } },
      ],
    });
  });

  it('subscribe — remote fn (stubbed publisher) — stubbed later re replays to subscriber handler', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: 'doPubSub3.', from: 'caller' } },
        { output: expect.objectContaining({ id: '1', op: '$sub', to: 'Pub:pub' }) },
        { input: { id: '1', re: [0] } },
        { input: { id: '1', re: [10] } },
        { input: { id: '1', re: [42] } },
        { input: { id: '2', op: 'readLast', from: 'caller' } },
        { output: { id: '2', 'ty': [{ last: 'Integer' }], re: [{ last: 42 }], to: 'caller' } },
      ],
    });
  });

  it('subscribe — remote fn (stubbed publisher) — parameterized: stubbed re propagates through handler', async () => {
    await createActor(script, {
      expects: [
        { input: { id: '1', op: 'doParamSub3.', from: 'caller' } },
        { output: expect.objectContaining({
          id: '1',
          op: [[{ p: 100 }], '$sub'],
          to: 'Pub:pub_w_params',
        }) },
        { input: { id: '1', re: [100] } },
        { input: { id: '1', re: [105] } },
        { input: { id: '2', op: 'readLast', from: 'caller' } },
        { output: { id: '2', 'ty': [{ last: 'Integer' }], re: [{ last: 105 }], to: 'caller' } },
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
    const m = /^#<([^:>]+)(?::[^>]*)?>/.exec(toStr);
    return m ? m[1] : toStr.split(':')[0];
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
    @body *Integer = 0
    @pub = { @body * 2 }
    @pub_w_params = (p: Integer) { @body + p }
  `;

  const subscriber = `
    use Pub = "pub" as { body *Integer, pub () -> (Integer), pub_w_params (p: Integer) -> (Integer) }

    last *Integer = 0

    @doPubSub.   = { sub Pub.pub, (v) { last <- v } }
    @doParamSub. = { sub Pub.pub_w_params(p: 100), (v) { last <- v } }
    @setRemote.  = (n: Integer) { Pub.body <- n }
    @readLast   = () -> :last as Integer
  `;

  it('public fn subscriber receives initial then replay after remote set', async () => {
    const pub = await createActor(publisher);
    const sub = await createActor(subscriber);
    let pubPrev = pub.posts.length;
    let subPrev = sub.posts.length;

    // 1. Subscribe: caller -> sub. sub posts subscribe@pub to Pub.
    await sub.sendAsync({ id: '1', op: 'doPubSub.', from: 'caller' });
    await routeNew(sub, subPrev, 'pub', 'sub', pub);
    //    pub replies with re:[0] addressed back to sub.
    pubPrev = await routeNew(pub, pubPrev, 'sub', 'pub', sub);
    subPrev = sub.posts.length;

    // 2. Set: caller -> sub. sub posts set@body(5) to Pub. body <- 5 -> @pub re-evaluates -> re:[10].
    await sub.sendAsync({ id: '2', op: [[{ n: 5 }], 'setRemote.'], 'ty': [[{ n: 'Integer' }]], from: 'caller' });
    await routeNew(sub, subPrev, 'pub', 'sub', pub);
    await routeNew(pub, pubPrev, 'sub', 'pub', sub);
    subPrev = sub.posts.length;

    // 3. Read: caller -> sub.
    await sub.sendAsync({ id: '3', op: 'readLast', from: 'caller' });
    const reply = sub.posts.slice(subPrev).find(p => p.id === '3');
    expect(reply).toEqual(expect.objectContaining({
      id: '3', re: [{ last: 10 }], to: 'caller',
    }));
  });

  it('parameterized subscriber carries args across the wire and tracks updates', async () => {
    const pub = await createActor(publisher);
    const sub = await createActor(subscriber);
    let pubPrev = pub.posts.length;
    let subPrev = sub.posts.length;

    await sub.sendAsync({ id: '1', op: 'doParamSub.', from: 'caller' });
    await routeNew(sub, subPrev, 'pub', 'sub', pub);
    pubPrev = await routeNew(pub, pubPrev, 'sub', 'pub', sub);
    subPrev = sub.posts.length;

    await sub.sendAsync({ id: '2', op: [[{ n: 5 }], 'setRemote.'], 'ty': [[{ n: 'Integer' }]], from: 'caller' });
    await routeNew(sub, subPrev, 'pub', 'sub', pub);
    await routeNew(pub, pubPrev, 'sub', 'pub', sub);
    subPrev = sub.posts.length;

    await sub.sendAsync({ id: '3', op: 'readLast', from: 'caller' });
    const reply = sub.posts.slice(subPrev).find(p => p.id === '3');
    expect(reply).toEqual(expect.objectContaining({
      id: '3', re: [{ last: 105 }], to: 'caller',
    }));
  });
});

// A cell the function declares is written only while the function runs, so a
// subscription to it has nothing to wait for: it's refused.
describe('subscribe — a cell the function declares', () => {
  it('a subscription to it is refused', () => {
    expect(() => compileSource(`
      @f = {
        n *Integer = 0
        seen *Integer = 0
        sub n, (v Integer) { seen <- v }
        n <- 5
        return seen
      }
    `)).toThrow("Cannot subscribe to 'n', a cell '@f' declares: each write to it happens while '@f' runs, so act on the value where it's written");
  });

  it('so is one to a pointer it declares', () => {
    expect(() => compileSource(`
      T = *(x Integer) { @a = () -> x }
      @f = {
        c = *T(1)
        sub *c, (p T) { x = 1 }
        return 1
      }
    `)).toThrow("Cannot subscribe to 'c', a cell '@f' declares: each write to it happens while '@f' runs, so act on the value where it's written");
  });

  it('and one from a lambda in the function', () => {
    expect(() => compileSource(`
      @f = {
        n *Integer = 0
        w = { sub n, (v Integer) { x = v } }
        return 1
      }
    `)).toThrow("Cannot subscribe to 'n', a cell '@f' declares: each write to it happens while '@f' runs, so act on the value where it's written");
  });
});
