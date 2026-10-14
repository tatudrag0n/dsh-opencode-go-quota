# OpenCode Go Quota — DSH Web plugin

OpenCode Go（月額プラン）の**残り利用枠**を、DeepSeek Harness の Web UI のコンポーザーに常時表示するプラグインです。

![slot](https://img.shields.io/badge/slot-conversation.input.left-blue) ![platform](https://img.shields.io/badge/platform-dsh--web-green)

## できること

- コンポーザー左側のチップに、**いま最も厳しい枠の残り％**を表示（例: `週 72%`）
- クリックで詳細ポップオーバー: 5時間 / 週間 / 月間 の残り％・使用％・リセット時刻
- 60秒ごとの自動更新（ポップオーバーの「更新」で即時更新も可能）
- 残量に応じて緑 → 黄 → 赤に変化
- 日本語 / 英語（DSH のロケールに追従）
- 取得失敗時はエラーを表示しつつ、直前の値を「前回取得した値」として保持

## 仕組み

```
┌─ Browser ─────────────────────────────┐
│  client.js  … チップ + ポップオーバー  │
│      │ fetch("api/opencode-go.quota") │  認証付き・同一オリジン
└──────┼────────────────────────────────┘
       ▼
┌─ DSH Host ────────────────────────────┐
│  index.js   … /api/opencode-go.quota  │
│      │ 資格情報ストアから鍵を都度解決  │
└──────┼────────────────────────────────┘
       ▼
   GET https://opencode.ai/zen/go/v1/usage
   {"usage":{"rolling":{"percent":14,…}, "weekly":{…}, "monthly":{…}}}
```

- 上流は**使用率**（`percent`）を返すので、プラグイン側で**残り％**に変換して表示します。
- API キーは Host 側でのみ扱い、**ブラウザには一切渡りません**。
- 鍵は毎リクエストごとに資格情報ストアから解決するため、ローテーション後も再起動不要です。

## 必要要件

- DeepSeek Harness の **Web プロファイル**（`connection` サービスが必要）
- OpenCode Go / Go Plus の API キー（`oc_sk_...`）

## インストール

```text
plugin_manager install_bundle  target: /path/to/dsh-opencode-go-quota
```

手動で入れる場合は、プロファイルの `cordis.patch.yml` に次を追加します。

```yaml
- insert:
    - id: opencode-go-quota
      name: '@local/dsh-opencode-go-quota'
```

API キーは DSH の資格情報ストア（`$DSH_HOME/.credentials.yaml` の `refs`）か、環境変数 `OPENCODE_GO_API_KEY` に設定してください。設定画面から Zen/Go を接続済みなら、その値がそのまま使われます。

## 設定

`cordis.patch.yml` の行に `config` を足すと変更できます（すべて任意）。

| キー | 既定値 | 説明 |
|---|---|---|
| `apiKeyEnv` | `OPENCODE_GO_API_KEY` | 解決する資格情報の参照名 |
| `baseUrl` | `https://opencode.ai` | 上流オリジン |
| `refreshSeconds` | `45` | 上流レスポンスのキャッシュ秒数 |
| `timeoutMs` | `15000` | 上流リクエストのタイムアウト |

```yaml
- id: opencode-go-quota
  name: '@local/dsh-opencode-go-quota'
  config:
    refreshSeconds: 120
```

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.js` | Host 半分。認証付きルートの登録と上流取得 |
| `client.js` | Client 半分。チップとポップオーバーの描画 |
| `cordis.patch.yml` | バンドルの行定義 |
| `package.json` | マニフェスト（`dsh.bundle` / `dsh.client`） |
| `locale/{en,ja}.json` | Plugin Manager に出す表示名と説明 |
| `icon.svg` | プラグインのアイコン |
| `test/smoke.mjs` | Host 半分のスモークテスト（依存パッケージ不要） |

## テスト

```bash
node test/smoke.mjs
```

資格情報ストアに鍵があれば実 API まで確認します（無い場合は「鍵なし」の挙動だけを検証します）。ネットワーク不要の経路（ルート登録・鍵なし応答）は常に検証されます。

## 注意

- `https://opencode.ai/zen/go/v1/usage` は**公式ドキュメントに記載のないエンドポイント**です。予告なく変更・廃止される可能性があります。
- 参照する DSH の内部 API（`ctx.connection.fetch` / スロット `conversation.input.left` / テーマトークン）は Harness のバージョンで変わることがあります。

## License

MIT — [LICENSE](./LICENSE) を参照してください。

---

## English

A DeepSeek Harness Web plugin that shows the **remaining OpenCode Go allowance** (5-hour, weekly, monthly) as a compact chip in the conversation composer toolbar.

Remaining percentages come from `GET https://opencode.ai/zen/go/v1/usage` (undocumented), fetched by the Host half behind an authenticated same-origin route. The API key stays on the Host; the browser never receives it. The chip shows the tightest window and expands into a popover with all three windows and their reset times. Japanese and English are both supported via the DSH locale service.

Install with `plugin_manager install_bundle` pointing at this directory, and configure the credential reference with `apiKeyEnv` (default `OPENCODE_GO_API_KEY`).
