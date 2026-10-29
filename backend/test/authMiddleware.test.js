const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'middleware-test-secret';
const { verifyToken } = require('../middleware/auth.middleware');

function invoke(authorization) {
  const req = { headers: authorization === undefined ? {} : { authorization } };
  let statusCode;
  let body;
  let continued = false;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  verifyToken(req, res, () => { continued = true; });
  return { req, statusCode, body, continued };
}

test('verifies the backend-issued customer JWT from a Bearer header', () => {
  const token = jwt.sign({ id: 'customer-1', role: 'CUSTOMER' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const result = invoke(`Bearer ${token}`);
  assert.equal(result.continued, true);
  assert.equal(result.req.user.id, 'customer-1');
  assert.equal(result.req.user.role, 'CUSTOMER');
});

test('rejects missing, malformed, and expired tokens as authentication failures', () => {
  const expired = jwt.sign({ id: 'customer-1', role: 'CUSTOMER' }, process.env.JWT_SECRET, { expiresIn: -1 });
  for (const authorization of [undefined, `Token ${expired}`, `Bearer ${expired}`]) {
    const result = invoke(authorization);
    assert.equal(result.continued, false);
    assert.equal(result.statusCode, 401);
  }
});
