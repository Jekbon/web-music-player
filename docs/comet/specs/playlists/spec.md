# Capability: playlists — 歌单

歌单的创建、管理与服务端持久化。

## API 行为

- `GET /api/playlists`：返回歌单列表，每项含 `id`、`name`、`trackIds`。
- `POST /api/playlists`：body `{ "name": "..." }` 创建歌单，返回新建歌单；重名返回 409。
- `PUT /api/playlists/:id`：body `{ "name": "..." }` 重命名；不存在返回 404，重名返回 409。
- `DELETE /api/playlists/:id`：删除歌单；不存在返回 404。
- `POST /api/playlists/:id/tracks`：body `{ "trackId": "..." }` 添加曲目；重复添加幂等（不重复加入）。
- `DELETE /api/playlists/:id/tracks/:trackId`：移除曲目。

## 持久化

- 歌单数据保存在 `data/playlists.json`（相对项目根），每次变更后同步落盘。
- 服务重启后歌单数据不丢失。
- 歌单只存曲目 id；曲库中已不存在的 id 在前端播放时跳过并提示。

## 前端交互

- 侧栏展示歌单列表；支持新建、重命名、删除歌单。
- 曲目行提供"加入歌单"入口；歌单详情可移除曲目、播放整个歌单（构建队列）。
