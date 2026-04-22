import { loadTestPage as loadPage } from '../../src/codegen/browser/harness.js';

// ═══════════════════════════════════════════════════════════════════════════════
// DOM subscribes to address children — Layer A Phase 4.
//
// When DOM.div receives `new` with payload children that include an address
// like `"<<pub @0>>"`, it walks the array:
//   - Text string  → append as a text node (existing behavior).
//   - `<<addr>>` address form → create a text node, post `subscribe` to the
//     address (converting the payload's space-inside-angles form to the to-
//     field convention `<<alias>> selector`), and route incoming `re` values
//     to that text node.
//
// The discriminator is the `<<…>>` delimiter itself (per the CAM address
// convention), not bv-a or any out-of-band hint.
//
// Test assumptions:
//   - DOM's subscribe-outbound uses `to: "<<alias>> selector"` form — the
//     existing refactor convention for routing. The payload form
//     `<<alias selector>>` (space-inside-angles) gets decomposed by DOM
//     into the routing form.
//   - DOM's subscribe-outbound carries `from: <element-addr>` so replies
//     route back to the element's handler. The element handler matches
//     incoming `re` by subscription id and updates the corresponding text
//     node.
//
// ═══════════════════════════════════════════════════════════════════════════════

async function expectBehavior(actor, ...steps) {
  let postIndex = actor.posts.length;
  for (const step of steps) {
    if (step.input) await actor.sendAsync(step.input);
    else if (step.output) {
      expect(actor.posts[postIndex]).toEqual(step.output);
      postIndex++;
    }
  }
}

const html = `<html><head>
  <script type="module" src="/src/codegen/browser/brevity.js"></script>
  </head><body></body></html>`;

describe('DOM element — subscribes to address children', () => {
  // ── Baseline: static text children still work (regression) ───────────────
  it('new with only text children emits no subscribe (baseline)', async () => {
    const page = await loadPage(html);
    const dom = await page.connectActor('DOM.div');

    await dom.sendAsync({ id: '1', op: [{ children: ['Hello'] }, 'new'], from: 'caller' });

    // No subscribe should be posted for purely-static children.
    expect(dom.posts.some(m => m.op === 'subscribe')).toBe(false);
    // Element address should be returned.
    expect(dom.posts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1', re: '<<DOM.div/1>>' }),
    ]));
  });

  // ── Core: new with address child posts subscribe ─────────────────────────
  it('new with <<alias sel>> child posts subscribe to <<alias>> sel', async () => {
    const page = await loadPage(html);
    const pubPosts = [];
    await page.register('pub', msg => pubPosts.push(msg));
    const dom = await page.connectActor('DOM.div');

    await dom.sendAsync({ id: '1', op: [{ children: ['<<pub @0>>'] }, 'new'], from: 'caller' });

    // DOM should have routed a subscribe to pub (alias-stripped; `to` becomes
    // the bare selector the recipient sees).
    expect(pubPosts).toHaveLength(1);
    expect(pubPosts[0]).toEqual(expect.objectContaining({
      op: 'subscribe',
      to: '@0',
      from: 'DOM.div/1',
    }));
    expect(typeof pubPosts[0].id).toBe('string');
    expect(pubPosts[0].id.length).toBeGreaterThan(0);
    // Element address reply still happens.
    expect(dom.posts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1', re: '<<DOM.div/1>>' }),
    ]));
  });

  // ── Incoming re on element address updates text content ──────────────────
  it('re arriving at the element address updates text content', async () => {
    const page = await loadPage(html);
    const pubPosts = [];
    await page.register('pub', msg => pubPosts.push(msg));
    const dom = await page.connectActor('DOM.div');

    await dom.sendAsync({ id: '1', op: [{ children: ['<<pub @0>>'] }, 'new'], from: 'caller' });

    const sub = pubPosts[0];
    expect(sub).toBeDefined();

    // Simulate publisher replying with initial value. Reply addressed to the
    // element address (DOM.div/1 — what DOM used as the subscribe's from),
    // carrying the sub-id so the element handler can route to the right text
    // node.
    await page.send({ id: sub.id, re: ['initial'], to: 'DOM.div/1', from: 'pub' });

    // Element text should now be 'initial'.
    const el = await page.connectActor('DOM.div/1');
    await expectBehavior(el,
      { input: { id: 'q1', op: '@innerHTML' } },
      { output: expect.objectContaining({ re: 'initial' }) },
    );
  });

  // ── Subsequent re values replay to the same text node ────────────────────
  it('multiple re values each update the same text node', async () => {
    const page = await loadPage(html);
    const pubPosts = [];
    await page.register('pub', msg => pubPosts.push(msg));
    const dom = await page.connectActor('DOM.div');

    await dom.sendAsync({ id: '1', op: [{ children: ['<<pub @0>>'] }, 'new'], from: 'caller' });

    const sub = pubPosts[0];
    const el = await page.connectActor('DOM.div/1');

    await page.send({ id: sub.id, re: ['first'], to: 'DOM.div/1', from: 'pub' });
    await expectBehavior(el,
      { input: { id: 'q1', op: '@innerHTML' } },
      { output: expect.objectContaining({ re: 'first' }) },
    );

    await page.send({ id: sub.id, re: ['second'], to: 'DOM.div/1', from: 'pub' });
    await expectBehavior(el,
      { input: { id: 'q2', op: '@innerHTML' } },
      { output: expect.objectContaining({ re: 'second' }) },
    );
  });

  // ── Mixed children: text stays, address dynamically updates ──────────────
  it('mixed static/dynamic children interleave in element text', async () => {
    const page = await loadPage(html);
    const pubPosts = [];
    await page.register('pub', msg => pubPosts.push(msg));
    const dom = await page.connectActor('DOM.div');

    await dom.sendAsync({
      id: '1',
      op: [{ children: ['pre ', '<<pub @0>>', ' post'] }, 'new'],
      from: 'caller',
    });

    expect(pubPosts).toHaveLength(1);
    const sub = pubPosts[0];

    const el = await page.connectActor('DOM.div/1');
    await page.send({ id: sub.id, re: ['middle'], to: 'DOM.div/1', from: 'pub' });

    await expectBehavior(el,
      { input: { id: 'q1', op: '@innerHTML' } },
      { output: expect.objectContaining({ re: 'pre middle post' }) },
    );
  });

  // ── Multiple dynamic children each get their own subscribe ───────────────
  it('two address children produce two independent subscribes', async () => {
    const page = await loadPage(html);
    const pubPosts = [];
    await page.register('pub', msg => pubPosts.push(msg));
    const dom = await page.connectActor('DOM.div');

    await dom.sendAsync({
      id: '1',
      op: [{ children: ['<<pub @0>>', ' — ', '<<pub @1>>'] }, 'new'],
      from: 'caller',
    });

    expect(pubPosts).toHaveLength(2);
    expect(pubPosts[0].to).toBe('@0');
    expect(pubPosts[1].to).toBe('@1');
    // Sub ids must be distinct so each text node is addressable independently.
    expect(pubPosts[0].id).not.toBe(pubPosts[1].id);

    const el = await page.connectActor('DOM.div/1');
    await page.send({ id: pubPosts[0].id, re: ['left'], to: 'DOM.div/1', from: 'pub' });
    await page.send({ id: pubPosts[1].id, re: ['right'], to: 'DOM.div/1', from: 'pub' });

    await expectBehavior(el,
      { input: { id: 'q1', op: '@innerHTML' } },
      { output: expect.objectContaining({ re: 'left — right' }) },
    );
  });
});
