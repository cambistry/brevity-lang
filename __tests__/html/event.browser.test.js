import { loadTestPage as loadPage } from '../../src/codegen/browser/harness.js';

// HTML::Event exists under the HTML actor, with the full field set, and the
// HTML actor emits it on a real native DOM event. Everything here is driven
// directly against the HTML / document CAM actors — no brevity source, no
// inline on* handler syntax:
//
//   1. construct an element via `#new`, wiring its on<event> to the test's own
//      CAM address (so the emitted event routes back to us);
//   2. append it to the document body;
//   3. fire a real event through the JS test framework (dispatchEvent);
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
const GENERIC_FIELDS = [
  'kind', 'phase', 'bubbles', 'cancelable', 'composed',
  'default_prevented', 'is_trusted', 'time_stamp',
];

// Synthesize an element + on<event> wiring over CAM, fire a real DOM event, and
// return the HTML::Event message(s) the HTML actor routed to our address.
//   on      — the attribute that wires the handler (e.g. 'onclick', 'onkeydown')
//   tag     — the element to construct (default 'button')
//   event   — { ctor: 'MouseEvent'|'KeyboardEvent', type, init } to dispatch
async function fireAndCapture(page, { on, tag = 'button', event }) {
  const replies = [];
  await page.register('t', m => replies.push(m));

  // document.body() → body address
  await page.send({ id: 'body', op: '@body', to: 'document', from: 't' });
  const bodyAddr = replies.find(m => m.id === 'body').re;

  // HTML.<tag>(#new) with the handler wired back to us (`#<t>`)
  await page.send({
    id: 'new',
    op: [{ id: 'evtel', [on]: '#<t>', children: [] }, '#new'],
    to: `HTML @${tag}`,
    from: 't',
  });
  const elAddr = replies.find(m => m.id === 'new').re;

  // body.append!(element)
  await page.send({ id: 'app', op: [[elAddr], '@append!'], to: bodyAddr, from: 't' });

  // Fire a real DOM event and drain what the listener routed to `t`. The
  // listener runs synchronously inside dispatchEvent, so the message is already
  // in the outbox when drainAll runs.
  return page.evaluate((ev) => {
    const Ctor = ev.ctor === 'KeyboardEvent' ? KeyboardEvent : MouseEvent;
    document.getElementById('evtel').dispatchEvent(new Ctor(ev.type, ev.init));
    return globalThis.__bv_test__.drainAll(['t']).t;
  }, event);
}

const CLICK = { ctor: 'MouseEvent', type: 'click', init: { cancelable: true, bubbles: true } };

describe('HTML::Event — emitted on a real DOM event (browser)', () => {
  it('the HTML actor delivers one HTML::Event tagged with its authority', async () => {
    const page = await loadPage(PAGE);
    const events = await fireAndCapture(page, { on: 'onclick', event: CLICK });
    expect(events).toHaveLength(1);
    expect(events[0]['bv-a']).toEqual([['#<HTML ::Event>']]);
  });

  it('carries every endpoint field as an HTML-rooted address', async () => {
    const page = await loadPage(PAGE);
    const [msg] = await fireAndCapture(page, { on: 'onclick', event: CLICK });
    const e = msg.op[0][0];
    for (const f of ENDPOINT_FIELDS) {
      expect(typeof e[f]).toBe('string');
      expect(e[f]).toMatch(/^#<HTML @__evt_/);
    }
  });

  it('carries every generic value field, snapshotted from the event', async () => {
    const page = await loadPage(PAGE);
    const [msg] = await fireAndCapture(page, { on: 'onclick', event: CLICK });
    const e = msg.op[0][0];
    for (const f of GENERIC_FIELDS) expect(f in e).toBe(true);
    expect(e.kind).toBe('click');
    expect(e.bubbles).toBe(true);
    expect(e.cancelable).toBe(true);
    expect(e.default_prevented).toBe(false);
    expect(e.is_trusted).toBe(false); // synthetic dispatch
  });

  it('carries target and current_target as the element actor address', async () => {
    const page = await loadPage(PAGE);
    const [msg] = await fireAndCapture(page, { on: 'onclick', event: CLICK });
    const e = msg.op[0][0];
    // The listener is attached to the button, and the click is dispatched on
    // it, so both references resolve to the same element actor address — an
    // HTML-rooted element address, distinct from the ephemeral @__evt_ endpoints.
    expect(e.target).toMatch(/^#<HTML @button\//);
    expect(e.current_target).toBe(e.target);
    // relatedTarget is absent on a plain click — the field drops out.
    expect('related_target' in e).toBe(false);
  });

  it('carries mouse value fields and modifier flags on a MouseEvent', async () => {
    const page = await loadPage(PAGE);
    const [msg] = await fireAndCapture(page, {
      on: 'onclick',
      event: {
        ctor: 'MouseEvent',
        type: 'click',
        init: { cancelable: true, bubbles: true, clientX: 12, clientY: 34, button: 0, shiftKey: true },
      },
    });
    const e = msg.op[0][0];
    expect(e.client_x).toBe(12);
    expect(e.client_y).toBe(34);
    expect(e.button).toBe(0);
    expect(e.buttons).toBe(0);
    // Modifier flags are present (as booleans) on every mouse event.
    expect(e.shift_key).toBe(true);
    expect(e.alt_key).toBe(false);
    expect(e.ctrl_key).toBe(false);
    expect(e.meta_key).toBe(false);
    // Keyboard-only fields do not appear on a mouse event.
    expect('key' in e).toBe(false);
    expect('code' in e).toBe(false);
  });

  it('carries key / code / modifiers on a KeyboardEvent', async () => {
    const page = await loadPage(PAGE);
    const [msg] = await fireAndCapture(page, {
      on: 'onkeydown',
      tag: 'input',
      event: {
        ctor: 'KeyboardEvent',
        type: 'keydown',
        init: { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, ctrlKey: true },
      },
    });
    const e = msg.op[0][0];
    expect(e.kind).toBe('keydown');
    expect(e.key).toBe('Enter');
    expect(e.code).toBe('Enter');
    expect(e.ctrl_key).toBe(true);
    expect(e.shift_key).toBe(false);
    expect(e.repeat).toBe(false);
    // Mouse-only coordinates do not appear on a keyboard event.
    expect('client_x' in e).toBe(false);
    expect('button' in e).toBe(false);
  });
});
