import compile from '../../index.js';
import { createActor } from '../helpers.js';

const _target = globalThis.BREVITY_TARGET || process.env.BREVITY_TARGET || 'js';
const isJs = _target === 'js';

// ═══════════════════════════════════════════════════════════════════════════════
// constructs — parsing
// ═══════════════════════════════════════════════════════════════════════════════

describe('constructs — parsing', () => {
  it('full form compiles', () => {
    expect(() => compile(`
      constructs WebViews(path: Text) as WebView

      WebView = <view> {
        @open = { view.open() . }
      }

      @go = -> 1 as Integer
    `)).not.toThrow();
  });

  it('condensed form compiles', () => {
    expect(() => compile(`
      constructs WebViews(path: Text) as <view> {
        @open = { view.open() . }
      }

      @go = -> 1 as Integer
    `)).not.toThrow();
  });

  it('constructor params are validated', () => {
    expect(() => compile(`
      constructs WebViews(path: Text) as WebView

      WebView = <view> {
        @open = { view.open() . }
      }

      @go = { WebViews(path: 123) . }
    `)).toThrow(/expected Text, got Integer/);
  });

  it('missing constructor arg is rejected', () => {
    expect(() => compile(`
      constructs WebViews(path: Text) as WebView

      WebView = <view> {
        @open = { view.open() . }
      }

      @go = { WebViews() . }
    `)).toThrow(/don't match/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// constructs — ::new wire message
// ═══════════════════════════════════════════════════════════════════════════════

describe('constructs — ::new', () => {
  it('construction emits ::new with args to factory', async () => {
    const actor = await createActor(`
      constructs WebViews(path: Text) as WebView

      WebView = <view> {
        @open = { view.open() . }
      }

      ref v WebView = WebViews(path: "/panel")
      @go = -> ok: "ready" as Text
    `);
    if (!isJs) {
      // Erlang needs a sendAsync to run the actor; send ::new reply to trigger init
      await actor.sendAsync({ id: '1', re: {}, 'bv-a': 'self', from: 'WebViews/42' });
    }
    expect(actor.posts[0]).toEqual(expect.objectContaining({
      op: [{ path: '/panel' }, '::new'],
      to: 'WebViews',
    }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// constructs — instance routing
// ═══════════════════════════════════════════════════════════════════════════════

describe('constructs — instance routing', () => {
  it('after ::new reply, proxy methods route to instance address', async () => {
    const actor = await createActor(`
      constructs WebViews(path: Text) as WebView

      WebView = <view> {
        @open = { view.open() . }
      }

      ref v WebView = WebViews(path: "/panel")
      @go = { v.open() . }
    `);
    if (isJs) {
      const newMsg = actor.posts[0];
      await actor.sendAsync({
        id: newMsg.id, re: {}, 'bv-a': 'self', from: 'WebViews/42',
      });
      await actor.sendAsync({ id: '1', op: '@go', from: 'caller' });
    } else {
      // Erlang: ::new reply + @go in one pass
      actor.send({ id: '1', re: {}, 'bv-a': 'self', from: 'WebViews/42' });
      await actor.sendAsync({ id: '2', op: '@go', from: 'caller' });
    }
    // view.open() should route to the instance address
    const openMsg = actor.posts.find(p => p.to === 'WebViews/42');
    expect(openMsg).toBeDefined();
    expect(openMsg.op).toBe('open');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// constructs — inbound events via on
// ═══════════════════════════════════════════════════════════════════════════════

describe('constructs — inbound events', () => {
  it('on handler receives event from remote instance', async () => {
    if (!isJs) return; // Erlang: on-handler event routing requires stateful child dispatch
    const actor = await createActor(`
      constructs WebViews(path: Text) as WebView

      WebView = <view> {
        ref last_event Text = ""
        on view.event |data: Text| { last_event <- data . }
        @last = -> :last_event as Text
      }

      ref v WebView = WebViews(path: "/panel")
      @last = { :last_event = v.last(); -> :last_event }
    `);
    const newMsg = actor.posts[0];
    await actor.sendAsync({
      id: newMsg.id, re: {}, 'bv-a': 'self', from: 'WebViews/42',
    });
    // Remote sends an event to the proxy
    await actor.sendAsync({
      op: [{ data: 'click' }, 'event'], from: 'WebViews/42',
    });
    // Check the on handler ran
    await actor.sendAsync({ id: '1', op: '@last', from: 'caller' });
    const reply = actor.posts.find(p => p.to === 'caller');
    expect(reply).toBeDefined();
    expect(reply.re).toEqual({ last_event: 'click' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// constructs — full roundtrip
// ═══════════════════════════════════════════════════════════════════════════════

describe('constructs — full roundtrip', () => {
  it('construct, call method, get response', async () => {
    const actor = await createActor(`
      constructs WebViews(path: Text) as WebView

      WebView = <view> {
        @eval = { result Text = view.eval(); :result }
      }

      ref v WebView = WebViews(path: "/panel")
      @go
        =
        :result Text = v.eval()
        -> :result
    `);
    if (isJs) {
      const newMsg = actor.posts[0];
      await actor.sendAsync({
        id: newMsg.id, re: {}, 'bv-a': 'self', from: 'WebViews/42',
      });
      await actor.sendAsync({ id: '1', op: '@go', from: 'caller' });
      const evalMsg = actor.posts.find(p => p.to === 'WebViews/42');
      expect(evalMsg).toBeDefined();
      await actor.sendAsync({
        id: evalMsg.id, re: { result: 'hello' }, from: 'WebViews/42',
      });
    } else {
      // Erlang: all messages in one pass (await_response_ blocks on stdin)
      // Init sends ::new with id "1"; child eval sends with id "2"
      actor.send({ id: '1', re: {}, 'bv-a': 'self', from: 'WebViews/42' });
      actor.send({ id: '2', op: '@go', from: 'caller' });
      await actor.sendAsync({ id: '2', re: { result: 'hello' }, from: 'WebViews/42' });
    }
    const reply = actor.posts.find(p => p.to === 'caller');
    expect(reply).toBeDefined();
    expect(reply.re).toEqual({ result: 'hello' });
  });

  it('construct, receive event, query state', async () => {
    if (!isJs) return; // Erlang: on-handler event routing with stateful child requires persistent process
    const actor = await createActor(`
      constructs WebViews(path: Text) as WebView

      WebView = <view> {
        ref count Integer = 0
        on view.click { count <- count + 1 . }
        @count = -> :count as Integer
      }

      ref v WebView = WebViews(path: "/panel")
      @count = { :count = v.count(); -> :count }
    `);
    const newMsg = actor.posts[0];
    await actor.sendAsync({
      id: newMsg.id, re: {}, 'bv-a': 'self', from: 'WebViews/42',
    });
    // Remote fires click events
    await actor.sendAsync({ op: 'click', from: 'WebViews/42' });
    await actor.sendAsync({ op: 'click', from: 'WebViews/42' });
    await actor.sendAsync({ op: 'click', from: 'WebViews/42' });
    // Query count
    await actor.sendAsync({ id: '1', op: '@count', from: 'caller' });
    const reply = actor.posts.find(p => p.to === 'caller');
    expect(reply).toBeDefined();
    expect(reply.re).toEqual({ count: 3 });
  });
});
