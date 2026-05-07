import { createActor, expectActorBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Remote instance — caller perspective
//
// When an actor has `view = WebView!(path: "...")` at the top level
// (where WebView is a declared dependency), actor initialization emits a
// `new` message on the wire. The reply carries the new instance's address
// in angle-delimited `re`, with bv-a: "#<Type>".
// Subsequent calls to the instance route to that address.
//
// Each test asserts the construction `new` outbound directly via
// `createActor`'s `expects` step list (cursor at 0, so file-init emissions
// are visible). Behavior after construction is asserted via
// `expectActorBehavior` (cursor at posts.length), which sends the `new`
// reply that supplies the instance address and then exercises the actor.
// ═══════════════════════════════════════════════════════════════════════════════

const singleViewSource = `
  *(
    "WebView": (WebView) *(:path Text) -> {
      open: () -> .
      getTitle: () -> (:title Text)
      close: () -> .
    }
  )
  =

  view = WebView!(path: "/my_view")

  @status = -> ok: "ready"
  @open = { view.open() . }
  @workflow
    =
    view.open()
    title: Text = view.getTitle()
    view.close()
    -> :title
`;

describe('remote instance — method calls after init', () => {
  it('`new` emits at init, then method calls route to instance address', async () => {
    const actor = await createActor(singleViewSource, {
      expects: [
        { output: expect.objectContaining({ op: [{ path: '/my_view' }, '#new'], to: 'WebView' }) },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<WebView/1>', 'bv-a': '#<WebView>', from: 'WebView' } },
      { input: { id: '99', op: '@open', from: 'caller' } },
      { output: expect.objectContaining({ op: '@open', to: 'WebView/1' }) },
    );
  });
});

describe('remote instance — sequential calls to instance', () => {
  it('multiple method calls all route to same address', async () => {
    const actor = await createActor(singleViewSource, {
      expects: [
        { output: expect.objectContaining({ op: [{ path: '/my_view' }, '#new'], to: 'WebView' }) },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<WebView/42>', 'bv-a': '#<WebView>', from: 'WebView' } },
      { input: { id: '100', op: '@workflow', from: 'caller' } },
      { output: expect.objectContaining({ op: '@open', to: 'WebView/42' }) },
      { input: { id: '2', re: {} } }, // reply to open
      { output: expect.objectContaining({ op: '@getTitle', to: 'WebView/42' }) },
      { input: { id: '3', re: { title: 'My Page' }, 'bv-a': { title: 'Text' } } }, // reply to getTitle
      { output: expect.objectContaining({ op: '@close', to: 'WebView/42' }) },
      { input: { id: '4', re: {} } }, // reply to close
      { output: expect.objectContaining({ id: '100', re: { title: 'My Page' }, to: 'caller' }) },
    );
  });
});

describe('remote instance — multiple instances', () => {
  it('two refs at init produce independent addresses', async () => {
    const actor = await createActor(`
      *(
        "WebView": (WebView) *(:path Text) -> {
          open: () -> (:ok Text)
        }
      )
      =

      v1 = WebView!(path: "/a")
      v2 = WebView!(path: "/b")

      @open_a
        =
        :ok Text = v1.open()
        -> :ok
      @open_b
        =
        :ok Text = v2.open()
        -> :ok
    `, {
      expects: [
        { output: expect.objectContaining({ op: [{ path: '/a' }, '#new'], to: 'WebView' }) },
        { output: expect.objectContaining({ op: [{ path: '/b' }, '#new'], to: 'WebView' }) },
      ],
    });
    await expectActorBehavior(actor,
      // Replies in seq order: id '1' = v1, id '2' = v2
      { input: { id: '1', re: '#<WebView/a1>', 'bv-a': '#<WebView>', from: 'WebView' } },
      { input: { id: '2', re: '#<WebView/b1>', 'bv-a': '#<WebView>', from: 'WebView' } },
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

describe('remote instance — named constructor args', () => {
  it('named ctor args appear in `new` and routed calls reach the instance', async () => {
    const actor = await createActor(`
      *(
        "Database": (Database) *(:host Text, :port Integer) -> {
          ping: () -> (:ok Text)
        }
      )
      =

      db = Database!(host: "localhost", port: 5432)

      @ping
        =
        :ok Text = db.ping()
        -> :ok
    `, {
      expects: [
        { output: expect.objectContaining({
          op: [{ host: 'localhost', port: 5432 }, '#new'],
          to: 'Database',
        }) },
      ],
    });
    await expectActorBehavior(actor,
      { input: { id: '1', re: '#<Database/1>', 'bv-a': '#<Database>', from: 'Database' } },
      { input: { id: '99', op: '@ping', from: 'caller' } },
      { output: expect.objectContaining({ op: '@ping', to: 'Database/1' }) },
      { input: { id: '2', re: { ok: 'pong' } } },
      { output: expect.objectContaining({ id: '99', re: { ok: 'pong' }, to: 'caller' }) },
    );
  });
});
