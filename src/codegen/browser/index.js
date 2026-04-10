// Browser target runner.
//
// All actor compilation and execution happens inside a real Chromium page
// via the Playwright-backed harness. Each runner method is a round-trip
// into the browser; the return shapes match the JS target runner, so
// __tests__/helpers.js consumes the browser target identically.

import { codegen } from '../javascript/classes.js';
import { callHarness, getHarness } from './harness.js';

export default {
  name: 'browser',
  codegen,
  runner: {
    async setup() {
      // Warm the harness: launch Chromium + server + page once per worker.
      await getHarness();
      return {};
    },

    async runActor(_ctx, { source, compileOptions = {}, receive }) {
      return callHarness('runActor', { source, compileOptions, receive });
    },

    async createActor(_ctx, source, { compileOptions = {} } = {}) {
      const id = await callHarness('createActor', { source, compileOptions });
      const posts = [];
      // Pull construction-time posts (e.g., ::new emission) immediately so
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

    async compileActor(_ctx, source, { compileOptions = {} } = {}) {
      const compiledId = await callHarness('compileActor', { source, compileOptions });
      return {
        async spawn() {
          const id = await callHarness('spawnCompiled', { compiledId });
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
