# feeda

サーバー負荷を最小にしたRSSリーダー。フィード本文はブラウザのIndexedDBにのみ保存し、サーバー（Flask + Neon）が扱うのは暗号化済みの「購読リスト」と「既読位置」だけです。サーバー側はシードを保存しないため、購読データを復号できません。

構成:

- `backend/` — Flask API（`/api/sync`, `/api/fetch-feed`）。Neon Postgresに暗号化ブロブを保存するだけで、フィード内容は保存・パースしません。
- `webapp/` — 3ペイン（フィード一覧 / 記事一覧 / プレビュー）のRSSリーダー本体。素のHTML/CSS/JS、ビルド不要。
- `userscript/` — Tampermonkeyスクリプト。閲覧中のページからRSS/Atomフィードを検出し、未登録のものだけ購読リストに自動追加します。
- `api/index.py`, `vercel.json` — リポジトリ全体を1つのVercelプロジェクトとしてデプロイするためのエントリポイント（Webアプリの静的配信とFlask APIを同一ドメインで提供）。

## 1. Neonのセットアップ

1. [Neon](https://neon.tech)でプロジェクトを作成し、接続文字列（`postgresql://...`）を控える。
2. テーブルは`backend`起動時に自動作成されるので、手動でのマイグレーションは不要。

## 2. バックエンド（Flask）をローカルで動かす

リポジトリのルートで実行します（`requirements.txt`はルート直下にあります）。

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp backend/.env.example backend/.env
# backend/.env の NEON_DATABASE_URL を実際の接続文字列に、ALLOWED_ORIGIN をwebappのオリジンに書き換える
python backend/app.py
```

`http://localhost:5000/api/healthz` が `{"status": "ok"}` を返せば起動成功です。

## 3. Vercelへのデプロイ（Webアプリ + APIを1プロジェクトで）

このリポジトリは**リポジトリのルートをそのままVercelプロジェクトのRoot Directoryとして**デプロイする構成になっています。WebアプリとFlask APIが同一ドメイン・同一デプロイで公開されます。

- `vercel.json` の `outputDirectory: "webapp"` により `webapp/` 配下が静的サイトとして配信されます（`/`が`webapp/index.html`に対応）。
- `vercel.json` の`rewrites`が `/api/*` へのリクエストを `api/index.py`（`backend/`のFlaskアプリをラップしたエントリポイント）にルーティングします。
- `requirements.txt` はルート直下に置いてあります（Vercelのビルドがここから依存関係を検出します）。
- Vercelのプロジェクト設定 → Environment Variables に `NEON_DATABASE_URL` を設定してください。`ALLOWED_ORIGIN` は同一ドメイン配信なら省略可（Webアプリからのfetchは同一オリジンになるためCORSは実質不要）。別ドメインからAPIを叩く場合のみそのオリジンを設定してください。
- フィード取得プロキシ（`/api/fetch-feed`）は対象URLをクエリ文字列ではなく `X-Feed-Url` ヘッダーで受け取ります。これはVercelのリライトを経由すると、クエリ文字列中のスラッシュがエンコードされて元のURLと食い違うことがあるための対策です。

## 4. Webアプリを開く

上記のVercelデプロイ後、そのURL（例: `https://your-app.vercel.app`）を開きます。ローカルでWebアプリだけを動かしたい場合は`webapp/`を`python -m http.server`等で配信してください。

初回起動時にセットアップ画面が表示されます。

- 新規に始める場合は「新しいシードを生成」を押し、表示されたシードを安全な場所に保管してください（**シードを失うと同期データには二度とアクセスできません**）。
- 別端末で既に使っている場合は、そのシードを貼り付けてください。
- 「APIベースURL」は、手順3のように**WebアプリとAPIを同一ドメインでデプロイしている場合は空欄のまま**で構いません（同一オリジンへの相対パスでアクセスします）。ドメインが別の場合のみ、APIのURL（例: `https://your-app.vercel.app`）を入力してください。

## 5. Tampermonkeyスクリプトのインストール

1. ブラウザにTampermonkey拡張機能をインストール。
2. `userscript/feeda-autoregister.user.js` の内容をTampermonkeyの新規スクリプトとして貼り付けて保存。
3. ブラウザのTampermonkeyアイコン → 「feeda: シードとAPIを設定」を選び、Webアプリで使っているシードと同じシード、およびAPIベースURLを入力。
4. 以後、RSS/Atomフィードを持つサイトを開くと、そのページに未登録のフィードがあれば自動的に購読リストへ登録されます（初回、ブラウザからAPIドメインへのアクセス許可を尋ねられる場合があります）。

登録済みのフィードには反応しないよう、フィードIDのローカルキャッシュを6時間ごとにサーバーと突き合わせて更新します。

## 既読/未読の考え方

個別記事ごとのフラグは持たず、フィードごとに「どの時点までを読んだか」（`readUntil`）だけを1つ管理します。

- 記事の投稿日時が `readUntil` より新しければ未読。
- ただし投稿日時が**システムクロック（現在時刻）より未来**の場合は、`readUntil`に関わらず常に既読として扱います。
- 記事を開くと、その記事の投稿日時まで`readUntil`が自動的に進みます（過去には戻りません）。
- フィード一覧の「既読」ボタンで、そのフィードを現在時刻まで一括既読にできます。

## セキュリティ上のメモ

- `/api/fetch-feed` はSSRF対策として、対象ホストを名前解決した実IPがプライベート/ループバック/リンクローカル等でないか検証してから取得します。
- 記事本文はプレビュー表示前にタグ・属性のアローリストでサニタイズしており、`<script>`等は描画されません。
