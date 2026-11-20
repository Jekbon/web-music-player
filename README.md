# Web Music Player

![CI](https://github.com/Jekbon/web-music-player/actions/workflows/ci.yml/badge.svg)

**English** | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [Español](README.es.md)

A self-hosted web music player for personal use: zero-dependency Node.js backend + vanilla-JS single-page frontend. No build step, no CDN dependencies.

## Features

- 🎵 Library: recursive scan of a local music directory (mp3/m4a/ogg/wav/flac), ID3 tag parsing (title/artist/album), upload from the web UI
- 📁 Browse: folder grouping, keyword search (title/artist/path)
- ▶️ Playback: play/pause, previous/next, seek, volume/mute, repeat / repeat-one / shuffle
- 📋 Queue: queue panel, click to play, remove a track, clear the queue
- 🎧 Playlists: create/rename/delete, add/remove tracks, play a whole playlist (persisted server-side)
- 📝 Lyrics: auto-matched same-name `.lrc`, time-synced line highlighting, click a line to seek
- 💾 Memory: restores last track, position, volume and play mode after a refresh

## Quick start

```bash
npm start        # default port 8787
```

Open http://localhost:8787; other devices on your LAN can use http://<your-ip>:8787.

Drop music files into `music/` (subdirectories supported) and refresh the page, or upload directly from the left sidebar.
Place a lyric file next to its audio with the same name (e.g. `晴天.mp3` ↔ `晴天.lrc`).

## Docker

```bash
# Pull the public image (published on v* tags)
docker run -d --name music-player -p 8787:8787 \
  -v "$PWD/music:/app/music" -v "$PWD/data:/app/data" \
  --restart unless-stopped \
  ghcr.io/jekbon/web-music-player:latest

# Or build locally
docker compose up -d --build
```

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `PORT` | 8787 | Listen port |
| `HOST` | 0.0.0.0 | Bind address |
| `MUSIC_DIR` | ./music | Music directory |
| `DATA_DIR` | ./data | Data directory (playlists.json) |

## Testing

```bash
npm test         # unit + integration tests (node --test)
```

## Project layout

```
server.js          # server entry (static hosting + API + Range streaming)
lib/
  scanner.js       # library scan & metadata parsing
  id3.js           # ID3v2 tag parser
  lrc.js           # LRC lyrics parser
  multipart.js     # multipart/form-data parser
  playlists.js     # playlist storage
public/            # single-page frontend (index.html / style.css / app.js)
test/              # unit & integration tests
music/             # music files (auto-created)
data/              # playlist data (auto-created)
```

## Notes

- Intended for trusted local/LAN environments only; there is no authentication
- No transcoding: whether flac/wav play depends on browser decoding (Chrome/Edge are fine)

## License

[MIT](LICENSE) © 王斌
