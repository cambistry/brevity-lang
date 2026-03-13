import { jest } from '@jest/globals';
import compile from '../index.js';
import { evaluate } from './helpers.js';

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
          // Rewrite 'from' to the sending actor's name before delivery
          actors[to].instance.receive({ ...msg, from: name });
        } else {
          external.push({ from: name, msg });
        }
      },
    };
  }

  // Instantiate after bindings are wired
  for (const [name, actor] of Object.entries(actors)) {
    actor.instance = new actor.Actor(actor.binding);
  }

  return { actors, external };
}

async function compileActor(source, exportName = 'default') {
  const { output } = compile(source);
  const Actor = await evaluate(output, exportName);
  return Actor;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('interop — two-actor request-reply', () => {
  it('primary actor calls remote actor and receives response', async () => {
    const remoteSource = `
      on get(:url : Text)
        reply response: "hello from remote" : Text
    `;

    const primarySource = `
      use Remote

      on call_remote(:url : Text)
        :response : Text = Remote.get(:url : Text)
        reply :response : Text
    `;

    const RemoteActor = await compileActor(remoteSource);
    const PrimaryActor = await compileActor(primarySource);

    const { actors } = createRouter({
      Primary: { Actor: PrimaryActor },
      Remote: { Actor: RemoteActor },
    });

    // Spy on Primary's binding to capture the final reply
    const postSpy = jest.spyOn(actors.Primary.binding, 'post');

    // Send initiating message to Primary
    actors.Primary.instance.receive({
      id: '100',
      op: [{ url: 'http://example.com' }, 'call_remote'],
      from: 'Tester',
      'bv-a': [{ url: 'Text' }],
    });
    await new Promise(r => setTimeout(r, 0));

    // Primary should have replied to Tester (routed to external since no "Tester" actor)
    const replies = postSpy.mock.calls.map(c => c[0]);
    const toRemote = replies.find(m => m.to === 'Remote');
    const toTester = replies.find(m => m.to === 'Tester');

    expect(toRemote).toEqual(expect.objectContaining({
      op: [{ url: 'http://example.com' }, 'get'],
      to: 'Remote',
    }));

    expect(toTester).toEqual(expect.objectContaining({
      id: '100',
      re: { response: 'hello from remote' },
      to: 'Tester',
    }));
  });
});
