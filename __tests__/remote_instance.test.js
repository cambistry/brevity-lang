import { createActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Remote instance — caller perspective
//
// When an actor has `ref view = WebView(path: "...")` at the top level
// (where WebView is a `uses` reference), actor initialization emits a
// ::new message on the wire. The reply carries the new instance's address
// in the `from` field, with bv-a: "self<Type>".
// Subsequent calls to the instance route to that address.
// ═══════════════════════════════════════════════════════════════════════════════

describe('remote instance — ::new at init', () => {
  it('actor init emits ::new with args to uses target', async () => {
    const actor = await createActor(`
      uses WebView

      ref view = WebView(path: "/my_view")

      @status = -> ok: "ready" as Text
    `);
    // ::new should have been emitted during construction
    expect(actor.posts[0]).toEqual(expect.objectContaining({
      op: [{ path: '/my_view' }, '::new'],
      to: 'WebView',
    }));
  });
});

describe('remote instance — method calls after init', () => {
  it('after ::new reply, method calls route to instance address', async () => {
    const actor = await createActor(`
      uses WebView

      ref view = WebView(path: "/my_view")

      @open = { view.open() . }
    `);
    // Reply to ::new — instance created at WebView/1
    const newMsg = actor.posts[0];
    await actor.sendAsync({
      id: newMsg.id,
      re: {},
      'bv-a': 'self<WebView>',
      from: 'WebView/1',
    });

    // Now call @open
    await actor.sendAsync({ id: '1', op: '@open', from: 'caller' });

    // open() should route to the instance address
    expect(actor.posts[1]).toEqual(expect.objectContaining({
      op: 'open',
      to: 'WebView/1',
    }));
  });
});

describe('remote instance — sequential calls to instance', () => {
  it('multiple method calls all route to same address', async () => {
    const actor = await createActor(`
      uses WebView

      ref view = WebView(path: "/panel")

      @workflow
        =
        view.open()
        :title : Text = view.getTitle()
        view.close()
        -> :title : Text
    `);
    // Reply to ::new
    const newMsg = actor.posts[0];
    await actor.sendAsync({
      id: newMsg.id,
      re: {},
      'bv-a': 'self<WebView>',
      from: 'WebView/42',
    });

    // Trigger @workflow
    await actor.sendAsync({ id: '1', op: '@workflow', from: 'caller' });

    // open() → WebView/42
    const openMsg = actor.posts[1];
    expect(openMsg).toEqual(expect.objectContaining({
      op: 'open',
      to: 'WebView/42',
    }));
    await actor.sendAsync({ id: openMsg.id, re: {} });

    // getTitle() → WebView/42
    const titleMsg = actor.posts[2];
    expect(titleMsg).toEqual(expect.objectContaining({
      op: 'getTitle',
      to: 'WebView/42',
    }));
    await actor.sendAsync({
      id: titleMsg.id,
      re: { title: 'My Page' },
      'bv-a': { title: 'Text' },
    });

    // close() → WebView/42
    const closeMsg = actor.posts[3];
    expect(closeMsg).toEqual(expect.objectContaining({
      op: 'close',
      to: 'WebView/42',
    }));
    await actor.sendAsync({ id: closeMsg.id, re: {} });

    // Final reply to caller
    expect(actor.posts[4]).toEqual(expect.objectContaining({
      id: '1',
      re: { title: 'My Page' },
      to: 'caller',
    }));
  });
});

describe('remote instance — multiple instances', () => {
  it('two refs at init produce independent addresses', async () => {
    const actor = await createActor(`
      uses WebView

      ref v1 = WebView(path: "/a")
      ref v2 = WebView(path: "/b")

      @open_both = {
        v1.open()
        v2.open()
        .
      }
    `);
    // Two ::new messages during init
    const new1 = actor.posts[0];
    expect(new1).toEqual(expect.objectContaining({
      op: [{ path: '/a' }, '::new'],
      to: 'WebView',
    }));
    const new2 = actor.posts[1];
    expect(new2).toEqual(expect.objectContaining({
      op: [{ path: '/b' }, '::new'],
      to: 'WebView',
    }));

    // Reply to both
    await actor.sendAsync({
      id: new1.id, re: {}, 'bv-a': 'self<WebView>', from: 'WebView/a1',
    });
    await actor.sendAsync({
      id: new2.id, re: {}, 'bv-a': 'self<WebView>', from: 'WebView/b1',
    });

    // Trigger @open_both
    await actor.sendAsync({ id: '1', op: '@open_both', from: 'caller' });

    // v1.open() → WebView/a1
    expect(actor.posts[2]).toEqual(expect.objectContaining({
      op: 'open', to: 'WebView/a1',
    }));
    await actor.sendAsync({ id: actor.posts[2].id, re: {} });

    // v2.open() → WebView/b1
    expect(actor.posts[3]).toEqual(expect.objectContaining({
      op: 'open', to: 'WebView/b1',
    }));
  });
});

describe('remote instance — named constructor args', () => {
  it('named args appear in ::new payload', async () => {
    const actor = await createActor(`
      uses Database

      ref db = Database(host: "localhost", port: 5432)

      @status = -> ok: "ready" as Text
    `);
    expect(actor.posts[0]).toEqual(expect.objectContaining({
      op: [{ host: 'localhost', port: 5432 }, '::new'],
      to: 'Database',
    }));
  });
});
