/**
 * brevity.js core — discovers <script type="text/brevity"> tags,
 * compiles them via the standard extract/compile pipeline,
 * and returns actor classes keyed by element id.
 *
 * boot()  — returns Map<id, ActorClass> (for runner compatibility)
 * start() — compiles, instantiates, and wires up live actors
 */

const documentDI = '< "document": (document) * >\n';

export async function boot(document, { extract, compile, compileOptions = {}, implicitDI = false }) {
  const scripts = document.querySelectorAll('script[type="text/brevity"]');
  const actors = new Map();

  for (const script of scripts) {
    let source = script.textContent;
    if (!source.trim()) continue;

    if (implicitDI && script.closest('head')) {
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
  first: (selector: Text) -> (HTMLElement)
}`;

export async function start(document, { extract, compile, compileOptions = {} }) {
  const browserOptions = {
    ...compileOptions,
    remotes: [
      ...(compileOptions.remotes || []),
      { path: 'document', service: documentManifest },
    ],
  };
  const classes = await boot(document, { extract, compile, compileOptions: browserOptions, implicitDI: true });
  const addresses = new Map();

  function route(msg) {
    const to = msg.to;
    if (to && addresses.has(to)) {
      addresses.get(to)(msg);
    }
  }

  // Element address registry — maps address to DOM element
  const elements = new Map();

  function registerElement(selector, el) {
    const addr = `document ${selector}`;
    if (!addresses.has(addr)) {
      elements.set(addr, el);
      addresses.set(addr, msg => {
        const { id, op, from } = msg;
        const opName = typeof op === 'string' ? op : op[op.length - 1];
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
        Promise.resolve().then(() => route({ id, re: {}, 'bv-a': 'self<HTMLElement>', from: addr, to: from }));
      }
    }
  });

  for (const [id, ActorClass] of classes) {
    const addr = id ? `#${id}` : null;
    const binding = {
      post(msg) { route({ ...msg, from: addr }); },
      created(inst) {
        // Register address as soon as the instance exists (before #init),
        // so deferred replies during init can reach the actor.
        if (addr) addresses.set(addr, msg => inst.receive(msg));
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
