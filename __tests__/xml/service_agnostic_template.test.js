import { compileActor, expectActorBehavior } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════
// Service-agnostic XML templating (js / rust / erlang).
//
// An XML element `<tag …>…</tag>` is a LANGUAGE form, not a DOM form. It lowers
// to a single CAM message: the generic `#new` construction op, a structured
// Object payload `{children: [...], ...attrs}`, sent to the element factory
// address of *whatever service the tag was imported from*. There is no DOM, no
// browser, and — crucially — no hard-coded `HTML` anywhere in the language: the
// host service name comes from the author's DI import.
//
// These tests prove that by using fully fictional host services (`Scene`,
// `Canvas`) and asserting the behaviour is parametric in the service name: the
// SAME template body routes to `Scene @node` or `Canvas @node` purely by its
// import. If the language still privileged `HTML`, one of these would throw (the
// validate gate) or mis-route (`HTML @node`).
//
// A reactive hole `{expr}` in the template becomes a local-form lambda
// reference `#<@N>` carried in the payload — a lambda passed BY REFERENCE to the
// host service. The service invokes it back through CAM (the same mechanism as
// lambda_ref_invocation.test.js, here via the template carrier), and the actor
// replies with the live value.
// ═══════════════════════════════════════════════════════════════════════════

// A fictional host service exporting one element factory, `node`. The signature
// is a placeholder — element construction uses the generic `#new` op, not this
// method — it exists only so the `(:node)` destructure resolves.
const HOST = `{
  node: (Anything) -> (Anything)
}`;

// ── The de-coupling proof: addressing tracks the imported service name ────────

describe('service-agnostic templating — `#new` routes to the imported service', () => {
  it('routes to `Scene @node` when the tag is imported from Scene', async () => {
    const src = `
      *( "Scene": (:node) )
      =
      @build = { <node x="1">hello</node> . }
    `;
    const actor = await (await compileActor(src, { compileOptions: { remotes: [{ path: 'Scene', service: HOST }] } })).spawn();
    await expectActorBehavior(actor,
      { input: { id: '1', op: '@build', from: 'caller' } },
      { output: { id: expect.any(String), op: [{ children: ['hello'], x: '1' }, '#new'], to: 'Scene @node' } },
    );
  });

  it('routes the SAME template body to `Canvas @node` when imported from Canvas', async () => {
    const src = `
      *( "Canvas": (:node) )
      =
      @build = { <node x="1">hello</node> . }
    `;
    const actor = await (await compileActor(src, { compileOptions: { remotes: [{ path: 'Canvas', service: HOST }] } })).spawn();
    await expectActorBehavior(actor,
      { input: { id: '1', op: '@build', from: 'caller' } },
      { output: { id: expect.any(String), op: [{ children: ['hello'], x: '1' }, '#new'], to: 'Canvas @node' } },
    );
  });

  it('routes a nested child element to the host service too', async () => {
    const src = `
      *( "Scene": (:node, :leaf) )
      =
      @build = { <node><leaf>deep</leaf></node> . }
    `;
    const actor = await (await compileActor(src, { compileOptions: { remotes: [{ path: 'Scene', service: `{
      node: (Anything) -> (Anything)
      leaf: (Anything) -> (Anything)
    }` }] } })).spawn();
    await actor.sendAsync({ id: '1', op: '@build', from: 'caller' });
    // The inner <leaf> is pre-dispatched as its own #new to `Scene @leaf`; the
    // outer <node> #new awaits that child's address before it can fire, so with
    // no service answering, only the child send is observable here. That it
    // routes to the imported host (not a privileged `HTML`) is the point.
    const leafSend = actor.posts.find(p => Array.isArray(p.op) && p.op[1] === '#new' && p.to === 'Scene @leaf');
    expect(leafSend).toBeTruthy();
    expect(leafSend.op[0]).toEqual({ children: ['deep'] });
  });
});

// ── Lambda by reference, through the template, invoked back over CAM ───────────

describe('service-agnostic templating — reactive hole is a lambda ref invoked over CAM', () => {
  const src = `
    *( "Scene": (:node) )
    =
    status *Text = "ready"
    @build = { <node label={ status }>x</node> . }
  `;
  const remotes = [{ path: 'Scene', service: HOST }];

  it('carries the reactive hole to the host service as a local-form lambda ref', async () => {
    const actor = await (await compileActor(src, { compileOptions: { remotes } })).spawn();
    await actor.sendAsync({ id: '1', op: '@build', from: 'caller' });
    const post = actor.posts.find(p => Array.isArray(p.op) && p.op[1] === '#new');
    expect(post.to).toBe('Scene @node');
    expect(post.op[0].label).toMatch(/^#<@\d+>$/);
  });

  it('runs the reactive lambda when the host invokes the reference through CAM', async () => {
    const actor = await (await compileActor(src, { compileOptions: { remotes } })).spawn();
    await actor.sendAsync({ id: '1', op: '@build', from: 'caller' });
    const post = actor.posts.find(p => Array.isArray(p.op) && p.op[1] === '#new');
    const selector = post.op[0].label.slice(2, -1); // '#<@0>' → '@0'

    const before = actor.posts.length;
    // Host promoted our #<@N> to a full address and now invokes the callback
    // through CAM (no args — a reactive read). The actor replies with the value.
    await actor.sendAsync({ id: '9', op: [[], selector], to: `#<here ${selector}>`, from: 'Scene' });
    const fired = actor.posts.slice(before);
    expect(fired).toContainEqual(
      expect.objectContaining({ re: ['ready'], to: 'Scene' }),
    );
  });
});
