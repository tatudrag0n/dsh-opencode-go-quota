# OpenCode Go 利用枠

DeepSeek Harness (DSH) の Web UI に、OpenCode Go の残り利用枠を表示するプラグインです。コンポーザー左側のチップに、いちばん早く尽きる枠の残り％が出ます。クリックすると5時間・週間・月間の内訳とリセット時刻が開きます。

![license](https://img.shields.io/badge/license-MIT-blue) ![slot](https://img.shields.io/badge/slot-conversation.input.left-blue) ![dsh](https://img.shields.io/badge/DSH-0.2.0--rc.2-blue)

英語版は [README.en.md](./README.en.md) にあります。

## 表示内容

チップには3枠のうち残りが最少のものだけを表示します。クリックで開く内訳には3枠すべてが並び、いま最初に尽きる枠がひと目で分かります。

```text
┌─ コンポーザー ─────────────────────────────────┐
│  [● 週 72%]   …                          [送信] │
└───────────────────────────────────────────────┘

クリックで開く内訳:

  OpenCode Go 利用枠                         更新
  ───────────────────────────────────────────────
  5時間                                残り 86%
  ████████████████████░░░░    使用 14%
  リセット 3時間後（10/14 22:57）
  ───────────────────────────────────────────────
  週間                                 残り 72%
  ████████████████░░░░░░░░    使用 28%
  リセット 4日後（10/19 09:00）
  ───────────────────────────────────────────────
  月間                                 残り 85%
  ███████████████████░░░░░    使用 15%
  リセット 29日後（11/13 11:53）
```

数値は実際の表示例です。

各枠は独立した上限を持ちます。OpenCode の仕様では、5時間枠が月間上限の20%、週間枠が50%、月間枠が100%です。モデルごとに月間上限の金額が違うため、表示は金額ではなく「その枠の何％を使ったか」になります。詳しくは [OpenCode Go のドキュメント](https://opencode.ai/v2/docs/console/go/) を参照してください。

チップと棒の色は残量で変わります。残り50%超は緑、20%超50%以下は黄、20%以下は赤です。

## 動作要件

- DSH の Web プロファイル（`connection` サービスを使います）
- OpenCode Go または Go Plus の契約と API キー（`oc_sk_` で始まる文字列）
- DSH が動作する Node.js。このリポジトリは DSH 0.2.0-rc.2 と Node.js 22 で確認しています

## インストール

1. リポジトリを clone します。

```bash
git clone https://github.com/tatudrag0n/dsh-opencode-go-quota.git
```

2. DSH の `plugin_manager` でバンドルをインストールします。`install_bundle` の `target` に clone 先のパスを渡します。

```text
plugin_manager install_bundle  target: /path/to/dsh-opencode-go-quota
```

3. DSH の画面を再読み込みします。コンポーザー左側にチップが出ます。

手動で入れる場合は、プロファイルの `cordis.patch.yml` に次を追記します。

```yaml
- insert:
    - id: opencode-go-quota
      name: '@local/dsh-opencode-go-quota'
```

### API キー

プラグインは Host 側で `OPENCODE_GO_API_KEY` をリクエストごとに解決します。次のどれかで設定してください。

- DSH の設定画面から OpenCode Go（Zen）を接続する。資格情報ストアに入っていればそのまま使われます
- 環境変数 `OPENCODE_GO_API_KEY` を設定する
- DSH が読む `.env` に書く

キーが有効かは curl で確かめられます。

```bash
curl -H "Authorization: Bearer $OPENCODE_GO_API_KEY" https://opencode.ai/zen/go/v1/usage
```

使用率が返れば成功です。

```json
{"usage":{"rolling":{"status":"ok","percent":14,"resetsAt":"2026-10-14T13:57:18.000Z"},"weekly":{"status":"ok","percent":28,"resetsAt":"2026-10-19T00:00:00.000Z"},"monthly":{"status":"ok","percent":14,"resetsAt":"2026-11-13T02:53:31.000Z"}}}
```

## 設定

バンドルの行に `config` を足すと変更できます。すべて任意です。

| キー | 既定値 | 内容 |
|---|---|---|
| `apiKeyEnv` | `OPENCODE_GO_API_KEY` | 解決する資格情報の名前 |
| `baseUrl` | `https://opencode.ai` | 上流のオリジン |
| `refreshSeconds` | `45` | 上流レスポンスのキャッシュ秒数 |
| `timeoutMs` | `15000` | 上流リクエストのタイムアウト |

```yaml
- id: opencode-go-quota
  name: '@local/dsh-opencode-go-quota'
  config:
    refreshSeconds: 120
```

## 仕組み

```text
┌─ ブラウザ ───────────────────────────────┐
│ client.js   チップとポップオーバー        │
│      │ GET api/opencode-go.quota         │
│      │ 同一オリジン・DSHセッションで認証   │
└──────┼───────────────────────────────────┘
       ▼
┌─ DSH Host ───────────────────────────────┐
│ index.js    /api/opencode-go.quota       │
│      │ 資格情報をリクエストごとに解決      │
│      │ 45秒キャッシュ                     │
└──────┼───────────────────────────────────┘
       ▼
  GET https://opencode.ai/zen/go/v1/usage
  Authorization: Bearer <OpenCode Go の API キー>
```

Host 側が認証付きの GET ルート `/api/opencode-go.quota` を登録します。Client 側はそのルートを同一オリジンで取得し、60秒ごとに更新します。

上流は使用率（`percent`）を返すので、プラグインが残り％に変換します。`status` が `ok` 以外の枠は、その値をそのまま表示します。

レスポンスは Host 側で45秒キャッシュします。同じ瞬間に複数のリクエストが来ても、上流を呼ぶのは1回だけです。ポップオーバーの「更新」は `?refresh=1` を付けてキャッシュを飛ばします。

取得に失敗したときは、直前の値を残したまま「前回取得した値を表示しています」と出します。一度も取れていない場合はエラーだけを表示します。失敗の種類は `no-key`、`unauthorized`、`unreachable`、`upstream`、`malformed` の5つです。

## データの扱い

- API キーは Host 側だけで使い、ブラウザには渡しません
- 外部への通信は `baseUrl`（既定は opencode.ai）だけです。テレメトリは送りません
- Client が使うルートは DSH のブラウザセッションで認証されます
- キーはリクエストごとに解決するため、ローテーションのあとに再起動は要りません

## うまく動かないとき

| 症状 | 原因の候補 | 対処 |
|---|---|---|
| チップが出ない | バンドルが有効になっていない | `plugin_manager` で `@local/dsh-opencode-go-quota` が有効か確認する |
| チップが `Go —` になる | キーが見つからない、または拒否された | 上の「API キー」を確認し、curl で試す |
| 数字が実際と合わない | 45秒のキャッシュが効いている | ポップオーバーの「更新」を押す |
| 編集が反映されない | Host 半分は起動時に読み込まれる | バンドルを入れ直すか、DSH を再起動する |
| `unreachable` が出る | ネットワークまたはプロキシ | `baseUrl` への到達を確認する |

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.js` | Host 半分。ルートの登録、上流の取得、キャッシュ |
| `client.js` | Client 半分。チップとポップオーバーの描画 |
| `cordis.patch.yml` | バンドルの行定義 |
| `package.json` | マニフェスト（`dsh.bundle` と `dsh.client`） |
| `locale/en.json`, `locale/ja.json` | Plugin Manager に出る表示名と説明 |
| `icon.svg` | プラグインのアイコン |
| `test/smoke.mjs` | Host 半分のスモークテスト |

## テスト

```bash
node test/smoke.mjs
```

25項目を確認します。資格情報ストアに鍵があれば、実際の API まで叩きます。鍵が無いときの対象はルート登録と「鍵なし」の応答です。

## 反映と再読み込み

Host 半分（`index.js`）はプロセスの起動時に読み込まれます。編集したあとは、バンドルを入れ直すか DSH を再起動してください。Client 半分（`client.js`）も、再読み込みするまで古いバンドルが使われます。

## 制限

- `https://opencode.ai/zen/go/v1/usage` は公式ドキュメントに記載のないエンドポイントです。予告なく変わる可能性があります
- DSH の内部 API（`ctx.connection.fetch`、スロット `conversation.input.left`、テーマトークン）に依存します。Harness の更新で動かなくなることがあります
- OpenCode と DeepSeek Harness のいずれとも無関係の非公式プラグインです
- 利用は OpenCode の利用規約の範囲で行ってください

## ライセンス

MIT。[LICENSE](./LICENSE) を参照してください。
