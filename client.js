/**
 * OpenCode Go quota — Client half.
 *
 * Registers one compact chip in the conversation composer tool row. It shows
 * the remaining percentage of the *tightest* OpenCode Go window (5-hour,
 * weekly, or monthly) and expands into a fixed-position popover with all
 * three windows, their used percentage, and their reset time.
 *
 * All figures come from the Host half's authenticated route
 * (`api/opencode-go.quota`); the browser never holds the API key.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-opencode-go-quota',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'opencode-go-quota';
    /** Document-relative form of the Host route, so a mounted app keeps working. */
    const ROUTE = 'api/opencode-go.quota';
    const SLOT = 'conversation.input.left';
    const POLL_MS = 60000;
    const FRESH_MS = 20000;
    const POPOVER_WIDTH = 272;
    const WINDOW_ORDER = ['rolling', 'weekly', 'monthly'];

    const DICTIONARIES = {
      en: {
        title: 'OpenCode Go quota',
        'window.rolling': 'Last 5 hours',
        'window.rolling.short': '5h',
        'window.weekly': 'This week',
        'window.weekly.short': 'wk',
        'window.monthly': 'This month',
        'window.monthly.short': 'mo',
        left: '{n}% left',
        used: '{n}% used',
        unknown: 'unknown',
        reset: 'Resets {when} ({clock})',
        'reset.unknown': 'Reset time unknown',
        'reset.now': 'shortly',
        'duration.minutes': 'in {n} min',
        'duration.hours': 'in {n}h {m}m',
        'duration.days': 'in {n}d {h}h',
        loading: 'Loading…',
        'error.title': 'Quota unavailable',
        refresh: 'Refresh',
        updated: 'Updated {clock}',
        stale: 'Showing the last known value.',
        'aria.details': 'Show OpenCode Go usage details',
      },
      ja: {
        title: 'OpenCode Go 利用枠',
        'window.rolling': '5時間',
        'window.rolling.short': '5時間',
        'window.weekly': '週間',
        'window.weekly.short': '週',
        'window.monthly': '月間',
        'window.monthly.short': '月',
        left: '残り {n}%',
        used: '使用 {n}%',
        unknown: '不明',
        reset: 'リセット {when}（{clock}）',
        'reset.unknown': 'リセット時刻は不明です',
        'reset.now': 'まもなく',
        'duration.minutes': '{n}分後',
        'duration.hours': '{n}時間{m}分後',
        'duration.days': '{n}日{h}時間後',
        loading: '読み込み中…',
        'error.title': '利用枠を取得できません',
        refresh: '更新',
        updated: '{clock} 更新',
        stale: '前回取得した値を表示しています。',
        'aria.details': 'OpenCode Go の利用枠の詳細を表示',
      },
    };

    const TONE_VAR = {
      success: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
    };

    const CSS = `
.oggq-root{display:inline-flex;align-items:center;min-width:0}
.oggq-chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;white-space:nowrap}
.oggq-chip:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.oggq-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.oggq-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-state-idle-primary)}
.oggq-chip-label{font-variant-numeric:tabular-nums}
.oggq-pop{position:fixed;z-index:60;box-sizing:border-box;padding:10px 12px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-overlay);box-shadow:0 12px 32px rgba(0,0,0,.22);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.45}
.oggq-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px}
.oggq-title{font-weight:600}
.oggq-refresh{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;padding:2px 5px;border-radius:6px}
.oggq-refresh:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.oggq-refresh:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.oggq-row{display:grid;grid-template-columns:1fr auto;gap:3px 8px;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.oggq-row:first-of-type{border-top:0}
.oggq-window{color:var(--dsw-alias-label-secondary)}
.oggq-value{font-variant-numeric:tabular-nums;font-weight:600}
.oggq-track{grid-column:1/-1;height:5px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.oggq-fill{display:block;height:100%;border-radius:999px}
.oggq-sub{grid-column:1/-1;display:flex;justify-content:space-between;gap:8px;color:var(--dsw-alias-label-secondary);font-size:11px}
.oggq-note{margin-top:6px;color:var(--dsw-alias-state-warn-primary);font-size:11px}
.oggq-error{margin-top:6px;color:var(--dsw-alias-state-error-primary);font-size:11px;overflow-wrap:anywhere}
.oggq-foot{margin-top:6px;color:var(--dsw-alias-label-secondary);font-size:11px}
.oggq-empty{color:var(--dsw-alias-label-secondary);font-size:11px}
`;

    /** Locale service face captured at apply time; absent in a bare composition. */
    let localeFace;

    function dictionaryFor(localeId) {
      const language = String(localeId ?? 'en').toLowerCase().split('-')[0];
      return DICTIONARIES[language] ?? DICTIONARIES.en;
    }

    function activeLocaleId() {
      try {
        if (localeFace !== undefined && typeof localeFace.getLocale === 'function') {
          const snapshot = localeFace.getLocale();
          const id = snapshot?.id ?? snapshot?.locale ?? snapshot?.language;
          if (typeof id === 'string' && id !== '') return id;
        }
      } catch {
        // Fall through to the browser language.
      }
      const browser = typeof navigator !== 'undefined' ? navigator.language : undefined;
      return typeof browser === 'string' && browser !== '' ? browser : 'en';
    }

    function fill(text, params) {
      if (params === undefined) return text;
      return text.replace(/\{(\w+)\}/g, (match, name) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
      );
    }

    /** Dictionary text, preferring the locale service and never throwing. */
    function t(key, params) {
      try {
        if (localeFace !== undefined && typeof localeFace.bind === 'function') {
          const bound = localeFace.bind(NS);
          const value = bound(key, params);
          if (typeof value === 'string' && value !== '' && value !== key) return value;
        }
      } catch {
        // Fall through to the local dictionary.
      }
      const dictionary = dictionaryFor(activeLocaleId());
      const text = dictionary[key] ?? DICTIONARIES.en[key] ?? key;
      return fill(text, params);
    }

    function formatNumber(value) {
      return Number.isInteger(value) ? String(value) : value.toFixed(1);
    }

    function parseTime(value) {
      if (typeof value !== 'string') return undefined;
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? ms : undefined;
    }

    function formatClock(ms) {
      try {
        return new Date(ms).toLocaleString(undefined, {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch {
        return new Date(ms).toISOString();
      }
    }

    function formatRelative(ms, now) {
      const delta = ms - now;
      if (delta <= 0) return t('reset.now');
      const minutes = Math.max(1, Math.round(delta / 60000));
      if (minutes < 60) return t('duration.minutes', { n: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 48) return t('duration.hours', { n: hours, m: minutes % 60 });
      const days = Math.floor(hours / 24);
      return t('duration.days', { n: days, h: hours % 24 });
    }

    function toneFor(remaining) {
      if (typeof remaining !== 'number') return 'idle';
      if (remaining > 50) return 'success';
      if (remaining > 20) return 'warn';
      return 'error';
    }

    function Styles() {
      return h('style', { dangerouslySetInnerHTML: { __html: CSS } });
    }

    function QuotaWidget() {
      const [snapshot, setSnapshot] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [open, setOpen] = React.useState(false);
      const [anchor, setAnchor] = React.useState(null);
      const [now, setNow] = React.useState(() => Date.now());
      const [, setLocaleRevision] = React.useState(0);
      const chipRef = React.useRef(null);
      const popRef = React.useRef(null);
      const loadedAtRef = React.useRef(0);

      const load = React.useCallback(async (force) => {
        setBusy(true);
        try {
          const response = await fetch(ROUTE + (force ? '?refresh=1' : ''), {
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
          });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const payload = await response.json();
          if (typeof payload !== 'object' || payload === null) throw new Error('malformed response');
          loadedAtRef.current = Date.now();
          setSnapshot(payload);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          loadedAtRef.current = Date.now();
          setSnapshot((current) =>
            current !== null && current.windows !== undefined && current.windows.length > 0
              ? { ...current, stale: true, error: { code: 'client', message } }
              : { ok: false, stale: false, windows: [], error: { code: 'client', message } },
          );
        } finally {
          setBusy(false);
        }
      }, []);

      React.useEffect(() => {
        let alive = true;
        const run = () => {
          if (alive) void load(false);
        };
        run();
        const timer = setInterval(run, POLL_MS);
        const onVisibility = () => {
          if (document.visibilityState === 'visible') run();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
          alive = false;
          clearInterval(timer);
          document.removeEventListener('visibilitychange', onVisibility);
        };
      }, [load]);

      React.useEffect(() => {
        if (localeFace === undefined || typeof localeFace.subscribe !== 'function') return undefined;
        try {
          const dispose = localeFace.subscribe(() => setLocaleRevision((n) => n + 1));
          return typeof dispose === 'function' ? dispose : undefined;
        } catch {
          return undefined;
        }
      }, []);

      React.useEffect(() => {
        if (!open) return undefined;
        const timer = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(timer);
      }, [open]);

      const reposition = React.useCallback(() => {
        const node = chipRef.current;
        if (node === null || typeof node.getBoundingClientRect !== 'function') return;
        const rect = node.getBoundingClientRect();
        const margin = 8;
        const maxLeft = Math.max(margin, window.innerWidth - POPOVER_WIDTH - margin);
        setAnchor({
          left: Math.min(Math.max(margin, rect.left), maxLeft),
          bottom: Math.max(margin, window.innerHeight - rect.top + margin),
        });
      }, []);

      React.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const chip = chipRef.current;
          const pop = popRef.current;
          if (chip !== null && typeof chip.contains === 'function' && chip.contains(event.target)) return;
          if (pop !== null && typeof pop.contains === 'function' && pop.contains(event.target)) return;
          setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          setOpen(false);
          if (chipRef.current !== null && typeof chipRef.current.focus === 'function') chipRef.current.focus();
        };
        const onReflow = () => reposition();
        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('resize', onReflow);
        window.addEventListener('scroll', onReflow, true);
        return () => {
          document.removeEventListener('mousedown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown, true);
          window.removeEventListener('resize', onReflow);
          window.removeEventListener('scroll', onReflow, true);
        };
      }, [open, reposition]);

      const windows = Array.isArray(snapshot?.windows) ? snapshot.windows : [];
      const measured = windows.filter((entry) => typeof entry?.remainingPercent === 'number');
      const tightest =
        measured.length === 0
          ? undefined
          : measured.reduce((lowest, entry) => (entry.remainingPercent < lowest.remainingPercent ? entry : lowest));

      const loading = snapshot === null;
      const failed = snapshot !== null && snapshot.ok !== true;
      const stale = snapshot !== null && snapshot.stale === true;
      const tone = failed ? 'error' : loading ? 'idle' : toneFor(tightest?.remainingPercent);

      const chipText = loading
        ? 'Go …'
        : failed || tightest === undefined
          ? 'Go —'
          : `${t('window.' + tightest.key + '.short')} ${formatNumber(tightest.remainingPercent)}%`;

      const chipTitle = loading
        ? t('title') + ' — ' + t('loading')
        : failed
          ? t('title') + ' — ' + t('error.title')
          : [
              t('title'),
              ...windows.map((entry) => {
                const label = t('window.' + entry.key);
                if (typeof entry.remainingPercent !== 'number') return `${label}: ${t('unknown')}`;
                return `${label}: ${t('left', { n: formatNumber(entry.remainingPercent) })}`;
              }),
            ].join('\n');

      const toggle = () => {
        if (open) {
          setOpen(false);
          return;
        }
        reposition();
        setNow(Date.now());
        setOpen(true);
        if (snapshot === null || Date.now() - loadedAtRef.current > FRESH_MS) void load(true);
      };

      const rows = windows.map((entry) => {
        const remaining = typeof entry.remainingPercent === 'number' ? entry.remainingPercent : undefined;
        const rowTone = toneFor(remaining);
        const resetAt = parseTime(entry.resetsAt);
        const status = typeof entry.status === 'string' && entry.status !== 'ok' && entry.status !== 'unknown' ? entry.status : undefined;
        return h(
          'div',
          { className: 'oggq-row', key: entry.key },
          h('span', { className: 'oggq-window' }, t('window.' + entry.key)),
          h('span', { className: 'oggq-value' }, remaining === undefined ? t('unknown') : t('left', { n: formatNumber(remaining) })),
          h(
            'span',
            { className: 'oggq-track' },
            h('span', {
              className: 'oggq-fill',
              style: { width: `${remaining ?? 0}%`, background: TONE_VAR[rowTone] },
            }),
          ),
          h(
            'span',
            { className: 'oggq-sub' },
            h('span', null, typeof entry.usedPercent === 'number' ? t('used', { n: formatNumber(entry.usedPercent) }) : ''),
            h(
              'span',
              null,
              resetAt === undefined
                ? t('reset.unknown')
                : t('reset', { when: formatRelative(resetAt, now), clock: formatClock(resetAt) }),
            ),
          ),
          status === undefined ? null : h('span', { className: 'oggq-note' }, status),
        );
      });

      const fetchedAt = parseTime(snapshot?.fetchedAt);
      const errorMessage =
        snapshot !== null && typeof snapshot.error?.message === 'string' ? snapshot.error.message : undefined;

      const popover =
        open && anchor !== null
          ? h(
              'div',
              {
                ref: popRef,
                className: 'oggq-pop',
                role: 'dialog',
                'aria-label': t('title'),
                style: { left: anchor.left, bottom: anchor.bottom, width: POPOVER_WIDTH },
              },
              h(
                'div',
                { className: 'oggq-head' },
                h('span', { className: 'oggq-title' }, t('title')),
                h(
                  'button',
                  { type: 'button', className: 'oggq-refresh', onClick: () => void load(true), disabled: busy },
                  t('refresh'),
                ),
              ),
              windows.length === 0
                ? h('div', { className: 'oggq-empty' }, loading ? t('loading') : t('error.title'))
                : rows,
              errorMessage === undefined ? null : h('div', { className: 'oggq-error' }, errorMessage),
              stale ? h('div', { className: 'oggq-note' }, t('stale')) : null,
              fetchedAt === undefined ? null : h('div', { className: 'oggq-foot' }, t('updated', { clock: formatClock(fetchedAt) })),
            )
          : null;

      return h(
        React.Fragment,
        null,
        h(Styles),
        h(
          'span',
          { className: 'oggq-root' },
          h(
            'button',
            {
              type: 'button',
              ref: chipRef,
              className: 'oggq-chip',
              title: chipTitle,
              'aria-label': t('aria.details'),
              'aria-haspopup': 'dialog',
              'aria-expanded': open ? 'true' : 'false',
              onClick: toggle,
            },
            h('span', { className: 'oggq-dot', style: { background: TONE_VAR[tone] } }),
            h('span', { className: 'oggq-chip-label' }, chipText),
          ),
          popover,
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        localeFace = ctx.locale;
        ctx.effect(
          () => {
            const disposeLocales = [];
            for (const [locale, dict] of Object.entries(DICTIONARIES)) {
              try {
                disposeLocales.push(ctx.locale.register(NS, locale, dict));
              } catch {
                // A duplicate or unsupported locale must not take the widget down.
              }
            }
            return () => {
              for (const dispose of disposeLocales) {
                try {
                  dispose();
                } catch {
                  // Disposal is best effort.
                }
              }
            };
          },
          'opencode-go-quota: dictionaries',
        );
        ctx.slots.inject(SLOT, () =>
          ctx.slots.register({ name: SLOT, id: 'opencode-go-quota', order: 20, label: 'OpenCode Go quota' }, QuotaWidget),
        );
      },
    };
  },
});
