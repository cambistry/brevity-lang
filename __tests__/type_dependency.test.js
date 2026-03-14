import compile from '../index.js';
import { runActors } from './helpers.js';

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
    const external = await runActors({
      actors: {
        Caller: { source: `
          use Remote

          on fetch(:url : Text)
            :response : Text = Remote.get(:url : Text)
            reply :response : Text
        ` },
        Remote: { source: `
          on get(:url : Text)
            reply response: "hello" : Text
        ` },
      },
      messages: [
        ['Caller', {
          id: '1', op: [{ url: 'http://example.com' }, 'fetch'],
          from: 'Tester', 'bv-a': [{ url: 'Text' }],
        }],
      ],
    });

    expect(external.find(m => m.id === '1')).toEqual(expect.objectContaining({
      id: '1', re: { response: 'hello' }, to: 'Tester',
    }));
  });

  it('reply type explicit, intermediate variable from remote', async () => {
    const external = await runActors({
      actors: {
        Caller: { source: `
          use Math

          on compute(:n : Integer)
            :result : Integer = Math.double(:n : Integer)
            reply answer: result + 1 : Integer
        ` },
        Math: { source: `
          on double(:n : Integer)
            reply result: n * 2 : Integer
        ` },
      },
      messages: [
        ['Caller', {
          id: '1', op: [{ n: 5 }, 'compute'],
          from: 'Tester', 'bv-a': [{ n: 'Integer' }],
        }],
      ],
    });

    expect(external.find(m => m.id === '1')).toEqual(expect.objectContaining({
      id: '1', re: { answer: 11 }, to: 'Tester',
    }));
  });
});

// ── Ungrounded reply types (invalid) ─────────────────────────────────────────
//
// Rule: if the reply type can only be determined by chasing a remote actor's
// reply type, the compiler must reject it.  This prevents circular type
// dependencies between actors.

describe('type dependency — ungrounded reply types', () => {
  it('reject reply whose type depends entirely on remote inference', () => {
    const remoteManifest = compile(`
      on get(:url : Text)
        reply response: "hello" : Text
    `).manifest.service;

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
    `).manifest.service;

    expect(() => compile(`
      use Remote

      on fetch(:url : Text)
        :data = Remote.get(:url : Text)
        reply :data
    `, { remotes: { Remote: remoteManifest } })).toThrow(/reply type.*cannot be inferred/i);
  });
});

// ── Remote manifest inference ────────────────────────────────────────────────

describe('type dependency — remote manifest inference', () => {
  it('variable type inferred from remote manifest, reply type explicit', async () => {
    const remoteManifest = compile(`
      on get(:url : Text)
        reply response: "hello" : Text
    `).manifest.service;

    const external = await runActors({
      actors: {
        Caller: {
          source: `
            use Remote

            on fetch(:url : Text)
              :response = Remote.get(:url : Text)
              reply :response : Text
          `,
          compileOptions: { remotes: { Remote: remoteManifest } },
        },
        Remote: { source: `
          on get(:url : Text)
            reply response: "hello" : Text
        ` },
      },
      messages: [
        ['Caller', {
          id: '1', op: [{ url: 'http://example.com' }, 'fetch'],
          from: 'Tester', 'bv-a': [{ url: 'Text' }],
        }],
      ],
    });

    expect(external.find(m => m.id === '1')).toEqual(expect.objectContaining({
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

    const manifestA = compile(sourceA).manifest.service;
    const manifestB = compile(sourceB).manifest.service;

    expect(() => compile(sourceA, { remotes: { B: manifestB } })).not.toThrow();
    expect(() => compile(sourceB, { remotes: { A: manifestA } })).not.toThrow();
  });
});
