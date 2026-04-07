import { extract, compile } from '../../index.js';
import { start } from '../../src/codegen/browser/runtime.js';

const tick = () => new Promise(r => setTimeout(r, 0));

async function loadPage(html) {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'http://localhost' });
  const doc = window.document;
  doc.write(html);
  return start(doc, { extract, compile });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Inline <script type="text/brevity"> actor — test.get
// ═══════════════════════════════════════════════════════════════════════════════

describe('browser inline script — test.get', () => {
  const html = `
    <html>
    <head>
      <script type="text/brevity" id="main">
        x *Integer = 100
      </script>
    </head>
    <body></body>
    </html>
  `;

  it('reads state var from script actor by id', async () => {
    const page = await loadPage(html);
    const replies = [];
    page.register('t', msg => replies.push(msg));

    page.send({ id: '1', test: { get: 'x' }, from: 't', to: '#main' });
    await tick();

    expect(replies).toEqual([
      { id: '1', 'bv-a': 'Integer', re: 100, from: '#main', to: 't' },
    ]);
  });
});
