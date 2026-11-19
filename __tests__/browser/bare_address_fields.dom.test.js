import { loadTestPage as loadPage } from '../../src/codegen/browser/harness.js';

// ═══════════════════════════════════════════════════════════════════════════════
// The page's router: `to`, `from` and `ty` are never bracketed
//
// A message whose `to`, `from` or `ty` holds an address value's `#<…>` is
// malformed. The router answers it with an `ex` (when it has an `id`) and
// delivers nothing. The same messages with bare fields are delivered.
// ═══════════════════════════════════════════════════════════════════════════════

const html = `<html><head>
  <script type="module" src="/src/codegen/browser/brevity.js"></script>
  </head><body></body></html>`;

describe('the page router rejects bracketed address fields', () => {
  it.each([
    ['to', { to: '#<HTML:div>', from: 'caller' }],
    ['from', { to: 'HTML:div', from: '#<caller>' }],
    ['ty', { to: 'HTML:div', from: 'caller', ty: [[{ children: '#<List>' }]] }],
  ])('a bracketed `%s`', async (_, fields) => {
    const page = await loadPage(html);
    const inbox = [];
    await page.register('caller', m => inbox.push(m));
    await page.send({ id: '1', op: [[{ children: [] }], '$new'], ...fields });
    expect(inbox).toEqual([{ id: '1', ex: { $new: 'bad_address' }, to: 'caller' }]);
    expect(await page.evaluate(() => document.querySelectorAll('div').length)).toBe(0);
  });

  it('the same message with bare fields is delivered', async () => {
    const page = await loadPage(html);
    const inbox = [];
    await page.register('caller', m => inbox.push(m));
    await page.send({ id: '1', op: [[{ children: [] }], '$new'], to: 'HTML:div', from: 'caller' });
    expect(inbox).toEqual([expect.objectContaining({ id: '1', re: [expect.stringMatching(/^#<HTML:div:\d+>$/)] })]);
  });
});
