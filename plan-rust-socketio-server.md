# Rust Socket.IOサーバー移行計画

## 目標

Node.js (app:3050) を停止し、Rust サーバーで Socket.IO を処理する

## 現状

```
[Pythonクライアント] --socket.emit("message")--> [Node.js:3050] --io.emit("hello")--> [ブラウザ]
```

- Node.js (app) がポート3050でSocket.IOサーバーとして稼働
- 13台のクライアントが接続中
- Pythonクライアントは `message` イベントを送信
- Node.js は `hello` イベントをブロードキャスト

## 移行後

```
[Pythonクライアント] --socket.emit("message")--> [Rust:3050] --io.emit("hello")--> [ブラウザ]
```

## 必要な変更

### 1. Rustクレート追加

```toml
# Cargo.toml
[dependencies]
socketioxide = "0.14"  # Socket.IOサーバー (axum対応)
```

現在の `rust-socketio` はクライアント専用なので、サーバー用に `socketioxide` を追加

### 2. Socket.IOサーバー実装

```rust
// src/socketio_server.rs (新規作成)

use socketioxide::{
    extract::{Data, SocketRef},
    SocketIo,
};
use serde_json::Value;

pub fn setup_socketio() -> SocketIo {
    let (layer, io) = SocketIo::new_layer();

    io.ns("/", |socket: SocketRef| {
        println!("Client connected: {}", socket.id);

        // message イベント受信
        socket.on("message", |socket: SocketRef, Data::<Value>(data)| {
            println!("Received message: {:?}", data);

            // hello イベントをブロードキャスト
            let _ = socket.broadcast().emit("hello", &data);
            let _ = socket.emit("hello", &data);  // 送信元にも送信
        });

        // 接続時に hello 送信
        let _ = socket.emit("hello", "from server");
    });

    io
}
```

### 3. main.rs 修正

```rust
use socketioxide::SocketIo;

#[tokio::main]
async fn main() {
    let io = setup_socketio();

    let app = Router::new()
        .route("/api/...", ...)
        .layer(io.layer());  // Socket.IOレイヤー追加

    // ポート3050で起動
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3050").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

### 4. HTTPS対応

Node.jsと同様にHTTPS必須：
- 証明書ファイルを使用
- `axum-server` + `rustls` でTLS対応

```rust
use axum_server::tls_rustls::RustlsConfig;

let config = RustlsConfig::from_pem_file(
    "ohishi-timecard.ohishi.local+4.pem",
    "ohishi-timecard.ohishi.local+4-key.pem",
).await.unwrap();

axum_server::bind_rustls("0.0.0.0:3050".parse().unwrap(), config)
    .serve(app.into_make_service())
    .await
    .unwrap();
```

### 5. messageステータス処理

Node.jsで行っている処理をRustに移植：

| status | 処理 |
|--------|------|
| `tmp inserted` | pic_dataをbase64変換 |
| `tmp inserted wo pic` | driversテーブルから名前取得 |
| その他 | そのままブロードキャスト |

## 移行手順

### Phase 1: 開発・テスト

1. [x] `socketioxide` クレート追加
2. [x] Socket.IOサーバー実装
3. [x] HTTPS対応
4. [ ] ローカルでテスト（別ポートで起動）

### Phase 2: 検証

1. [ ] devサーバー(3150)を停止
2. [ ] Rustを3150で起動
3. [ ] テスト用Pythonクライアントで接続確認
4. [ ] ブラウザでhelloイベント受信確認

### Phase 3: 本番移行

1. [ ] Node.js (app:3050) を停止
   ```bash
   ssh pi@172.18.21.90 "docker stop app"
   ```
2. [ ] Rustサーバーを3050で起動
3. [ ] Pythonクライアント接続確認
4. [ ] 全機能テスト

### Phase 4: ロールバック準備

問題発生時：
```bash
ssh pi@172.18.21.90 "docker start app"
```

## リスク

1. **Socket.IOプロトコル互換性**: socketioxideがPythonクライアント(python-socketio)と互換性あるか要確認
2. **HTTPS証明書**: 同じ証明書ファイルを使用できるか確認
3. **パフォーマンス**: 13台同時接続の負荷

## 作業見積もり

| タスク | 工数 |
|--------|------|
| socketioxideセットアップ | 1-2時間 |
| message/hello実装 | 1-2時間 |
| HTTPS対応 | 1時間 |
| ローカルテスト | 1時間 |
| 本番移行・テスト | 1時間 |

合計: 5-7時間
