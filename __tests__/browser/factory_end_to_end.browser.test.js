import { loadTestPage as loadPage } from '../../src/codegen/browser/harness.js';

// ═══════════════════════════════════════════════════════════════════════════════
// End-to-end factory integration — Layer A Phase 5.
//
// Composes all prior phases:
//
//   Phase 1: `{ content }` compiles to a closure at @0 on Factory.
//   Phase 2: `<div>{ content }</div>` emits `new` with `<<@0>>` child.
//   Phase 3: runtime parent translation prepends Factory's address:
//            `<<@0>>` → `<<factory.bv @0>>` on the wire to DOM.
//   Phase 4: DOM walks children, decomposes `<<factory.bv @0>>` →
//            `<<factory.bv>> @0`, posts subscribe to factory.bv. The
//            factory's @0 closure replies with current value; DOM
//            updates text node.
//   Plus: set@content mutation on Factory replays the @0 closure,
//         which pushes a new `re` to DOM, which updates the text node.
//
// No new code; this verifies the assembled reactive loop.
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

describe('factory end-to-end', () => {
  // Bare `content` (no @ sigil) so `{ content }` parses as RefRead rather
  // than Identifier. The factory note uses @content; getting public set@content
  // working end-to-end here would need Identifier-in-expression-context to
  // resolve to RefRead when the name is a state-ref decl — follow-up work.
  // For this test we expose a @bump handler as the public mutation surface,
  // matching the Phase 1 closure-primitive test pattern.
  const factorySource = `
    <DOM: (:div) *>
    content Text! = "initial"
    @bump = |:v Text| { content <- v . }
    @create = -> <div>{ content }</div>
  `;

  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity" id="main" src="/factory.bv"></script>
    </head><body></body></html>`;

  it('Factory.create returns element address whose text reflects @content', async () => {
    const page = await loadPage(html, { sources: { '/factory.bv': factorySource } });
    const factory = await page.connectActor('factory.bv');

    // Invoke Factory's @create. Factory emits a `new` to DOM with
    // children=[<<@0>>]; runtime prepends factory.bv → <<factory.bv @0>>;
    // DOM creates the element, subscribes to <<factory.bv>> @0, receives
    // the initial value ("initial") and updates the text node before the
    // Factory's reply (the element address) reaches the caller.
    await expectBehavior(factory,
      { input: { id: '1', op: '@create', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', re: ['<<DOM @div/1>>'] }) },
    );

    // Query the element's innerHTML — should be the initial @content value.
    const el = await page.connectActor('DOM @div/1');
    await expectBehavior(el,
      { input: { id: 'q1', op: '@innerHTML' } },
      { output: expect.objectContaining({ re: 'initial' }) },
    );
  });

  it('set@content on Factory propagates to the DOM element text', async () => {
    const page = await loadPage(html, { sources: { '/factory.bv': factorySource } });
    const factory = await page.connectActor('factory.bv');

    // Build the element.
    await factory.sendAsync({ id: '1', op: '@create', from: 'caller' });

    // Mutate content via the public @bump setter.
    await factory.sendAsync({
      id: '2',
      op: [{ v: 'updated' }, '@bump'],
      'bv-a': [{ v: 'Text' }],
      from: 'caller',
    });

    // Element text should now reflect the new value.
    const el = await page.connectActor('DOM @div/1');
    await expectBehavior(el,
      { input: { id: 'q1', op: '@innerHTML' } },
      { output: expect.objectContaining({ re: 'updated' }) },
    );
  });

  it('multiple set@content replays each update the element text', async () => {
    const page = await loadPage(html, { sources: { '/factory.bv': factorySource } });
    const factory = await page.connectActor('factory.bv');

    await factory.sendAsync({ id: '1', op: '@create', from: 'caller' });

    const el = await page.connectActor('DOM @div/1');

    for (const [seq, value] of [['a', 'first'], ['b', 'second'], ['c', 'third']]) {
      await factory.sendAsync({
        id: seq,
        op: [{ v: value }, '@bump'],
        'bv-a': [{ v: 'Text' }],
        from: 'caller',
      });
      await expectBehavior(el,
        { input: { id: 'q-' + seq, op: '@innerHTML' } },
        { output: expect.objectContaining({ re: value }) },
      );
    }
  });
});
