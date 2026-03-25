import compile from '../../index.js';
import { createActor, expectReply } from '../helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// uses — basic parsing
// ═══════════════════════════════════════════════════════════════════════════════

describe('uses — basic declaration', () => {
  it('uses without manifest compiles', () => {
    expect(() => compile(`
      uses Remote
      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('uses with inline manifest compiles', () => {
    expect(() => compile(`
      uses Remote {
        call: (Text) -> (response: Text)
        ping: () -> .
      }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });

  it('multiple uses declarations compile', () => {
    expect(() => compile(`
      uses Alpha {
        foo: () -> (Integer)
      }
      uses Beta {
        bar: (Text) -> .
      }
      @test = -> 1 as Integer
    `)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// uses — outgoing CAM messages
// ═══════════════════════════════════════════════════════════════════════════════

describe('uses — outgoing CAM messages', () => {
  it('silent send produces correct outgoing message', async () => {
    const actor = await createActor(`
      uses Remote {
        ping: () -> .
      }
      @go = { Remote.ping() . }
    `);
    await actor.sendAsync({ id: '1', op: '@go', from: 'c' });
    const outgoing = actor.posts.find(p => p.to === 'Remote');
    expect(outgoing).toBeDefined();
    expect(outgoing.op).toEqual([{}, '@ping']);
    expect(outgoing.to).toBe('Remote');
  });

  it('uses without manifest — bare call is silent ping', async () => {
    const actor = await createActor(`
      uses Remote
      @go = { Remote.ping() . }
    `);
    await actor.sendAsync({ id: '1', op: '@go', from: 'c' });
    const outgoing = actor.posts.find(p => p.to === 'Remote');
    expect(outgoing).toBeDefined();
    expect(outgoing.op).toEqual([{}, '@ping']);
    expect(outgoing.to).toBe('Remote');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// uses — compile-time checks
// ═══════════════════════════════════════════════════════════════════════════════

describe('uses — compile-time: reject returning remote send result', () => {
  it('-> Remote.call() is rejected', () => {
    expect(() => compile(`
      uses Remote {
        call: (Text) -> (response: Text)
      }
      @go = -> Remote.call("hi")
    `)).toThrow(/remote send.*fire-and-forget/i);
  });

  it('{ -> Remote.call() } is rejected', () => {
    expect(() => compile(`
      uses Remote {
        call: (Text) -> (response: Text)
      }
      @go = { -> Remote.call("hi") }
    `)).toThrow(/remote send.*fire-and-forget/i);
  });

  it('{ Remote.call() . } is allowed (explicit silent)', () => {
    expect(() => compile(`
      uses Remote {
        call: (Text) -> (response: Text)
      }
      @go = { Remote.call("hi") . }
    `)).not.toThrow();
  });
});
