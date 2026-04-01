/**
 * brevity.js core — discovers <script type="text/brevity"> tags,
 * compiles them via the standard extract/compile pipeline,
 * and returns actor classes keyed by element id.
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
