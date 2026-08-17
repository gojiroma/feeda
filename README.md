# feeda

サーバー負荷を最小にしたRSSリーダー。フィード本文はブラウザのIndexedDBにのみ保存し、サーバー（Flask + Neon）が扱うのは暗号化済みの「購読リスト」と「既読位置」だけです。サーバー側はシードを保存しないため、購読データを復号できません。

構成:

- `backend/` — Flask API（`/api/sync`, `/api/fetch-feed`）。Neon Postgresに暗号化ブロブを保存するだけで、フィード内容は保存・パースしません。
- `public/` — 3ペイン（フィード一覧 / 記事一覧 / プレビュー）のRSSリーダー本体。素のHTML/CSS/JS、ビルド不要。Vercelの静的ファイル配信規約に合わせて`public/`という名前にしています。
- `userscript/` — Tampermonkeyスクリプト。閲覧中のページからRSS/Atomフィードを検出し、未登録のものだけ購読リストに自動追加します。OPMLファイルからの一括インポートにも対応。
- `api/index.py`, `vercel.json` — リポジトリ全体を1つのVercelプロジェクトとしてデプロイするためのエントリポイント（Webアプリの静的配信とFlask APIを同一ドメインで提供）。

## 1. Neonのセットアップ

1. [Neon](https://neon.tech)でプロジェクトを作成し、接続文字列（`postgresql://...`）を控える。Vercelの「Storage」タブからNeon連携を追加した場合は、この手順は不要です（`DATABASE_URL`/`POSTGRES_URL`が自動で設定されます。下記参照）。
2. テーブルは初回のAPIリクエスト時に自動作成されるので、手動でのマイグレーションは不要。

## 2. バックエンド（Flask）をローカルで動かす

リポジトリのルートで実行します（`requirements.txt`はルート直下にあります）。

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp backend/.env.example backend/.env
# backend/.env の NEON_DATABASE_URL を実際の接続文字列に、ALLOWED_ORIGIN をWebアプリのオリジンに書き換える
python backend/app.py
```

`http://localhost:5000/api/healthz` が `{"status": "ok"}` を返せば起動成功です。

## 3. Vercelへのデプロイ（Webアプリ + APIを1プロジェクトで）

このリポジトリは**リポジトリのルートをそのままVercelプロジェクトのRoot Directoryとして**デプロイする構成になっています。WebアプリとFlask APIが同一ドメイン・同一デプロイで公開されます。

- `vercel.json` は明示的な`builds`/`routes`形式（Flask公式ガイドと同じ、いわゆるBuild Output API v1形式）を使っています。`rewrites`（新しいZero-Config向けの書き方）はWSGIアプリへのキャッチオールでは実際のリクエストパスがFlask側に渡らず、全ルートが404になる問題があったため使っていません。
  - `api/index.py`（`backend/`のFlaskアプリをラップしたエントリポイント）が`@vercel/python`でビルドされ、`/api/*`宛のリクエストはすべてそこにルーティングされます（元のパスがそのままFlaskに渡ります）。
  - `public/**`が`@vercel/static`でビルドされ、それ以外のリクエストは静的ファイルとして配信されます。
- `requirements.txt` はルート直下に置いてあります（Vercelのビルドがここから依存関係を検出します）。
- **データベース接続文字列の環境変数名は`NEON_DATABASE_URL`・`DATABASE_URL`・`POSTGRES_URL`のいずれでも構いません**（この順で探します）。VercelのStorageタブからNeon連携を追加した場合は`DATABASE_URL`/`POSTGRES_URL`が自動設定されるので、追加の設定は不要です。手動でNeonプロジェクトを作った場合はEnvironment Variablesに`NEON_DATABASE_URL`を追加してください。
  - **環境変数の追加・変更は既存のデプロイには反映されません。** 保存後、Deployments画面から最新デプロイを選び「Redeploy」するか、`git push`等で新しいデプロイをトリガーしてください。
- `ALLOWED_ORIGIN` は同一ドメイン配信なら省略可（Webアプリからのfetchは同一オリジンになるためCORSは実質不要）。別ドメインからAPIを叩く場合のみそのオリジンを設定してください。
- フィード取得プロキシ（`/api/fetch-feed`）は対象URLをクエリ文字列ではなく `X-Feed-Url` ヘッダーで受け取ります。これはVercelのリライトを経由すると、クエリ文字列中のスラッシュがエンコードされて元のURLと食い違うことがあるための対策です。
- DB接続に必要な環境変数が無い場合でも`/api/healthz`のようなDBを使わないルートは正常に応答します（データベースへの接続はモジュールのimport時ではなく、実際にDBが必要なリクエストが来たときに初めて行う設計になっているため、設定漏れがサイト全体を巻き込んで落とすことはありません）。

## 4. Webアプリを開く

上記のVercelデプロイ後、そのURL（例: `https://your-app.vercel.app`）を開きます。ローカルでWebアプリだけを動かしたい場合は`public/`を`python -m http.server`等で配信してください。

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

### OPMLの一括インポート

他のRSSリーダーからの乗り換え用に、Tampermonkeyアイコン →「feeda: OPMLをインポート」からOPMLファイルを選択すると、ファイル内の全フィードのうち未登録のものだけをまとめて購読リストに追加できます（登録済みのものは自動的にスキップされます）。

## 既読/未読の考え方

個別記事ごとのフラグは持たず、フィードごとに「どの時点までを読んだか」（`readUntil`）だけを1つ管理します。

- 記事の投稿日時が `readUntil` より新しければ未読。
- ただし投稿日時が**システムクロック（現在時刻）より未来**の場合は、`readUntil`に関わらず常に既読として扱います。
- 記事を開くと、その記事の投稿日時まで`readUntil`が自動的に進みます（過去には戻りません）。
- フィード一覧の「既読」ボタンで、そのフィードを現在時刻まで一括既読にできます。

## セキュリティ上のメモ

- `/api/fetch-feed` はSSRF対策として、対象ホストを名前解決した実IPがプライベート/ループバック/リンクローカル等でないか検証してから取得します。
- 記事本文はプレビュー表示前にタグ・属性のアローリストでサニタイズしており、`<script>`等は描画されません。
