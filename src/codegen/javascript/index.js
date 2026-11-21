export { codegen, parseInterface } from './classes.js';
import { codegen } from './classes.js';

const tick = () => new Promise(r => setTimeout(r, 0));

// Normalize BigInt values for test output consistency with JSON-based targets.
// BigInt within safe integer range → Number; large BigInt stays as BigInt.
function normalizeBigInts(val) {
  if (typeof val === 'bigint') {
    if (val >= Number.MIN_SAFE_INTEGER && val <= Number.MAX_SAFE_INTEGER) return Number(val);
    return val;
  }
  if (Array.isArray(val)) return val.map(normalizeBigInts);
  if (val !== null && typeof val === 'object') {
    if (typeof val.toNumber === 'function' && 'c' in val && 's' in val) return val.toNumber();
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = normalizeBigInts(v);
    return out;
  }
  return val;
}

// Cons-cell conversion: array → { head, tail }
function _toConsList(arr) {
  if (arr === null || arr === undefined) return null;
  return arr.reduceRight((tail, head) => ({ head, tail }), null);
}

function _coerceArg(value, type) {
  if (typeof type === 'string' && type.startsWith('List') && Array.isArray(value)) {
    return _toConsList(value);
  }
  return value;
}

function resolveConstructorArgs(ctx, source, constructorArgs) {
  if (constructorArgs == null) return [];
  const { ast } = ctx.extract(source);
  const fileActor = (ast.actors || []).find(a => !a.name);
  const params = fileActor?.initParams || [];
  if (Array.isArray(constructorArgs)) {
    return constructorArgs.map((v, i) => _coerceArg(v, params[i]?.type));
  }
  // Named object: map to positional order via the file actor's initParams.
  return params.map(p => _coerceArg(constructorArgs[p.key || p.name], p.type));
}

let _moduleSeq = 0;
async function loadModule(extract, compile, source, exportName = 'default', compileOptions = {}) {
  const { ast } = extract(source);
  const output = compile(ast, { ...compileOptions, target: 'js' });
  // Append unique comment to bust data: URL import cache
  const unique = output + `\n// _seq${_moduleSeq++}`;
  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(unique)}`;
  const mod = await import(dataUrl);
  return mod[exportName];
}

export default {
  name: 'js',
  codegen,
  runner: {
    setup({ extract, compile }) {
      return { extract, compile };
    },

    async runActor(ctx, { source, exportName = 'default', compileOptions = {}, receive }) {
      const Actor = await loadModule(ctx.extract, ctx.compile, source, exportName, compileOptions);
      const posts = [];
      const binding = { post: msg => posts.push(normalizeBigInts(msg)) };
      const actor = await Actor.create(binding);
      for (const msg of receive) {
        actor.receive(msg);
        await tick();
      }
      return posts;
    },

    async createActor(ctx, source, { exportName = 'default', compileOptions = {}, constructorArgs = null } = {}) {
      const Actor = await loadModule(ctx.extract, ctx.compile, source, exportName, compileOptions);
      const args = resolveConstructorArgs(ctx, source, constructorArgs);
      const posts = [];
      const pending = [];
      const binding = { post: msg => posts.push(normalizeBigInts(msg)) };
      const instance = await Actor.create(binding, ...args);
      return {
        send(msg) { pending.push(msg); },
        async sendAsync(msg) {
          pending.push(msg);
          for (const m of pending) {
            instance.receive(m);
            await tick(); await tick();
          }
          pending.length = 0;
        },
        posts,
      };
    },

    async compileActor(ctx, source, { exportName = 'default', compileOptions = {}, constructorArgs = null } = {}) {
      const Actor = await loadModule(ctx.extract, ctx.compile, source, exportName, compileOptions);
      const args = resolveConstructorArgs(ctx, source, constructorArgs);
      return {
        async spawn() {
          const posts = [];
          const pending = [];
          const binding = { post: msg => posts.push(normalizeBigInts(msg)) };
          const instance = await Actor.create(binding, ...args);
          return {
            send(msg) { pending.push(msg); },
            async sendAsync(msg) {
              pending.push(msg);
              for (const m of pending) {
                instance.receive(m);
                await tick(); await tick();
              }
              pending.length = 0;
            },
            posts,
          };
        },
      };
    },
  },
};
