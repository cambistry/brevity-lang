/**
 * brevity.js core — discovers <script type="text/brevity"> tags,
 * compiles them via the standard extract/compile pipeline,
 * and returns descriptors carrying the source ref needed to derive
 * each actor's CAM address.
 *
 * boot()  — returns Array<{ id, src, ActorClass }> in document order
 * start() — compiles, instantiates, and wires up live actors
 */

const documentDI = '< "document": (document) >\n';

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
    // External (src=) scripts must request resources explicitly via <:document>.
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

// `document` is the page's singleton actor. Methods describe its behavior
// surface; return types reference HTML.Element (the real type, declared in
// domManifest) so callers binding `el = document.first(...)` get an
// Element-typed value with the full attribute and method surface.
export const documentManifest = `{
  document: <> -> {
    title: () -> (Text)
    first: (:selector Text) -> (Element)
    body: () -> (Element)
  }
}`;

// HTML service manifest.
//
// Element is an abstract parent enumerating every non-event-handler
// attribute that applies to every HTML tag, plus content fields
// (`inner_html`, `children`) so a single typed constructor covers
// construction end-to-end. Per-attribute typing (Boolean / Integer /
// Decimal / Text) lets the validator catch wrong types at compile time.
//
// Aria buckets ARIA state/properties as one cohesive sub-type so
// Element's surface stays manageable. The `:role` field lives on Aria
// (not Element) because it's part of the accessibility surface;
// serialisation maps it to the bare `role=` attribute, not `aria-role=`.
//
// Concrete tags use lowercase names matching the HTML tag exactly
// (`div`, `p`, etc.). They subtype Element with empty own params for
// tags that add no tag-specific attributes; tags like <a> (with href)
// will add their own fields when they land.
//
// `:children` is `List of Texts | null` because each child is encoded
// as a wire token — text runs as bare strings, element references as
// `#<HTML @tag/N>`, closure subscriptions as `#<actor @N>` — and the
// runtime parses each entry to decide what to attach.
//
// `inner_html` is a method, not a constructor attribute — read the
// element's current innerHTML after construction. Setting initial
// content happens via `:children`.
export const domManifest = `{
  Element: <
    :id Text | null,
    :class Text | null,
    :style Text | null,
    :title Text | null,
    :lang Text | null,
    :dir Text | null,
    :translate Text | null,
    :hidden Boolean | null,
    :tabindex Integer | null,
    :accesskey Text | null,
    :draggable Boolean | null,
    :contenteditable Text | null,
    :spellcheck Boolean | null,
    :inert Boolean | null,
    :autofocus Boolean | null,
    :autocapitalize Text | null,
    :inputmode Text | null,
    :enterkeyhint Text | null,
    :is Text | null,
    :nonce Text | null,
    :popover Text | null,
    :slot Text | null,
    :part Text | null,
    :exportparts Text | null,
    :itemid Text | null,
    :itemprop Text | null,
    :itemref Text | null,
    :itemscope Boolean | null,
    :itemtype Text | null,
    :writingsuggestions Text | null,
    :virtualkeyboardpolicy Text | null,
    :data Structure | null,
    :aria Aria | null,
    :children List of Texts | null
  > -> {
    inner_html: () -> (Text)
  }

  Aria: <
    :role Text | null,
    :label Text | null,
    :labelledby Text | null,
    :describedby Text | null,
    :description Text | null,
    :details Text | null,
    :hidden Boolean | null,
    :disabled Boolean | null,
    :readonly Boolean | null,
    :required Boolean | null,
    :invalid Text | null,
    :errormessage Text | null,
    :checked Text | null,
    :pressed Text | null,
    :selected Boolean | null,
    :expanded Boolean | null,
    :busy Boolean | null,
    :live Text | null,
    :atomic Boolean | null,
    :relevant Text | null,
    :current Text | null,
    :haspopup Text | null,
    :level Integer | null,
    :modal Boolean | null,
    :multiline Boolean | null,
    :multiselectable Boolean | null,
    :orientation Text | null,
    :placeholder Text | null,
    :sort Text | null,
    :valuemax Decimal | null,
    :valuemin Decimal | null,
    :valuenow Decimal | null,
    :valuetext Text | null,
    :autocomplete Text | null,
    :keyshortcuts Text | null,
    :roledescription Text | null,
    :activedescendant Text | null,
    :controls Text | null,
    :flowto Text | null,
    :owns Text | null,
    :colcount Integer | null,
    :colindex Integer | null,
    :colspan Integer | null,
    :rowcount Integer | null,
    :rowindex Integer | null,
    :rowspan Integer | null,
    :posinset Integer | null,
    :setsize Integer | null,
    :dropeffect Text | null,
    :grabbed Boolean | null
  >

  div: <Element |>
  p: <Element |>
  span: <Element |>
  h1: <Element |>
}`;

export async function start(document, { extract, compile, compileOptions = {}, fetch = globalThis.fetch }) {
  const browserOptions = {
    ...compileOptions,
    remotes: [
      ...(compileOptions.remotes || []),
      { path: 'document', service: documentManifest },
      { path: 'HTML', service: domManifest },
    ],
  };
  const classes = await boot(document, { extract, compile, compileOptions: browserOptions, implicitDI: true, fetch });
  const addresses = new Map();
  const elements = new Map();

  // ── HTML service — element constructors ───────────────────────────────────
  // Per-tag counters: each tag (div, p, span, …) numbers independently from 1,
  // so the address `HTML @div/1` and `HTML @p/1` refer to distinct elements.
  const tagCounters = new Map();

  let subCounter = 0;

  // Mint a fresh HTML element address (per-tag counter) and register its
  // actor handler. Elements are registered in the shared `elements` map
  // under BOTH their global form (`HTML @tag/N`) and local form (`@tag/N`).
  // External lookups (e.g., document.body.append! receiving a `#<HTML @p/1>`
  // reference from another subsystem) use the global form; HTML-internal
  // lookups after strip-on-hop (where the `HTML` alias has been stripped
  // from embedded payload tokens) use the local form. The two keys are
  // disjoint — HTML element local selectors are `@tag/N` (tag + slash +
  // number), while closure selectors are `@N` (numeric) — so they can
  // coexist in a single map.
  function registerElementActor(tag, el) {
    const idx = (tagCounters.get(tag) || 0) + 1;
    tagCounters.set(tag, idx);
    const addr = `HTML @${tag}/${idx}`;
    const localAddr = `@${tag}/${idx}`;
    const elemSubs = new Map();
    elements.set(addr, el);
    elements.set(localAddr, el);
    addresses.set(addr, elemMsg => {
      const { id: eid, op: eop, from: efrom, re: eRe } = elemMsg;
      if (eRe !== undefined && elemSubs.has(eid)) {
        const textNode = elemSubs.get(eid);
        const val = Array.isArray(eRe) ? eRe[0] : eRe;
        textNode.nodeValue = val == null ? '' : String(val);
        return;
      }
      const eopName = typeof eop === 'string' ? eop : eop[eop.length - 1];
      if (eopName === '@inner_html') {
        Promise.resolve().then(() => route({ id: eid, re: el.innerHTML, from: addr, to: efrom }));
      }
    });
    return { addr, elemSubs };
  }

  // Children is an ordered array of bare strings (text runs), closure
  // addresses `#<actor @N>` (subscribe + text node), or already-live
  // element addresses `#<HTML @tag/N>` (appendChild). Matches XML
  // Infoset's [children] property. Caller pre-dispatches nested element
  // `new`s and passes their returned addresses here; by the time the
  // parent's dispatch lands, all child element actors are already
  // registered.
  function constructElementFromChildren(tag, children) {
    const el = document.createElement(tag);
    const { addr, elemSubs } = registerElementActor(tag, el);
    for (const child of children || []) {
      if (typeof child !== 'string') continue;
      if (child.startsWith('#<') && child.endsWith('>')) {
        const inner = child.slice(2, -1);
        const existingEl = elements.get(inner);
        if (existingEl) {
          el.appendChild(existingEl);
          continue;
        }
        const textNode = document.createTextNode('');
        el.appendChild(textNode);
        const subId = `_sub_${++subCounter}`;
        elemSubs.set(subId, textNode);
        Promise.resolve().then(() => route({
          id: subId, op: 'subscribe', to: child, from: addr,
        }));
        continue;
      }
      el.appendChild(document.createTextNode(child));
    }
    return { addr, el };
  }

  function handleDomNew(tag, msg) {
    const { id, op, from } = msg;
    const payload = Array.isArray(op) ? op[0] : {};
    const { addr } = constructElementFromChildren(tag, payload.children);
    Promise.resolve().then(() => route({
      id, re: '#<' + addr + '>', 'bv-a': '#<HTML @' + tag + '>', from: 'HTML', to: from,
    }));
  }

  // Extract the destination's alias from a `to` field. Handles both the
  // bare-global form (`ALIAS sel`) and the delimited-global form
  // (`#<ALIAS sel>`). Returns null for local forms (`@sel`, `#sel`,
  // `#<@sel>`, `#<#sel>`) — they name no outer alias to strip.
  function destAliasOf(to) {
    if (typeof to !== 'string') return null;
    let candidate = to;
    if (to.startsWith('#<') && to.endsWith('>')) candidate = to.slice(2, -1);
    const sp = candidate.indexOf(' ');
    const alias = sp === -1 ? candidate : candidate.slice(0, sp);
    if (!alias || alias.startsWith('@') || alias.startsWith('#')) return null;
    return alias;
  }

  function escapeForRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Strip the destination's alias from embedded `#<ALIAS sel>` tokens in
  // payload strings — the inbound mirror of `rewriteAddressStrings`'s
  // outbound prepend. After strip, HTML's receive handler sees its own
  // elements in local form (`#<@p/1>`), which the dual-keyed `elements`
  // map resolves without needing knowledge of its own alias.
  function stripMatchingAlias(v, alias) {
    if (typeof v === 'string') {
      const pattern = new RegExp(escapeForRegExp('#<' + alias + ' '), 'g');
      return v.replace(pattern, '#<');
    }
    if (Array.isArray(v)) return v.map(el => stripMatchingAlias(el, alias));
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = stripMatchingAlias(v[k], alias);
      return out;
    }
    return v;
  }

  function route(originalMsg) {
    const destAlias = destAliasOf(originalMsg.to);
    let msg = originalMsg;
    if (destAlias) {
      // Strip matching alias from embedded `#<ALIAS sel>` tokens in payload
      // fields only. Leaves `to` and `from` untouched — those identify the
      // dispatch endpoints, not payload content. `to` is decoded below by
      // the alias-aware dispatch paths; `from` names the sender's global
      // address, which replies need in unstripped form to route back.
      msg = { ...originalMsg };
      for (const k of Object.keys(originalMsg)) {
        if (k === 'to' || k === 'from') continue;
        msg[k] = stripMatchingAlias(originalMsg[k], destAlias);
      }
    }
    const to = msg.to;
    // `HTML @tag` form resolves to the tag's element constructor.
    let domTag = null;
    if (typeof to === 'string' && !addresses.has(to)) {
      const sepMatch = /^HTML\s+@(\w+)$/.exec(to);
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
    // `#<alias selector>` form (hash-angle delimited): the full address is
    // one chunk; interior is split into alias + selector. Deliver to alias
    // with the selector as the new `to` for the receiver's dispatcher.
    if (typeof to === 'string' && to.startsWith('#<') && to.endsWith('>')) {
      const inner = to.slice(2, -1);
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
          if (typeof val === 'string' && val.startsWith('#<') && val.endsWith('>')) {
            const childAddr = val.slice(2, -1);
            const childEl = elements.get(childAddr);
            if (childEl) el.appendChild(childEl);
          } else {
            el.insertAdjacentHTML('beforeend', val);
          }
          Promise.resolve().then(() => route({ id, re: '#<' + addr + '>', 'bv-a': '#<Element>', from: 'document', to: from }));
          return;
        }
        let re;
        if (opName === '@inner_html') re = el.innerHTML;
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
        Promise.resolve().then(() => route({ id, re: '#<' + addr + '>', 'bv-a': '#<Element>', from: 'document', to: from }));
      }
    } else if (opName === '@body') {
      const el = document.body;
      if (el) {
        const addr = registerElement('body', el);
        Promise.resolve().then(() => route({ id, re: '#<' + addr + '>', 'bv-a': '#<Element>', from: 'document', to: from }));
      }
    }
  });

  // Parent-layer address translation for runtime-loaded actors. Payload
  // `#<@N>`/`#<#N>` addresses get the sender's address prepended; `from`
  // is filled in if missing, prepended if local-form. Structural walk
  // (not JSON round-trip) so BigInt and other non-JSON primitives survive.
  function rewriteAddressStrings(v, selfAddr) {
    if (typeof v === 'string') {
      return v.replace(/#<([@#][^>]*)>/g, (_, content) => `#<${selfAddr} ${content}>`);
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
