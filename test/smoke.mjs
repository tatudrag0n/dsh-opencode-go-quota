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
import { existsSync, readFileSync } from 'node:fs';
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

// The package name is what the client module system registers a bundle under
// (`entry.id` is the package name), so a rename that leaves any of these three
// places behind loads the bundle without registering it.
const root = join(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const clientSource = readFileSync(join(root, 'client.js'), 'utf8');
const patchSource = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');

check('package is publishable (not private)', manifest.private !== true, String(manifest.private));
check(
  'client bundle registers the package name',
  clientSource.includes(`id: '${manifest.name}'`),
  `expected id: '${manifest.name}'`,
);
check(
  'bundle patch row names the package',
  patchSource.includes(`name: '${manifest.name}'`),
  `expected name: '${manifest.name}'`,
);
check(
  'manifest declares the bundle and client halves',
  manifest.dsh?.bundle?.patch === './cordis.patch.yml' && manifest.dsh?.client?.platform === 'web',
  JSON.stringify(manifest.dsh),
);
for (const file of manifest.files ?? []) {
  const present = file.includes('*') || existsSync(join(root, file));
  check(`published file exists: ${file}`, present, file);
}

// --- Client half: the window picker -----------------------------------------
// client.js registers itself through window.__ModuleLoader__, so a stub loader
// captures the factory and lets the real code run under Node.
const browserSource = readFileSync(join(root, 'client.js'), 'utf8');
const store = new Map();
let clientModule;
globalThis.window = {
  __ModuleLoader__: {
    load(registration) {
      clientModule = registration.factory((name) => {
        if (name !== 'react') throw new Error(`unexpected require: ${name}`);
        return {
          createElement: (type, props, ...children) => ({ type, props, children }),
          Fragment: 'fragment',
          useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
          useRef: (initial) => ({ current: initial }),
          useCallback: (fn) => fn,
          useEffect: () => {},
        };
      });
    },
  },
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  },
};
globalThis.localStorage = globalThis.window.localStorage;
// `navigator` is a getter-only global in Node, so it has to be defined.
Object.defineProperty(globalThis, 'navigator', { value: { language: 'en' }, configurable: true });
globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
globalThis.fetch = async () => {
  throw new Error('network disabled in tests');
};
new Function(browserSource)();
check('client bundle registers through the module loader', clientModule !== undefined);

/** Reach the picker helpers through the registered module's apply(). */
const clientApi = (() => {
  const captured = {};
  clientModule.apply({
    locale: { register: () => () => {}, bind: () => (key) => key, subscribe: () => () => {} },
    effect: (fn) => fn(),
    slots: {
      inject: (_slot, fn) => fn(),
      register: (meta, component) => {
        captured.meta = meta;
        captured.component = component;
        return () => {};
      },
    },
  });
  return captured;
})();
check('client registers the composer slot', clientApi.meta?.name === 'conversation.input.left');

/**
 * Render the widget with a stubbed React that records the element tree, then
 * read the chip label and the pressed state of each picker option.
 */
function renderWidget(windows) {
  // Seed the snapshot so the first render already carries data; the widget's
  // own fetch is stubbed out below and never resolves.
  const seeded = { ok: true, stale: false, fetchedAt: new Date(0).toISOString(), windows };
  let stateIndex = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: 'fragment',
    useState: (initial) => {
      // QuotaWidget's state order, so the first render has data and the popover
      // open: snapshot, busy, open, anchor, now, visible, localeRevision.
      const values = [seeded, false, true, { left: 0, bottom: 0 }, 0, undefined, 0];
      const slot = stateIndex++;
      const value = values[slot];
      return [value === undefined ? (typeof initial === 'function' ? initial() : initial) : value, () => {}];
    },
    useRef: (initial) => ({ current: initial }),
    useCallback: (fn) => fn,
    useEffect: () => {},
  };
  const previousRequire = globalThis.window.__ModuleLoader__.load;
  let factory;
  globalThis.window.__ModuleLoader__.load = (registration) => {
    factory = registration.factory;
  };
  new Function(browserSource)();
  const mod = factory((name) => {
    if (name !== 'react') throw new Error(`unexpected require: ${name}`);
    return React;
  });
  globalThis.window.__ModuleLoader__.load = previousRequire;
  let component;
  mod.apply({
    locale: { register: () => () => {}, bind: () => (key) => key, subscribe: () => () => {} },
    effect: (fn) => fn(),
    slots: { inject: (_slot, fn) => fn(), register: (_meta, c) => ((component = c), () => {}) },
  });
  // The widget fetches on mount; the stub fetch rejects, which the catch handles.
  stateIndex = 0;
  const tree = component();
  const find = (node, predicate, out = []) => {
    if (node === null || typeof node !== 'object') return out;
    if (predicate(node)) out.push(node);
    for (const child of node.children ?? []) {
      if (Array.isArray(child)) for (const entry of child) find(entry, predicate, out);
      else find(child, predicate, out);
    }
    return out;
  };
  const chip = find(tree, (n) => n.props?.className === 'oggq-chip')[0];
  const label = find(chip, (n) => n.props?.className === 'oggq-chip-label')[0];
  // The picker lives inside the popover, which only mounts when it is open;
  // find it anywhere in the tree so the assertion does not depend on that.
  const options = find(tree, (n) => typeof n.props?.className === 'string' && n.props.className.startsWith('oggq-opt'));
  return {
    chipText: label?.children?.[0],
    pressed: options.filter((n) => n.props['aria-pressed'] === 'true').map((n) => n.children?.[0]),
    optionCount: options.length,
  };
}

const threeWindows = [
  { key: 'rolling', remainingPercent: 86, usedPercent: 14, status: 'ok' },
  { key: 'weekly', remainingPercent: 72, usedPercent: 28, status: 'ok' },
  { key: 'monthly', remainingPercent: 85, usedPercent: 15, status: 'ok' },
];

store.clear();
const autoView = renderWidget(threeWindows);
check('default chip reports the tightest window', autoView.chipText === 'wk 72%', autoView.chipText);
check('picker offers auto plus three windows', autoView.optionCount === 4, String(autoView.optionCount));
check('picker starts on auto', JSON.stringify(autoView.pressed) === JSON.stringify(['Tightest']), JSON.stringify(autoView.pressed));

store.set('dsh.opencode-go-quota.visibleWindows', 'rolling,monthly');
const pinnedView = renderWidget(threeWindows);
check(
  'pinned windows render in WINDOW_ORDER, not stored order',
  pinnedView.chipText === '5h 86% · mo 85%',
  pinnedView.chipText,
);
check(
  'pinned options are marked pressed',
  JSON.stringify(pinnedView.pressed) === JSON.stringify(['5h', 'mo']),
  JSON.stringify(pinnedView.pressed),
);

store.set('dsh.opencode-go-quota.visibleWindows', 'monthly');
const singleView = renderWidget(threeWindows);
check('a single pinned window shows alone', singleView.chipText === 'mo 85%', singleView.chipText);

store.set('dsh.opencode-go-quota.visibleWindows', 'bogus,,weekly');
const junkView = renderWidget(threeWindows);
check('unknown keys are dropped, valid ones kept', junkView.chipText === 'wk 72%', junkView.chipText);

store.set('dsh.opencode-go-quota.visibleWindows', 'bogus');
const allJunkView = renderWidget(threeWindows);
check('an unusable preference falls back to auto', allJunkView.chipText === 'wk 72%', allJunkView.chipText);

store.set('dsh.opencode-go-quota.visibleWindows', 'rolling,weekly,monthly');
const allView = renderWidget(threeWindows);
check('all three pinned shows all three', allView.chipText.split(' · ').length === 3, allView.chipText);

store.clear();
const emptyView = renderWidget([]);
check('no data still renders a chip', emptyView.chipText === 'Go —', emptyView.chipText);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log(`failed: ${failures.join(', ')}`);
  process.exitCode = 1;
}
