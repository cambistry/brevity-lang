import { createActor, expectBehavior } from '../helpers.js';

// ── 1. Two-actor request-reply ───────────────────────────────────────────────

describe('interop — two-actor request-reply', () => {
  it('remote replies to get request', async () => {
    const script = `
      @get
        =
        url: Text
        =
        -> response: "hello from remote" as Text
    `;
    await expectBehavior(script,
      { input: { id: 'R1', op: [{ url: 'http://example.com' }, '@get'], from: 'Primary', 'bv-a': [{ url: 'Text' }] } },
      { output: expect.objectContaining({ id: 'R1', re: { response: 'hello from remote' }, to: 'Primary' }) },
    );
  });

  it('primary sends get to Remote and forwards response', async () => {
    const actor = await createActor(`
      uses Remote {
        get: (url: Text) -> (response: Text)
      }

      @call_remote
        =
        url: Text
        =
        response: Text = Remote.get(:url)
        -> :response as Text
    `);
    await actor.sendAsync({ id: '100', op: [{ url: 'http://example.com' }, '@call_remote'], from: 'Tester', 'bv-a': [{ url: 'Text' }] });
    await actor.sendAsync({ id: '1', re: { response: 'hello from remote' } });
    expect(actor.posts[0]).toEqual(expect.objectContaining({ op: [{ url: 'http://example.com' }, '@get'], to: 'Remote' }));
    expect(actor.posts[1]).toEqual(expect.objectContaining({ id: '100', re: { response: 'hello from remote' }, to: 'Tester' }));
  });
});

// ── 2. Cross-call to silent public function ──────────────────────────────────

describe('interop — cross-call to silent public function', () => {
  it('caller spawns notify and replies ack', async () => {
    const actor = await createActor(`
      uses Store {
        notify: (msg: Text) -> .
      }

      @send_notify
        =
        msg: Text
        =
        spawn Store.notify(:msg)
        -> ack: "ok" as Text
    `);
    await actor.sendAsync({ id: '1', op: [{ msg: 'hello' }, '@send_notify'], from: 'Tester', 'bv-a': [{ msg: 'Text' }] });
    expect(actor.posts[0]).toEqual(expect.objectContaining({ op: [{ msg: 'hello' }, '@notify'], to: 'Store' }));
    expect(actor.posts[1]).toEqual(expect.objectContaining({ id: '1', re: { ack: 'ok' }, to: 'Tester' }));
  });

  it('store handles silent notify and check', async () => {
    const script = `
      ref last Text = ""

      @notify
        =
        msg: Text
        =
        last <- msg .

      @check
        =
        -> last: last as Text
    `;
    await expectBehavior(script,
      { input: { id: 'N1', op: [{ msg: 'hello' }, '@notify'], from: 'Caller', 'bv-a': [{ msg: 'Text' }] } },
      { input: { id: '2', op: '@check', from: 'Tester' } },
      { output: expect.objectContaining({ id: '2', re: { last: 'hello' }, to: 'Tester' }) }
    );
  });
});

// ── 3. Three-actor chain ─────────────────────────────────────────────────────

describe('interop — three-actor chain', () => {
  it('backend computes n * 2', async () => {
    const script = `
      @compute
        =
        n: Integer
        =
        -> result: (n * 2) as Integer
    `;
    await expectBehavior(script,
      { input: { id: 'B1', op: [{ n: 5 }, '@compute'], from: 'Middle', 'bv-a': [{ n: 'Integer' }] } },
      { output: expect.objectContaining({ id: 'B1', re: { result: 10 }, to: 'Middle' }) },
    );
  });

  it('middle sends compute to Backend and adds one', async () => {
    const actor = await createActor(`
      uses Backend {
        compute: (n: Integer) -> (result: Integer)
      }

      @process
        =
        n: Integer
        =
        result: Integer = Backend.compute(:n)
        -> result: (result + 1) as Integer
    `);
    await actor.sendAsync({ id: 'M1', op: [{ n: 5 }, '@process'], from: 'Front', 'bv-a': [{ n: 'Integer' }] });
    await actor.sendAsync({ id: '1', re: { result: 10 } });
    expect(actor.posts[0]).toEqual(expect.objectContaining({ op: [{ n: 5 }, '@compute'], to: 'Backend' }));
    expect(actor.posts[1]).toEqual(expect.objectContaining({ id: 'M1', re: { result: 11 }, to: 'Front' }));
  });

  it('front sends process to Middle and replies answer', async () => {
    const actor = await createActor(`
      uses Middle {
        process: (n: Integer) -> (result: Integer)
      }

      @start
        =
        n: Integer
        =
        result: Integer = Middle.process(:n)
        -> answer: result as Integer
    `);
    await actor.sendAsync({ id: 'F1', op: [{ n: 5 }, '@start'], from: 'Tester', 'bv-a': [{ n: 'Integer' }] });
    await actor.sendAsync({ id: '1', re: { result: 11 } });
    expect(actor.posts[0]).toEqual(expect.objectContaining({ op: [{ n: 5 }, '@process'], to: 'Middle' }));
    expect(actor.posts[1]).toEqual(expect.objectContaining({ id: 'F1', re: { answer: 11 }, to: 'Tester' }));
  });
});

// ── 4. Callback ──────────────────────────────────────────────────────────────

describe('interop — callback', () => {
  it('worker calls back Boss for secret and replies', async () => {
    const actor = await createActor(`
      uses Boss {
        get_secret: () -> (secret: Text)
      }

      @process
        =
        secret: Text = Boss.get_secret()
        -> result: secret as Text
    `);
    await actor.sendAsync({ id: 'W1', op: '@process', from: 'Boss' });
    await actor.sendAsync({ id: '1', re: { secret: 's3cret' } });
    expect(actor.posts[0]).toEqual(expect.objectContaining({ op: '@get_secret', to: 'Boss' }));
    expect(actor.posts[1]).toEqual(expect.objectContaining({ id: 'W1', re: { result: 's3cret' }, to: 'Boss' }));
  });

  it('boss sends process to Worker, handles callback, replies', async () => {
    const actor = await createActor(`
      uses Worker {
        process: () -> (result: Text)
      }

      @start
        =
        result: Text = Worker.process()
        -> :result as Text

      @get_secret
        =
        -> secret: "s3cret" as Text
    `);
    await actor.sendAsync({ id: 'B1', op: '@start', from: 'Tester' });
    await actor.sendAsync({ id: 'W1', op: '@get_secret', from: 'Worker' });
    await actor.sendAsync({ id: '1', re: { result: 's3cret' } });
    expect(actor.posts[0]).toEqual(expect.objectContaining({ op: '@process', to: 'Worker' }));
    expect(actor.posts[1]).toEqual(expect.objectContaining({ id: 'W1', re: { secret: 's3cret' }, to: 'Worker' }));
    expect(actor.posts[2]).toEqual(expect.objectContaining({ id: 'B1', re: { result: 's3cret' }, to: 'Tester' }));
  });
});
