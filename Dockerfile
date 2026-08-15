# Web 音乐播放器 - 零依赖 Node 应用，无需 npm install
FROM node:22-alpine

LABEL org.opencontainers.image.title="web-music-player" \
      org.opencontainers.image.description="个人使用的 Web 音乐播放器：零依赖 Node 后端 + 原生 JS 单页前端"

WORKDIR /app

# 仅拷贝运行必需的文件（测试/文档等通过 .dockerignore 排除）
COPY server.js ./
COPY lib/ ./lib/
COPY public/ ./public/

# 音乐目录与歌单数据目录（建议挂载卷持久化）
ENV MUSIC_DIR=/app/music \
    DATA_DIR=/app/data \
    PORT=8787 \
    HOST=0.0.0.0

RUN mkdir -p /app/music /app/data

EXPOSE 8787

# 健康检查：曲库 API 可达
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/library" || exit 1

CMD ["node", "server.js"]
