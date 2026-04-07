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

  // Register document as an addressable actor
  addresses.set('document', msg => {
    const { id, op, from } = msg;
    const opName = typeof op === 'string' ? op : op[op.length - 1];
    let re;
    if (opName === '@title') re = document.title;
    if (re !== undefined) {
      // Defer reply to next microtask so the sender's instance is addressable
      Promise.resolve().then(() => route({ id, re, from: 'document', to: from }));
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
