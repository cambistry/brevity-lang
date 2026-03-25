import compile from '../../index.js';
import { createActor } from '../helpers.js';

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

  it('after ::new reply, instance method routes to returned address', async () => {
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
