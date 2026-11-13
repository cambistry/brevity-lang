export { codegen, parseInterface } from './classes.js';
import { codegen } from './classes.js';
import { _opre_split as split, _opre_join as join, _opre_quote as quote, _opre_resolve as resolve, _opre_map_bracketed as mapBracketed } from '../opre_tokens.js';

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

    async runActors(ctx, { actors, messages }) {
      const external = [];
      const instances = {};
      for (const [name, { source, exportName, compileOptions }] of Object.entries(actors)) {
        instances[name] = { Actor: await loadModule(ctx.extract, ctx.compile, source, exportName, compileOptions) };
      }
      // Parse the `to` wire field into { alias, selector }: the head token
      // names a peer, the rest is relative to it. A relative address (`. x`)
      // names no peer. Forms: "#<alias rest>", "alias rest", "alias".
      const unescAddr = (s) => s.replace(/\\(\\|>)/g, (_, c) => c);
      const parseTo = (toStr) => {
        if (typeof toStr !== 'string') return { alias: null, selector: null };
        const bracketed = toStr.startsWith('#<') && toStr.endsWith('>');
        const tokens = split(bracketed ? unescAddr(toStr.slice(2, -1)) : toStr);
        if (tokens.length === 0 || tokens[0] === null) return { alias: null, selector: toStr };
        return { alias: tokens[0], selector: tokens.length > 1 ? join([null, ...tokens.slice(1)]) : null };
      };
      for (const [name, inst] of Object.entries(instances)) {
        // Each peer sits at the global boundary: what it sends relative to
        // itself (`. x`) is `name x` on the way out. Anything else is global
        // and passes through.
        const self = quote(name);
        const globalize = (v) => {
          if (typeof v === 'string') return mapBracketed(v, (a) => resolve(a, self));
          if (Array.isArray(v)) return v.map(globalize);
          if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, globalize(x)]));
          return v;
        };
        // `ty` has no brackets: a relative tag (`.`, `. Box`, `. ::Point`) is
        // resolved whole.
        const globalizeTy = (v) => {
          if (typeof v === 'string') return resolve(v, self);
          if (Array.isArray(v)) return v.map(globalizeTy);
          if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, globalizeTy(x)]));
          return v;
        };
        inst.binding = {
          post(msg) {
            const { alias, selector } = parseTo(msg.to);
            const target = alias;
            if (target && instances[target]) {
              const from = msg.from ? resolve(msg.from, self) : self;
              const { ty, ...rest } = msg;
              // Deliver with `to` rewritten relative to the receiver (the alias
              // resolves to the receiver = self, so the head collapses).
              const forwarded = { ...globalize(rest), ...('ty' in msg ? { ty: globalizeTy(ty) } : {}), to: selector || undefined, from };
              instances[target].instance.receive(forwarded);
            } else {
              external.push(normalizeBigInts(msg));
            }
          },
        };
        inst.instance = await inst.Actor.create(inst.binding);
      }
      for (const [target, msg] of messages) {
        instances[target].instance.receive(msg);
        await tick();
      }
      return external;
    },
  },
};
