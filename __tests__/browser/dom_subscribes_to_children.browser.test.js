import { loadTestPage as loadPage } from '../../src/codegen/browser/harness.js';

// ═══════════════════════════════════════════════════════════════════════════════
// HTML element — subscribes to address tokens in `:children`
//
// When HTML @div receives `new` with a `:children` array, it walks each
// entry:
//   - Bare text run → text node.
//   - `#<HTML tag N>` token referencing an already-live element →
//     appendChild that element.
//   - `#<actor @N>` token referencing a closure → empty text node + post
//     `subscribe` to the address; subsequent `re` replies update the text
//     node.
//
// The discriminator is the `#<…>` delimiter itself (per the CAM address
// convention), not ty or any out-of-band hint.
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

describe('HTML element — subscribes to address tokens in :children', () => {
  // ── Baseline: pure-static children produce no subscribe ─────────────────
  it('new with static-only children emits no subscribe (baseline)', async () => {
    const page = await loadPage(html);
    const dom = await page.connectActor('HTML div');

    await dom.sendAsync({ id: '1', op: [{ children: ['Hello'] }, '$new'], from: 'caller' });

    expect(dom.posts.some(m => m.op === '$subscribe')).toBe(false);
    expect(dom.posts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1', re: '#<HTML div 1>' }),
    ]));
  });

  // ── Core: child token posts subscribe ───────────────────────────────────
  it('new with child "#<alias sel>" posts subscribe with to: "#<alias sel>"', async () => {
    const page = await loadPage(html);
    const pubPosts = [];
    await page.register('pub', msg => pubPosts.push(msg));
    const dom = await page.connectActor('HTML div');

    await dom.sendAsync({ id: '1', op: [{ children: ['#<pub @0>'] }, '$new'], from: 'caller' });

    // HTML should have routed a subscribe to pub (alias-stripped; `to` becomes
    // the address relative to the recipient).
    expect(pubPosts).toHaveLength(1);
    expect(pubPosts[0]).toEqual(expect.objectContaining({
      op: '$subscribe',
      to: '. @0',
      from: 'HTML div 1',
    }));
    expect(typeof pubPosts[0].id).toBe('string');
    expect(pubPosts[0].id.length).toBeGreaterThan(0);
    // Element address reply still happens.
    expect(dom.posts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1', re: '#<HTML div 1>' }),
    ]));
  });

  // ── Incoming re on element address updates text content ─────────────────
  it('re arriving at the element address updates text content', async () => {
    const page = await loadPage(html);
    const pubPosts = [];
    await page.register('pub', msg => pubPosts.push(msg));
    const dom = await page.connectActor('HTML div');

    await dom.sendAsync({ id: '1', op: [{ children: ['#<pub @0>'] }, '$new'], from: 'caller' });

    const sub = pubPosts[0];
    expect(sub).toBeDefined();

    // Simulate publisher replying with initial value. Reply addressed to the
    // element address (HTML @div/1 — what HTML used as the subscribe's from),
    // carrying the sub-id so the element handler can route to the right text
    // node.
    await page.send({ id: sub.id, re: ['initial'], to: 'HTML div 1', from: 'pub' });

    // Element text should now be 'initial'.
    const el = await page.connectActor('HTML div 1');
    await expectBehavior(el,
      { input: { id: 'q1', op: 'inner_html' } },
      { output: expect.objectContaining({ re: 'initial' }) },
    );
  });

  // ── Subsequent re values replay to the same text node ───────────────────
  it('multiple re values each update the same text node', async () => {
    const page = await loadPage(html);
    const pubPosts = [];
    await page.register('pub', msg => pubPosts.push(msg));
    const dom = await page.connectActor('HTML div');

    await dom.sendAsync({ id: '1', op: [{ children: ['#<pub @0>'] }, '$new'], from: 'caller' });

    const sub = pubPosts[0];
    const el = await page.connectActor('HTML div 1');

    await page.send({ id: sub.id, re: ['first'], to: 'HTML div 1', from: 'pub' });
    await expectBehavior(el,
      { input: { id: 'q1', op: 'inner_html' } },
      { output: expect.objectContaining({ re: 'first' }) },
    );

    await page.send({ id: sub.id, re: ['second'], to: 'HTML div 1', from: 'pub' });
    await expectBehavior(el,
      { input: { id: 'q2', op: 'inner_html' } },
      { output: expect.objectContaining({ re: 'second' }) },
    );
  });

  // ── Mixed children: static text and dynamic tokens interleave ───────────
  it('mixed static/dynamic children interleave in element text', async () => {
    const page = await loadPage(html);
    const pubPosts = [];
    await page.register('pub', msg => pubPosts.push(msg));
    const dom = await page.connectActor('HTML div');

    await dom.sendAsync({
      id: '1',
      op: [{ children: ['pre ', '#<pub @0>', ' post'] }, '$new'],
      from: 'caller',
    });

    expect(pubPosts).toHaveLength(1);
    const sub = pubPosts[0];

    const el = await page.connectActor('HTML div 1');
    await page.send({ id: sub.id, re: ['middle'], to: 'HTML div 1', from: 'pub' });

    await expectBehavior(el,
      { input: { id: 'q1', op: 'inner_html' } },
      { output: expect.objectContaining({ re: 'pre middle post' }) },
    );
  });

  // ── Multiple dynamic tokens each get their own subscribe ────────────────
  it('two child tokens produce two independent subscribes', async () => {
    const page = await loadPage(html);
    const pubPosts = [];
    await page.register('pub', msg => pubPosts.push(msg));
    const dom = await page.connectActor('HTML div');

    await dom.sendAsync({
      id: '1',
      op: [{ children: ['#<pub @0>', ' — ', '#<pub @1>'] }, '$new'],
      from: 'caller',
    });

    expect(pubPosts).toHaveLength(2);
    expect(pubPosts[0].to).toBe('. @0');
    expect(pubPosts[1].to).toBe('. @1');
    // Sub ids must be distinct so each text node is addressable independently.
    expect(pubPosts[0].id).not.toBe(pubPosts[1].id);

    const el = await page.connectActor('HTML div 1');
    await page.send({ id: pubPosts[0].id, re: ['left'], to: 'HTML div 1', from: 'pub' });
    await page.send({ id: pubPosts[1].id, re: ['right'], to: 'HTML div 1', from: 'pub' });

    await expectBehavior(el,
      { input: { id: 'q1', op: 'inner_html' } },
      { output: expect.objectContaining({ re: 'left — right' }) },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// A subscribed value that names a live element puts that element in the slot
//
// `{{ expr }}` in children subscribes to a closure. When the closure's value is
// an element address, the element takes the slot; a later text value puts a
// text node back.
// ═══════════════════════════════════════════════════════════════════════════════

describe('HTML element — a subscribed element address fills the slot', () => {
  it('re naming a live element attaches it in place of the text node', async () => {
    const page = await loadPage(html);
    const pubPosts = [];
    await page.register('pub', msg => pubPosts.push(msg));
    const span = await page.connectActor('HTML span');
    const div = await page.connectActor('HTML div');

    await span.sendAsync({ id: '1', op: [{ children: ['inner'] }, '$new'], from: 'caller' });
    await div.sendAsync({ id: '2', op: [{ children: ['[', '#<pub @0>', ']'] }, '$new'], from: 'caller' });
    await page.send({ id: pubPosts[0].id, re: ['#<HTML span 1>'], to: 'HTML div 1', from: 'pub' });

    const el = await page.connectActor('HTML div 1');
    await expectBehavior(el,
      { input: { id: 'q1', op: 'inner_html' } },
      { output: expect.objectContaining({ re: '[<span>inner</span>]' }) },
    );
  });

  it('a later text value replaces the element with text', async () => {
    const page = await loadPage(html);
    const pubPosts = [];
    await page.register('pub', msg => pubPosts.push(msg));
    const span = await page.connectActor('HTML span');
    const div = await page.connectActor('HTML div');

    await span.sendAsync({ id: '1', op: [{ children: ['inner'] }, '$new'], from: 'caller' });
    await div.sendAsync({ id: '2', op: [{ children: ['[', '#<pub @0>', ']'] }, '$new'], from: 'caller' });
    await page.send({ id: pubPosts[0].id, re: ['#<HTML span 1>'], to: 'HTML div 1', from: 'pub' });
    await page.send({ id: pubPosts[0].id, re: ['plain'], to: 'HTML div 1', from: 'pub' });

    const el = await page.connectActor('HTML div 1');
    await expectBehavior(el,
      { input: { id: 'q1', op: 'inner_html' } },
      { output: expect.objectContaining({ re: '[plain]' }) },
    );
  });
});

describe('template — a function returning an element, interpolated as a child', () => {
  const factorySource = `
    *
      :document
      HTML: (:div, :span)
    *
    #badge = -> <span>new</span>
    el = <div>[{{ #badge() }}]</div>
    body = document.body()
    body.append!(el)
  `;

  const page_html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity" src="/factory.bv"></script>
    </head><body></body></html>`;

  it('renders the returned element, not its address', async () => {
    const page = await loadPage(page_html, { sources: { '/factory.bv': factorySource } });
    const inner = await page.evaluate(() => document.querySelector('div').innerHTML);
    expect(inner).toBe('[<span>new</span>]');
  });
});
