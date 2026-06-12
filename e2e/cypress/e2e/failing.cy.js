describe('smoke', () => {
  it('fails on purpose', () => {
    expect(1 + 1, 'deliberate smoke-test failure').to.equal(3);
  });
});
