# OpenCode Go quota for DeepSeek Harness

Shows how much of your OpenCode Go allowance is left, inside the DeepSeek Harness (DSH) web UI. A chip in the composer toolbar reports the window you will hit first. Click it to see the 5-hour, weekly, and monthly windows with their used share and reset times.

The plugin calls `GET https://opencode.ai/zen/go/v1/usage`, converts the used percentage of each window into the remaining percentage, and refreshes every 60s. Your API key stays on the DSH host and never reaches the browser.

Japanese documentation: [README.md](./README.md).

## What the chip shows

A Go subscription meters usage in three windows, so the chip reports the one that will run out first. The popover lists all three.

```text
┌─ composer ─────────────────────────────────────┐
│  [● wk 72%]   …                          [send] │
└───────────────────────────────────────────────┘

The popover behind a click:

  OpenCode Go quota                       refresh
  ───────────────────────────────────────────────
  5-hour                                86% left
  ████████████████████░░░░    14% used
  Resets in 3h 0m (10/14 22:57)
  ───────────────────────────────────────────────
  Weekly                                72% left
  ████████████████░░░░░░░░    28% used
  Resets in 4d 0h (10/19 09:00)
  ───────────────────────────────────────────────
  Monthly                               85% left
  ███████████████████░░░░░    15% used
  Resets in 29d 0h (11/13 11:53)
```

The numbers above come from a live reading.

Each window has its own cap. OpenCode documents the 5-hour window as 20% of the monthly limit, the weekly window as 50%, and the monthly window as 100%. Monthly limits differ by model, so the plugin reports a share of each window instead of a dollar figure. The [OpenCode Go documentation](https://opencode.ai/v2/docs/console/go/) lists the limits and prices.

The chip and the bars change color with what is left: green above 50%, amber from 20% to 50%, red at or below 20%.

## Requirements

- A DSH web profile, because the plugin uses the `connection` service.
- An OpenCode Go or Go Plus subscription and its API key, which starts with `oc_sk_`.
- Node.js as required by your DSH release. This repository is tested with DSH 0.2.0-rc.2 on Node.js 22.

## Install the plugin

1. Clone the repository.

```bash
git clone https://github.com/tatudrag0n/dsh-opencode-go-quota.git
```

2. Install the bundle with `plugin_manager`. Pass the clone path as the `target` of `install_bundle`.

```text
plugin_manager install_bundle  target: /path/to/dsh-opencode-go-quota
```

3. Reload the DSH page. The chip appears on the left of the composer tool row.

For a manual install, add this row to the profile `cordis.patch.yml`.

```yaml
- insert:
    - id: opencode-go-quota
      name: '@local/dsh-opencode-go-quota'
```

### Set the API key

The host resolves `OPENCODE_GO_API_KEY` on every request. Set it in one of these places:

- Connect OpenCode Go (Zen) in the DSH settings. The credential store value is used as is.
- Export `OPENCODE_GO_API_KEY` in the environment.
- Write it into a `.env` file that DSH reads.

Check the key with curl:

```bash
curl -H "Authorization: Bearer $OPENCODE_GO_API_KEY" https://opencode.ai/zen/go/v1/usage
```

A working key returns the used share of each window.

```json
{"usage":{"rolling":{"status":"ok","percent":14,"resetsAt":"2026-10-14T13:57:18.000Z"},"weekly":{"status":"ok","percent":28,"resetsAt":"2026-10-19T00:00:00.000Z"},"monthly":{"status":"ok","percent":14,"resetsAt":"2026-11-13T02:53:31.000Z"}}}
```

## Configuration

Add `config` to the bundle row. Every field is optional.

| Field | Default | Purpose |
|---|---|---|
| `apiKeyEnv` | `OPENCODE_GO_API_KEY` | Credential name to resolve |
| `baseUrl` | `https://opencode.ai` | Upstream origin |
| `refreshSeconds` | `45` | Cache lifetime for the upstream response |
| `timeoutMs` | `15000` | Upstream request timeout |

```yaml
- id: opencode-go-quota
  name: '@local/dsh-opencode-go-quota'
  config:
    refreshSeconds: 120
```

## How it works

```text
┌─ Browser ────────────────────────────────┐
│ client.js   chip and popover             │
│      │ GET api/opencode-go.quota         │
│      │ same origin, DSH browser session  │
└──────┼───────────────────────────────────┘
       ▼
┌─ DSH host ───────────────────────────────┐
│ index.js    /api/opencode-go.quota       │
│      │ resolves the credential per call  │
│      │ caches the response for 45s       │
└──────┼───────────────────────────────────┘
       ▼
  GET https://opencode.ai/zen/go/v1/usage
  Authorization: Bearer <OpenCode Go API key>
```

The host registers an authenticated `GET /api/opencode-go.quota` route. The client reads that route from the same origin and polls it every 60s.

The upstream endpoint returns the used share in `percent`, so the plugin computes what is left. A window whose `status` is not `ok` is displayed with the value it reports.

The host caches the response for 45s and allows one upstream call at a time, so a burst of client requests still costs one call. The refresh button in the popover sends `?refresh=1`, which skips the cache.

When a call fails, the widget keeps the last reading and labels it as the previous value. With no reading yet, it shows the error only. Failure codes are `no-key`, `unauthorized`, `unreachable`, `upstream`, and `malformed`.

## Where your key goes

- The host reads the key and sends it to `baseUrl`, which is opencode.ai by default, and to no other host.
- The browser never receives the key. The client reads an authenticated same-origin route instead.
- The plugin sends no telemetry.
- The key is resolved per request, so rotating it takes effect on the next call without a restart.

## Fix a missing or wrong reading

| Symptom | Likely cause | Fix |
|---|---|---|
| No chip | The bundle is not enabled | Check that `@local/dsh-opencode-go-quota` is enabled in `plugin_manager` |
| The chip reads `Go —` | The key is missing or refused | Follow [Set the API key](#set-the-api-key) above, then test with curl |
| Numbers lag reality | The 45s cache is serving a stored response | Click refresh in the popover |
| An edit does nothing | The host half loads at process start | Reinstall the bundle or restart DSH |
| `unreachable` | Network or proxy | Check that `baseUrl` is reachable from the DSH host |

## Repository layout

| File | Role |
|---|---|
| `index.js` | Host half: route registration, upstream call, cache |
| `client.js` | Client half: chip and popover rendering |
| `cordis.patch.yml` | Bundle row definition |
| `package.json` | Manifest (`dsh.bundle` and `dsh.client`) |
| `locale/en.json`, `locale/ja.json` | Display name and description for the plugin manager |
| `icon.svg` | Plugin icon |
| `test/smoke.mjs` | Host-half smoke test |

## Run the tests

```bash
node test/smoke.mjs
```

The suite runs 25 checks. With a key in the credential store it calls the live endpoint. Without one it verifies route registration and the no-key response.

## Reload after a change

The host half (`index.js`) loads when the process starts, so reinstall the bundle or restart DSH after an edit. The browser keeps the previous client bundle until you reload the page.

## Limitations

- `https://opencode.ai/zen/go/v1/usage` is not documented, so it can change or disappear without notice.
- The plugin depends on DSH internals: `ctx.connection.fetch`, the `conversation.input.left` slot, and theme tokens. A Harness update can break it.
- This plugin is unofficial and is not affiliated with OpenCode or DeepSeek Harness.
- Use it within the OpenCode terms of service.

## License

MIT. See [LICENSE](./LICENSE).
