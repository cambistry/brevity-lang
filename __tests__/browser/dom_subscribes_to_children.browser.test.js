import { loadTestPage as loadPage } from '../../src/codegen/browser/harness.js';

// ═══════════════════════════════════════════════════════════════════════════════
// DOM subscribes to address tokens in inner_html — Layer A Phase 4.
//
// When DOM @div receives `new` with an `inner_html` payload that contains
// `<<…>>` tokens, it parses the markup and:
//   - Static subtrees (no `<<…>>`) → native DOM (innerHTML / appendChild).
//   - Text runs containing `<<addr>>` tokens → split into text nodes; for
//     each token, create an empty text node, post `subscribe` to the
//     address (converting payload space-inside-angles form `<<alias sel>>`
//     to the routing form `<<alias>> sel`), and route incoming `re` to
//     that text node.
//   - Nested elements whose subtree contains `<<…>>` → recursive dispatch
//     to the appropriate `DOM @<tag>` with the child's inner_html.
//
// The discriminator is the `<<…>>` delimiter itself (per the CAM address
// convention), not bv-a or any out-of-band hint.
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

describe('DOM element — subscribes to address tokens in inner_html', () => {
  // ── Baseline: pure-static inner_html still works (regression) ────────────
  it('new with static-only inner_html emits no subscribe (baseline)', async () => {
    const page = await loadPage(html);
    const dom = await page.connectActor('DOM @div');

    await dom.sendAsync({ id: '1', op: [{ inner_html: 'Hello' }, 'new'], from: 'caller' });

    // No subscribe should be posted for purely-static inner_html.
    expect(dom.posts.some(m => m.op === 'subscribe')).toBe(false);
    // Element address should be returned.
    expect(dom.posts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1', re: '<<DOM @div/1>>' }),
    ]));
  });

  // ── Core: new with address token posts subscribe ─────────────────────────
  it('new with inner_html "<<alias sel>>" posts subscribe to <<alias>> sel', async () => {
    const page = await loadPage(html);
    const pubPosts = [];
    await page.register('pub', msg => pubPosts.push(msg));
    const dom = await page.connectActor('DOM @div');

    await dom.sendAsync({ id: '1', op: [{ inner_html: '<<pub @0>>' }, 'new'], from: 'caller' });

    // DOM should have routed a subscribe to pub (alias-stripped; `to` becomes
    // the bare selector the recipient sees).
    expect(pubPosts).toHaveLength(1);
    expect(pubPosts[0]).toEqual(expect.objectContaining({
      op: 'subscribe',
      to: '@0',
      from: 'DOM @div/1',
    }));
    expect(typeof pubPosts[0].id).toBe('string');
    expect(pubPosts[0].id.length).toBeGreaterThan(0);
    // Element address reply still happens.
    expect(dom.posts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1', re: '<<DOM @div/1>>' }),
    ]));
  });

  // ── Incoming re on element address updates text content ──────────────────
  it('re arriving at the element address updates text content', async () => {
    const page = await loadPage(html);
    const pubPosts = [];
    await page.register('pub', msg => pubPosts.push(msg));
    const dom = await page.connectActor('DOM @div');

    await dom.sendAsync({ id: '1', op: [{ inner_html: '<<pub @0>>' }, 'new'], from: 'caller' });

    const sub = pubPosts[0];
    expect(sub).toBeDefined();

    // Simulate publisher replying with initial value. Reply addressed to the
    // element address (DOM @div/1 — what DOM used as the subscribe's from),
    // carrying the sub-id so the element handler can route to the right text
    // node.
    await page.send({ id: sub.id, re: ['initial'], to: 'DOM @div/1', from: 'pub' });

    // Element text should now be 'initial'.
    const el = await page.connectActor('DOM @div/1');
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
    const dom = await page.connectActor('DOM @div');

    await dom.sendAsync({ id: '1', op: [{ inner_html: '<<pub @0>>' }, 'new'], from: 'caller' });

    const sub = pubPosts[0];
    const el = await page.connectActor('DOM @div/1');

    await page.send({ id: sub.id, re: ['first'], to: 'DOM @div/1', from: 'pub' });
    await expectBehavior(el,
      { input: { id: 'q1', op: '@innerHTML' } },
      { output: expect.objectContaining({ re: 'first' }) },
    );

    await page.send({ id: sub.id, re: ['second'], to: 'DOM @div/1', from: 'pub' });
    await expectBehavior(el,
      { input: { id: 'q2', op: '@innerHTML' } },
      { output: expect.objectContaining({ re: 'second' }) },
    );
  });

  // ── Mixed inner_html: text stays, address dynamically updates ────────────
  it('mixed static/dynamic inner_html interleaves in element text', async () => {
    const page = await loadPage(html);
    const pubPosts = [];
    await page.register('pub', msg => pubPosts.push(msg));
    const dom = await page.connectActor('DOM @div');

    await dom.sendAsync({
      id: '1',
      op: [{ inner_html: 'pre <<pub @0>> post' }, 'new'],
      from: 'caller',
    });

    expect(pubPosts).toHaveLength(1);
    const sub = pubPosts[0];

    const el = await page.connectActor('DOM @div/1');
    await page.send({ id: sub.id, re: ['middle'], to: 'DOM @div/1', from: 'pub' });

    await expectBehavior(el,
      { input: { id: 'q1', op: '@innerHTML' } },
      { output: expect.objectContaining({ re: 'pre middle post' }) },
    );
  });

  // ── Multiple dynamic tokens each get their own subscribe ─────────────────
  it('two address tokens in inner_html produce two independent subscribes', async () => {
    const page = await loadPage(html);
    const pubPosts = [];
    await page.register('pub', msg => pubPosts.push(msg));
    const dom = await page.connectActor('DOM @div');

    await dom.sendAsync({
      id: '1',
      op: [{ inner_html: '<<pub @0>> — <<pub @1>>' }, 'new'],
      from: 'caller',
    });

    expect(pubPosts).toHaveLength(2);
    expect(pubPosts[0].to).toBe('@0');
    expect(pubPosts[1].to).toBe('@1');
    // Sub ids must be distinct so each text node is addressable independently.
    expect(pubPosts[0].id).not.toBe(pubPosts[1].id);

    const el = await page.connectActor('DOM @div/1');
    await page.send({ id: pubPosts[0].id, re: ['left'], to: 'DOM @div/1', from: 'pub' });
    await page.send({ id: pubPosts[1].id, re: ['right'], to: 'DOM @div/1', from: 'pub' });

    await expectBehavior(el,
      { input: { id: 'q1', op: '@innerHTML' } },
      { output: expect.objectContaining({ re: 'left — right' }) },
    );
  });
});
