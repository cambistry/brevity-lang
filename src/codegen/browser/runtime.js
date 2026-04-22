/**
 * brevity.js core — discovers <script type="text/brevity"> tags,
 * compiles them via the standard extract/compile pipeline,
 * and returns actor classes keyed by element id.
 *
 * boot()  — returns Map<id, ActorClass> (for runner compatibility)
 * start() — compiles, instantiates, and wires up live actors
 */

const documentDI = '< "document": (document) * >\n';

export async function boot(document, { extract, compile, compileOptions = {}, implicitDI = false, fetch = globalThis.fetch }) {
  const scripts = document.querySelectorAll('script[type="text/brevity"]');
  const actors = new Map();

  for (const script of scripts) {
    let source;
    const src = script.getAttribute('src');
    const isExternal = Boolean(src);
    if (isExternal) {
      if (!fetch) throw new Error(`brevity.js: <script src="${src}"> requires fetch, but none is available`);
      const url = new URL(src, document.baseURI || 'http://localhost/');
      const res = await fetch(url.href);
      if (!res.ok) throw new Error(`brevity.js: failed to load ${url.href}: ${res.status}`);
      source = await res.text();
    } else {
      source = script.textContent;
    }
    if (!source || !source.trim()) continue;

    // Inline scripts in <head> get document DI auto-prepended.
    // External (src=) scripts must request resources explicitly via <:document *>.
    if (implicitDI && !isExternal && script.closest('head')) {
      source = documentDI + source;
    }

    const { ast } = extract(source);
    const output = compile(ast, { ...compileOptions, target: 'browser' });

    const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(output)}`;
    const mod = await import(dataUrl);
    const ActorClass = mod.default;

    const id = script.id || script.getAttribute('id');
    actors.set(id || null, ActorClass);
  }

  return actors;
}

const documentManifest = `{
  title: () -> (Text)
  first: (:selector Text) -> (HTMLElement)
  body: () -> (HTMLElement)
}`;

const domManifest = `{
  div: (:children List) -> (HTMLElement)
  p: (:children List) -> (HTMLElement)
  span: (:children List) -> (HTMLElement)
}`;

export async function start(document, { extract, compile, compileOptions = {}, fetch = globalThis.fetch }) {
  const browserOptions = {
    ...compileOptions,
    remotes: [
      ...(compileOptions.remotes || []),
      { path: 'document', service: documentManifest },
      { path: 'DOM', service: domManifest },
    ],
  };
  const classes = await boot(document, { extract, compile, compileOptions: browserOptions, implicitDI: true, fetch });
  const addresses = new Map();
  const elements = new Map();

  // ── DOM service — element constructors ───────────────────────────────────
  let domElementCounter = 0;

  let subCounter = 0;

  // Decompose a payload-form address `<<alias selector>>` into the routing
  // to-field convention `<<alias>> selector`. Returns null if not an address.
  function decomposeAddress(str) {
    const m = /^<<(.+?)>>$/.exec(str);
    if (!m) return null;
    const inner = m[1];
    const sp = inner.indexOf(' ');
    if (sp === -1) return `<<${inner}>>`;
    return `<<${inner.slice(0, sp)}>> ${inner.slice(sp + 1)}`;
  }

  function handleDomNew(tag, msg) {
    const { id, op, from } = msg;
    const payload = Array.isArray(op) ? op[0] : {};
    const el = document.createElement(tag);
    // Per-element subscription registry: sub-id → text node. Incoming `re`
    // messages on the element's address are routed to the right text node
    // by matching the sub-id.
    const elemSubs = new Map();
    if (payload.children) {
      for (const child of payload.children) {
        if (typeof child !== 'string') continue;
        const toForm = decomposeAddress(child);
        if (toForm) {
          // Dynamic slot: create an empty text node, post subscribe, register
          // the text node under a fresh sub-id so re replies can find it.
          const textNode = document.createTextNode('');
          el.appendChild(textNode);
          const subId = `_sub_${++subCounter}`;
          const elAddr = `DOM.${tag}/${domElementCounter + 1}`;
          elemSubs.set(subId, textNode);
          Promise.resolve().then(() => route({
            id: subId, op: 'subscribe', to: toForm, from: elAddr,
          }));
        } else {
          el.appendChild(document.createTextNode(child));
        }
      }
    }
    const idx = ++domElementCounter;
    const addr = `DOM.${tag}/${idx}`;
    elements.set(addr, el);
    addresses.set(addr, elemMsg => {
      const { id: eid, op: eop, from: efrom, re: eRe } = elemMsg;
      // Subscribe re — route to text node update.
      if (eRe !== undefined && elemSubs.has(eid)) {
        const textNode = elemSubs.get(eid);
        const val = Array.isArray(eRe) ? eRe[0] : eRe;
        textNode.nodeValue = val == null ? '' : String(val);
        return;
      }
      const eopName = typeof eop === 'string' ? eop : eop[eop.length - 1];
      if (eopName === '@innerHTML') {
        Promise.resolve().then(() => route({ id: eid, re: el.innerHTML, from: addr, to: efrom }));
      }
    });
    Promise.resolve().then(() => route({
      id, re: '<<' + addr + '>>', 'bv-a': '<<DOM.' + tag + '>>', from: 'DOM', to: from,
    }));
  }

  function route(msg) {
    const to = msg.to;
    // DOM.tag / DOM @tag / <<DOM>> @tag — all route to handleDomNew.
    // Old dot-form stays supported while external callers transition. Angle-
    // delimited form accepted for forward-compat with transport activation.
    let domTag = null;
    if (typeof to === 'string' && !addresses.has(to)) {
      const sepMatch = /^(?:<<DOM>>|DOM)\s+@(\w+)$/.exec(to);
      if (sepMatch) domTag = sepMatch[1];
      else if (to.startsWith('DOM.')) domTag = to.slice(4);
    }
    if (domTag) {
      const { op } = msg;
      const opName = typeof op === 'string' ? op : op[op.length - 1];
      if (opName === 'new') {
        handleDomNew(domTag, msg);
        return;
      }
    }
    // Direct address match takes precedence (legacy + registered actors).
    if (to && addresses.has(to)) {
      addresses.get(to)(msg);
      return;
    }
    // `<<alias>> selector` form: strip alias, deliver to alias with the bare
    // selector as new `to`. Mirrors the JS harness parseTo convention.
    if (typeof to === 'string' && to.startsWith('<<')) {
      const m = /^<<([^>]+)>>(?:\s+(.+))?$/.exec(to);
      if (m && addresses.has(m[1])) {
        const selector = m[2];
        const forwarded = selector ? { ...msg, to: selector } : { ...msg, to: undefined };
        addresses.get(m[1])(forwarded);
      }
    }
  }

  function registerElement(selector, el) {
    const addr = `document ${selector}`;
    if (!addresses.has(addr)) {
      elements.set(addr, el);
      addresses.set(addr, msg => {
        const { id, op, from } = msg;
        const opName = typeof op === 'string' ? op : op[op.length - 1];
        if (opName === '@append!') {
          const payload = Array.isArray(op) ? op[0] : {};
          const val = typeof payload === 'string' ? payload : (Array.isArray(payload) ? payload[0] : '');
          if (typeof val === 'string' && val.startsWith('<<') && val.endsWith('>>')) {
            const childAddr = val.slice(2, -2);
            const childEl = elements.get(childAddr);
            if (childEl) el.appendChild(childEl);
          } else {
            el.insertAdjacentHTML('beforeend', val);
          }
          Promise.resolve().then(() => route({ id, re: '<<' + addr + '>>', 'bv-a': '<<HTMLElement>>', from: 'document', to: from }));
          return;
        }
        let re;
        if (opName === '@innerHTML') re = el.innerHTML;
        if (re !== undefined) {
          Promise.resolve().then(() => route({ id, re, from: addr, to: from }));
        }
      });
    }
    return addr;
  }

  // Register document as an addressable actor
  addresses.set('document', msg => {
    const { id, op, from } = msg;
    const opName = typeof op === 'string' ? op : op[op.length - 1];
    if (opName === '@title') {
      Promise.resolve().then(() => route({ id, re: document.title, from: 'document', to: from }));
    } else if (opName === '@first') {
      const payload = Array.isArray(op) ? op[0] : {};
      const selector = payload.selector;
      const el = document.querySelector(selector);
      if (el) {
        const addr = registerElement(selector, el);
        Promise.resolve().then(() => route({ id, re: '<<' + addr + '>>', 'bv-a': '<<HTMLElement>>', from: 'document', to: from }));
      }
    } else if (opName === '@body') {
      const el = document.body;
      if (el) {
        const addr = registerElement('body', el);
        Promise.resolve().then(() => route({ id, re: '<<' + addr + '>>', 'bv-a': '<<HTMLElement>>', from: 'document', to: from }));
      }
    }
  });

  let anonCounter = 0;
  for (const [id, ActorClass] of classes) {
    // Every actor needs a routable address — even anonymous inline scripts.
    // Without one, replies to the actor's own init-time messages have
    // nowhere to land, and the await on (e.g.) document.body() never resolves.
    const addr = id ? `#${id}` : `#__bv_anon_${++anonCounter}`;
    const binding = {
      post(msg) { route({ ...msg, from: addr }); },
      created(inst) {
        // Register address as soon as the instance exists (before #init),
        // so deferred replies during init can reach the actor.
        addresses.set(addr, msg => inst.receive(msg));
      },
    };
    await ActorClass.create(binding);
  }

  return {
    send: route,
    register(id, handler) {
      addresses.set(id, handler);
    },
  };
}
