import { extract, compile } from '../../index.js';
import { createActor, expectBehavior } from '../helpers.js';

// ── Manifest extraction ──────────────────────────────────────────────────────

describe('type dependency — manifest extraction', () => {
  it('manifest is extractable from parse alone, independent of caller', () => {
    const { manifest } = extract(`
      @get
        =
        url: Text
        =
        -> response: "hello" as Text
    `);
    expect(manifest.service).toBe('{\n  get: (url: Text) -> (response: Text)\n}');
  });

  it('manifest captures multiple ops with full signatures', () => {
    const { manifest } = extract(`
      @read
        =
        key: Text
        =
        -> value: "v" as Text

      @write = |key: Text, value: Text| .
    `);
    expect(manifest.service).toBe(
      '{\n  read: (key: Text) -> (value: Text)\n  write: (key: Text, value: Text) -> .\n}'
    );
  });

  it('manifest for silent public function shows -> .', () => {
    const { manifest } = extract('@notify = |msg: Text| .\n');
    expect(manifest.service).toBe('{\n  notify: (msg: Text) -> .\n}');
  });
});

// ── Grounded -> types (valid) ─────────────────────────────────────────────

describe('type dependency — grounded -> types', () => {
  it('remote replies to get', async () => {
    const script = `
      @get
        =
        url: Text
        =
        -> response: "hello" as Text
    `;
    await expectBehavior(script,
      { input: { id: 'R1', op: [{ url: 'http://example.com' }, '@get'], from: 'Caller', 'bv-a': [{ url: 'Text' }] } },
      { output: expect.objectContaining({ id: 'R1', re: { response: 'hello' }, to: 'Caller' }) },
    );
  });

  it('caller fetches from Remote with explicit types', async () => {
    const actor = await createActor(`
      uses Remote {
        get: (url: Text) -> (response: Text)
      }

      @fetch
        =
        url: Text
        =
        :response Text = Remote.get(:url)
        -> :response as Text
    `);
    // Send the request — it will produce an outbound message to Remote
    await actor.sendAsync({ id: '1', op: [{ url: 'http://example.com' }, '@fetch'], from: 'Tester', 'bv-a': [{ url: 'Text' }] });
    // Simulate Remote's reply
    await actor.sendAsync({ id: '1', re: { response: 'hello' } });
    expect(actor.posts[0]).toEqual(expect.objectContaining({ op: [{ url: 'http://example.com' }, '@get'], to: 'Remote' }));
    expect(actor.posts[1]).toEqual(expect.objectContaining({ id: '1', re: { response: 'hello' }, to: 'Tester' }));
  });

  it('math actor doubles a number', async () => {
    const script = `
      @double
        =
        n: Integer
        =
        -> result: (n * 2) as Integer
    `;
    await expectBehavior(script,
      { input: { id: 'M1', op: [{ n: 5 }, '@double'], from: 'Caller', 'bv-a': [{ n: 'Integer' }] } },
      { output: expect.objectContaining({ id: 'M1', re: { result: 10 }, to: 'Caller' }) },
    );
  });

  it('caller computes with explicit -> type, intermediate from remote', async () => {
    const actor = await createActor(`
      uses Math {
        double: (n: Integer) -> (result: Integer)
      }

      @compute
        =
        n: Integer
        =
        :result Integer = Math.double(:n)
        -> answer: (result + 1) as Integer
    `);
    await actor.sendAsync({ id: '1', op: [{ n: 5 }, '@compute'], from: 'Tester', 'bv-a': [{ n: 'Integer' }] });
    await actor.sendAsync({ id: '1', re: { result: 10 } });
    expect(actor.posts[0]).toEqual(expect.objectContaining({ op: [{ n: 5 }, '@double'], to: 'Math' }));
    expect(actor.posts[1]).toEqual(expect.objectContaining({ id: '1', re: { answer: 11 }, to: 'Tester' }));
  });
});

// ── Ungrounded -> types (invalid) ─────────────────────────────────────────

describe('type dependency — ungrounded -> types', () => {
  it('reject -> whose type depends entirely @remote inference', () => {
    const remoteManifest = extract(`
      @get
        =
        url: Text
        =
        -> response: "hello" as Text
    `).manifest.service;

    const { ast } = extract(`
      uses Remote

      @fetch
        =
        url: Text
        =
        :response = Remote.get(:url)
        -> :response
    `);
    expect(() => compile(ast, { remotes: { Remote: remoteManifest } })).toThrow(/reply type.*cannot be inferred/i);
  });

  it('reject -> with sigil whose type is only known from remote', () => {
    const remoteManifest = extract(`
      @get
        =
        url: Text
        =
        -> data: "hello" as Text
    `).manifest.service;

    const { ast } = extract(`
      uses Remote

      @fetch
        =
        url: Text
        =
        :data = Remote.get(:url)
        -> :data
    `);
    expect(() => compile(ast, { remotes: { Remote: remoteManifest } })).toThrow(/reply type.*cannot be inferred/i);
  });
});

// ── Remote manifest inference ────────────────────────────────────────────────

describe('type dependency — remote manifest inference', () => {
  const remoteManifest = extract(`
    @get
      =
      url: Text
      =
      -> response: "hello" as Text
  `).manifest.service;

  it('caller compiles and runs with remote manifest inference', async () => {
    const actor = await createActor(`
      uses Remote

      @fetch
        =
        url: Text
        =
        :response = Remote.get(:url)
        -> :response as Text
    `, { compileOptions: { remotes: { Remote: remoteManifest } } });
    await actor.sendAsync({ id: '1', op: [{ url: 'http://example.com' }, '@fetch'], from: 'Tester', 'bv-a': [{ url: 'Text' }] });
    await actor.sendAsync({ id: '1', re: { response: 'hello' } });
    expect(actor.posts[0]).toEqual(expect.objectContaining({ op: [{ url: 'http://example.com' }, '@get'], to: 'Remote' }));
    expect(actor.posts[1]).toEqual(expect.objectContaining({ id: '1', re: { response: 'hello' }, to: 'Tester' }));
  });

  it('circular use statements both compile when -> types are grounded', () => {
    const sourceA = `
      uses B {
        compute: (n: Integer) -> (result: Integer)
      }

      @ask
        =
        n: Integer
        =
        :result Integer = B.compute(:n)
        -> answer: result as Integer

      @get_base
        =
        -> base: 10 as Integer
    `;
    const sourceB = `
      uses A {
        get_base: () -> (base: Integer)
      }

      @compute
        =
        n: Integer
        =
        :base Integer = A.get_base()
        -> result: n + base as Integer
    `;

    const manifestA = extract(sourceA).manifest.service;
    const manifestB = extract(sourceB).manifest.service;

    const { ast: astA } = extract(sourceA);
    const { ast: astB } = extract(sourceB);
    expect(() => compile(astA, { remotes: { B: manifestB } })).not.toThrow();
    expect(() => compile(astB, { remotes: { A: manifestA } })).not.toThrow();
  });
});
