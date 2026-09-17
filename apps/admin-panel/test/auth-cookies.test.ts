import assert from 'node:assert/strict';
import test from 'node:test';
import { authCookies } from '../src/lib/server/auth-cookies';

test('HTTP loopback sign-in and refresh cookies remain usable in Safari', () => {
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173']) {
    const policy = authCookies(new URL(origin));
    assert.equal(policy.accessOptions.secure, false);
    assert.equal(policy.refreshOptions.secure, false);
    assert.equal(policy.refreshName, 'scarline_refresh');
    for (const options of [policy.accessOptions, policy.refreshOptions]) {
      assert.equal(options.httpOnly, true);
      assert.equal(options.sameSite, 'strict');
      assert.equal(options.path, '/');
    }
  }
});

test('HTTPS and non-loopback authentication retain secure cookie protection', () => {
  for (const origin of ['https://localhost:5173', 'https://lab.example.org', 'http://lab.example.org', 'http://localhost.example.org']) {
    const policy = authCookies(new URL(origin));
    assert.equal(policy.accessOptions.secure, true);
    assert.equal(policy.refreshOptions.secure, true);
    assert.equal(policy.refreshName, '__Host-scarline_refresh');
  }
});
