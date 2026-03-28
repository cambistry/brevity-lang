import compile from '../../index.js';
import { createActor } from '../helpers.js';

const _target = globalThis.BREVITY_TARGET || process.env.BREVITY_TARGET || 'js';
const isJs = _target === 'js';

// ═══════════════════════════════════════════════════════════════════════════════
// uses with constructor — parsing
// ═══════════════════════════════════════════════════════════════════════════════

describe('uses with constructor — parsing', () => {
  it('uses with constructor params and instance methods compiles', () => {
    expect(() => compile(`
      uses WebView(path: Text) {
        open: () -> (Text)
        close: () -> .
      }
      @go = -> 1 as Integer
    `)).not.toThrow();
  });

  it('constructor call compiles', () => {
    expect(() => compile(`
      uses WebView(path: Text) {
        open: () -> (Text)
      }
      ref view : WebView = WebView(path: "/my_view")
      @go = -> 1 as Integer
    `)).not.toThrow();
  });

  it('constructor call with wrong arg name is rejected', () => {
    expect(() => compile(`
      uses WebView(path: Text) {
        open: () -> (Text)
      }
      ref view : WebView = WebView(route: "/my_view")
      @go = -> 1 as Integer
    `)).toThrow(/don't match/);
  });

  it('constructor call with wrong arg type is rejected', () => {
    expect(() => compile(`
      uses WebView(path: Text) {
        open: () -> (Text)
      }
      ref view : WebView = WebView(path: 123)
      @go = -> 1 as Integer
    `)).toThrow(/expected Text, got Integer/);
  });

  it('constructor call with no args when params expected is rejected', () => {
    expect(() => compile(`
      uses WebView(path: Text) {
        open: () -> (Text)
      }
      ref view : WebView = WebView()
      @go = -> 1 as Integer
    `)).toThrow(/don't match/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// uses with constructor — outgoing CAM
// ═══════════════════════════════════════════════════════════════════════════════

describe('uses with constructor — outgoing CAM', () => {
  it('constructor emits ::new with named args', async () => {
    if (!isJs) return;
    const actor = await createActor(`
      uses WebView(path: Text) {
        open: () -> (Text)
      }
      ref view : WebView = WebView(path: "/my_view")
      @go = -> 1 as Integer
    `);
    expect(actor.posts[0]).toEqual(expect.objectContaining({
      op: [{ path: '/my_view' }, '::new'],
      to: 'WebView',
    }));
  });

  it('instance method call to undeclared method is rejected', () => {
    expect(() => compile(`
      uses WebView(path: Text) {
        open: () -> (Text)
      }
      ref view : WebView = WebView(path: "/my_view")
      @go = { view.nope() . }
    `)).toThrow(/has no function 'nope'/);
  });

  it('instance method call with wrong arg count is rejected', () => {
    expect(() => compile(`
      uses WebView(path: Text) {
        open: () -> (Text)
      }
      ref view : WebView = WebView(path: "/my_view")
      @go = { view.open("extra") . }
    `)).toThrow(/don't match/);
  });

  it('instance method call with correct signature compiles', () => {
    expect(() => compile(`
      uses WebView(path: Text) {
        eval: (Text) -> (Structure)
      }
      ref view : WebView = WebView(path: "/my_view")
      @go = { view.eval("code") . }
    `)).not.toThrow();
  });

  it('after ::new reply, instance method routes to returned address', async () => {
    if (!isJs) return;
    const actor = await createActor(`
      uses WebView(path: Text) {
        open: () -> (Text)
      }
      ref view : WebView = WebView(path: "/my_view")
      @go = { view.open() . }
    `);
    // ::new was emitted during create()
    const newMsg = actor.posts[0];
    expect(newMsg).toEqual(expect.objectContaining({
      op: [{ path: '/my_view' }, '::new'],
      to: 'WebView',
    }));

    // Mock the ::new response — instance address comes in "from"
    await actor.sendAsync({
      id: newMsg.id, re: {}, 'bv-a': 'self<WebView>', from: 'WebView/42',
    });

    // Trigger @go which calls view.open()
    await actor.sendAsync({ id: '1', op: '@go', from: 'caller' });

    // view.open() should route to the instance address
    const openMsg = actor.posts.find(p => p.to === 'WebView/42');
    expect(openMsg).toBeDefined();
    expect(openMsg.op).toBe('open');
    expect(openMsg.to).toBe('WebView/42');
  });
});

  it('instance method call with sigil arg compiles', () => {
    expect(() => compile(`
      uses WebView(path: Text) {
        first: (selector : Text) -> (Anything)
      }
      ref view : WebView = WebView(path: "/my_view")
      @first = |selector : Text| {
        :result : Anything = view.first(:selector)
        result
      }
    `)).not.toThrow();
  });

  it('instance method call with sigil arg routes correctly', async () => {
    if (!isJs) return;
    const actor = await createActor(`
      uses WebView(path: Text) {
        first: (selector : Text) -> (Anything)
      }
      ref view : WebView = WebView(path: "/my_view")
      @first = |selector : Text| {
        :result : Anything = view.first(:selector)
        result
      }
    `);
    const newMsg = actor.posts[0];
    await actor.sendAsync({
      id: newMsg.id, re: {}, 'bv-a': 'self<WebView>', from: 'WebView/42',
    });

    await actor.sendAsync({ id: '1', op: [['#headline'], '@first'], from: 'caller', 'bv-a': [['Text']] });

    const firstMsg = actor.posts.find(p => p.to === 'WebView/42');
    expect(firstMsg).toBeDefined();
    expect(firstMsg.op).toEqual([{ selector: '#headline' }, 'first']);
    expect(firstMsg.to).toBe('WebView/42');
  });

// ═══════════════════════════════════════════════════════════════════════════════
// uses with constructor — ex (error) handling
// ═══════════════════════════════════════════════════════════════════════════════

describe('uses with constructor — error responses', () => {
  it('ex response to ::new does not crash the actor', async () => {
    if (!isJs) return;
    const actor = await createActor(`
      uses WebView(path: Text) {
        open: () -> (Text)
      }
      ref view : WebView = WebView(path: "/bad_path")
      @go = -> ok: "ready" as Text
    `);
    const newMsg = actor.posts[0];
    // Remote replies with an error instead of a success
    await actor.sendAsync({
      id: newMsg.id, ex: { error: 'bad path' },
    });
    // Actor should not crash — @go should still work
    await actor.sendAsync({ id: '1', op: '@go', from: 'caller' });
    const reply = actor.posts.find(p => p.to === 'caller');
    expect(reply).toBeDefined();
    expect(reply.re).toEqual({ ok: 'ready' });
  });

  it('ex response to instance method does not crash the actor', async () => {
    if (!isJs) return;
    const actor = await createActor(`
      uses WebView(path: Text) {
        open: () -> (Text)
      }
      ref view : WebView = WebView(path: "/my_view")
      @go
        =
        :status : Text = view.open()
        -> :status
    `);
    const newMsg = actor.posts[0];
    await actor.sendAsync({
      id: newMsg.id, re: {}, 'bv-a': 'self<WebView>', from: 'WebView/1',
    });
    await actor.sendAsync({ id: '1', op: '@go', from: 'caller' });
    const openMsg = actor.posts.find(p => p.to === 'WebView/1');
    // Remote replies with an error
    await actor.sendAsync({
      id: openMsg.id, ex: { open: 'error' },
    });
    // Actor should forward the error to the caller, not crash
    const reply = actor.posts.find(p => p.to === 'caller');
    expect(reply).toBeDefined();
    expect(reply.ex).toBeDefined();
  });
});
