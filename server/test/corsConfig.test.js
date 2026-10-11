import test from 'node:test';
import assert from 'node:assert/strict';
import { getAllowedClientOrigins } from '../src/config/cors.js';

test('development CORS defaults to the local Vite origin', () => {
  assert.deepEqual(getAllowedClientOrigins({ nodeEnv: 'development' }), ['http://localhost:5173']);
});

test('production CORS requires an explicit HTTPS frontend origin', () => {
  assert.throws(
    () => getAllowedClientOrigins({ nodeEnv: 'production' }),
    /CLIENT_URL is required/,
  );
  assert.throws(
    () => getAllowedClientOrigins({ clientUrl: 'http://medibook.example', nodeEnv: 'production' }),
    /HTTPS/,
  );
  assert.deepEqual(
    getAllowedClientOrigins({ clientUrl: 'https://medibook.example', nodeEnv: 'production' }),
    ['https://medibook.example'],
  );
});

test('CORS allows only configured exact origins and rejects wildcard or path values', () => {
  assert.deepEqual(
    getAllowedClientOrigins({
      clientUrl: 'https://medibook.example, https://preview.medibook.example',
      nodeEnv: 'production',
    }),
    ['https://medibook.example', 'https://preview.medibook.example'],
  );
  assert.throws(
    () => getAllowedClientOrigins({ clientUrl: '*', nodeEnv: 'production' }),
    /valid frontend origin URLs|exact origin URLs/,
  );
  assert.throws(
    () => getAllowedClientOrigins({ clientUrl: 'https://medibook.example/app', nodeEnv: 'production' }),
    /exact origin URLs/,
  );
});
