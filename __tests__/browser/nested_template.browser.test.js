import { loadTestPage as loadPage } from '../../src/codegen/browser/harness.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Nested template — HTML.X recursion on inner_html subtrees.
//
// When HTML.div receives inner_html containing nested elements, it parses
// the markup and dispatches recursively:
//   - Static subtrees (no `#<…>` tokens) → native HTML (innerHTML path).
//   - Reactive subtrees (element whose inner markup contains `#<…>`) →
//     recursive `new` to `HTML @<childTag>` with the child's inner_html.
//
// Walkthrough case:
//
//   Template = <> {
//     content Text! = "initial"
//     -> <div><h1>Title</h1><p>{ content }</p></div>
//   }
//
// On Template(), HTML.div receives
//   inner_html: "<h1>Title</h1><p>#<factory.bv @0></p>"
// HTML.div handles:
//   - <h1>Title</h1> inline (no #<…>).
//   - <p>#<factory.bv @0></p> → new to HTML @p with inner_html "#<factory.bv @0>".
// HTML.p subscribes, receives initial value, sets text.
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

describe('nested template — recursive HTML.X dispatch', () => {
  const factorySource = `
    *(HTML: (:div, :p, :h1))
    =
    content Text! = "initial"
    @bump = (:v Text) { content <- v . }
    @create = -> <div><h1>Title</h1><p>{ content }</p></div>
  `;

  const html = `<html><head>
    <script type="module" src="/src/codegen/browser/brevity.js"></script>
    <script type="text/brevity" src="/factory.bv"></script>
    </head><body></body></html>`;

  it('Template() returns a div address; div contains static <h1>Title</h1> and reactive <p>', async () => {
    const page = await loadPage(html, { sources: { '/factory.bv': factorySource } });
    const factory = await page.connectActor('factory.bv');

    await expectBehavior(factory,
      { input: { id: '1', op: '@create', from: 'caller' } },
      { output: expect.objectContaining({ id: '1', re: ['#<HTML @div/1>'] }) },
    );

    const div = await page.connectActor('HTML @div/1');
    await expectBehavior(div,
      { input: { id: 'q1', op: '@inner_html' } },
      { output: expect.objectContaining({
        re: expect.stringMatching(/<h1>Title<\/h1>.*<p>initial<\/p>/),
      }) },
    );
  });

  it('mutating @content updates the nested <p>, not the <h1>', async () => {
    const page = await loadPage(html, { sources: { '/factory.bv': factorySource } });
    const factory = await page.connectActor('factory.bv');

    await factory.sendAsync({ id: '1', op: '@create', from: 'caller' });

    await factory.sendAsync({
      id: '2',
      op: [{ v: 'updated' }, '@bump'],
      'bv-a': [{ v: 'Text' }],
      from: 'caller',
    });

    const div = await page.connectActor('HTML @div/1');
    await expectBehavior(div,
      { input: { id: 'q1', op: '@inner_html' } },
      { output: expect.objectContaining({
        re: expect.stringMatching(/<h1>Title<\/h1>.*<p>updated<\/p>/),
      }) },
    );
  });

  it('HTML.p is a cousin actor under the HTML subsystem, reachable at HTML @p/1', async () => {
    const page = await loadPage(html, { sources: { '/factory.bv': factorySource } });
    const factory = await page.connectActor('factory.bv');

    await factory.sendAsync({ id: '1', op: '@create', from: 'caller' });

    const p = await page.connectActor('HTML @p/1');
    await expectBehavior(p,
      { input: { id: 'q1', op: '@inner_html' } },
      { output: expect.objectContaining({ re: 'initial' }) },
    );
  });
});
