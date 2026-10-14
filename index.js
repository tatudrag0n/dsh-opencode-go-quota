/**
 * OpenCode Go quota — Host half.
 *
 * Serves one authenticated same-origin GET route (`/api/opencode-go.quota`)
 * reporting how much of the OpenCode Go allowance is left in each metered
 * window: `rolling` (5 hours), `weekly`, and `monthly`.
 *
 * Upstream is `GET https://opencode.ai/zen/go/v1/usage`, which answers with a
 * *used* percentage per window:
 *   { "usage": { "rolling": { "status": "ok", "percent": 11, "resetsAt": "..." },
 *                "weekly":  { ... }, "monthly": { ... } } }
 * The route converts that to remaining percentages and keeps the raw figures,
 * so the Client half never talks to opencode.ai itself and the API key never
 * reaches the browser.
 *
 * The credential is resolved per request through the Harness credential
 * service, so a rotated key reaches the next request without a restart.
 */

const DEFAULT_BASE_URL = 'https://opencode.ai';
const USAGE_PATH = '/zen/go/v1/usage';
/** Authenticated exact route the Client half fetches. */
const ROUTE_PATH = '/api/opencode-go.quota';
const USER_AGENT = 'dsh-opencode-go-quota/1.0';
const WINDOW_KEYS = ['rolling', 'weekly', 'monthly'];

/** `connection` owns the authenticated Fetch-route registry. */
export const inject = ['connection'];

/**
 * Register the usage route.
 * @param ctx - Host context carrying the Connection service.
 * @param config - optional row config (see cordis.patch.yml).
 */
export function apply(ctx, config = {}) {
  const settings = {
    apiKeyEnv: nonEmpty(config.apiKeyEnv) ?? 'OPENCODE_GO_API_KEY',
    baseUrl: (nonEmpty(config.baseUrl) ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    refreshSeconds: positiveNumber(config.refreshSeconds, 45),
    timeoutMs: positiveNumber(config.timeoutMs, 15000),
  };
  const cache = { at: 0, snapshot: undefined, inflight: undefined };

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: ROUTE_PATH,
        methods: ['GET', 'HEAD'],
        requestBody: 'buffered',
        fetch: (request) => respondUsage(ctx, settings, cache, request),
      }),
    'opencode-go-quota: usage route',
  );
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

async function respondUsage(ctx, settings, cache, request) {
  let force = false;
  try {
    force = new URL(request.url).searchParams.get('refresh') === '1';
  } catch {
    force = false;
  }
  const snapshot = await readUsage(ctx, settings, cache, force);
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: JSON_HEADERS });
  return new Response(JSON.stringify(snapshot), { status: 200, headers: JSON_HEADERS });
}

/** Serve the cached snapshot while it is fresh; one upstream call at a time. */
async function readUsage(ctx, settings, cache, force) {
  const now = Date.now();
  if (!force && cache.snapshot !== undefined && now - cache.at < settings.refreshSeconds * 1000) {
    return cache.snapshot;
  }
  if (cache.inflight !== undefined) return cache.inflight;
  const task = fetchUsage(ctx, settings, cache).then((snapshot) => {
    if (snapshot.ok) {
      cache.at = Date.now();
      cache.snapshot = snapshot;
    }
    return snapshot;
  });
  cache.inflight = task;
  try {
    return await task;
  } finally {
    if (cache.inflight === task) cache.inflight = undefined;
  }
}

/** Resolve to a snapshot; a failure keeps the last good windows and marks them stale. */
async function fetchUsage(ctx, settings, cache) {
  const fetchedAt = new Date().toISOString();
  const credential = await resolveApiKey(ctx, settings);
  if (credential === undefined) {
    return failure(cache, fetchedAt, 'no-key', `No OpenCode Go API key: configure the ${settings.apiKeyEnv} credential.`);
  }

  let response;
  try {
    response = await fetch(`${settings.baseUrl}${USAGE_PATH}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${credential.value}`,
        accept: 'application/json',
        'user-agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(settings.timeoutMs),
    });
  } catch (error) {
    return failure(cache, fetchedAt, 'unreachable', `${settings.baseUrl} is unreachable: ${messageOf(error)}`);
  }

  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? 'unauthorized' : 'upstream';
    const hint = code === 'unauthorized' ? ' The API key was refused.' : '';
    return failure(cache, fetchedAt, code, `The usage endpoint answered HTTP ${response.status}.${hint}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    return failure(cache, fetchedAt, 'malformed', `The usage response was not JSON: ${messageOf(error)}`);
  }

  const windows = normalizeWindows(payload);
  if (windows === undefined) {
    return failure(cache, fetchedAt, 'malformed', 'The usage response carried no window data.');
  }
  return {
    ok: true,
    stale: false,
    fetchedAt,
    source: credential.source,
    windows,
  };
}

function failure(cache, fetchedAt, code, message) {
  const previous = cache.snapshot;
  if (previous !== undefined && previous.ok === true) {
    return { ...previous, stale: true, fetchedAt, error: { code, message } };
  }
  return { ok: false, stale: false, fetchedAt, windows: [], error: { code, message } };
}

/** Read the credential per request: process environment, provider store, then `.env`. */
async function resolveApiKey(ctx, settings) {
  const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined;
  if (credentials !== undefined) {
    try {
      const resolved = await credentials.resolve(settings.apiKeyEnv);
      const value = resolved !== undefined && typeof resolved.value === 'string' ? resolved.value.trim() : '';
      if (value !== '') {
        return { value, source: nonEmpty(resolved.source) ?? settings.apiKeyEnv };
      }
    } catch {
      // Fall through to the process environment.
    }
  }
  const fromEnv = process.env[settings.apiKeyEnv];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return { value: fromEnv.trim(), source: 'process env' };
  }
  return undefined;
}

/** Convert upstream used percentages into the remaining shape the widget renders. */
function normalizeWindows(payload) {
  const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : payload;
  if (!isRecord(usage)) return undefined;
  const windows = [];
  for (const key of WINDOW_KEYS) {
    const entry = usage[key];
    if (!isRecord(entry)) continue;
    const used = percent(entry.percent);
    windows.push({
      key,
      status: typeof entry.status === 'string' ? entry.status : 'unknown',
      usedPercent: used,
      remainingPercent: used === undefined ? undefined : round1(100 - used),
      resetsAt: typeof entry.resetsAt === 'string' ? entry.resetsAt : undefined,
    });
  }
  return windows.length === 0 ? undefined : windows;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function percent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return round1(Math.min(100, Math.max(0, value)));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function positiveNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function messageOf(error) {
  if (error instanceof Error && error.name === 'TimeoutError') return 'the request timed out';
  return error instanceof Error ? error.message : String(error);
}
