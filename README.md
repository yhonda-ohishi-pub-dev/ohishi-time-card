# 大石社タイムカードシステム

ICカード・指紋認証による出退勤管理システム

## システム概要

| コンポーネント | 技術スタック |
|---------------|-------------|
| バックエンド | Rust + Docker |
| フロントエンド | TypeScript (Cloudflare Workers) |
| データベース | MySQL/MariaDB |
| クライアント | Python/wxPython (Windows) |

## システムアーキテクチャ

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              システム全体構成                                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  ICカードリーダー  │     │   指紋認証装置    │     │    体温計測器    │
│  (Windows PC)   │     │   (Windows PC)  │     │   (Windows PC)  │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    socket.emit("message", {...})
                                 ▼
                  ┌──────────────────────────────┐
                  │   既存 Node.js サーバー        │
                  │        :3050 (HTTPS)         │
                  └──────────────┬───────────────┘
                                 │
                    io.emit("hello", data)
                                 ▼
                  ┌──────────────────────────────┐
                  │      Rust API サーバー        │
                  │   (Socket.IO クライアント)     │
                  │      + HTTP REST API         │
                  └──────────────┬───────────────┘
                                 │
                         WebSocket / SSE
                                 ▼
                  ┌──────────────────────────────┐
                  │  Cloudflare Workers          │
                  │     (フロントエンド)           │
                  └──────────────────────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │      Web ブラウザ             │
                  │  (PC / Android Chrome)       │
                  └──────────────────────────────┘
```

## ICカード登録フロー

### 方法1: 未登録IC → Webアプリで登録

現場のPythonクライアントで検出された未登録ICを、後からWebアプリで登録する方式。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        未登録IC登録フロー                                    │
└─────────────────────────────────────────────────────────────────────────────┘

[1] ICカードタッチ（Pythonクライアント）
         │
         ▼
    ┌─────────┐
    │ 登録済み？ │
    └────┬────┘
         │
    ┌────┴────┐
    │         │
   YES        NO
    │         │
    ▼         ▼
 打刻完了   ic_non_reged に記録
            「再度ICをかざしてください」
                   │
                   ▼
[2] Webアプリ（/ic_non_reg）で社員番号を入力
         │
         ▼
    registered_id を設定
         │
         ▼
[3] 再度ICカードタッチ（Pythonクライアント）
         │
         ▼
    find_ic_id() で registered_id 発見
         │
         ▼
    ic_id テーブルに登録
    (MariaDB + ローカルSQLite)
         │
         ▼
    deleted = 1 に更新
         │
         ▼
    登録完了 ✓
```

### 方法2: Web NFC で直接登録（/ic_register）

Android Chrome + Web NFC でその場でICカードを登録する方式。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Web NFC 登録フロー                                    │
└─────────────────────────────────────────────────────────────────────────────┘

[1] Android Chrome で /ic_register にアクセス
         │
         ▼
[2] ドライバーID入力 + 「スキャン」ボタン
         │
         ▼
[3] ICカード 1回目タッチ → IC ID取得
         │
         ▼
[4] ICカード 2回目タッチ → 一致確認
         │
         ▼
    ┌─────────┐
    │  一致？   │
    └────┬────┘
         │
    ┌────┴────┐
    │         │
   YES        NO
    │         │
    ▼         ▼
 ic_non_reged   エラー表示
 に登録         リセット
 (registered_id
  = driver_id)
    │
    ▼
[5] Pythonクライアントで次回タッチ時
         │
         ▼
    ic_id に登録（両DB同期）
         │
         ▼
    登録完了 ✓
```

**設計理由**: Pythonクライアントのローカル SQLite にも `ic_id` を反映させるため、`ic_non_reged` 経由で登録する。

## データベース構成

### テーブル一覧

| テーブル名 | 用途 |
|-----------|------|
| `drivers` | 従業員/ドライバーマスタ |
| `ic_id` | ICカード登録データ |
| `ic_log` | ICカード打刻ログ |
| `ic_non_reged` | 未登録ICカード記録 |
| `finger_log` | 指紋認証ログ |
| `user_finger_data` | 指紋生体認証データ |
| `user_finger_ids` | 指紋IDマッピング |
| `tmp_data` | 体温データ |
| `pic_data` | 画像データ |
| `log` | アプリケーションログ |
| `vapidkey` | Webプッシュ通知用VAPIDキー |

### ic_non_reged 削除要領

| 処理 | 条件 |
|------|------|
| 時間制限 | `datetime` から30分経過 → 検索対象外 |
| 論理削除 | `deleted = 1` → 登録完了時に設定 |
| 物理削除 | 未実装（定期バッチが必要） |

## ディレクトリ構成

```
ohishi-time-card/
├── timecard-rust-api/      # Rust バックエンド（サブモジュール）
├── timecard-cf-worker/     # Cloudflare Workers フロントエンド
├── wxpython_test-ref/      # Pythonクライアント（参考）
├── app-ref/                # 既存Node.js実装（参考）
├── nodeJS_test-ref/        # Docker構成（参考）
├── handover/               # 引き継ぎ書
├── CLAUDE.md               # 開発ガイド（Claude Code用）
└── README.md               # このファイル
```

## Webアプリ ページ一覧

| パス | 機能 |
|------|------|
| `/` | 打刻一覧（トップページ） |
| `/drivers` | ドライバー一覧 |
| `/ic_non_reg` | 未登録IC一覧・登録 |
| `/ic_register` | Web NFC IC登録 |
| `/delete_ic` | IC削除 |

## API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/drivers` | ドライバー一覧取得 |
| GET | `/api/driver/{id}` | ドライバー詳細取得 |
| GET | `/api/pic_tmp` | 打刻データ取得 |
| GET | `/api/ic_non_reg` | 未登録IC一覧取得 |
| POST | `/api/ic_non_reg/register` | 未登録IC登録 |
| POST | `/api/ic/register_direct` | Web NFC IC登録 |
| POST | `/api/ic/delete` | IC削除（Socket.IO経由） |
| GET | `/api/ic_log` | ICログ取得 |
| GET | `/api/ic_log_list` | 打刻一覧取得 |

## 環境変数

```bash
# データベース接続
RDB_HOST=172.18.21.90
RDB_USER=dbuser
RDB_PASSWORD=***
RDB_NAME=db

# Socket.IO接続（既存Node.jsサーバー）
SOCKETIO_URL=https://172.18.21.90:3050

# Cloudflare Workers
GRPC_API_URL=https://...
```

## 開発

### 前提条件

- Rust (latest stable)
- Node.js 18+
- Docker & Docker Compose

### Rust API サーバー

```bash
cd timecard-rust-api
cargo run
```

### Cloudflare Workers

```bash
cd timecard-cf-worker
npm install
npm run dev
```

## Socket.IO イベント

### クライアント → サーバー

```javascript
socket.emit('message', {
  ip: 'クライアントIP',
  status: 'tmp inserted' | 'tmp inserted by ic' | 'tmp inserted by fing' | ...,
  message: '',
  data: {
    time: 'ISO形式日時',
    id: 社員ID,
    tmp: '体温',
    pic_data: 'base64画像'
  }
});
```

### サーバー → クライアント

```javascript
socket.on('hello', (data) => {
  // data.status でイベント種別を判定
  // 'tmp inserted', 'insert ic_log', 'delete_ic' など
});
```

## ライセンス

Private - All rights reserved
