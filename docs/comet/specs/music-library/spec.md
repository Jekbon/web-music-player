# Capability: music-library — 音乐库

音乐播放器服务端的曲库能力：扫描本地目录、网页上传、流式播放、歌词获取，并提供曲库浏览 API。

## scan — 目录扫描与元数据解析

- 服务启动时递归扫描音乐目录（默认项目下 `./music`，可由环境变量 `MUSIC_DIR` 覆盖），目录不存在时自动创建。
- 收录白名单后缀：`.mp3 .m4a .ogg .wav .flac`（大小写不敏感）；忽略以 `.` 开头的隐藏文件与隐藏目录。
- 每首曲目生成：`id`（相对路径的稳定哈希）、`title`、`artist`、`album`、`folder`（相对目录路径）、`path`（相对路径）、`size`、`duration`（尽力解析，失败为 null）。
- 元数据解析：解析 ID3v2 标签（TIT2 标题、TPE1 艺术家、TALB 专辑）；无标签或解析失败时回退：标题取文件名（去后缀），艺术家/专辑为空。
- 扫描结果缓存在内存中，上传成功后增量刷新。

## upload — 网页上传入库

- `POST /api/upload`：multipart/form-data，字段名 `file`。
- 仅接受白名单后缀；其他后缀返回 400 与错误信息。
- 文件名中的路径分隔符被剥离，只写入音乐目录根下，防止路径穿越；同名文件自动追加序号。
- 上传成功后该曲目立即可在曲库 API 中查询并播放。

## delete — 删除歌曲（物理删除文件）

- `DELETE /api/tracks/:id`：按曲目 id 物理删除磁盘上的音频文件。
- 同时删除同目录同基名的 `.lrc` 歌词文件（存在时）。
- 删除成功后从内存曲库缓存中移除该曲目，并从所有歌单的 trackIds 中清理该 id（落盘）。
- 仅允许删除音乐目录内的文件：解析后的绝对路径必须位于音乐目录内，否则返回 400。
- 未知 id 返回 404 JSON 错误；文件已不存在时仍从曲库移除并返回成功（幂等）。
- 前端入口：曲目行 ⋯ 菜单中的"删除歌曲"项，点击后弹确认框，确认后调用 API 并刷新列表；若删除的是当前播放曲目，自动切换下一首（队列为空则停止播放）。

## stream — 流式播放

- `GET /api/stream/:id`：按曲目 id 流式返回音频字节。
- 支持 HTTP Range 请求：有 `Range: bytes=a-b` 时返回 206，`Content-Range: bytes a-b/total`，`Content-Length` 为片段长度；无 Range 时返回 200 完整内容。
- 未知 id 返回 404 JSON 错误。
- Content-Type 按后缀映射（mp3→audio/mpeg，m4a→audio/mp4，ogg→audio/ogg，wav→audio/wav，flac→audio/flac）。

## lyrics-api — 歌词获取

- `GET /api/lyrics/:id`：查找与音频同名的 `.lrc` 文件（同目录、同基名）。
- 存在时返回 `{ "found": true, "text": "<lrc 原文>" }`；不存在返回 `{ "found": false }`。

## browse — 曲库浏览 API

- `GET /api/library`：返回 `{ "tracks": [...], "folders": [...] }`。
  - tracks：全部曲目对象数组（字段见 scan），按 folder、title 排序。
  - folders：去重后的相对目录路径数组（根目录为 `.`）。
- 搜索过滤在前端完成（客户端按 title/artist/folder 关键字过滤），服务端不做查询参数。

## deploy — 部署与访问

- 单命令启动：`npm start`（即 `node server.js`），监听 `0.0.0.0`，端口默认 8787，可由环境变量 `PORT` 覆盖。
- 启动时打印访问地址；局域网内浏览器 `http://<ip>:<port>` 直接访问，无登录鉴权。
- 前端为静态单页（HTML/CSS/JS），由同一服务托管，无外部 CDN 依赖。
