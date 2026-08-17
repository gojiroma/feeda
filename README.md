# feeda

サーバー負荷を最小にしたRSSリーダー。フィード本文はブラウザのIndexedDBにのみ保存し、サーバー（Flask + Neon）が扱うのは暗号化済みの「購読リスト」と「既読位置」だけです。サーバー側はシードを保存しないため、購読データを復号できません。

構成:

- `backend/` — Flask API（`/api/sync`, `/api/fetch-feed`）。Neon Postgresに暗号化ブロブを保存するだけで、フィード内容は保存・パースしません。
- `webapp/` — 3ペイン（フィード一覧 / 記事一覧 / プレビュー）のRSSリーダー本体。素のHTML/CSS/JS、ビルド不要。
- `userscript/` — Tampermonkeyスクリプト。閲覧中のページからRSS/Atomフィードを検出し、未登録のものだけ購読リストに自動追加します。

## 1. Neonのセットアップ

1. [Neon](https://neon.tech)でプロジェクトを作成し、接続文字列（`postgresql://...`）を控える。
2. テーブルは`backend`起動時に自動作成されるので、手動でのマイグレーションは不要。

## 2. バックエンド（Flask）をローカルで動かす

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# .env の NEON_DATABASE_URL を実際の接続文字列に、ALLOWED_ORIGIN をwebappのオリジンに書き換える
python app.py
```

`http://localhost:5000/healthz` が `{"status": "ok"}` を返せば起動成功です。

## 3. Vercelへのデプロイ

このリポジトリでは `backend/` をVercelプロジェクトのRoot Directoryに指定してください。

- `backend/vercel.json` がすべてのリクエストを `backend/api/index.py`（Flask WSGIアプリ）にルーティングします。
- Vercelのプロジェクト設定 → Environment Variables に `NEON_DATABASE_URL` と `ALLOWED_ORIGIN`（webappを配信するオリジン）を設定してください。
- フィード取得プロキシ（`/api/fetch-feed`）は対象URLをクエリ文字列ではなく `X-Feed-Url` ヘッダーで受け取ります。これはVercelのリライトを経由すると、クエリ文字列中のスラッシュがエンコードされて元のURLと食い違うことがあるための対策です。

## 4. Webアプリを開く

`webapp/`を任意の静的ホスティング（Vercel、GitHub Pages、あるいはローカルなら`python -m http.server`）で配信し、ブラウザで開きます。

初回起動時にセットアップ画面が表示されます。

- 新規に始める場合は「新しいシードを生成」を押し、表示されたシードを安全な場所に保管してください（**シードを失うと同期データには二度とアクセスできません**）。
- 別端末で既に使っている場合は、そのシードを貼り付けてください。
- 「APIベースURL」には手順3でデプロイしたFlask APIのURL（例: `https://your-app.vercel.app`）を入力します。

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
