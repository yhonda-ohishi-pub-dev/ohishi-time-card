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

参考用に以下のリポジトリを`-ref`サフィックスでクローン済み：
- `app-ref/` - 既存のNode.js/TypeScript/Express実装（Socket.IO使用）
- `nodeJS_test-ref/` - MariaDBとphpMyAdminのDocker Compose構成
- `wxpython_test-ref/` - ICカードリーダー/指紋認証クライアント（Python/wxPython）

## wxpython_test-ref（ICカードリーダークライアント）

Windows上で動作するICカードリーダー・指紋認証クライアントアプリケーション。

### 依存関係

主要な依存ライブラリ（`requirements.txt`より）：
- **GUI**: `wxPython==4.2.0`
- **ICカード**: `pyscard==2.0.5`, `PySmartCard==1.4.1`
- **データベース**:
  - `sqlite3`（標準ライブラリ） - ローカル設定・ログ保存
  - `mysql-connector-python==8.0.32` - MariaDB接続
- **リアルタイム通信**:
  - `python-socketio==5.8.0` - Socket.IOクライアント
  - `websocket-client==1.5.1` - WebSocket通信
- **その他**: `opencv-contrib-python`（カメラ）, `pyttsx3`（音声合成）, `sounddevice`/`soundfile`（音声再生）

### 接続先設定

```python
# make_lib/dbmaria.py - MariaDB接続
host='172.18.21.90'
user='dbuser'
password='***'  # 実際のパスワードはdbmaria.pyを参照
database='db'

# make_lib/sock.py - Socket.IO接続
SocketIOClient('https://172.18.21.90:3150', '/')
# SSL検証は無効化（self-signed証明書対応）
socketio.Client(ssl_verify=False)
```

### IC登録処理フロー

`make_lib/printobserver.py` → `make_lib/reg_ic.py` → `make_lib/dbmaria.py`

1. **ICカード検知**（`printobserver.py`）
   - `pyscard`の`CardMonitor`でスマートカード挿入を監視
   - カード種別判定:
     - `driver_license` - 運転免許証（有効期限・残り回数取得）
     - `car_inspection` - 車検証
     - `other` - その他ICカード（Felica等）

2. **IC登録判定**（`reg_ic.py`の`register_ic_id()`）
   ```
   運転免許証で社員ID取得可能？
   └→ YES: 免許証有効期限から社員IDを特定
   └→ NO: 登録済みIC？
          └→ YES: ic_idテーブルから社員ID取得
          └→ NO: MariaDBのic_non_regedで30分以内に登録済み？
                 └→ YES: registered_idを使用してIC登録
                 └→ NO: 未登録ICとしてic_non_regedに記録、再タッチ要求
   ```

3. **ICログ保存**（`reg_ic.py`の`enroll_ic_db()`）
   - SQLite（database_other.db）とMariaDB両方に保存
   - Socket.IOで`insert ic_log`イベント送信

### 未登録IC確認処理

`make_lib/dbmaria.py`の処理：

```python
# 未登録IC検索（30分以内の記録を確認）
def find_ic_id(data: list):
    sql = "select * from ic_non_reged where id=%s and `datetime`> current_timestamp + interval -30 minute limit 1"
    # registered_idがあれば、そのIDでIC登録を実行

# 未登録IC記録
def insert_ic_non_reg(data: str):
    sql = "INSERT INTO ic_non_reged (id) VALUES (%s) ON DUPLICATE KEY UPDATE `datetime`=CURRENT_TIMESTAMP() + INTERVAL 9 HOUR, registered_id=NULL"
```

**未登録IC登録の流れ**:
1. ICカードタッチ → 未登録判定 → `ic_non_reged`に記録
2. Webアプリで社員番号を`registered_id`に登録
3. 再度ICタッチ → `find_ic_id()`で登録済み確認 → `ic_id`テーブルに登録

### Web NFC登録（/ic_register）の方針

Android Chrome + Web NFCでICカードを直接登録する機能。

**設計方針**: `ic_non_reged`テーブルの`registered_id`を設定するのみ。`ic_id`への登録はPythonクライアント経由で行う。

```
[Web NFC登録]
    ↓
ic_non_reged に INSERT/UPDATE（registered_id = driver_id, deleted = 0）
    ↓
[Pythonクライアントで次回ICタッチ]
    ↓
find_ic_id() で registered_id を発見
    ↓
ic_id テーブルに登録（MariaDB + ローカルSQLite 両方）
    ↓
deleted = 1 に更新
```

**理由**: Pythonクライアントのローカル`database_main.db`（SQLite）にも`ic_id`が反映される必要があるため。Web NFCで`ic_id`に直接登録するとMariaDBのみに書き込まれ、Pythonクライアントでは「未登録」と判定されてしまう。

**ic_non_regedの削除要領**:
| 処理 | 条件 |
|------|------|
| 時間制限 | `datetime`から30分経過 → 検索対象外 |
| 論理削除 | `deleted = 1` → 登録完了時に設定 |
| 物理削除 | 未実装（定期バッチが必要） |

### IC削除（/delete_ic）の方針

Android Chrome + Web NFCでICカードを削除する機能。IC登録と同様、Pythonクライアント経由でローカルSQLiteも更新する。

**設計方針**: Web NFCで読み取ったIC IDをSocket.IOでブロードキャスト。Pythonクライアントが受信し、ローカルSQLiteとMariaDB両方から論理削除する。

```
[Web NFC削除]
    ↓ WebSocket送信: {status: 'delete_ic', ic: <IC_ID>}
[Cloudflare Worker]
    ↓ ブロードキャスト: {status: 'delete_ic', ic: <IC_ID>}
[Pythonクライアント] ← Socket.IOで受信
    ↓
database.delete_ic() → SQLite ic_id.deleted = タイムスタンプ
    ↓
dbmaria.delete_ic() → MariaDB ic_id.deleted = 1
```

**理由**: IC登録と同じく、Pythonクライアントのローカル`database_main.db`（SQLite）からも削除が必要。Web NFCでMariaDBのみ削除すると、Pythonクライアントでは「登録済み」と判定されてしまう。

**ic_idテーブルの削除方式**:
| DB | 削除方式 | 値 |
|----|----------|-----|
| SQLite | 論理削除 | `deleted = datetime('now','localtime')` |
| MariaDB | 論理削除 | `deleted = 1` |

**現状の実装状況**:
| コンポーネント | 状態 | 備考 |
|---------------|------|------|
| Web NFC UI | 実装済み | `/delete_ic` ページ |
| WebSocketブロードキャスト | 実装済み | Cloudflare Worker |
| Rust API `/api/ic/delete` | 実装済み | Socket.IOで`message`イベント送信 |
| SQLite削除 | 実装済み | `database.py:delete_ic()` |
| MariaDB削除 | 未実装 | `dbmaria.py`に関数なし |
| Pythonクライアント受信 | 実装済み | `sock.py:on_hello()`で`delete_ic`を処理 |

**Rust API設定**:
- 環境変数 `SOCKETIO_URL` でSocket.IOサーバーを指定
- 例: `SOCKETIO_URL=https://172.18.21.90:3050`

**TODO**:
1. `dbmaria.py`に`delete_ic()`関数を追加（MariaDB同期用）

### DB問い合わせ手順

#### ローカルSQLite（設定・ログ用）
- `database_main.db` - IC登録、指紋ID、設定
- `database_other.db` - ログ、画像データ、体温データ

```python
# make_lib/database.py
import sqlite3
conn = sqlite3.connect('database_main.db')
# テーブル: ic_id, user_finger_ids, user_finger_data, config, Log
```

#### リモートMariaDB（本番データ用）
```python
# make_lib/dbmaria.py
import mysql.connector
cnx = mysql.connector.connect(
    user='dbuser',
    password='***',  # 実際のパスワードはdbmaria.pyを参照
    host='172.18.21.90',
    database='db'
)
```

主要な操作関数:
| 関数名 | 用途 | テーブル |
|--------|------|----------|
| `insert_ic_id()` | IC-社員ID登録 | ic_id |
| `enroll_ic_db()` | ICログ記録 | ic_log |
| `insert_ic_non_reg()` | 未登録IC記録 | ic_non_reged |
| `find_ic_id()` | 未登録IC検索 | ic_non_reged |
| `insert_tmp()` | 体温データ登録 | tmp_data |
| `insert_cam()` | カメラ画像保存 | pic_data |
| `finger_log()` | 指紋認証ログ | finger_log |

### Socket.IOイベント送信

`make_lib/sock.py`からサーバーへ送信するイベント:
```python
# イベント名: 'message'
# データ構造:
{
    "ip": "クライアントIP",
    "status": "tmp inserted wo pic" | "insert ic_log" | ...,
    "message": "",
    "data": {
        "time": "ISO形式日時",
        "id": 社員ID,
        "tmp": "体温",
        ...
    }
}
```

### モジュール構成（make_lib/）

| ファイル | 役割 |
|----------|------|
| `printobserver.py` | ICカード監視・読み取り |
| `reg_ic.py` | IC登録ロジック |
| `database.py` | SQLite操作 |
| `dbmaria.py` | MariaDB操作 |
| `sock.py` | Socket.IOクライアント |
| `cam.py` | カメラ撮影 |
| `sound.py` | 音声再生 |
| `driver.py` | ドライバー情報取得 |
| `tmp.py` | 体温データ管理 |

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

## 本番サーバー（172.18.21.90）

### VPN接続

```bash
# IPsec + L2TP VPN接続
sudo ipsec up ohishi
sudo systemctl start xl2tpd
echo "c ohishi" | sudo tee /var/run/xl2tpd/l2tp-control

# ルート追加（必要に応じて）
sudo ip route add 172.18.21.0/24 dev ppp0
```

### SSH接続

```bash
ssh pi@172.18.21.90
```

### Dockerコンテナ構成

| コンテナ | イメージ | HTTP | Socket.IO | 用途 |
|---------|---------|------|-----------|------|
| **app** | node:16 | 3000 | **3050** | 本番環境 |
| **app_dev** | node:16 | 3100 | **3150** | 開発環境 |
| db | mariadb:10.6.2 | - | 3306 | MariaDB |
| phpmyadmin | phpmyadmin:5.1.1 | 8888 | - | DB管理UI |

### devサーバー起動

app_devコンテナはデフォルトでNode.jsインタラクティブシェルのみ起動。devサーバーを手動で起動する必要あり：

```bash
# SSH経由でdevサーバー起動
ssh pi@172.18.21.90 "docker exec -d app_dev sh -c 'cd /app && npx tsc && npm run dev'"

# 起動確認
ssh pi@172.18.21.90 "docker exec app_dev ss -tlnp | grep 3050"
# → LISTEN *:3050 が表示されればOK
```

**注意**: `docker exec -d`で起動するとログが`docker logs`に出力されない。ログ確認が必要な場合はフォアグラウンドで実行：
```bash
ssh -t pi@172.18.21.90 "docker exec -it app_dev sh -c 'cd /app && npm run dev'"
```

### Pythonクライアント接続先

- Pythonクライアント（wxpython_test）は `https://172.18.21.90:3150` に接続
- devサーバーが起動していないとSocket.IO接続失敗

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

## 開発環境

### LSP対応
- **TypeScript**: typescript-language-server
- **Rust**: rust-analyzer

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
