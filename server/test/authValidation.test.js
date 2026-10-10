import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLogin, validateRegistration } from '../src/utils/authValidation.js';
import { escapeRegex, parseDoctorListQuery } from '../src/utils/doctorQuery.js';
import { requireRole } from '../src/middleware/auth.js';

test('registration trims the display name and normalizes email', () => {
  assert.deepEqual(validateRegistration({
    name: '  Riley Patient ',
    email: '  Riley@example.com ',
    password: 'long-enough-password',
    role: 'admin',
  }), {
    value: { name: 'Riley Patient', email: 'riley@example.com', password: 'long-enough-password' },
  });
});

test('registration rejects short passwords and invalid emails', () => {
  assert.match(validateRegistration({ name: 'Riley', email: 'bad-email', password: 'short' }).error, /email/i);
  assert.match(validateRegistration({ name: 'Riley', email: 'riley@example.com', password: 'short' }).error, /password/i);
});

test('registration rejects passwords that exceed bcrypt byte limits', () => {
  const password = 'é'.repeat(37);
  assert.ok(Buffer.byteLength(password, 'utf8') > 72);
  assert.match(validateRegistration({ name: 'Riley', email: 'riley@example.com', password }).error, /72 bytes/);
});

test('login normalizes email and rejects malformed credentials', () => {
  assert.deepEqual(validateLogin({ email: '  RILEY@example.com ', password: 'correct horse battery' }), {
    value: { email: 'riley@example.com', password: 'correct horse battery' },
  });
  assert.match(validateLogin({ email: 'nope', password: 'x' }).error, /incorrect/i);
});

test('role middleware blocks a patient from admin-only routes', () => {
  let statusCode;
  let responseBody;
  let continued = false;
  const response = {
    status(code) { statusCode = code; return this; },
    json(body) { responseBody = body; return this; },
  };

  requireRole('admin')({ user: { role: 'patient' } }, response, () => { continued = true; });

  assert.equal(statusCode, 403);
  assert.equal(responseBody.error.code, 'FORBIDDEN');
  assert.equal(continued, false);
});

test('doctor directory query validates pagination and escapes search text', () => {
  assert.deepEqual(parseDoctorListQuery({ q: '  A+B  ', feeMax: '750', page: '2', limit: '10' }), {
    value: { q: 'A+B', specialty: '', page: 2, limit: 10, feeMax: 750 },
  });
  assert.equal(escapeRegex('A+B'), 'A\\+B');
  assert.match(parseDoctorListQuery({ limit: '1000' }).error, /Limit/);
  assert.match(parseDoctorListQuery({ feeMax: '-1' }).error, /feeMax/);
});
