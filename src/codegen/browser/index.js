// Browser target runner.
//
// All actor compilation and execution happens inside a real Chromium page
// via the Playwright-backed harness. Each runner method is a round-trip
// into the browser; the return shapes match the JS target runner, so
// __tests__/helpers.js consumes the browser target identically.

import { codegen } from '../javascript/classes.js';
import { callHarness, getHarness } from './harness.js';

function resolveConstructorArgs(ctx, source, constructorArgs) {
  if (constructorArgs == null) return [];
  if (Array.isArray(constructorArgs)) return constructorArgs;
  const { ast } = ctx.extract(source);
  const fileActor = (ast.actors || []).find(a => !a.name);
  const order = (fileActor?.initParams || []).map(p => p.name);
  return order.map(n => constructorArgs[n]);
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
      return callHarness('runActor', { source, compileOptions, receive });
    },

    async createActor(ctx, source, { compileOptions = {}, constructorArgs = null } = {}) {
      const args = resolveConstructorArgs(ctx, source, constructorArgs);
      const id = await callHarness('createActor', { source, compileOptions, args });
      const posts = [];
      // Pull construction-time posts (e.g., `new` emission) immediately so
      // the returned `posts` array is populated as tests expect.
      const initial = await callHarness('drainPosts', id);
      posts.push(...initial);
      const pending = [];
      return {
        posts,
        send(msg) { pending.push(msg); },
        async sendAsync(msg) {
          pending.push(msg);
          const fresh = await callHarness('sendBatchAndDrain', { id, msgs: pending });
          pending.length = 0;
          posts.push(...fresh);
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
          posts.push(...initial);
          const pending = [];
          return {
            posts,
            send(msg) { pending.push(msg); },
            async sendAsync(msg) {
              pending.push(msg);
              const fresh = await callHarness('sendBatchAndDrain', { id, msgs: pending });
              pending.length = 0;
              posts.push(...fresh);
            },
          };
        },
      };
    },

    async runActors(_ctx, { actors, messages }) {
      return callHarness('runActors', { actors, messages });
    },
  },
};
