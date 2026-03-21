import { runActor } from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Marshal — actor state serialization via cam: "marshal" wire message
// ═══════════════════════════════════════════════════════════════════════════════

describe('marshal — state var', () => {
  let outputs;

  beforeAll(async () => {
    const source = `
      ref x : Integer = 10

      @get
        =
        -> :x
    `;

    outputs = await runActor({
      source,
      receive: [
        { id: '1', cam: 'marshal', from: 'parent' },
      ],
    });
  });

  it('marshal returns state', () => {
    expect(outputs[0]).toEqual({
      id: '1',
      re: { x: 10 },
      to: 'parent',
    });
  });
});
