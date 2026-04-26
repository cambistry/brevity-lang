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
// tags that add no tag-specific attributes; tags that carry their own
// surface (like <a> with href, <input> with type/value/...) declare
// them after the `Element |` divider.
//
// `:children` is a list of wire tokens — text runs as bare strings,
// element references as `#<HTML @tag/N>`, closure subscriptions as
// `#<actor @N>` — and the runtime parses each entry to decide what to
// attach.
//
// `inner_html` is a method, not a constructor attribute — read the
// element's current innerHTML after construction. Setting initial
// content happens via `:children`.
//
// Every attribute slot is marked optional with the `? ` prefix: the
// caller may omit any/all of them, and the runtime supplies a default
// (null for absent attributes). Optionality is an interface concern;
// the implementation owns the default.
//
// A handful of attributes are typed as unions (`Boolean | Text`,
// `Text | List of Texts`, `Integer | Decimal | Text`, ...) where the
// HTML spec genuinely admits multiple value shapes — `hidden` is a
// boolean attribute that also accepts the literal string
// "until-found"; `class` is one space-separated string OR a list of
// class names; `<input :value>` straddles text/number/decimal. The
// validator's union support (parser → splitUnionMembers → isAssignable)
// resolves any concrete arg type against any member.
export const domManifest = `{
  Element: <
    ? :id Text,
    ? :class Text | List of Texts,
    ? :style Text,
    ? :title Text,
    ? :lang Text,
    ? :dir Text,
    ? :translate Text,
    ? :hidden Boolean | Text,
    ? :tabindex Integer,
    ? :accesskey Text,
    ? :draggable Boolean,
    ? :contenteditable Boolean | Text,
    ? :spellcheck Boolean,
    ? :inert Boolean,
    ? :autofocus Boolean,
    ? :autocapitalize Text,
    ? :autocorrect Text,
    ? :inputmode Text,
    ? :enterkeyhint Text,
    ? :is Text,
    ? :nonce Text,
    ? :popover Boolean | Text,
    ? :slot Text,
    ? :part Text,
    ? :exportparts Text,
    ? :itemid Text,
    ? :itemprop Text,
    ? :itemref Text,
    ? :itemscope Boolean,
    ? :itemtype Text,
    ? :writingsuggestions Text,
    ? :virtualkeyboardpolicy Text,
    ? :data Structure,
    ? :aria Aria,
    ? :children List of Texts
  > -> {
    inner_html: () -> (Text)
  }

  Aria: <
    ? :role Text,
    ? :label Text,
    ? :labelledby Text,
    ? :describedby Text,
    ? :description Text,
    ? :details Text,
    ? :hidden Boolean,
    ? :disabled Boolean,
    ? :readonly Boolean,
    ? :required Boolean,
    ? :invalid Text,
    ? :errormessage Text,
    ? :checked Text,
    ? :pressed Text,
    ? :selected Boolean,
    ? :expanded Boolean,
    ? :busy Boolean,
    ? :live Text,
    ? :atomic Boolean,
    ? :relevant Text,
    ? :current Text,
    ? :haspopup Text,
    ? :level Integer,
    ? :modal Boolean,
    ? :multiline Boolean,
    ? :multiselectable Boolean,
    ? :orientation Text,
    ? :placeholder Text,
    ? :sort Text,
    ? :valuemax Decimal,
    ? :valuemin Decimal,
    ? :valuenow Decimal,
    ? :valuetext Text,
    ? :autocomplete Text,
    ? :keyshortcuts Text,
    ? :roledescription Text,
    ? :activedescendant Text,
    ? :controls Text,
    ? :flowto Text,
    ? :owns Text,
    ? :colcount Integer,
    ? :colindex Integer,
    ? :colspan Integer,
    ? :rowcount Integer,
    ? :rowindex Integer,
    ? :rowspan Integer,
    ? :posinset Integer,
    ? :setsize Integer
  >

  html: <Element |>
  head: <Element |>
  body: <Element |>
  header: <Element |>
  footer: <Element |>
  main: <Element |>
  nav: <Element |>
  section: <Element |>
  article: <Element |>
  aside: <Element |>
  h1: <Element |>
  h2: <Element |>
  h3: <Element |>
  h4: <Element |>
  h5: <Element |>
  h6: <Element |>
  div: <Element |>
  p: <Element |>
  span: <Element |>
  pre: <Element |>
  hr: <Element |>
  br: <Element |>
  blockquote: <Element | ? :cite Text>
  a: <Element | ? :href Text, ? :target Text, ? :rel Text, ? :download Boolean | Text, ? :type Text, ? :hreflang Text, ? :ping Text, ? :referrerpolicy Text>
  em: <Element |>
  strong: <Element |>
  code: <Element |>
  mark: <Element |>
  small: <Element |>
  ul: <Element |>
  ol: <Element | ? :type Text, ? :start Integer, ? :reversed Boolean>
  li: <Element | ? :value Integer>
  dl: <Element |>
  dt: <Element |>
  dd: <Element |>
  table: <Element |>
  thead: <Element |>
  tbody: <Element |>
  tr: <Element |>
  td: <Element | ? :colspan Integer, ? :rowspan Integer, ? :headers Text>
  th: <Element | ? :colspan Integer, ? :rowspan Integer, ? :headers Text, ? :scope Text, ? :abbr Text>
  caption: <Element |>
  form: <Element | ? :action Text, ? :method Text, ? :target Text, ? :enctype Text, ? :autocomplete Text, ? :novalidate Boolean, ? :name Text>
  input: <Element |
    ? :type Text,
    ? :name Text,
    ? :value Text | Integer | Decimal,
    ? :placeholder Text,
    ? :required Boolean,
    ? :disabled Boolean,
    ? :readonly Boolean,
    ? :min Integer | Decimal | Text,
    ? :max Integer | Decimal | Text,
    ? :step Integer | Decimal | Text,
    ? :minlength Integer,
    ? :maxlength Integer,
    ? :pattern Text,
    ? :accept Text,
    ? :multiple Boolean,
    ? :checked Boolean,
    ? :autocomplete Text,
    ? :list Text,
    ? :src Text,
    ? :alt Text,
    ? :form Text,
    ? :height Integer | Text,
    ? :width Integer | Text,
    ? :size Integer
  >
  button: <Element | ? :type Text, ? :name Text, ? :value Text | Integer, ? :disabled Boolean, ? :form Text, ? :formaction Text, ? :formmethod Text, ? :formnovalidate Boolean, ? :formtarget Text>
  select: <Element | ? :name Text, ? :multiple Boolean, ? :required Boolean, ? :disabled Boolean, ? :size Integer, ? :autocomplete Text, ? :form Text>
  option: <Element | ? :value Text | Integer | Decimal, ? :selected Boolean, ? :disabled Boolean, ? :label Text>
  textarea: <Element | ? :name Text, ? :rows Integer, ? :cols Integer, ? :placeholder Text, ? :required Boolean, ? :disabled Boolean, ? :readonly Boolean, ? :minlength Integer, ? :maxlength Integer, ? :wrap Text, ? :autocomplete Text, ? :form Text>
  label: <Element | ? :for Text, ? :form Text>
  img: <Element | ? :src Text, ? :srcset Text, ? :alt Text, ? :width Integer | Text, ? :height Integer | Text, ? :sizes Text, ? :loading Text, ? :decoding Text, ? :fetchpriority Text, ? :crossorigin Text, ? :referrerpolicy Text, ? :usemap Text, ? :ismap Boolean>
  canvas: <Element | ? :width Integer | Text, ? :height Integer | Text>
  iframe: <Element | ? :src Text, ? :srcdoc Text, ? :name Text, ? :sandbox Text, ? :allow Text, ? :allowfullscreen Boolean, ? :loading Text, ? :referrerpolicy Text, ? :width Integer | Text, ? :height Integer | Text>
  figure: <Element |>
  figcaption: <Element |>
  details: <Element | ? :open Boolean, ? :name Text>
  summary: <Element |>
  dialog: <Element | ? :open Boolean>
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

  // Apply one HTML attribute to an element, mapping JS values to attribute
  // string conventions:
  //   - null / false / undefined → omit (boolean-attr false; absent slot)
  //   - true                    → present with empty value
  //   - Array                   → space-joined string (List of Texts → class="a b")
  //   - other                   → String(value)
  function applyDomAttribute(el, name, value) {
    if (value == null || value === false) return;
    if (value === true) { el.setAttribute(name, ''); return; }
    if (Array.isArray(value)) { el.setAttribute(name, value.map(v => String(v)).join(' ')); return; }
    el.setAttribute(name, String(value));
  }

  // Walk the `new` payload and stamp HTML attributes on the element:
  //   - top-level keys (excluding `children`, `aria`, `data`) → bare attrs
  //   - `aria` sub-object  → `aria-{key}` for each, except `role` → bare `role`
  //   - `data` sub-object  → `data-{key}` for each
  // `children` is consumed separately by the caller so wire-token semantics
  // (text run vs element ref vs closure subscription) stay localized there.
  const ATTR_BUCKETS = new Set(['children', 'aria', 'data']);
  function applyDomAttributes(el, payload) {
    if (!payload || typeof payload !== 'object') return;
    for (const [k, v] of Object.entries(payload)) {
      if (ATTR_BUCKETS.has(k)) continue;
      applyDomAttribute(el, k, v);
    }
    if (payload.aria && typeof payload.aria === 'object') {
      for (const [k, v] of Object.entries(payload.aria)) {
        applyDomAttribute(el, k === 'role' ? 'role' : 'aria-' + k, v);
      }
    }
    if (payload.data && typeof payload.data === 'object') {
      for (const [k, v] of Object.entries(payload.data)) {
        applyDomAttribute(el, 'data-' + k, v);
      }
    }
  }

  // Children is an ordered array of bare strings (text runs), closure
  // addresses `#<actor @N>` (subscribe + text node), or already-live
  // element addresses `#<HTML @tag/N>` (appendChild). Matches XML
  // Infoset's [children] property. Caller pre-dispatches nested element
  // `new`s and passes their returned addresses here; by the time the
  // parent's dispatch lands, all child element actors are already
  // registered.
  function constructElementFromPayload(tag, payload) {
    const el = document.createElement(tag);
    const { addr, elemSubs } = registerElementActor(tag, el);
    applyDomAttributes(el, payload);
    for (const child of (payload && payload.children) || []) {
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
    const { addr } = constructElementFromPayload(tag, payload);
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
