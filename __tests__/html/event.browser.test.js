import { loadTestPage as loadPage } from '../../src/codegen/browser/harness.js';

// HTML::Event exists under the HTML actor, with the full field set, and the
// HTML actor emits it on a real native DOM event. Everything here is driven
// directly against the HTML / document CAM actors — no brevity source, no
// inline on* handler syntax:
//
//   1. construct a <button> via `#new`, wiring its onclick to the test's own
//      CAM address (so the emitted event routes back to us);
//   2. append it to the document body;
//   3. fire a real `click` through the JS test framework (dispatchEvent);
//   4. inspect the HTML::Event value the HTML actor delivered.
//
// The runtime always bootstraps the HTML/document actors, so the page needs
// only the brevity.js module — no <script type="text/brevity">. See
// notes/event-as-value-type-2026-10-25.

const PAGE = `<html><head>
  <script type="module" src="/src/codegen/browser/brevity.js"></script>
  </head><body></body></html>`;

// Field set exported by HTML's ::Event (src/codegen/browser/runtime.js).
const ENDPOINT_FIELDS = ['prevent', 'stop', 'stop_immediate'];
const VALUE_FIELDS = [
  'kind', 'phase', 'bubbles', 'cancelable', 'composed',
  'default_prevented', 'is_trusted', 'time_stamp',
];

// Synthesize the element + wiring over CAM, fire a real click, and return the
// HTML::Event message the HTML actor routed to our address.
async function fireAndCapture(page) {
  const replies = [];
  await page.register('t', m => replies.push(m));

  // document.body() → body address
  await page.send({ id: 'body', op: '@body', to: 'document', from: 't' });
  const bodyAddr = replies.find(m => m.id === 'body').re;

  // HTML.button(#new) with onclick wired back to us (`#<t>`)
  await page.send({
    id: 'new',
    op: [{ id: 'evtbtn', onclick: '#<t>', children: [] }, '#new'],
    to: 'HTML @button',
    from: 't',
  });
  const btnAddr = replies.find(m => m.id === 'new').re;

  // body.append!(button)
  await page.send({ id: 'app', op: [[btnAddr], '@append!'], to: bodyAddr, from: 't' });

  // Fire a real DOM click and drain the event the listener routed to `t`. The
  // listener runs synchronously inside dispatchEvent, so the message is already
  // in the outbox when drainAll runs.
  const drained = await page.evaluate(() => {
    document.getElementById('evtbtn').dispatchEvent(
      new MouseEvent('click', { cancelable: true, bubbles: true }),
    );
    return globalThis.__bv_test__.drainAll(['t']).t;
  });
  return drained;
}

describe('HTML::Event — emitted on a real DOM event (browser)', () => {
  it('the HTML actor delivers one HTML::Event tagged with its authority', async () => {
    const page = await loadPage(PAGE);
    const events = await fireAndCapture(page);
    expect(events).toHaveLength(1);
    expect(events[0]['bv-a']).toEqual([['#<HTML ::Event>']]);
  });

  it('carries every endpoint field as an HTML-rooted address', async () => {
    const page = await loadPage(PAGE);
    const [msg] = await fireAndCapture(page);
    const e = msg.op[0][0];
    for (const f of ENDPOINT_FIELDS) {
      expect(typeof e[f]).toBe('string');
      expect(e[f]).toMatch(/^#<HTML @__evt_/);
    }
  });

  it('carries every readable value field, snapshotted from the event', async () => {
    const page = await loadPage(PAGE);
    const [msg] = await fireAndCapture(page);
    const e = msg.op[0][0];
    for (const f of VALUE_FIELDS) expect(f in e).toBe(true);
    expect(e.kind).toBe('click');
    expect(e.bubbles).toBe(true);
    expect(e.cancelable).toBe(true);
    expect(e.default_prevented).toBe(false);
    expect(e.is_trusted).toBe(false); // synthetic dispatch
  });
});
