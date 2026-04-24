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
// connectActor establishes a com channel to an existing address (like "DOM @div")
// so we can send messages and assert replies using the same step-list pattern
// as expectActorBehavior.
// ═══════════════════════════════════════════════════════════════════════════════

describe('DOM element construction — service side', () => {
  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    </head><body></body></html>`;

  it('DOM @div new creates a <div> and responds with element address', async () => {
    const page = await loadPage(html);
    const dom = await page.connectActor('DOM @div');

    await expectBehavior(dom,
      { input: { id: '1', op: [{ inner_html: 'Hello' }, 'new'] } },
      { output: expect.objectContaining({ id: '1', re: '#<DOM @div/1>', 'bv-a': '#<DOM @div>', from: 'DOM' }) },
    );
  });

  it('created element is addressable and has correct content', async () => {
    const page = await loadPage(html);
    const dom = await page.connectActor('DOM @div');

    await expectBehavior(dom,
      { input: { id: '1', op: [{ inner_html: 'Hello' }, 'new'] } },
      { output: expect.objectContaining({ re: '#<DOM @div/1>' }) },
    );

    const el = await page.connectActor('DOM @div/1');
    await expectBehavior(el,
      { input: { id: '2', op: '@innerHTML' } },
      { output: expect.objectContaining({ re: 'Hello' }) },
    );
  });

  it('counter increments sequentially within a single tag', async () => {
    const page = await loadPage(html);
    const domDiv = await page.connectActor('DOM @div');

    await expectBehavior(domDiv,
      { input: { id: '1', op: [{ inner_html: 'First' }, 'new'] } },
      { output: expect.objectContaining({ id: '1', re: '#<DOM @div/1>', 'bv-a': '#<DOM @div>' }) },
      { input: { id: '2', op: [{ inner_html: 'Second' }, 'new'] } },
      { output: expect.objectContaining({ id: '2', re: '#<DOM @div/2>', 'bv-a': '#<DOM @div>' }) },
      { input: { id: '3', op: [{ inner_html: 'Third' }, 'new'] } },
      { output: expect.objectContaining({ id: '3', re: '#<DOM @div/3>', 'bv-a': '#<DOM @div>' }) },
    );
  });

  it('counters are per-tag — div and p number independently', async () => {
    const page = await loadPage(html);
    const domDiv = await page.connectActor('DOM @div');
    const domP = await page.connectActor('DOM @p');

    // Interleave div/p/div/p so a unified counter would produce
    // /1, /2, /3, /4 — per-tag counters instead produce /1, /1, /2, /2.
    await domDiv.sendAsync({ id: '1', op: [{ inner_html: 'd1' }, 'new'] });
    await domP.sendAsync({ id: '2', op: [{ inner_html: 'p1' }, 'new'] });
    await domDiv.sendAsync({ id: '3', op: [{ inner_html: 'd2' }, 'new'] });
    await domP.sendAsync({ id: '4', op: [{ inner_html: 'p2' }, 'new'] });

    expect(domDiv.posts).toEqual([
      expect.objectContaining({ id: '1', re: '#<DOM @div/1>', 'bv-a': '#<DOM @div>' }),
      expect.objectContaining({ id: '3', re: '#<DOM @div/2>', 'bv-a': '#<DOM @div>' }),
    ]);
    expect(domP.posts).toEqual([
      expect.objectContaining({ id: '2', re: '#<DOM @p/1>', 'bv-a': '#<DOM @p>' }),
      expect.objectContaining({ id: '4', re: '#<DOM @p/2>', 'bv-a': '#<DOM @p>' }),
    ]);
  });

  it('each tag-specific element is independently addressable', async () => {
    const page = await loadPage(html);
    const domDiv = await page.connectActor('DOM @div');
    const domP = await page.connectActor('DOM @p');

    await domDiv.sendAsync({ id: '1', op: [{ inner_html: 'div-one' }, 'new'] });
    await domP.sendAsync({ id: '2', op: [{ inner_html: 'p-one' }, 'new'] });
    await domDiv.sendAsync({ id: '3', op: [{ inner_html: 'div-two' }, 'new'] });

    // DOM @div/1 and DOM @p/1 are distinct elements despite sharing the "/1" suffix.
    const div1 = await page.connectActor('DOM @div/1');
    const p1 = await page.connectActor('DOM @p/1');
    const div2 = await page.connectActor('DOM @div/2');

    await expectBehavior(div1,
      { input: { id: 'q1', op: '@innerHTML' } },
      { output: expect.objectContaining({ re: 'div-one' }) },
    );
    await expectBehavior(p1,
      { input: { id: 'q2', op: '@innerHTML' } },
      { output: expect.objectContaining({ re: 'p-one' }) },
    );
    await expectBehavior(div2,
      { input: { id: 'q3', op: '@innerHTML' } },
      { output: expect.objectContaining({ re: 'div-two' }) },
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

  const testerSource = `<DOM: (:div)>
=
@createDiv = -> <div>Hello</div>
`;

  it('actor sends CAM new to DOM @div and returns element address', async () => {
    const page = await loadPage(html, { sources: { '/tester.bv': testerSource } });
    const actor = await page.connectActor('tester.bv');

    await expectBehavior(actor,
      { input: { id: '1', op: '@createDiv' } },
      { output: expect.objectContaining({ id: '1', re: ['#<DOM @div/1>'] }) },
    );
  });

  it('actor-constructed element is addressable and has correct content', async () => {
    const page = await loadPage(html, { sources: { '/tester.bv': testerSource } });
    const actor = await page.connectActor('tester.bv');

    await expectBehavior(actor,
      { input: { id: '1', op: '@createDiv' } },
      { output: expect.objectContaining({ re: ['#<DOM @div/1>'] }) },
    );

    const el = await page.connectActor('DOM @div/1');
    await expectBehavior(el,
      { input: { id: '2', op: '@innerHTML' } },
      { output: expect.objectContaining({ re: 'Hello' }) },
    );
  });
});
