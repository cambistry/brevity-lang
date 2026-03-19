import { runActor } from './helpers.js';

// ── 1. Two-actor request-reply ───────────────────────────────────────────────

describe('interop — two-actor request-reply', () => {
  const remoteSource = `
    @get
      =
      :url : Text
      =
      -> response: "hello from remote" : Text
  `;

  const primarySource = `
    use Remote

    @call_remote
      =
      :url : Text
      =
      :response : Text = Remote.get(:url : Text)
      -> :response : Text
  `;

  it('remote replies to get request', async () => {
    const posts = await runActor({
      source: remoteSource,
      receive: {
        id: 'R1', op: [{ url: 'http://example.com' }, 'get'],
        from: 'Primary', 'bv-a': [{ url: 'Text' }],
      },
    });
    expect(posts[0]).toEqual(expect.objectContaining({
      id: 'R1', re: { response: 'hello from remote' }, to: 'Primary',
    }));
  });

  it('primary sends get to Remote and forwards response', async () => {
    const posts = await runActor({
      source: primarySource,
      receive: [
        {
          id: '100', op: [{ url: 'http://example.com' }, 'call_remote'],
          from: 'Tester', 'bv-a': [{ url: 'Text' }],
        },
        { id: '1', re: { response: 'hello from remote' } },
      ],
    });
    expect(posts[0]).toEqual(expect.objectContaining({
      op: [{ url: 'http://example.com' }, 'get'], to: 'Remote',
    }));
    expect(posts[1]).toEqual(expect.objectContaining({
      id: '100', re: { response: 'hello from remote' }, to: 'Tester',
    }));
  });
});

// ── 2. Cross-call to silent public function ──────────────────────────────────────────

describe('interop — cross-call to silent public function', () => {
  const callerSource = `
    use Store

    @send_notify
      =
      :msg : Text
      =
      spawn Store.notify(:msg : Text)
      -> ack: "ok" : Text
  `;

  const storeSource = `
    init
    $last : Text = ""

    @notify
      =
      :msg : Text
      =
      $last = msg .

    @check
      =
      -> last: $last : Text
  `;

  it('caller spawns notify and replies ack', async () => {
    const posts = await runActor({
      source: callerSource,
      receive: {
        id: '1', op: [{ msg: 'hello' }, 'send_notify'],
        from: 'Tester', 'bv-a': [{ msg: 'Text' }],
      },
    });
    expect(posts[0]).toEqual(expect.objectContaining({
      op: [{ msg: 'hello' }, 'notify'], to: 'Store',
    }));
    expect(posts[1]).toEqual(expect.objectContaining({
      id: '1', re: { ack: 'ok' }, to: 'Tester',
    }));
  });

  it('store handles init, silent notify, and check', async () => {
    const posts = await runActor({
      source: storeSource,
      receive: [
        { id: 'init-Store', cam: 'init', from: 'system' },
        { id: 'N1', op: [{ msg: 'hello' }, 'notify'], from: 'Caller', 'bv-a': [{ msg: 'Text' }] },
        { id: '2', op: 'check', from: 'Tester' },
      ],
    });
    // posts[0] is init ack, posts[1] is check -> (notify is silent)
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(expect.objectContaining({
      id: '2', re: { last: 'hello' }, to: 'Tester',
    }));
  });
});

// ── 3. Three-actor chain ─────────────────────────────────────────────────────

describe('interop — three-actor chain', () => {
  const backendSource = `
    @compute
      =
      :n : Integer
      =
      -> result: n * 2 : Integer
  `;

  const middleSource = `
    use Backend

    @process
      =
      :n : Integer
      =
      :result : Integer = Backend.compute(:n : Integer)
      -> result: result + 1 : Integer
  `;

  const frontSource = `
    use Middle

    @start
      =
      :n : Integer
      =
      :result : Integer = Middle.process(:n : Integer)
      -> answer: result : Integer
  `;

  it('backend computes n * 2', async () => {
    const posts = await runActor({
      source: backendSource,
      receive: {
        id: 'B1', op: [{ n: 5 }, 'compute'],
        from: 'Middle', 'bv-a': [{ n: 'Integer' }],
      },
    });
    expect(posts[0]).toEqual(expect.objectContaining({
      id: 'B1', re: { result: 10 }, to: 'Middle',
    }));
  });

  it('middle sends compute to Backend and adds one', async () => {
    const posts = await runActor({
      source: middleSource,
      receive: [
        {
          id: 'M1', op: [{ n: 5 }, 'process'],
          from: 'Front', 'bv-a': [{ n: 'Integer' }],
        },
        { id: '1', re: { result: 10 } },
      ],
    });
    expect(posts[0]).toEqual(expect.objectContaining({
      op: [{ n: 5 }, 'compute'], to: 'Backend',
    }));
    expect(posts[1]).toEqual(expect.objectContaining({
      id: 'M1', re: { result: 11 }, to: 'Front',
    }));
  });

  it('front sends process to Middle and replies answer', async () => {
    const posts = await runActor({
      source: frontSource,
      receive: [
        {
          id: 'F1', op: [{ n: 5 }, 'start'],
          from: 'Tester', 'bv-a': [{ n: 'Integer' }],
        },
        { id: '1', re: { result: 11 } },
      ],
    });
    expect(posts[0]).toEqual(expect.objectContaining({
      op: [{ n: 5 }, 'process'], to: 'Middle',
    }));
    expect(posts[1]).toEqual(expect.objectContaining({
      id: 'F1', re: { answer: 11 }, to: 'Tester',
    }));
  });
});

// ── 4. Callback ──────────────────────────────────────────────────────────────

describe('interop — callback', () => {
  const bossSource = `
    use Worker

    @start
      =
      :result : Text = Worker.process()
      -> :result : Text

    @get_secret
      =
      -> secret: "s3cret" : Text
  `;

  const workerSource = `
    use Boss

    @process
      =
      :secret : Text = Boss.get_secret()
      -> result: secret : Text
  `;

  it('worker calls back Boss for secret and replies', async () => {
    const posts = await runActor({
      source: workerSource,
      receive: [
        { id: 'W1', op: 'process', from: 'Boss' },
        { id: '1', re: { secret: 's3cret' } },
      ],
    });
    expect(posts[0]).toEqual(expect.objectContaining({
      op: [{}, 'get_secret'], to: 'Boss',
    }));
    expect(posts[1]).toEqual(expect.objectContaining({
      id: 'W1', re: { result: 's3cret' }, to: 'Boss',
    }));
  });

  it('boss sends process to Worker, handles callback, replies', async () => {
    const posts = await runActor({
      source: bossSource,
      receive: [
        { id: 'B1', op: 'start', from: 'Tester' },
        { id: 'W1', op: 'get_secret', from: 'Worker' },
        { id: '1', re: { result: 's3cret' } },
      ],
    });
    expect(posts[0]).toEqual(expect.objectContaining({
      op: [{}, 'process'], to: 'Worker',
    }));
    expect(posts[1]).toEqual(expect.objectContaining({
      id: 'W1', re: { secret: 's3cret' }, to: 'Worker',
    }));
    expect(posts[2]).toEqual(expect.objectContaining({
      id: 'B1', re: { result: 's3cret' }, to: 'Tester',
    }));
  });
});
