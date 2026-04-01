import { codegen } from '../javascript/classes.js';
import { boot } from './runtime.js';

const tick = () => new Promise(r => setTimeout(r, 0));

async function loadActor(extract, compile, source, compileOptions = {}) {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'http://localhost' });
  const doc = window.document;

  const script = doc.createElement('script');
  script.type = 'text/brevity';
  script.id = 'document';
  script.textContent = source;
  doc.head.appendChild(script);

  const actors = await boot(doc, { extract, compile, compileOptions });
  const ActorClass = actors.get('document');
  if (!ActorClass) throw new Error('No actor found in browser harness');
  return { ActorClass, window };
}

export default {
  name: 'browser',
  codegen,
  runner: {
    setup({ extract, compile }) {
      return { extract, compile };
    },

    async runActor(ctx, { source, exportName = 'default', compileOptions = {}, receive }) {
      const { ActorClass } = await loadActor(ctx.extract, ctx.compile, source, compileOptions);
      const posts = [];
      const binding = { post: msg => posts.push(msg) };
      const actor = await ActorClass.create(binding);
      for (const msg of receive) {
        actor.receive(msg);
        await tick();
      }
      return posts;
    },

    async createActor(ctx, source, { exportName = 'default', compileOptions = {} } = {}) {
      const { ActorClass } = await loadActor(ctx.extract, ctx.compile, source, compileOptions);
      const posts = [];
      const pending = [];
      const binding = { post: msg => posts.push(msg) };
      const instance = await ActorClass.create(binding);
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

    async compileActor(ctx, source, { exportName = 'default', compileOptions = {} } = {}) {
      const { ActorClass } = await loadActor(ctx.extract, ctx.compile, source, compileOptions);
      return {
        async spawn() {
          const posts = [];
          const pending = [];
          const binding = { post: msg => posts.push(msg) };
          const instance = await ActorClass.create(binding);
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
        const { ActorClass } = await loadActor(ctx.extract, ctx.compile, source, compileOptions);
        instances[name] = { ActorClass };
      }
      for (const [name, inst] of Object.entries(instances)) {
        inst.binding = {
          post(msg) {
            const to = msg.to;
            if (to && instances[to]) {
              instances[to].instance.receive({ ...msg, from: name });
            } else {
              external.push(msg);
            }
          },
        };
        inst.instance = await inst.ActorClass.create(inst.binding);
      }
      for (const [target, msg] of messages) {
        instances[target].instance.receive(msg);
        await tick();
      }
      return external;
    },
  },
};
