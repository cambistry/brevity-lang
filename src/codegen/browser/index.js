// Browser target runner.
//
// All actor compilation and execution happens inside a real Chromium page
// via the Playwright-backed harness. Each runner method is a round-trip
// into the browser; the return shapes match the JS target runner, so
// __tests__/helpers.js consumes the browser target identically.

import { codegen } from '../javascript/classes.js';
import { callHarness, getHarness } from './harness.js';

// Normalize BigInt values for test output consistency with JSON-based targets.
function normalizeBigInts(val) {
  if (typeof val === 'bigint') {
    if (val >= Number.MIN_SAFE_INTEGER && val <= Number.MAX_SAFE_INTEGER) return Number(val);
    return val;
  }
  if (Array.isArray(val)) return val.map(normalizeBigInts);
  if (val !== null && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = normalizeBigInts(v);
    return out;
  }
  return val;
}

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
  return params.map(p => _coerceArg(constructorArgs[p.name], p.type));
}

export default {
  name: 'browser',
  codegen,
  runner: {
    async setup({ extract } = {}) {
      // Warm the harness: launch Chromium + server + page once per worker.
      await getHarness();
      return { extract };
    },

    async runActor(_ctx, { source, compileOptions = {}, receive }) {
      const posts = await callHarness('runActor', { source, compileOptions, receive });
      return posts.map(normalizeBigInts);
    },

    async createActor(ctx, source, { compileOptions = {}, constructorArgs = null } = {}) {
      const args = resolveConstructorArgs(ctx, source, constructorArgs);
      const id = await callHarness('createActor', { source, compileOptions, args });
      const posts = [];
      // Pull construction-time posts (e.g., `new` emission) immediately so
      // the returned `posts` array is populated as tests expect.
      const initial = await callHarness('drainPosts', id);
      posts.push(...initial.map(normalizeBigInts));
      const pending = [];
      return {
        posts,
        send(msg) { pending.push(msg); },
        async sendAsync(msg) {
          pending.push(msg);
          const fresh = await callHarness('sendBatchAndDrain', { id, msgs: pending });
          pending.length = 0;
          posts.push(...fresh.map(normalizeBigInts));
        },
      };
    },

    async compileActor(ctx, source, { compileOptions = {}, constructorArgs = null } = {}) {
      const args = resolveConstructorArgs(ctx, source, constructorArgs);
      const compiledId = await callHarness('compileActor', { source, compileOptions });
      return {
        async spawn() {
          const id = await callHarness('spawnCompiled', { compiledId, args });
          const posts = [];
          const initial = await callHarness('drainPosts', id);
          posts.push(...initial.map(normalizeBigInts));
          const pending = [];
          return {
            posts,
            send(msg) { pending.push(msg); },
            async sendAsync(msg) {
              pending.push(msg);
              const fresh = await callHarness('sendBatchAndDrain', { id, msgs: pending });
              pending.length = 0;
              posts.push(...fresh.map(normalizeBigInts));
            },
          };
        },
      };
    },

    async runActors(_ctx, { actors, messages }) {
      const posts = await callHarness('runActors', { actors, messages });
      return posts.map(normalizeBigInts);
    },
  },
};
