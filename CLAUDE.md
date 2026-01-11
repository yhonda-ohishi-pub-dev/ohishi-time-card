# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

大石社のタイムカード管理システム。以下の構成で新規実装を行う：
- **バックエンド**: Rust + Docker
- **フロントエンド**: TypeScript (Cloudflare)
- **データベース**: 既存のMySQL/MariaDBをそのまま使用
- **アーキテクチャ**: フロントエンドとバックエンドはGitサブモジュールとして管理

### システム構成（中継方式）

ICカードリーダー等の既存クライアントは変更せず、中継サーバーを介して新システムに接続：

```
[ICカードリーダー等]
    ↓ socket.emit("message", {...})  ← 変更なし
[既存Node.jsサーバー :3050]
    ↓ io.emit("hello", data)  ← ブロードキャスト
[Rustサーバー] ← Socket.IOクライアントとして既存サーバーに接続
    ↓ WebSocket or SSE
[Cloudflareフロントエンド]
```

この方式により、既存のICカードリーダーやセンサー類のファームウェア変更が不要。

### 参考リポジトリ

参考用に以下の2つのリポジトリを`-ref`サフィックスでクローン済み：
- `app-ref/` - 既存のNode.js/TypeScript/Express実装（Socket.IO使用）
- `nodeJS_test-ref/` - MariaDBとphpMyAdminのDocker Compose構成

## データベーススキーマ

MySQL/MariaDBデータベース（`db.sql`）は12個のテーブルで構成：
- `drivers` - 従業員/ドライバーマスタデータ（id, name）
- `finger_log` - 指紋認証ログ
- `ic_id` - ICカード登録データ
- `ic_log` - ICカード打刻ログ（出退勤記録）
- `ic_non_reged` - 未登録ICカード記録
- `log` - アプリケーションログ
- `pic_data` - 画像/写真データ保存
- `test` - テスト用データ
- `tmp_data` - 処理用一時データ
- `user_finger_data` - ユーザー指紋生体認証データ
- `user_finger_ids` - ユーザー指紋IDマッピング
- `vapidkey` - Webプッシュ通知用VAPIDキー

データベース接続には以下の環境変数を使用：
- `RDB_HOST` - データベースホスト
- `RDB_USER` - データベースユーザー
- `RDB_PASSWORD` - データベースパスワード
- `RDB_NAME` - データベース名

## 既存アーキテクチャ（参考実装）

`app-ref/`の参考実装は以下を使用：
- **フレームワーク**: Express.js + TypeScript
- **リアルタイム通信**: Socket.IO（WebSocket）
- **データベース**: MySQL2（カスタムクエリラッパー）
- **SSL/TLS**: HTTPS対応（証明書ファイル使用）
- **テンプレートエンジン**: Jade（Pug）
- **ポート**: 3050（HTTPS）

### 主要ルート（参考実装）
- `/` - トップページ
- `/users` - ユーザー管理
- `/api` - APIエンドポイント（`routes/api.ts`にメインロジック）
- `/ic` - ICカード操作
- `/delete_ic` - ICカード削除
- `/drivers` - ドライバー/従業員管理
- `/video` - ビデオストリーム処理
- `/ic_non_reg` - 未登録ICカード処理

### Socket.IOイベント（参考）
- **クライアント→サーバー**: `message`イベント（status, message, data[time, pic_data, name, id]を含む）
- **サーバー→クライアント**: `hello`イベント（ブロードキャスト）
- ステータスタイプ: "tmp inserted", "tmp inserted by ic", "tmp inserted by fing", "tmp inserted wo pic"

## 開発コマンド（参考）

`app-ref/package.json`より：
```bash
npm run dev      # 開発モード（nodemon使用、TypeScriptファイル監視）
npm start        # 本番起動
npm run server   # Socket.IOクライアントテスト実行
npx tsc          # TypeScriptコンパイル
```

## Docker構成（参考）

`nodeJS_test-ref/docker-compose.yml`より：
- **MariaDB**: ポート3306、データは`./maria`に永続化
- **phpMyAdmin**: ポート8888、MariaDBに接続
- **Node.jsアプリ**: ポート3000、`./src`をマウント、起動時に自動コンパイル

`.env`に必要な環境変数：
- `rpassw` - MySQL rootパスワード
- `user` - MySQLユーザー
- `passw` - MySQLパスワード

## 新規実装の方針

Rust バックエンド + TypeScript Cloudflare フロントエンドで実装する際の指針：

1. **Gitサブモジュール**: フロントエンドとバックエンドを別々のサブモジュールとして構成
2. **データベース**: `db.sql`の既存MySQLスキーマとデータを再利用
3. **API互換性**: 参考実装のルートと同様のAPIエンドポイントを維持
4. **リアルタイム機能**:
   - RustサーバーがSocket.IOクライアントとして既存Node.jsサーバーに接続
   - `hello`イベントを受信し、Cloudflareフロントエンドへ中継（WebSocket/SSE）
5. **画像処理**: `pic_data`のbase64エンコード/デコードをサポート
6. **認証**: ICカードと指紋認証の両方に対応

### Rust推奨クレート

- **Webフレームワーク**: `axum` または `actix-web`
- **Socket.IOクライアント**: `rust-socketio`
- **WebSocket**: `tokio-tungstenite`
- **データベース**: `sqlx`（MySQL）
- **非同期ランタイム**: `tokio`

## 引き継ぎ書（Handover）

### 作業開始時
1. `handover/` フォルダの最新ファイルを確認
2. 進行中の作業・次にやるべきことを把握してから作業開始

### 作業終了時
`handover/` フォルダへ引き継ぎ書を作成する。

### ファイル形式
- **保存先**: `handover/YYYY-MM-DD.md`（日付形式）
- **同日に複数回**: `handover/YYYY-MM-DD-2.md` のように連番

### 記載内容（チェックリスト形式）

```markdown
# 引き継ぎ書 YYYY-MM-DD

## 完了タスク
- [x] 完了した作業1
- [x] 完了した作業2

## 進行中の作業
- [ ] 作業中のタスク1
- [ ] 作業中のタスク2

## 次にやるべきこと
- [ ] 次のステップ1
- [ ] 次のステップ2

## 重要な申し送り事項
- 注意点や課題
- 確認が必要な事項
```

## 重要な注意事項

- 既存アプリはHTTPからHTTPSへリダイレクト（ポート3050）
- 画像データはbase64形式でデータベースに保存し、Socket.IOで送信
- システムは永続保存前に一時データを処理する仕組み
- IDが提供されているが名前がない場合、データベースからドライバー名を取得
- HTTPS運用にはSSL証明書が必要
