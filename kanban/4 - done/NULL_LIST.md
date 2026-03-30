describe('List construction — reply', () => {
  it('[] typed as List of Integers is null at runtime', async () => {
    const source = `
      @test
        empty : List of Integers = []
        -> result: empty
    `;
    await expectReply({
      source,
      receive: { id: '1', op: 'test', from: 'caller' },
      reply: {
        id: '1',
        'bv-a': { result: 'List of Integers' },
        re: { result: null },
        to: 'caller',
      },
    });
  });

This seems incorrect. re should contain result: [], however internally represented.
