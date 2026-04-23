import { loadTestPage as loadPage } from '../../src/codegen/browser/harness.js';

// Step-list assertion matching expectActorBehavior's interface:
//   { input: msg }  — send msg to the actor
//   { output: matcher } — assert next post matches
async function expectBehavior(actor, ...steps) {
  let postIndex = 0;
  for (const step of steps) {
    if (step.input && step.output) throw new Error('Cannot include both input and output in the same step.');
    if (step.input) {
      await actor.sendAsync(step.input);
    } else if (step.output) {
      expect(actor.posts[postIndex]).toEqual(step.output);
      postIndex++;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOM element construction — service side
//
// connectActor establishes a com channel to an existing address (like "DOM.div")
// so we can send messages and assert replies using the same step-list pattern
// as expectActorBehavior.
// ═══════════════════════════════════════════════════════════════════════════════

describe('DOM element construction — service side', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    </head><body></body></html>`;

  it('DOM.div new creates a <div> and responds with element address', async () => {
    const page = await loadPage(html);
    const dom = await page.connectActor('DOM.div');

    await expectBehavior(dom,
      { input: { id: '1', op: [{ children: ['Hello'] }, 'new'] } },
      { output: expect.objectContaining({ id: '1', re: '<<DOM.div/1>>', 'bv-a': '<<DOM.div>>', from: 'DOM' }) },
    );
  });

  it('created element is addressable and has correct content', async () => {
    const page = await loadPage(html);
    const dom = await page.connectActor('DOM.div');

    await expectBehavior(dom,
      { input: { id: '1', op: [{ children: ['Hello'] }, 'new'] } },
      { output: expect.objectContaining({ re: '<<DOM.div/1>>' }) },
    );

    const el = await page.connectActor('DOM.div/1');
    await expectBehavior(el,
      { input: { id: '2', op: '@innerHTML' } },
      { output: expect.objectContaining({ re: 'Hello' }) },
    );
  });

  it('unified counter increments across element types', async () => {
    const page = await loadPage(html);
    const domDiv = await page.connectActor('DOM.div');
    const domP = await page.connectActor('DOM.p');

    await expectBehavior(domDiv,
      { input: { id: '1', op: [{ children: ['First'] }, 'new'] } },
      { output: expect.objectContaining({ id: '1', re: '<<DOM.div/1>>', 'bv-a': '<<DOM.div>>' }) },
    );
    await expectBehavior(domP,
      { input: { id: '2', op: [{ children: ['Second'] }, 'new'] } },
      { output: expect.objectContaining({ id: '2', re: '<<DOM.p/2>>', 'bv-a': '<<DOM.p>>' }) },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DOM element construction — actor side
//
// A .bv file imports DOM, destructures (:div), and issues <div>Hello</div>.
// The actor should emit the correct CAM "new" message and forward the
// address from the DOM service response.
// ═══════════════════════════════════════════════════════════════════════════════

describe('DOM element construction — actor side', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity" id="main" src="/tester.bv"></script>
    </head><body></body></html>`;

  const testerSource = `<DOM: (:div) *>
=
@createDiv = -> <div>Hello</div>
`;

  it('actor sends CAM new to DOM.div and returns element address', async () => {
    const page = await loadPage(html, { sources: { '/tester.bv': testerSource } });
    const actor = await page.connectActor('tester.bv');

    await expectBehavior(actor,
      { input: { id: '1', op: '@createDiv' } },
      { output: expect.objectContaining({ id: '1', re: ['<<DOM.div/1>>'] }) },
    );
  });

  it('actor-constructed element is addressable and has correct content', async () => {
    const page = await loadPage(html, { sources: { '/tester.bv': testerSource } });
    const actor = await page.connectActor('tester.bv');

    await expectBehavior(actor,
      { input: { id: '1', op: '@createDiv' } },
      { output: expect.objectContaining({ re: ['<<DOM.div/1>>'] }) },
    );

    const el = await page.connectActor('DOM.div/1');
    await expectBehavior(el,
      { input: { id: '2', op: '@innerHTML' } },
      { output: expect.objectContaining({ re: 'Hello' }) },
    );
  });
});
