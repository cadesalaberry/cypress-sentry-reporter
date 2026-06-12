describe('smoke', () => {
  it('fails on purpose', () => {
    expect(true, 'deliberate failure for the Sentry smoke test').to.equal(
      false,
    );
  });
});
