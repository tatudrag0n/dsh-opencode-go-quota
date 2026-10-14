#!/usr/bin/env node
/**
 * Host-half smoke test — no dependencies, no test framework.
 *
 * `apply()` is mounted against a stub context, so this exercises the real
 * route registration and the real upstream call. The credential is read from
 * the DSH credential store (or `OPENCODE_GO_API_KEY`); when none is available
 * only the offline paths are asserted.
 *
 * Usage:
 *   node test/smoke.mjs
 *   OPENCODE_GO_API_KEY=oc_sk_... node test/smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from '../index.js';

const ROUTE_PATH = '/api/opencode-go.quota';
const failures = [];
let passed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
    return;
  }
  failures.push(name);
  console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`);
}

function credentialStoreKey(reference) {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
  try {
    const text = readFileSync(join(home, '.credentials.yaml'), 'utf8');
    const match = new RegExp(`^\\s*${reference}:\\s*(\\S+)\\s*$`, 'm').exec(text);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/** Stub Host context recording the registered routes and credential lookups. */
function makeContext(key) {
  const routes = [];
  const state = { key, resolveCalls: 0 };
  const ctx = {
    services: {
      credentials: {
        resolve: async () => {
          state.resolveCalls += 1;
          return state.key === undefined ? undefined : { value: state.key, source: 'test store' };
        },
      },
    },
    effect: (fn) => {
      const dispose = fn();
      return () => (typeof dispose === 'function' ? dispose() : undefined);
    },
    get: (name) => ctx.services[name],
    connection: { fetch: { register: (route) => (routes.push(route), async () => {}) } },
  };
  return { ctx, routes, state };
}

function get(route, query = '') {
  return route.fetch(new Request(`http://127.0.0.1${ROUTE_PATH}${query}`));
}

const reference = 'OPENCODE_GO_API_KEY';
const key = process.env[reference] ?? credentialStoreKey(reference);

console.log(`\nHost half (${key === undefined ? 'no credential available' : 'credential found'})`);

// --- Offline: no credential --------------------------------------------------
{
  const { ctx, routes, state } = makeContext(undefined);
  apply(ctx, {});
  check('registers exactly one route', routes.length === 1, `got ${routes.length}`);
  const route = routes[0];
  check('route path', route?.path === ROUTE_PATH, route?.path);
  check('route methods', route?.methods?.join('/') === 'GET/HEAD', route?.methods?.join('/'));
  check('route body mode', route?.requestBody === 'buffered', route?.requestBody);

  const body = await (await get(route)).json();
  check('missing credential degrades instead of throwing', body.ok === false, JSON.stringify(body));
  check('missing credential reports no-key', body.error?.code === 'no-key', body.error?.code);
  check('missing credential resolves the configured reference', state.resolveCalls === 1, `${state.resolveCalls} calls`);
  check('missing credential carries no windows', Array.isArray(body.windows) && body.windows.length === 0);
}

if (key !== undefined) {
  // --- Live: real credential and real upstream -------------------------------
  console.log('\nLive upstream');
  const { ctx, routes, state } = makeContext(key);
  apply(ctx, {});
  const route = routes[0];

  const response = await get(route);
  const body = await response.json();
  check('route answers HTTP 200', response.status === 200, String(response.status));
  check('content type is JSON', response.headers.get('content-type')?.includes('application/json') === true);
  check('response is not cached by the browser', response.headers.get('cache-control') === 'no-store');
  check('live snapshot is ok', body.ok === true, JSON.stringify(body.error ?? body));
  check('live snapshot is not stale', body.stale === false);

  const windows = Array.isArray(body.windows) ? body.windows : [];
  check('three windows reported', windows.length === 3, `got ${windows.length}`);
  const keys = windows.map((entry) => entry.key);
  check('window keys are rolling/weekly/monthly', keys.join(',') === 'rolling,weekly,monthly', keys.join(','));
  check(
    'remaining is the complement of used',
    windows.every((entry) => typeof entry.remainingPercent === 'number' && entry.usedPercent + entry.remainingPercent === 100),
  );
  check(
    'percentages stay within 0..100',
    windows.every(
      (entry) => entry.remainingPercent >= 0 && entry.remainingPercent <= 100 && entry.usedPercent >= 0 && entry.usedPercent <= 100,
    ),
  );
  check('reset timestamps parse', windows.every((entry) => Number.isFinite(Date.parse(entry.resetsAt))));

  for (const entry of windows) {
    console.log(`       ${entry.key.padEnd(8)} used ${String(entry.usedPercent).padStart(5)}%  left ${String(entry.remainingPercent).padStart(5)}%  resets ${entry.resetsAt}`);
  }

  const before = state.resolveCalls;
  await (await get(route)).json();
  check('a second call inside the cache window reuses the snapshot', state.resolveCalls === before);
  await (await get(route, '?refresh=1')).json();
  check('?refresh=1 forces a fresh credential resolution', state.resolveCalls === before + 1, `${state.resolveCalls} calls`);

  const headResponse = await route.fetch(new Request(`http://127.0.0.1${ROUTE_PATH}`, { method: 'HEAD' }));
  check('HEAD answers without a body', headResponse.status === 200 && (await headResponse.text()) === '');
  check('GET after HEAD still answers', (await get(route)).status === 200);

  // --- A refused key must degrade, never throw -------------------------------
  const refused = makeContext('oc_sk_invalid_test_key');
  apply(refused.ctx, {});
  const refusedBody = await (await refused.routes[0].fetch(new Request(`http://127.0.0.1${ROUTE_PATH}?refresh=1`))).json();
  check(
    'refused key degrades with a code',
    refusedBody.error?.code === 'unauthorized' || refusedBody.error?.code === 'unreachable',
    JSON.stringify(refusedBody.error),
  );
  check('refused key keeps the response shape', Array.isArray(refusedBody.windows));

  const stale = makeContext(key);
  apply(stale.ctx, {});
  await get(stale.routes[0]);
  stale.state.key = 'oc_sk_invalid_test_key';
  const staleBody = await (await (stale.routes[0].fetch(new Request(`http://127.0.0.1${ROUTE_PATH}?refresh=1`)))).json();
  if (staleBody.error?.code === 'unauthorized') {
    check('a later failure keeps the last good value as stale', staleBody.stale === true && staleBody.windows.length === 3);
  } else {
    console.log('  skip stale-value check (upstream unreachable from here)');
  }
} else {
  console.log('\nSkip live upstream checks: no OPENCODE_GO_API_KEY and no stored credential.');
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log(`failed: ${failures.join(', ')}`);
  process.exitCode = 1;
}
