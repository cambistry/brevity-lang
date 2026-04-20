import { compileActor, createActor, compileSource } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SKIPPED: `constructs` keyword is being deprecated in favor of dependency
// injection (future work). The fixtures here also use the outdated bare
// `<view>` syntax (should be `<view *>` to declare an actor ref). All
// describes in this file are .skip until the feature is replaced.
// ═══════════════════════════════════════════════════════════════════════════════

describe.skip('constructs — parsing', () => {
  it('full form compiles', () => {
    expect(() => compileSource(`
      constructs WebViews(:path Text) as WebView

      WebView = <view> {
        @open = { view.open() . }
      }

      @go = -> 1
    `)).not.toThrow();
  });

  it('condensed form compiles', () => {
    expect(() => compileSource(`
      constructs WebViews(:path Text) as <view> {
        @open = { view.open() . }
      }

      @go = -> 1
    `)).not.toThrow();
  });

  it('constructor params are validated', () => {
    expect(() => compileSource(`
      constructs WebViews(:path Text) as WebView

      WebView = <view> {
        @open = { view.open() . }
      }

      @go = { WebViews(path: 123) . }
    `)).toThrow(/expected Text, got Integer/);
  });

  it('missing constructor arg is rejected', () => {
    expect(() => compileSource(`
      constructs WebViews(:path Text) as WebView

      WebView = <view> {
        @open = { view.open() . }
      }

      @go = { WebViews() . }
    `)).toThrow(/don't match/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// constructs — shared fixture for `new` + routing tests
// ═══════════════════════════════════════════════════════════════════════════════

const basicConstructSource = `
  constructs WebViews(:path Text) as WebView

  WebView = <view> {
    @open = { view.open() . }
  }

  v *WebView = WebViews(path: "/panel")
  @status = -> ok: "ready"
  @goOpen = { v.open() . }
`;

describe.skip('constructs — `new`', () => {
  it('construction emits `new` with args to factory', async () => {
    const compiled = await compileActor(basicConstructSource);
    const actor = await compiled.spawn();
    await actor.sendAsync({ id: '1', re: {}, 'bv-a': 'self', from: 'WebViews/42' });
    expect(actor.posts[0]).toEqual(expect.objectContaining({
      op: [{ path: '/panel' }, 'new'],
      to: 'WebViews',
    }));
  });
});

describe.skip('constructs — instance routing', () => {
  it('after `new` reply, proxy methods route to instance address', async () => {
    const compiled = await compileActor(basicConstructSource);
    const actor = await compiled.spawn();
    actor.send({ id: '1', re: {}, 'bv-a': 'self', from: 'WebViews/42' });
    await actor.sendAsync({ id: '2', op: '@goOpen', from: 'caller' });
    // view.open() should route to the instance address
    const openMsg = actor.posts.find(p => p.to === 'WebViews/42');
    expect(openMsg).toBeDefined();
    expect(openMsg.op).toBe('@open');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// constructs — inbound events via on
// ═══════════════════════════════════════════════════════════════════════════════

const eventConstructSource = `
  constructs WebViews(:path Text) as WebView

  WebView = <view> {
    last_event *Text = ""
    on view.event |:data Text| { last_event <- data . }
    @last = -> :last_event
  }

  v *WebView = WebViews(path: "/panel")
  @getLast = { :last_event = v.last(); -> :last_event }
`;

describe.skip('constructs — inbound events', () => {
  it('on handler receives event from remote instance', async () => {
    const compiled = await compileActor(eventConstructSource);
    const actor = await compiled.spawn();
    // Reply to `new` (send_seq '1') to complete construction
    await actor.sendAsync({
      id: '1', re: {}, 'bv-a': 'self', from: 'WebViews/42',
    });
    // Remote sends an event to the proxy
    await actor.sendAsync({
      op: [{ data: 'click' }, 'event'], from: 'WebViews/42',
    });
    // Check the on handler ran
    await actor.sendAsync({ id: '10', op: '@getLast', from: 'caller' });
    const reply = actor.posts.find(p => p.to === 'caller');
    expect(reply).toBeDefined();
    expect(reply.re).toEqual({ last_event: 'click' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// constructs — full roundtrip
// ═══════════════════════════════════════════════════════════════════════════════

const clickConstructSource = `
  constructs WebViews(:path Text) as WebView

  WebView = <view> {
    count *Integer = 0
    on view.click { count <- count + 1 . }
    @count = -> :count
  }

  v *WebView = WebViews(path: "/panel")
  @getCount = { :count = v.count(); -> :count }
`;

describe.skip('constructs — full roundtrip', () => {
  it('construct, call method, get response', async () => {
    const actor = await createActor(`
      constructs WebViews(:path Text) as WebView

      WebView = <view> {
        @eval = { result Text = view.eval(); :result }
      }

      v *WebView = WebViews(path: "/panel")
      @go
        =
        :result Text = v.eval()
        -> :result
    `);
    actor.send({ id: '1', re: {}, 'bv-a': 'self', from: 'WebViews/42' });
    actor.send({ id: '2', op: '@go', from: 'caller' });
    await actor.sendAsync({ id: '2', re: { result: 'hello' }, from: 'WebViews/42' });
    const reply = actor.posts.find(p => p.to === 'caller');
    expect(reply).toBeDefined();
    expect(reply.re).toEqual({ result: 'hello' });
  });

  it('construct, receive event, query state', async () => {
    const compiled = await compileActor(clickConstructSource);
    const actor = await compiled.spawn();
    // Reply to `new` (send_seq '1') to complete construction
    await actor.sendAsync({
      id: '1', re: {}, 'bv-a': 'self', from: 'WebViews/42',
    });
    // Remote fires click events
    await actor.sendAsync({ op: 'click', from: 'WebViews/42' });
    await actor.sendAsync({ op: 'click', from: 'WebViews/42' });
    await actor.sendAsync({ op: 'click', from: 'WebViews/42' });
    // Query count
    await actor.sendAsync({ id: '10', op: '@getCount', from: 'caller' });
    const reply = actor.posts.find(p => p.to === 'caller');
    expect(reply).toBeDefined();
    expect(reply.re).toEqual({ count: 3 });
  });
});
