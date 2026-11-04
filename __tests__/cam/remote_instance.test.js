import { createActor, expectActorBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Remote actor — caller perspective
//
// When an actor has `view = *WebView(path: "...")` at the top level
// (where WebView is a declared dependency), actor initialization emits a
// `new` message on the wire. The reply carries the new actor's address
// in angle-delimited `re`, with ty: "Type" (no brackets).
// Subsequent calls to the actor route to that address.
//
// Each test asserts the construction `new` outbound directly via
// `createActor`'s `expects` step list (cursor at 0, so file-init emissions
// are visible). Behavior after construction is asserted via
// `expectActorBehavior` (cursor at posts.length), which sends the `new`
// reply that supplies the actor address and then exercises the actor.
// ═══════════════════════════════════════════════════════════════════════════════

const singleViewSource = `
  *
    "WebView": WebView (path: Text) -> *{
      open. () => .
      getTitle () -> (title: Text)
      close. () => .
    }
  *

  view = *WebView(path: "/my_view")

  @status = -> ok: "ready"
  @open. = { view.open.()... }
  @workflow!
    =
    view.open.()...
    title: Text = view.getTitle()
    view.close.()...
    return :title
`;

describe('remote actor — method calls after init', () => {
  it('`new` emits at init, then method calls route to actor address', async () => {
    const actor = await createActor(singleViewSource, {
      expects: [
        { output: expect.objectContaining({ op: [{ path: '/my_view' }, '#new'], to: 'WebView' }) },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<WebView/1>', 'ty': 'WebView', from: 'WebView' } },
      { input: { id: '99', op: '@open.', from: 'caller' } },
      { output: expect.objectContaining({ op: '@open.', to: 'WebView/1' }) },
    );
  });
});

describe('remote actor — sequential calls to actor', () => {
  it('multiple method calls all route to same address', async () => {
    const actor = await createActor(singleViewSource, {
      expects: [
        { output: expect.objectContaining({ op: [{ path: '/my_view' }, '#new'], to: 'WebView' }) },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<WebView/42>', 'ty': 'WebView', from: 'WebView' } },
      { input: { id: '100', op: '@workflow!', from: 'caller' } },
      // `open.` and `close.` are silent: nothing replies, and nothing waits.
      { output: expect.objectContaining({ op: '@open.', to: 'WebView/42' }) },
      { output: expect.objectContaining({ op: '@getTitle', to: 'WebView/42' }) },
      { input: { id: '3', re: { title: 'My Page' }, 'ty': { title: 'Text' } } }, // reply to getTitle
      { output: expect.objectContaining({ op: '@close.', to: 'WebView/42' }) },
      { output: expect.objectContaining({ id: '100', re: { title: 'My Page' }, to: 'caller' }) },
    );
  });
});

// A call used as a statement waits for its reply. While it waits, the actor answers
// other messages, so a bump that arrives first is seen by the waiting handler.
describe('a call used as a statement waits for its reply', () => {
  const script = `
    *
      "svc.bv": Svc {
        ping! () => self
      }
    *
    n *Integer = 0
    @bump! = { n <- n + 1 }
    @go! = {
      Svc.ping!()
      return n
    }
  `;

  it('and returns only once the reply comes', async () => {
    const actor = await createActor(script);
    await expectActorBehavior(actor,
      { input: { id: '1', op: '@go!', from: 'c' } },
      { output: expect.objectContaining({ id: '1', op: '@ping!', to: 'Svc' }) },
      { input: { id: '2', op: '@bump!', from: 'c' } },
      { output: expect.objectContaining({ id: '2', to: 'c' }) },
      { input: { id: '1', re: '#<Svc>', from: 'Svc' } },
      { output: { id: '1', re: [1], 'ty': ['Integer'], to: 'c' } },
    );
  });
});

describe('a call that doesn\'t wait for a reply', () => {
  const script = `
    *
      "svc.bv": Svc {
        log (Text) => .
        ping! () => self
      }
    *
    @go! = {
      Svc.log("x")...
      Svc.ping!()...
      return 1
    }
    W = *{
      @go! = {
        Svc.log("y")...
        return 2
      }
    }
    @inClass! = {
      w = W()
      n Integer = w.go!()
      return n
    }
  `;

  it('a doc\'s silent function, and a launched one, don\'t wait', async () => {
    const actor = await createActor(script);
    await expectActorBehavior(actor,
      { input: { id: '1', op: '@go!', from: 'c' } },
      { output: expect.objectContaining({ op: [['x'], '@log'], to: 'Svc' }) },
      { output: expect.objectContaining({ op: '@ping!', to: 'Svc' }) },
      { output: { id: '1', re: [1], 'ty': ['Integer'], to: 'c' } },
    );
  });

  it('nor from a class', async () => {
    const actor = await createActor(script);
    await expectActorBehavior(actor,
      { input: { id: '1', op: '@inClass!', from: 'c' } },
      { output: expect.objectContaining({ op: [['y'], '@log'], to: 'Svc' }) },
      { output: { id: '1', re: [2], 'ty': ['Integer'], to: 'c' } },
    );
  });
});

describe('remote actor — a reply nobody is waiting for', () => {
  it('is ignored, and the actor carries on', async () => {
    const actor = await createActor(singleViewSource, {
      expects: [
        { output: expect.objectContaining({ op: [{ path: '/my_view' }, '#new'], to: 'WebView' }) },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<WebView/42>', 'ty': 'WebView', from: 'WebView' } },
      { input: { id: '77', re: {}, from: 'WebView/42' } },
      { input: { id: '100', op: '@status', from: 'caller' } },
      { output: expect.objectContaining({ id: '100', re: { ok: 'ready' }, to: 'caller' }) },
    );
  });
});

describe('remote actor — multiple actors', () => {
  it('two refs at init produce independent addresses', async () => {
    const actor = await createActor(`
      *
        "WebView": WebView (path: Text) -> *{
          open () -> (ok: Text)
        }
      *

      v1 = *WebView(path: "/a")
      v2 = *WebView(path: "/b")

      @open_a
        =
        :ok Text = v1.open()
        return :ok
      @open_b
        =
        :ok Text = v2.open()
        return :ok
    `, {
      expects: [
        { output: expect.objectContaining({ op: [{ path: '/a' }, '#new'], to: 'WebView' }) },
        { output: expect.objectContaining({ op: [{ path: '/b' }, '#new'], to: 'WebView' }) },
      ],
    });
    await expectActorBehavior(actor,
      // Replies in seq order: id '1' = v1, id '2' = v2
      { input: { id: '1', re: '#<WebView/a1>', 'ty': 'WebView', from: 'WebView' } },
      { input: { id: '2', re: '#<WebView/b1>', 'ty': 'WebView', from: 'WebView' } },
      // v1
      { input: { id: '10', op: '@open_a', from: 'caller' } },
      { output: expect.objectContaining({ op: '@open', to: 'WebView/a1' }) },
      { input: { id: '3', re: { ok: 'A' } } },
      { output: expect.objectContaining({ id: '10', re: { ok: 'A' }, to: 'caller' }) },
      // v2
      { input: { id: '20', op: '@open_b', from: 'caller' } },
      { output: expect.objectContaining({ op: '@open', to: 'WebView/b1' }) },
      { input: { id: '4', re: { ok: 'B' } } },
      { output: expect.objectContaining({ id: '20', re: { ok: 'B' }, to: 'caller' }) },
    );
  });
});

describe('remote actor — named class args', () => {
  it('named class args appear in `new` and routed calls reach the actor', async () => {
    const actor = await createActor(`
      *
        "Database": Database (host: Text, port: Integer) -> *{
          ping () -> (ok: Text)
        }
      *

      db = *Database(host: "localhost", port: 5432)

      @ping
        =
        :ok Text = db.ping()
        return :ok
    `, {
      expects: [
        { output: expect.objectContaining({
          op: [{ host: 'localhost', port: 5432 }, '#new'],
          to: 'Database',
        }) },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<Database/1>', 'ty': 'Database', from: 'Database' } },
      { input: { id: '99', op: '@ping', from: 'caller' } },
      { output: expect.objectContaining({ op: '@ping', to: 'Database/1' }) },
      { input: { id: '2', re: { ok: 'pong' } } },
      { output: expect.objectContaining({ id: '99', re: { ok: 'pong' }, to: 'caller' }) },
    );
  });
});
