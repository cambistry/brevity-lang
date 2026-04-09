import { compileActor, createActor } from '../helpers.js';

const _target = globalThis.BREVITY_TARGET || process.env.BREVITY_TARGET || 'js';

// ═══════════════════════════════════════════════════════════════════════════════
// Remote instance — caller perspective
//
// When an actor has `view = *WebView(path: "...")` at the top level
// (where WebView is a declared dependency), actor initialization emits a
// ::new message on the wire. The reply carries the new instance's address
// in the `from` field, with bv-a: "self<Type>".
// Subsequent calls to the instance route to that address.
//
// JS: ::new fires during construction, captured in posts before sendAsync.
// Erlang/Rust: ::new fires when process starts (first sendAsync), reply
//   must be included in stdin. The ::new id is predictable (first send_seq).
// ═══════════════════════════════════════════════════════════════════════════════

// Shared fixture for single-view tests
const singleViewSource = `
  <
    "WebView": (WebView) <:path Text> -> {
      open: () -> .
      getTitle: () -> (:title Text)
      close: () -> .
    }
  >

  view = *WebView(path: "/my_view")

  @status = -> ok: "ready" as Text
  @open = { view.open() . }
  @workflow
    =
    view.open()
    title: Text = view.getTitle()
    view.close()
    -> :title as Text
`;

let singleViewCompiled;
beforeAll(async () => { singleViewCompiled = await compileActor(singleViewSource); });

describe('remote instance — ::new at init', () => {
  it('actor init emits ::new with args to declared dependency', async () => {
    const actor = await singleViewCompiled.spawn();
    if (_target === 'js') {
      // JS: ::new already in posts from construction
      expect(actor.posts[0]).toEqual(expect.objectContaining({
        op: [{ path: '/my_view' }, '::new'],
        to: 'WebView',
      }));
    } else {
      // Erlang/Rust: trigger process with ::new reply + a status call
      await actor.sendAsync({ id: '1', re: {}, 'bv-a': 'self<WebView>', from: 'WebView/1' });
      // The ::new message should be in the output
      expect(actor.posts[0]).toEqual(expect.objectContaining({
        op: [{ path: '/my_view' }, '::new'],
        to: 'WebView',
      }));
    }
  });
});

describe('remote instance — method calls after init', () => {
  it('after ::new reply, method calls route to instance address', async () => {
    const actor = await singleViewCompiled.spawn();
    if (_target === 'js') {
      const newMsg = actor.posts[0];
      expect(newMsg).toEqual(expect.objectContaining({
        op: [{ path: '/my_view' }, '::new'],
        to: 'WebView',
      }));
      await actor.sendAsync({
        id: newMsg.id, re: {}, 'bv-a': 'self<WebView>', from: 'WebView/1',
      });
      await actor.sendAsync({ id: '1', op: '@open', from: 'caller' });
      expect(actor.posts[1]).toEqual(expect.objectContaining({
        op: '@open', to: 'WebView/1',
      }));
    } else {
      // Send ::new reply + @open together
      await actor.sendAsync({ id: '1', re: {}, 'bv-a': 'self<WebView>', from: 'WebView/1' });
      await actor.sendAsync({ id: '2', op: '@open', from: 'caller' });
      // posts[0] = ::new outbound, posts[1] = open() to instance
      expect(actor.posts[0]).toEqual(expect.objectContaining({
        op: [{ path: '/my_view' }, '::new'], to: 'WebView',
      }));
      expect(actor.posts[1]).toEqual(expect.objectContaining({
        op: '@open', to: 'WebView/1',
      }));
    }
  });
});

describe('remote instance — sequential calls to instance', () => {
  it('multiple method calls all route to same address', async () => {
    const actor = await singleViewCompiled.spawn();
    if (_target === 'js') {
      const newMsg = actor.posts[0];
      await actor.sendAsync({
        id: newMsg.id, re: {}, 'bv-a': 'self<WebView>', from: 'WebView/42',
      });
      await actor.sendAsync({ id: '1', op: '@workflow', from: 'caller' });
      const openMsg = actor.posts[1];
      expect(openMsg).toEqual(expect.objectContaining({ op: '@open', to: 'WebView/42' }));
      await actor.sendAsync({ id: openMsg.id, re: {} });
      const titleMsg = actor.posts[2];
      expect(titleMsg).toEqual(expect.objectContaining({ op: '@getTitle', to: 'WebView/42' }));
      await actor.sendAsync({ id: titleMsg.id, re: { title: 'My Page' }, 'bv-a': { title: 'Text' } });
      const closeMsg = actor.posts[3];
      expect(closeMsg).toEqual(expect.objectContaining({ op: '@close', to: 'WebView/42' }));
      await actor.sendAsync({ id: closeMsg.id, re: {} });
      expect(actor.posts[4]).toEqual(expect.objectContaining({
        id: '1', re: { title: 'My Page' }, to: 'caller',
      }));
    } else {
      await actor.sendAsync({ id: '1', re: {}, 'bv-a': 'self<WebView>', from: 'WebView/42' });
      actor.send({ id: '100', op: '@workflow', from: 'caller' });
      actor.send({ id: '2', re: {} }); // reply to open
      actor.send({ id: '3', re: { title: 'My Page' }, 'bv-a': { title: 'Text' } }); // reply to getTitle
      await actor.sendAsync({ id: '4', re: {} }); // reply to close
      expect(actor.posts[0]).toEqual(expect.objectContaining({
        op: [{ path: '/my_view' }, '::new'], to: 'WebView',
      }));
      expect(actor.posts[1]).toEqual(expect.objectContaining({ op: '@open', to: 'WebView/42' }));
      expect(actor.posts[2]).toEqual(expect.objectContaining({ op: '@getTitle', to: 'WebView/42' }));
      expect(actor.posts[3]).toEqual(expect.objectContaining({ op: '@close', to: 'WebView/42' }));
      expect(actor.posts[4]).toEqual(expect.objectContaining({
        id: '100', re: { title: 'My Page' }, to: 'caller',
      }));
    }
  });
});

describe('remote instance — multiple instances', () => {
  it('two refs at init produce independent addresses', async () => {
    const actor = await createActor(`
      <
        "WebView": (WebView) <:path Text> -> { open: () -> . }
      >

      v1 = *WebView(path: "/a")
      v2 = *WebView(path: "/b")

      @open_both = {
        v1.open()
        v2.open()
        .
      }
    `);
    if (_target === 'js') {
      const new1 = actor.posts[0];
      expect(new1).toEqual(expect.objectContaining({
        op: [{ path: '/a' }, '::new'], to: 'WebView',
      }));
      const new2 = actor.posts[1];
      expect(new2).toEqual(expect.objectContaining({
        op: [{ path: '/b' }, '::new'], to: 'WebView',
      }));
      await actor.sendAsync({
        id: new1.id, re: {}, 'bv-a': 'self<WebView>', from: 'WebView/a1',
      });
      await actor.sendAsync({
        id: new2.id, re: {}, 'bv-a': 'self<WebView>', from: 'WebView/b1',
      });
      await actor.sendAsync({ id: '1', op: '@open_both', from: 'caller' });
      expect(actor.posts[2]).toEqual(expect.objectContaining({ op: '@open', to: 'WebView/a1' }));
      await actor.sendAsync({ id: actor.posts[2].id, re: {} });
      expect(actor.posts[3]).toEqual(expect.objectContaining({ op: '@open', to: 'WebView/b1' }));
    } else {
      // ::new replies for both, then @open_both + open replies
      // send_seq: 1=v1::new, 2=v2::new, 3=v1.open, 4=v2.open
      actor.send({ id: '1', re: {}, 'bv-a': 'self<WebView>', from: 'WebView/a1' });
      actor.send({ id: '2', re: {}, 'bv-a': 'self<WebView>', from: 'WebView/b1' });
      actor.send({ id: '100', op: '@open_both', from: 'caller' });
      actor.send({ id: '3', re: {} }); // reply to v1.open
      await actor.sendAsync({ id: '4', re: {} }); // reply to v2.open
      expect(actor.posts[0]).toEqual(expect.objectContaining({
        op: [{ path: '/a' }, '::new'], to: 'WebView',
      }));
      expect(actor.posts[1]).toEqual(expect.objectContaining({
        op: [{ path: '/b' }, '::new'], to: 'WebView',
      }));
      expect(actor.posts[2]).toEqual(expect.objectContaining({ op: '@open', to: 'WebView/a1' }));
      expect(actor.posts[3]).toEqual(expect.objectContaining({ op: '@open', to: 'WebView/b1' }));
    }
  });
});

describe('remote instance — named constructor args', () => {
  it('named args appear in ::new payload', async () => {
    const actor = await createActor(`
      <
        "Database": (Database) <:host Text, :port Integer> -> { ping: () -> . }
      >

      db = *Database(host: "localhost", port: 5432)

      @status = -> ok: "ready" as Text
    `);
    if (_target === 'js') {
      expect(actor.posts[0]).toEqual(expect.objectContaining({
        op: [{ host: 'localhost', port: 5432 }, '::new'],
        to: 'Database',
      }));
    } else {
      await actor.sendAsync({ id: '1', re: {}, 'bv-a': 'self<Database>', from: 'Database/1' });
      expect(actor.posts[0]).toEqual(expect.objectContaining({
        op: [{ host: 'localhost', port: 5432 }, '::new'],
        to: 'Database',
      }));
    }
  });
});
