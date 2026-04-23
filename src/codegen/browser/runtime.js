/**
 * brevity.js core — discovers <script type="text/brevity"> tags,
 * compiles them via the standard extract/compile pipeline,
 * and returns descriptors carrying the source ref needed to derive
 * each actor's CAM address.
 *
 * boot()  — returns Array<{ id, src, ActorClass }> in document order
 * start() — compiles, instantiates, and wires up live actors
 */

const documentDI = '< "document": (document) * >\n';

export async function boot(document, { extract, compile, compileOptions = {}, implicitDI = false, fetch = globalThis.fetch }) {
  const scripts = document.querySelectorAll('script[type="text/brevity"]');
  const actors = [];

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
    actors.push({ id: id || null, src: src || null, ActorClass });
  }

  return actors;
}

const documentManifest = `{
  title: () -> (Text)
  first: (:selector Text) -> (HTMLElement)
  body: () -> (HTMLElement)
}`;

const domManifest = `{
  div: (:inner_html Text) -> (HTMLElement)
  p: (:inner_html Text) -> (HTMLElement)
  span: (:inner_html Text) -> (HTMLElement)
  h1: (:inner_html Text) -> (HTMLElement)
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
  // Per-tag counters: each tag (div, p, span, …) numbers independently from 1,
  // so the address `DOM @div/1` and `DOM @p/1` refer to distinct elements.
  const tagCounters = new Map();

  let subCounter = 0;

  // Populate `el` from an inner_html string. DOM.X does its own walk of the
  // string rather than delegating to `element.innerHTML = …` — `<<…>>` is a
  // wire-level token, not markup, and the browser HTML tokenizer would mangle
  // it (treating the second `<` as opening a new tag). By building the DOM
  // manually with createElement / createTextNode / appendChild, tokens stay
  // first-class throughout.
  //
  //   - Pure-static (no `<<`) → `element.innerHTML = s` fast path.
  //   - `<<ADDR>>` → empty text node, subscribe, register in elemSubs.
  //   - `<tag>…</tag>` with tokens in its subtree → recurse via
  //     constructElement (cousin DOM.X actor).
  //   - `<tag>…</tag>` with no tokens → native createElement + innerHTML.
  //   - Text between tags → text node.
  function populateFromInnerHtml(el, addr, innerHtml, elemSubs) {
    if (typeof innerHtml !== 'string' || innerHtml === '') return;
    if (!innerHtml.includes('<<')) {
      el.innerHTML = innerHtml;
      return;
    }
    parseAndBuild(el, addr, innerHtml, elemSubs);
  }

  function parseAndBuild(parent, addr, source, elemSubs) {
    let i = 0;
    while (i < source.length) {
      if (source[i] === '<' && source[i + 1] === '<') {
        const end = source.indexOf('>>', i + 2);
        if (end === -1) {
          parent.appendChild(document.createTextNode(source.slice(i)));
          return;
        }
        const address = source.slice(i, end + 2);
        const textNode = document.createTextNode('');
        parent.appendChild(textNode);
        const subId = `_sub_${++subCounter}`;
        elemSubs.set(subId, textNode);
        Promise.resolve().then(() => route({
          id: subId, op: 'subscribe', to: address, from: addr,
        }));
        i = end + 2;
        continue;
      }
      if (source[i] === '<' && /[a-z]/.test(source[i + 1] || '')) {
        let j = i + 1;
        let tag = '';
        while (j < source.length && /[a-z0-9]/.test(source[j])) tag += source[j++];
        if (source[j] !== '>') {
          parent.appendChild(document.createTextNode(source[i]));
          i++;
          continue;
        }
        const openEnd = j + 1;
        const closeStart = findMatchingClose(source, openEnd, tag);
        if (closeStart === -1) {
          parent.appendChild(document.createTextNode(source.slice(i, openEnd)));
          i = openEnd;
          continue;
        }
        const inner = source.slice(openEnd, closeStart);
        if (inner.includes('<<')) {
          // Reactive subtree: cousin DOM.X actor.
          const { el: childEl } = constructElement(tag, inner);
          parent.appendChild(childEl);
        } else {
          // Static subtree: native construction.
          const childEl = document.createElement(tag);
          if (inner) childEl.innerHTML = inner;
          parent.appendChild(childEl);
        }
        i = closeStart + tag.length + 3; // past `</tag>`
        continue;
      }
      let j = i;
      while (j < source.length && source[j] !== '<') j++;
      parent.appendChild(document.createTextNode(source.slice(i, j)));
      i = j;
    }
  }

  // Find the matching `</tag>` at depth 0 for an open `<tag>` that starts at
  // position `startIdx`. Skips over `<<…>>` tokens so they can't be mistaken
  // for markup. Depth counts same-tag nesting only (other tags are irrelevant
  // for matching our current close).
  function findMatchingClose(source, startIdx, tag) {
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;
    let depth = 1;
    let i = startIdx;
    while (i < source.length) {
      if (source[i] === '<' && source[i + 1] === '<') {
        const end = source.indexOf('>>', i + 2);
        if (end === -1) return -1;
        i = end + 2;
        continue;
      }
      if (source.startsWith(openTag, i)) {
        depth++;
        i += openTag.length;
        continue;
      }
      if (source.startsWith(closeTag, i)) {
        depth--;
        if (depth === 0) return i;
        i += closeTag.length;
        continue;
      }
      i++;
    }
    return -1;
  }

  // Construct a new DOM.X element actor: create the native element, populate
  // from inner_html, register its address and message handler. Used both at
  // top-level (from handleDomNew) and recursively from populateFromInnerHtml
  // when a reactive subtree needs its own cousin DOM.X actor.
  function constructElement(tag, innerHtml) {
    const el = document.createElement(tag);
    const idx = (tagCounters.get(tag) || 0) + 1;
    tagCounters.set(tag, idx);
    const addr = `DOM @${tag}/${idx}`;
    const elemSubs = new Map();
    populateFromInnerHtml(el, addr, innerHtml, elemSubs);
    elements.set(addr, el);
    addresses.set(addr, elemMsg => {
      const { id: eid, op: eop, from: efrom, re: eRe } = elemMsg;
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
    return { addr, el };
  }

  function handleDomNew(tag, msg) {
    const { id, op, from } = msg;
    const payload = Array.isArray(op) ? op[0] : {};
    const { addr } = constructElement(tag, payload.inner_html);
    Promise.resolve().then(() => route({
      id, re: '<<' + addr + '>>', 'bv-a': '<<DOM @' + tag + '>>', from: 'DOM', to: from,
    }));
  }

  function route(msg) {
    const to = msg.to;
    // `DOM @tag` / `<<DOM>> @tag` — both resolve to the tag's element
    // constructor. The angle-delimited form is accepted for forward-compat
    // with transport activation.
    let domTag = null;
    if (typeof to === 'string' && !addresses.has(to)) {
      const sepMatch = /^(?:<<DOM>>|DOM)\s+@(\w+)$/.exec(to);
      if (sepMatch) domTag = sepMatch[1];
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
    // `<<alias selector>>` form (space inside angles): the full address is
    // one chunk; interior is split into alias + selector. Deliver to alias
    // with the selector as the new `to` for the receiver's dispatcher.
    if (typeof to === 'string' && to.startsWith('<<') && to.endsWith('>>')) {
      const inner = to.slice(2, -2);
      const sp = inner.indexOf(' ');
      const alias = sp === -1 ? inner : inner.slice(0, sp);
      const selector = sp === -1 ? undefined : inner.slice(sp + 1);
      if (addresses.has(alias)) {
        const forwarded = selector ? { ...msg, to: selector } : { ...msg, to: undefined };
        addresses.get(alias)(forwarded);
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

  // Parent-layer address translation for runtime-loaded actors. Payload
  // `<<@N>>`/`<<#N>>` addresses get the sender's address prepended (space-
  // inside-angles); `from` is filled in if missing, prepended if local-
  // form. Structural walk (not JSON round-trip) so BigInt and other non-
  // JSON primitives survive.
  function rewriteAddressStrings(v, selfAddr) {
    if (typeof v === 'string') {
      return v.replace(/<<([@#][^>]*)>>/g, (_, content) => `<<${selfAddr} ${content}>>`);
    }
    if (Array.isArray(v)) return v.map(el => rewriteAddressStrings(el, selfAddr));
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = rewriteAddressStrings(v[k], selfAddr);
      return out;
    }
    return v;
  }
  function translateOutbound(msg, selfAddr) {
    const out = rewriteAddressStrings(msg, selfAddr);
    if (out.from == null || out.from === '') {
      out.from = selfAddr;
    } else if (typeof out.from === 'string' && /^[@#]/.test(out.from)) {
      out.from = selfAddr + ' ' + out.from;
    }
    return out;
  }

  let anonCounter = 0;
  for (const { id, src, ActorClass } of classes) {
    // Every actor needs a routable address — even anonymous inline scripts.
    // Without one, replies to the actor's own init-time messages have
    // nowhere to land, and the await on (e.g.) document.body() never resolves.
    //
    // Address scheme (globals must start with a word char; leading delimiters
    // like `#`/`@` are reserved for internal/local addresses):
    //   - external src=path → path with leading `/` stripped (e.g. `app.bv`)
    //   - inline with id    → `script#id` (CSS-selector-shaped, single token)
    //   - anonymous inline  → `script#__bv_anon_N`
    let addr;
    if (src) {
      addr = src.replace(/^\/+/, '');
    } else if (id) {
      addr = `script#${id}`;
    } else {
      addr = `script#__bv_anon_${++anonCounter}`;
    }
    const binding = {
      post(msg) { route(translateOutbound(msg, addr)); },
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
