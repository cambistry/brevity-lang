import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

const tick = () => new Promise(r => setTimeout(r, 0));

/**
 * Mini-router: wires actors together by name.
 * Each actor's binding.post routes messages to the target actor's receive(),
 * or collects them as "external" if no matching actor exists.
 */
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

async function initActor(router, name) {
  router.actors[name].instance.receive({ id: `init-${name}`, cam: 'init', from: 'system' });
  await tick();
}

// ── 1. Two-actor request-reply ───────────────────────────────────────────────

describe('interop — two-actor request-reply', () => {
  it('primary actor calls remote actor and receives response', async () => {
    const RemoteActor = await compileActor(`
      on get(:url : Text)
        reply response: "hello from remote" : Text
    `);

    const PrimaryActor = await compileActor(`
      use Remote

      on call_remote(:url : Text)
        :response : Text = Remote.get(:url : Text)
        reply :response : Text
    `);

    const router = createRouter({
      Primary: { Actor: PrimaryActor },
      Remote: { Actor: RemoteActor },
    });

    const postSpy = jest.spyOn(router.actors.Primary.binding, 'post');

    router.actors.Primary.instance.receive({
      id: '100',
      op: [{ url: 'http://example.com' }, 'call_remote'],
      from: 'Tester',
      'bv-a': [{ url: 'Text' }],
    });
    await tick();

    const replies = postSpy.mock.calls.map(c => c[0]);
    expect(replies.find(m => m.to === 'Remote')).toEqual(expect.objectContaining({
      op: [{ url: 'http://example.com' }, 'get'], to: 'Remote',
    }));
    expect(replies.find(m => m.to === 'Tester')).toEqual(expect.objectContaining({
      id: '100', re: { response: 'hello from remote' }, to: 'Tester',
    }));
  });
});

// ── 2. Cross-call to silent handler ──────────────────────────────────────────

describe('interop — cross-call to silent handler', () => {
  it('spawn fires to stateful remote, follow-up confirms state change', async () => {
    const StoreActor = await compileActor(`
      actor Store

      init
      $last : Text = ""

      on notify(:msg : Text)
        $last = msg
        end

      on check()
        reply last: $last : Text

      end
    `, 'Store');

    const CallerActor = await compileActor(`
      use Store

      on send_notify(:msg : Text)
        spawn Store.notify(:msg : Text)
        reply ack: "ok" : Text
    `);

    const router = createRouter({
      Caller: { Actor: CallerActor },
      Store: { Actor: StoreActor },
    });
    await initActor(router, 'Store');

    // Send notify through Caller
    router.actors.Caller.instance.receive({
      id: '1', op: [{ msg: 'hello' }, 'send_notify'],
      from: 'Tester', 'bv-a': [{ msg: 'Text' }],
    });
    await tick();

    // Caller should have replied ack
    const ack = router.external.find(m => m.id === '1');
    expect(ack).toEqual(expect.objectContaining({
      id: '1', re: { ack: 'ok' }, to: 'Tester',
    }));

    // Directly query Store to confirm state was updated
    router.actors.Store.instance.receive({
      id: '2', op: 'check', from: 'Tester',
    });
    await tick();

    const check = router.external.find(m => m.id === '2');
    expect(check).toEqual(expect.objectContaining({
      id: '2', re: { last: 'hello' }, to: 'Tester',
    }));
  });
});

// ── 3. Three-actor chain ─────────────────────────────────────────────────────

describe('interop — three-actor chain', () => {
  it('result bubbles back through the chain', async () => {
    const BackendActor = await compileActor(`
      on compute(:n : Integer)
        reply result: n * 2 : Integer
    `);

    const MiddleActor = await compileActor(`
      use Backend

      on process(:n : Integer)
        :result : Integer = Backend.compute(:n : Integer)
        reply result: result + 1 : Integer
    `);

    const FrontActor = await compileActor(`
      use Middle

      on start(:n : Integer)
        :result : Integer = Middle.process(:n : Integer)
        reply answer: result : Integer
    `);

    const router = createRouter({
      Front: { Actor: FrontActor },
      Middle: { Actor: MiddleActor },
      Backend: { Actor: BackendActor },
    });

    router.actors.Front.instance.receive({
      id: '1', op: [{ n: 5 }, 'start'],
      from: 'Tester', 'bv-a': [{ n: 'Integer' }],
    });
    await tick();

    // 5 * 2 = 10, 10 + 1 = 11
    const reply = router.external.find(m => m.id === '1');
    expect(reply).toEqual(expect.objectContaining({
      id: '1', re: { answer: 11 }, to: 'Tester',
    }));
  });
});

// ── 4. Callback ──────────────────────────────────────────────────────────────

describe('interop — callback', () => {
  it('actor 2 calls back actor 1 with different op during request', async () => {
    // Actor1 calls Actor2.process, Actor2 calls back Actor1.get_secret,
    // Actor1 replies with the secret, Actor2 uses it to reply to Actor1
    const Actor1 = await compileActor(`
      use Worker

      on start()
        :result : Text = Worker.process()
        reply :result : Text

      on get_secret()
        reply secret: "s3cret" : Text
    `);

    const Actor2 = await compileActor(`
      use Boss

      on process()
        :secret : Text = Boss.get_secret()
        reply result: secret : Text
    `);

    const router = createRouter({
      Boss: { Actor: Actor1 },
      Worker: { Actor: Actor2 },
    });

    router.actors.Boss.instance.receive({
      id: '1', op: 'start', from: 'Tester',
    });
    await tick();

    const reply = router.external.find(m => m.id === '1');
    expect(reply).toEqual(expect.objectContaining({
      id: '1', re: { result: 's3cret' }, to: 'Tester',
    }));
  });
});
