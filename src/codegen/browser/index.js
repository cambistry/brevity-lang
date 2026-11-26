// Browser target runner.
//
// All actor compilation and execution happens inside a real Chromium page
// via the Playwright-backed harness. Each runner method is a round-trip
// into the browser; the return shapes match the JS target runner, so
// __tests__/helpers.js consumes the browser target identically.

import { codegen } from '../javascript/classes.js';
import { callHarness, getHarness } from './harness.js';
import { isList } from '../../type_enc.js';

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
  if (isList(type) && Array.isArray(value)) {
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
    return constructorArgs.map((v, i) => _coerceArg(v, params[i]?.typeEnc));
  }
  return params.map(p => _coerceArg(constructorArgs[p.key || p.name], p.typeEnc));
}

// An actor in the page. Its posts reach Node only on a round-trip, so `refresh`
// pulls what it has posted since (one may trail a send, made on handling a reply),
// with whether construction has finished (`built`) or failed.
async function liveActor(id) {
  const posts = [];
  const pending = [];
  let built = false;
  let failed = null;
  const take = (drained) => {
    posts.push(...drained.posts.map(normalizeBigInts));
    built = drained.built;
    if (drained.failed && !failed) failed = new Error(drained.failed);
  };
  // Pull construction-time posts (e.g., `new` emission) immediately so
  // the returned `posts` array is populated as tests expect.
  take(await callHarness('drainPosts', id));
  return {
    posts,
    get built() { return built; },
    get failed() { return failed; },
    send(msg) { pending.push(msg); },
    async sendAsync(msg) {
      if (failed) throw failed;
      pending.push(msg);
      take(await callHarness('sendBatchAndDrain', { id, msgs: pending.splice(0) }));
    },
    async refresh() { take(await callHarness('drainPosts', id)); },
  };
}

export default {
  name: 'browser',
  codegen,
  runner: {
    async setup({ extract } = {}) {
      // Warm the harness: connect to the browser, start the server and runner page.
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
      return liveActor(id);
    },

    async compileActor(ctx, source, { compileOptions = {}, constructorArgs = null } = {}) {
      const args = resolveConstructorArgs(ctx, source, constructorArgs);
      const compiledId = await callHarness('compileActor', { source, compileOptions });
      return {
        async spawn() {
          const id = await callHarness('spawnCompiled', { compiledId, args });
          return liveActor(id);
        },
      };
    },

  },
};
