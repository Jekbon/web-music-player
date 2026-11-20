# Web ミュージックプレーヤー

![CI](https://github.com/Jekbon/web-music-player/actions/workflows/ci.yml/badge.svg)

[English](README.md) | [简体中文](README.zh-CN.md) | **日本語** | [Español](README.es.md)

個人利用向けのセルフホスト型 Web ミュージックプレーヤー。依存ゼロの Node バックエンド + バニラ JS のシングルページフロントエンド。ビルド工程なし、CDN 依存なし。

## 特徴

- 🎵 ライブラリ：ローカル音楽ディレクトリ（mp3/m4a/ogg/wav/flac）の再帰スキャン、ID3 タグ解析（タイトル/アーティスト/アルバム）、Web からのアップロード
- 📁 閲覧：フォルダ単位のグループ化、キーワード検索（タイトル/アーティスト/パス）
- ▶️ 再生：再生/一時停止、前へ/次へ、シーク、音量/ミュート、リピート/1曲リピート/シャッフル
- 📋 キュー：キューパネル、クリック再生、曲の削除、キュー全クリア
- 🎧 プレイリスト：作成/名前変更/削除、曲の追加/削除、プレイリスト一括再生（サーバー側で永続化）
- 📝 歌詞：同名 `.lrc` の自動マッチ、時間同期ハイライト、行クリックでシーク
- 💾 記憶：更新後に前回の曲・再生位置・音量・再生モードを復元

## クイックスタート

```bash
npm start        # デフォルトポート 8787
```

http://localhost:8787 を開きます。LAN 内の他デバイスからは http://<自機IP>:8787 でアクセスできます。

音楽ファイルを `music/` ディレクトリ（サブディレクトリ対応）に入れてページを更新するか、左サイドバーから直接アップロードします。
歌詞ファイルは音声ファイルと同じ名前・同じディレクトリに配置します（例：`晴天.mp3` ↔ `晴天.lrc`）。

## Docker

```bash
# 公開イメージを取得（v* タグで公開）
docker run -d --name music-player -p 8787:8787 \
  -v "$PWD/music:/app/music" -v "$PWD/data:/app/data" \
  --restart unless-stopped \
  ghcr.io/jekbon/web-music-player:latest

# またはローカルでビルド
docker compose up -d --build
```

## 設定

| 環境変数 | デフォルト | 説明 |
|---------|-----------|------|
| `PORT` | 8787 | リスンポート |
| `HOST` | 0.0.0.0 | バインドアドレス |
| `MUSIC_DIR` | ./music | 音楽ディレクトリ |
| `DATA_DIR` | ./data | データディレクトリ（playlists.json） |

## テスト

```bash
npm test         # 単体テスト + 結合テスト（node --test）
```

## 構成

```
server.js          # サーバーエントリ（静的ホスティング + API + Range ストリーミング）
lib/
  scanner.js       # ライブラリスキャンとメタデータ解析
  id3.js           # ID3v2 タグパーサ
  lrc.js           # LRC 歌詞パーサ
  multipart.js     # multipart/form-data パーサ
  playlists.js     # プレイリスト保存
public/            # シングルページフロントエンド（index.html / style.css / app.js）
test/              # 単体テストと結合テスト
music/             # 音楽ファイルディレクトリ（自動作成）
data/              # プレイリストデータ（自動作成）
```

## 注意

- 信頼できるローカル/LAN 環境向けです。認証機能はありません
- トランスコードは行いません：flac/wav の再生はブラウザのデコード能力に依存します（Chrome/Edge は良好）

## ライセンス

[MIT](LICENSE) © 王斌
