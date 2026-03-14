import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

const tick = () => new Promise(r => setTimeout(r, 0));

function createRouter(actors) {
  const external = [];
  for (const [name, actor] of Object.entries(actors)) {
    actor.binding = {
      post(msg) {
        const to = msg.to;
        if (to && actors[to]) {
          actors[to].instance.receive({ ...msg, from: name });
        } else {
          external.push(msg);
        }
      },
    };
  }
  for (const [name, actor] of Object.entries(actors)) {
    actor.instance = new actor.Actor(actor.binding);
  }
  return { actors, external };
}

async function compileActor(source, exportName = 'default') {
  const { output } = compile(source);
  return evaluate(output, exportName);
}

// ── Manifest extraction ──────────────────────────────────────────────────────

describe('type dependency — manifest extraction', () => {
  it('manifest is extractable from parse alone, independent of caller', () => {
    const { manifest } = compile(`
      on get(:url : Text)
        reply response: "hello" : Text
    `);
    expect(manifest.service).toBe('{\n  get: (url: Text) -> (response: Text)\n}');
  });

  it('manifest captures multiple ops with full signatures', () => {
    const { manifest } = compile(`
      on read(:key : Text)
        reply value: "v" : Text

      on write(:key : Text, :value : Text) end
    `);
    expect(manifest.service).toBe(
      '{\n  read: (key: Text) -> (value: Text)\n  write: (key: Text, value: Text) -> .\n}'
    );
  });

  it('manifest for silent handler shows -> .', () => {
    const { manifest } = compile('on notify(:msg : Text) end\n');
    expect(manifest.service).toBe('{\n  notify: (msg: Text) -> .\n}');
  });
});

// ── Grounded reply types (valid) ─────────────────────────────────────────────
//
// Rule: reply types MUST be explicitly declared or inferrable from local
// declarations. Variable types may be inferred from a remote reply type,
// as long as the inference does not trickle into the reply clause.

describe('type dependency — grounded reply types', () => {
  it('explicit types on both variable and reply', async () => {
    const RemoteActor = await compileActor(`
      on get(:url : Text)
        reply response: "hello" : Text
    `);
    const CallerActor = await compileActor(`
      use Remote

      on fetch(:url : Text)
        :response : Text = Remote.get(:url : Text)
        reply :response : Text
    `);

    const router = createRouter({
      Caller: { Actor: CallerActor },
      Remote: { Actor: RemoteActor },
    });

    router.actors.Caller.instance.receive({
      id: '1', op: [{ url: 'http://example.com' }, 'fetch'],
      from: 'Tester', 'bv-a': [{ url: 'Text' }],
    });
    await tick();

    expect(router.external.find(m => m.id === '1')).toEqual(expect.objectContaining({
      id: '1', re: { response: 'hello' }, to: 'Tester',
    }));
  });

  it('reply type explicit, intermediate variable from remote', async () => {
    // Variable type annotated explicitly, even though remote also declares it.
    // Reply type is grounded by the explicit annotation.
    const MathActor = await compileActor(`
      on double(:n : Integer)
        reply result: n * 2 : Integer
    `);
    const CallerActor = await compileActor(`
      use Math

      on compute(:n : Integer)
        :result : Integer = Math.double(:n : Integer)
        reply answer: result + 1 : Integer
    `);

    const router = createRouter({
      Caller: { Actor: CallerActor },
      Math: { Actor: MathActor },
    });

    router.actors.Caller.instance.receive({
      id: '1', op: [{ n: 5 }, 'compute'],
      from: 'Tester', 'bv-a': [{ n: 'Integer' }],
    });
    await tick();

    expect(router.external.find(m => m.id === '1')).toEqual(expect.objectContaining({
      id: '1', re: { answer: 11 }, to: 'Tester',
    }));
  });
});

// ── Ungrounded reply types (invalid) ─────────────────────────────────────────
//
// Rule: if the reply type can only be determined by chasing a remote actor's
// reply type, the compiler must reject it.  This prevents circular type
// dependencies between actors.
//
// These tests describe the enforcement that the compiler should perform once
// remote manifests are plumbed through to type checking.

describe('type dependency — ungrounded reply types', () => {
  it('reject reply whose type depends entirely on remote inference', () => {
    const remoteManifest = compile(`
      on get(:url : Text)
        reply response: "hello" : Text
    `).manifest.structured;

    expect(() => compile(`
      use Remote

      on fetch(:url : Text)
        :response = Remote.get(:url : Text)
        reply :response
    `, { remotes: { Remote: remoteManifest } })).toThrow(/reply type.*cannot be inferred/i);
  });

  it('reject reply with sigil whose type is only known from remote', () => {
    const remoteManifest = compile(`
      on get(:url : Text)
        reply data: "hello" : Text
    `).manifest.structured;

    expect(() => compile(`
      use Remote

      on fetch(:url : Text)
        :data = Remote.get(:url : Text)
        reply :data
    `, { remotes: { Remote: remoteManifest } })).toThrow(/reply type.*cannot be inferred/i);
  });
});

// ── Future: compile with remote manifests ────────────────────────────────────
//
// Once the compiler accepts a `remotes` option, these tests will exercise
// variable type inference from a remote manifest.
//
// Pattern:
//   const remoteManifest = compile(remoteSource).manifest;
//   const { output } = compile(primarySource, { remotes: { Remote: remoteManifest } });

describe('type dependency — remote manifest inference', () => {
  it('variable type inferred from remote manifest, reply type explicit', async () => {
    const remoteManifest = compile(`
      on get(:url : Text)
        reply response: "hello" : Text
    `).manifest.structured;

    const { output } = compile(`
      use Remote

      on fetch(:url : Text)
        :response = Remote.get(:url : Text)
        reply :response : Text
    `, { remotes: { Remote: remoteManifest } });

    const RemoteActor = await compileActor(`
      on get(:url : Text)
        reply response: "hello" : Text
    `);
    const CallerActor = await evaluate(output, 'default');

    const router = createRouter({
      Caller: { Actor: CallerActor },
      Remote: { Actor: RemoteActor },
    });

    router.actors.Caller.instance.receive({
      id: '1', op: [{ url: 'http://example.com' }, 'fetch'],
      from: 'Tester', 'bv-a': [{ url: 'Text' }],
    });
    await tick();

    expect(router.external.find(m => m.id === '1')).toEqual(expect.objectContaining({
      id: '1', re: { response: 'hello' }, to: 'Tester',
    }));
  });

  it('circular use statements both compile when reply types are grounded', () => {
    const sourceA = `
      use B

      on ask(:n : Integer)
        :result : Integer = B.compute(:n : Integer)
        reply answer: result : Integer
    `;
    const sourceB = `
      use A

      on compute(:n : Integer)
        :base : Integer = A.get_base()
        reply result: n + base : Integer
    `;

    const manifestA = compile(sourceA).manifest.structured;
    const manifestB = compile(sourceB).manifest.structured;

    expect(() => compile(sourceA, { remotes: { B: manifestB } })).not.toThrow();
    expect(() => compile(sourceB, { remotes: { A: manifestA } })).not.toThrow();
  });
});
