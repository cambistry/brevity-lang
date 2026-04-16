export { codegen, parseInterface } from './classes.js';
import { codegen } from './classes.js';

const tick = () => new Promise(r => setTimeout(r, 0));

function resolveConstructorArgs(ctx, source, constructorArgs) {
  if (constructorArgs == null) return [];
  if (Array.isArray(constructorArgs)) return constructorArgs;
  // Named object: map to positional order via the file actor's initParams.
  const { ast } = ctx.extract(source);
  const fileActor = (ast.actors || []).find(a => !a.name);
  const order = (fileActor?.initParams || []).map(p => p.name);
  return order.map(n => constructorArgs[n]);
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
      const binding = { post: msg => posts.push(msg) };
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
      const binding = { post: msg => posts.push(msg) };
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
          const binding = { post: msg => posts.push(msg) };
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
