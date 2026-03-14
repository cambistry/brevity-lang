import { runActors } from './helpers.js';

// ── 1. Two-actor request-reply ───────────────────────────────────────────────

describe('interop — two-actor request-reply', () => {
  it('primary actor calls remote actor and receives response', async () => {
    const external = await runActors({
      actors: {
        Primary: { source: `
          use Remote

          on call_remote(:url : Text)
            :response : Text = Remote.get(:url : Text)
            reply :response : Text
        ` },
        Remote: { source: `
          on get(:url : Text)
            reply response: "hello from remote" : Text
        ` },
      },
      messages: [
        ['Primary', {
          id: '100', op: [{ url: 'http://example.com' }, 'call_remote'],
          from: 'Tester', 'bv-a': [{ url: 'Text' }],
        }],
      ],
    });

    expect(external.find(m => m.id === '100')).toEqual(expect.objectContaining({
      re: { response: 'hello from remote' }, to: 'Tester',
    }));
  });
});

// ── 2. Cross-call to silent handler ──────────────────────────────────────────

describe('interop — cross-call to silent handler', () => {
  it('spawn fires to stateful remote, follow-up confirms state change', async () => {
    const external = await runActors({
      actors: {
        Caller: { source: `
          use Store

          on send_notify(:msg : Text)
            spawn Store.notify(:msg : Text)
            reply ack: "ok" : Text
        ` },
        Store: { source: `
          actor Store

          init
          $last : Text = ""

          on notify(:msg : Text)
            $last = msg
            end

          on check()
            reply last: $last : Text

          end
        `, exportName: 'Store' },
      },
      messages: [
        ['Store', { id: 'init-Store', cam: 'init', from: 'system' }],
        ['Caller', { id: '1', op: [{ msg: 'hello' }, 'send_notify'], from: 'Tester', 'bv-a': [{ msg: 'Text' }] }],
        ['Store', { id: '2', op: 'check', from: 'Tester' }],
      ],
    });

    expect(external.find(m => m.id === '1')).toEqual(expect.objectContaining({
      re: { ack: 'ok' }, to: 'Tester',
    }));
    expect(external.find(m => m.id === '2')).toEqual(expect.objectContaining({
      re: { last: 'hello' }, to: 'Tester',
    }));
  });
});

// ── 3. Three-actor chain ─────────────────────────────────────────────────────

describe('interop — three-actor chain', () => {
  it('result bubbles back through the chain', async () => {
    const external = await runActors({
      actors: {
        Front: { source: `
          use Middle

          on start(:n : Integer)
            :result : Integer = Middle.process(:n : Integer)
            reply answer: result : Integer
        ` },
        Middle: { source: `
          use Backend

          on process(:n : Integer)
            :result : Integer = Backend.compute(:n : Integer)
            reply result: result + 1 : Integer
        ` },
        Backend: { source: `
          on compute(:n : Integer)
            reply result: n * 2 : Integer
        ` },
      },
      messages: [
        ['Front', { id: '1', op: [{ n: 5 }, 'start'], from: 'Tester', 'bv-a': [{ n: 'Integer' }] }],
      ],
    });

    // 5 * 2 = 10, 10 + 1 = 11
    expect(external.find(m => m.id === '1')).toEqual(expect.objectContaining({
      re: { answer: 11 }, to: 'Tester',
    }));
  });
});

// ── 4. Callback ──────────────────────────────────────────────────────────────

describe('interop — callback', () => {
  it('actor 2 calls back actor 1 with different op during request', async () => {
    const external = await runActors({
      actors: {
        Boss: { source: `
          use Worker

          on start()
            :result : Text = Worker.process()
            reply :result : Text

          on get_secret()
            reply secret: "s3cret" : Text
        ` },
        Worker: { source: `
          use Boss

          on process()
            :secret : Text = Boss.get_secret()
            reply result: secret : Text
        ` },
      },
      messages: [
        ['Boss', { id: '1', op: 'start', from: 'Tester' }],
      ],
    });

    expect(external.find(m => m.id === '1')).toEqual(expect.objectContaining({
      re: { result: 's3cret' }, to: 'Tester',
    }));
  });
});
