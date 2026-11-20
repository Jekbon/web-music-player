# Reproductor de Música Web

![CI](https://github.com/Jekbon/web-music-player/actions/workflows/ci.yml/badge.svg)

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | **Español**

Reproductor de música web autoalojado para uso personal: backend Node sin dependencias + frontend SPA en JS vanilla. Sin paso de compilación, sin dependencias de CDN.

## Características

- 🎵 Biblioteca: escaneo recursivo de un directorio local (mp3/m4a/ogg/wav/flac), análisis de etiquetas ID3 (título/artista/álbum), subida desde la web
- 📁 Navegación: agrupación por carpetas, búsqueda por palabra clave (título/artista/ruta)
- ▶️ Reproducción: jugar/pausa, anterior/siguiente, búsqueda de posición, volumen/silencio, repetir / repetir uno / aleatorio
- 📋 Cola: panel de cola, clic para reproducir, quitar pista, vaciar cola
- 🎧 Listas: crear/renombrar/eliminar, añadir/quitar pistas, reproducir lista completa (persistido en el servidor)
- 📝 Letras: coincidencia automática de `.lrc` con el mismo nombre, resaltado sincronizado por línea, clic en una línea para saltar
- 💾 Memoria: restaura la última pista, posición, volumen y modo de reproducción tras recargar

## Inicio rápido

```bash
npm start        # puerto 8787 por defecto
```

Abre http://localhost:8787; otros dispositivos de tu LAN pueden usar http://<tu-ip>:8787.

Coloca los archivos de música en `music/` (subdirectorios incluidos) y recarga la página, o súbelos desde la barra lateral izquierda.
Coloca el archivo de letra junto al audio con el mismo nombre (p. ej. `晴天.mp3` ↔ `晴天.lrc`).

## Docker

```bash
# Descarga la imagen pública (publicada con etiquetas v*)
docker run -d --name music-player -p 8787:8787 \
  -v "$PWD/music:/app/music" -v "$PWD/data:/app/data" \
  --restart unless-stopped \
  ghcr.io/jekbon/web-music-player:latest

# O compila localmente
docker compose up -d --build
```

## Configuración

| Variable | Por defecto | Descripción |
|----------|-------------|-------------|
| `PORT` | 8787 | Puerto de escucha |
| `HOST` | 0.0.0.0 | Dirección de enlace |
| `MUSIC_DIR` | ./music | Directorio de música |
| `DATA_DIR` | ./data | Directorio de datos (playlists.json) |

## Pruebas

```bash
npm test         # pruebas unitarias + de integración (node --test)
```

## Estructura

```
server.js          # entrada del servidor (estáticos + API + streaming Range)
lib/
  scanner.js       # escaneo de biblioteca y metadatos
  id3.js           # parser de etiquetas ID3v2
  lrc.js           # parser de letras LRC
  multipart.js     # parser multipart/form-data
  playlists.js     # almacenamiento de listas
public/            # frontend SPA (index.html / style.css / app.js)
test/              # pruebas unitarias y de integración
music/             # archivos de música (auto-creado)
data/              # datos de listas (auto-creado)
```

## Notas

- Pensado solo para entornos locales/LAN de confianza; no hay autenticación
- Sin transcodificación: la reproducción de flac/wav depende del decodificado del navegador (Chrome/Edge funcionan bien)

## Licencia

[MIT](LICENSE) © 王斌
