/**
 * brevity.js core — discovers <script type="text/brevity"> tags,
 * compiles them via the standard extract/compile pipeline,
 * and returns actor classes keyed by element id.
 *
 * boot()  — returns Map<id, ActorClass> (for runner compatibility)
 * start() — compiles, instantiates, and wires up live actors
 */

export async function boot(document, { extract, compile, compileOptions = {} }) {
  const scripts = document.querySelectorAll('script[type="text/brevity"]');
  const actors = new Map();

  for (const script of scripts) {
    const source = script.textContent;
    if (!source.trim()) continue;

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

export async function start(document, { extract, compile, compileOptions = {} }) {
  const classes = await boot(document, { extract, compile, compileOptions });
  const addresses = new Map();

  function route(msg) {
    const to = msg.to;
    if (to && addresses.has(to)) {
      addresses.get(to)(msg);
    }
  }

  for (const [id, ActorClass] of classes) {
    const addr = id ? `#${id}` : null;
    const binding = {
      post(msg) { route({ ...msg, from: addr }); },
    };
    const instance = await ActorClass.create(binding);
    if (addr) addresses.set(addr, msg => instance.receive(msg));
  }

  return {
    send: route,
    register(id, handler) {
      addresses.set(id, handler);
    },
  };
}
