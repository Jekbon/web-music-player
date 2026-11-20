# Web 音乐播放器

![CI](https://github.com/Jekbon/web-music-player/actions/workflows/ci.yml/badge.svg)

个人使用的 Web 音乐播放器：零依赖 Node 后端 + 原生 JS 单页前端，无构建步骤、无 CDN 依赖。

## 功能

- 🎵 曲库：递归扫描本地音乐目录（mp3/m4a/ogg/wav/flac），解析 ID3 标签（标题/艺术家/专辑），网页上传入库
- 📁 浏览：按目录分组、关键字搜索（歌名/艺术家/路径）
- ▶️ 播放：播放/暂停、上一首/下一首、进度拖动、音量/静音、列表循环/单曲循环/随机播放
- 📋 队列：队列面板、点击播放、移除单曲、清空
- 🎧 歌单：创建/重命名/删除、加曲/移除、播放整个歌单（服务端持久化）
- 📝 歌词：同名 .lrc 自动匹配、逐行同步高亮、点击跳转
- 💾 记忆：刷新后恢复上次歌曲、进度、音量、播放模式

## 快速开始

```bash
npm start        # 默认端口 8787
```

浏览器打开 http://localhost:8787，局域网内其他设备访问 http://<本机IP>:8787。

把音乐文件放进 `music/` 目录（支持子目录），刷新页面即可；也可以直接在页面左侧上传。
歌词文件与音频同名同目录放置即可（如 `晴天.mp3` ↔ `晴天.lrc`）。

## Docker 运行

```bash
# 拉取公开镜像一键运行（镜像随 v* tag 发布）
docker run -d --name music-player -p 8787:8787 \
  -v "$PWD/music:/app/music" -v "$PWD/data:/app/data" \
  --restart unless-stopped \
  ghcr.io/jekbon/web-music-player:latest

# 或本地构建启动
docker compose up -d --build
```

## 配置

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `PORT` | 8787 | 监听端口 |
| `HOST` | 0.0.0.0 | 监听地址 |
| `MUSIC_DIR` | ./music | 音乐目录 |
| `DATA_DIR` | ./data | 数据目录（歌单 playlists.json） |

## 测试

```bash
npm test         # 单元测试 + 集成测试（node --test）
```

## 目录结构

```
server.js          # 服务端入口（静态托管 + API + Range 流式）
lib/
  scanner.js       # 曲库扫描与元数据解析
  id3.js           # ID3v2 标签解析器
  lrc.js           # LRC 歌词解析器
  multipart.js     # multipart/form-data 解析器
  playlists.js     # 歌单存储
public/            # 前端单页（index.html / style.css / app.js）
test/              # 单元测试与集成测试
music/             # 音乐文件目录（自动创建）
data/              # 歌单数据（自动创建）
```

## 说明

- 仅面向可信的本机/局域网环境，无登录鉴权
- 不做转码：flac/wav 能否播放取决于浏览器解码能力（Chrome/Edge 支持良好）

## 协议

[MIT](LICENSE) © 王斌
