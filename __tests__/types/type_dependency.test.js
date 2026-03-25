import compile from '../../index.js';
import { createActor, expectReply } from '../helpers.js';

// ── Manifest extraction ──────────────────────────────────────────────────────

describe('type dependency — manifest extraction', () => {
  it('manifest is extractable from parse alone, independent of caller', () => {
    const { manifest } = compile(`
      @get
        =
        :url : Text
        =
        -> response: "hello" as Text
    `);
    expect(manifest.service).toBe('{\n  get: (url: Text) -> (response: Text)\n}');
  });

  it('manifest captures multiple ops with full signatures', () => {
    const { manifest } = compile(`
      @read
        =
        :key : Text
        =
        -> value: "v" : Text

      @write = |:key : Text, :value : Text| .
    `);
    expect(manifest.service).toBe(
      '{\n  read: (key: Text) -> (value: Text)\n  write: (key: Text, value: Text) -> .\n}'
    );
  });

  it('manifest for silent public function shows -> .', () => {
    const { manifest } = compile('@notify = |:msg : Text| .\n');
    expect(manifest.service).toBe('{\n  notify: (msg: Text) -> .\n}');
  });
});

// ── Grounded -> types (valid) ─────────────────────────────────────────────

describe('type dependency — grounded -> types', () => {
  it('remote replies to get', async () => {
    const script = `
      @get
        =
        :url : Text
        =
        -> response: "hello" as Text
    `;
    await expectReply({
      script, receive: { id: 'R1', op: [{ url: 'http://example.com' }, '@get'], from: 'Caller', 'bv-a': [{ url: 'Text' }] },
      reply: expect.objectContaining({ id: 'R1', re: { response: 'hello' }, to: 'Caller' }),
    });
  });

  it('caller fetches from Remote with explicit types', async () => {
    const actor = await createActor(`
      uses Remote

      @fetch
        =
        :url : Text
        =
        :response : Text = Remote.get(:url : Text)
        -> :response : Text
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
        :n : Integer
        =
        -> result: (n * 2) as Integer
    `;
    await expectReply({
      script, receive: { id: 'M1', op: [{ n: 5 }, '@double'], from: 'Caller', 'bv-a': [{ n: 'Integer' }] },
      reply: expect.objectContaining({ id: 'M1', re: { result: 10 }, to: 'Caller' }),
    });
  });

  it('caller computes with explicit -> type, intermediate from remote', async () => {
    const actor = await createActor(`
      uses Math

      @compute
        =
        :n : Integer
        =
        :result : Integer = Math.double(:n : Integer)
        -> answer: (result + 1) as Integer
    `);
    await actor.sendAsync({ id: '1', op: [{ n: 5 }, '@compute'], from: 'Tester', 'bv-a': [{ n: 'Integer' }] });
    await actor.sendAsync({ id: '1', re: { result: 10 } });
    expect(actor.posts[0]).toEqual(expect.objectContaining({ op: [{ n: 5 }, '@double'], to: 'Math' }));
    expect(actor.posts[1]).toEqual(expect.objectContaining({ id: '1', re: { answer: 11 }, to: 'Tester' }));
  });
});

// ── Ungrounded -> types (invalid) ─────────────────────────────────────────

const isJs = !process.env.BREVITY_TARGET || process.env.BREVITY_TARGET === 'js';

describe('type dependency — ungrounded -> types', () => {
  it('reject -> whose type depends entirely @remote inference', () => {
    if (!isJs) return;
    const remoteManifest = compile(`
      @get
        =
        :url : Text
        =
        -> response: "hello" as Text
    `).manifest.service;

    expect(() => compile(`
      uses Remote

      @fetch
        =
        :url : Text
        =
        :response = Remote.get(:url : Text)
        -> :response
    `, { remotes: { Remote: remoteManifest } })).toThrow(/reply type.*cannot be inferred/i);
  });

  it('reject -> with sigil whose type is only known from remote', () => {
    if (!isJs) return;
    const remoteManifest = compile(`
      @get
        =
        :url : Text
        =
        -> data: "hello" as Text
    `).manifest.service;

    expect(() => compile(`
      uses Remote

      @fetch
        =
        :url : Text
        =
        :data = Remote.get(:url : Text)
        -> :data
    `, { remotes: { Remote: remoteManifest } })).toThrow(/reply type.*cannot be inferred/i);
  });
});

// ── Remote manifest inference ────────────────────────────────────────────────

describe('type dependency — remote manifest inference', () => {
  const remoteManifest = compile(`
    @get
      =
      :url : Text
      =
      -> response: "hello" as Text
  `).manifest.service;

  it('caller compiles and runs with remote manifest inference', async () => {
    const actor = await createActor(`
      uses Remote

      @fetch
        =
        :url : Text
        =
        :response = Remote.get(:url : Text)
        -> :response : Text
    `, { compileOptions: { remotes: { Remote: remoteManifest } } });
    await actor.sendAsync({ id: '1', op: [{ url: 'http://example.com' }, '@fetch'], from: 'Tester', 'bv-a': [{ url: 'Text' }] });
    await actor.sendAsync({ id: '1', re: { response: 'hello' } });
    expect(actor.posts[0]).toEqual(expect.objectContaining({ op: [{ url: 'http://example.com' }, '@get'], to: 'Remote' }));
    expect(actor.posts[1]).toEqual(expect.objectContaining({ id: '1', re: { response: 'hello' }, to: 'Tester' }));
  });

  it('circular use statements both compile when -> types are grounded', () => {
    const sourceA = `
      uses B

      @ask
        =
        :n : Integer
        =
        :result : Integer = B.compute(:n : Integer)
        -> answer: result : Integer
    `;
    const sourceB = `
      uses A

      @compute
        =
        :n : Integer
        =
        :base : Integer = A.get_base()
        -> result: n + base : Integer
    `;

    const manifestA = compile(sourceA).manifest.service;
    const manifestB = compile(sourceB).manifest.service;

    expect(() => compile(sourceA, { remotes: { B: manifestB } })).not.toThrow();
    expect(() => compile(sourceB, { remotes: { A: manifestA } })).not.toThrow();
  });
});
