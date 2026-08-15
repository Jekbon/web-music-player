/**
 * Web 音乐播放器前端（原生 JS，无依赖）
 * Apple Music 式极简 UI：主题三态（浅色/深色/跟随系统）+ 桌面/移动响应式
 */
(() => {
  'use strict';

  // ─── 状态 ───────────────────────────────────────────────
  const state = {
    tracks: [],          // 全部曲目
    trackMap: new Map(), // id -> track
    folders: [],
    queue: [],           // 队列：track id 数组
    queueIndex: -1,      // 当前播放的队列下标
    mode: 'loop',        // loop | single | shuffle
    view: { type: 'all', folder: null, playlistId: null },
    search: '',
    playlists: [],
    lyrics: [],          // [{time, text}]
    lyricIndex: -1,
    lastShuffle: -1,
    theme: 'auto',       // auto | light | dark
    mobileView: 'library', // library | playlists | queue
  };

  const audio = document.getElementById('audio');
  const $ = (id) => document.getElementById(id);

  const MODES = ['loop', 'single', 'shuffle'];
  const MODE_ICONS = { loop: '🔁', single: '🔂', shuffle: '🔀' };
  const MODE_TITLES = { loop: '列表循环', single: '单曲循环', shuffle: '随机播放' };
  const THEMES = ['auto', 'light', 'dark'];
  const THEME_TITLES = { auto: '跟随系统', light: '浅色', dark: '深色' };
  const mqMobile = window.matchMedia('(max-width: 899px)');
  const mqDark = window.matchMedia('(prefers-color-scheme: dark)');

  // ─── 工具 ───────────────────────────────────────────────
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s ?? '';
    return d.innerHTML;
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, opts);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ─── 主题系统 ───────────────────────────────────────────
  const THEME_KEY = 'wmp-theme';

  function applyTheme(theme) {
    state.theme = THEMES.includes(theme) ? theme : 'auto';
    document.documentElement.dataset.theme = state.theme;
    for (const btn of [$('btn-theme'), $('fp-btn-theme')]) {
      if (!btn) continue;
      btn.title = `主题：${THEME_TITLES[state.theme]}`;
      btn.textContent = state.theme === 'auto' ? '◐' : state.theme === 'light' ? '☀' : '☾';
    }
    try { localStorage.setItem(THEME_KEY, state.theme); } catch { /* ignore */ }
  }

  function cycleTheme() {
    const next = THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length];
    applyTheme(next);
  }

  // ─── LRC 解析（与 lib/lrc.js 同逻辑）─────────────────────
  const TIME_TAG_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const META_TAG_RE = /^\[(ti|ar|al|by|offset|length|re|ve)\s*:.*\]$/i;

  function parseLrc(text) {
    if (!text || !text.trim()) return [];
    let offset = 0;
    const lines = [];
    for (const rawLine of text.split(/\r\n|\r|\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (META_TAG_RE.test(line)) {
        const m = /^\[offset\s*:\s*([+-]?\d+(?:\.\d+)?)\s*\]$/i.exec(line);
        if (m) offset = parseFloat(m[1]);
        continue;
      }
      const times = [];
      let lastEnd = 0;
      TIME_TAG_RE.lastIndex = 0;
      let m;
      while ((m = TIME_TAG_RE.exec(line)) !== null) {
        const fracRaw = m[3] ?? '0';
        times.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + parseInt(fracRaw, 10) / 10 ** fracRaw.length);
        lastEnd = m.index + m[0].length;
      }
      if (!times.length) continue;
      const lyricText = line.slice(lastEnd).trim();
      for (const t of times) lines.push({ time: t, text: lyricText });
    }
    const offsetSec = offset / 1000;
    for (const l of lines) l.time = Math.max(0, l.time - offsetSec);
    lines.sort((a, b) => a.time - b.time);
    return lines;
  }

  // ─── 持久化 ─────────────────────────────────────────────
  const STORE_KEY = 'wmp-state-v1';
  let saveTimer = null;

  function persistNow() {
    try {
      const current = currentTrack();
      localStorage.setItem(STORE_KEY, JSON.stringify({
        trackId: current ? current.id : null,
        position: audio.currentTime || 0,
        volume: audio.volume,
        muted: audio.muted,
        mode: state.mode,
        queue: state.queue,
        queueIndex: state.queueIndex,
      }));
    } catch { /* localStorage 不可用时静默 */ }
  }

  function schedulePersist() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; persistNow(); }, 5000);
  }

  function restoreState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  // ─── 曲库加载 ───────────────────────────────────────────
  async function loadLibrary() {
    const data = await api('/api/library');
    state.tracks = data.tracks;
    state.trackMap = new Map(data.tracks.map((t) => [t.id, t]));
    state.folders = data.folders;
    renderFolders();
    renderTracks();
  }

  // ─── 渲染：侧栏目录 ─────────────────────────────────────
  function renderFolders() {
    const el = $('folder-list');
    el.innerHTML = '';
    const all = document.createElement('div');
    all.className = 'folder-item' + (state.view.type === 'all' ? ' active' : '');
    all.textContent = '全部歌曲';
    all.onclick = () => { state.view = { type: 'all' }; renderFolders(); renderTracks(); };
    el.appendChild(all);
    for (const f of state.folders) {
      if (f === '.') continue;
      const item = document.createElement('div');
      item.className = 'folder-item' + (state.view.type === 'folder' && state.view.folder === f ? ' active' : '');
      item.textContent = f;
      item.title = f;
      item.onclick = () => { state.view = { type: 'folder', folder: f }; renderFolders(); renderTracks(); };
      el.appendChild(item);
    }
  }

  // ─── 渲染：歌单（桌面侧栏 + 移动视图）──────────────────
  async function loadPlaylists() {
    const data = await api('/api/playlists');
    state.playlists = data.playlists;
    renderPlaylists();
  }

  function playlistActions(pl, { mobile }) {
    const actions = document.createElement('span');
    actions.className = mobile ? 'm-pl-actions' : 'pl-actions';
    const btnPlay = document.createElement('button');
    btnPlay.className = 'icon-btn sm';
    btnPlay.textContent = '▶';
    btnPlay.title = '播放歌单';
    btnPlay.onclick = (e) => { e.stopPropagation(); playPlaylist(pl); };
    const btnRename = document.createElement('button');
    btnRename.className = 'icon-btn sm';
    btnRename.textContent = '✎';
    btnRename.title = '重命名';
    btnRename.onclick = async (e) => {
      e.stopPropagation();
      const newName = prompt('重命名歌单', pl.name);
      if (newName && newName.trim() && newName !== pl.name) {
        try { await api(`/api/playlists/${pl.id}`, { method: 'PUT', body: JSON.stringify({ name: newName }) }); await loadPlaylists(); renderTracks(); }
        catch (err) { alert(err.status === 409 ? '歌单名已存在' : '重命名失败: ' + err.message); }
      }
    };
    const btnDel = document.createElement('button');
    btnDel.className = 'icon-btn sm';
    btnDel.textContent = '🗑';
    btnDel.title = '删除歌单';
    btnDel.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`删除歌单「${pl.name}」？`)) return;
      await api(`/api/playlists/${pl.id}`, { method: 'DELETE' });
      if (state.view.type === 'playlist' && state.view.playlistId === pl.id) state.view = { type: 'all' };
      await loadPlaylists(); renderTracks();
    };
    actions.append(btnPlay, btnRename, btnDel);
    return actions;
  }

  function renderPlaylists() {
    // 桌面侧栏
    const el = $('playlist-list');
    el.innerHTML = '';
    if (!state.playlists.length) {
      el.innerHTML = '<div class="empty-tip" style="padding:8px;font-size:12px;">暂无歌单</div>';
    }
    for (const pl of state.playlists) {
      const item = document.createElement('div');
      item.className = 'playlist-item' + (state.view.type === 'playlist' && state.view.playlistId === pl.id ? ' active' : '');
      const name = document.createElement('span');
      name.className = 'pl-name';
      name.textContent = `${pl.name} (${pl.trackIds.length})`;
      name.title = '点击查看歌单';
      name.onclick = () => { state.view = { type: 'playlist', playlistId: pl.id }; renderPlaylists(); renderFolders(); renderTracks(); };
      item.append(name, playlistActions(pl, { mobile: false }));
      el.appendChild(item);
    }

    // 移动端歌单视图
    const mel = $('m-playlist-list');
    if (!mel) return;
    mel.innerHTML = '';
    if (!state.playlists.length) {
      mel.innerHTML = '<div class="empty-tip">暂无歌单，点右上角 ＋ 新建</div>';
    }
    for (const pl of state.playlists) {
      const row = document.createElement('div');
      row.className = 'm-pl-row';
      const name = document.createElement('span');
      name.className = 'm-pl-name';
      name.textContent = pl.name;
      const count = document.createElement('span');
      count.className = 'm-pl-count';
      count.textContent = `${pl.trackIds.length} 首`;
      row.append(name, count, playlistActions(pl, { mobile: true }));
      row.onclick = () => {
        state.view = { type: 'playlist', playlistId: pl.id };
        renderPlaylists(); renderTracks();
        switchMobileView('library');
      };
      mel.appendChild(row);
    }
  }

  function playPlaylist(pl) {
    const ids = pl.trackIds.filter((id) => state.trackMap.has(id));
    const skipped = pl.trackIds.length - ids.length;
    if (!ids.length) { alert('歌单中没有可播放的歌曲'); return; }
    setQueue(ids, 0, true);
    if (skipped > 0) console.warn(`歌单中 ${skipped} 首歌曲已不在曲库中，已跳过`);
  }

  // ─── 渲染：曲目列表 ─────────────────────────────────────
  function visibleTracks() {
    let list = state.tracks;
    if (state.view.type === 'folder') list = list.filter((t) => t.folder === state.view.folder);
    if (state.view.type === 'playlist') {
      const pl = state.playlists.find((p) => p.id === state.view.playlistId);
      if (!pl) return [];
      list = pl.trackIds.map((id) => state.trackMap.get(id)).filter(Boolean);
    }
    const q = state.search.trim().toLowerCase();
    if (q) {
      list = list.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        (t.artist && t.artist.toLowerCase().includes(q)) ||
        t.path.toLowerCase().includes(q));
    }
    return list;
  }

  function renderTracks() {
    const list = visibleTracks();
    const el = $('track-list');
    el.innerHTML = '';

    let title = '资料库';
    if (state.view.type === 'folder') title = state.view.folder;
    if (state.view.type === 'playlist') {
      const pl = state.playlists.find((p) => p.id === state.view.playlistId);
      title = pl ? pl.name : '歌单';
    }
    if (state.search.trim()) title += ` · "${state.search.trim()}"`;
    $('view-title').textContent = title;
    $('track-count').textContent = `${list.length} 首`;

    if (!list.length) {
      el.innerHTML = '<div class="empty-tip">这里还没有歌曲。把音乐文件放进 music 目录，或上传音频文件。</div>';
      return;
    }

    const playing = currentTrack();
    list.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'track-row' + (playing && playing.id === t.id ? ' playing' : '');
      row.innerHTML = `
        <div class="t-idx">${i + 1}</div>
        <div class="t-title">${esc(t.title)}<span class="t-sub">${esc(t.folder === '.' ? '' : t.folder)}</span></div>
        <div class="t-artist">${esc(t.artist || '-')}</div>
        <div class="t-album">${esc(t.album || '-')}</div>
        <button class="t-more" title="加入歌单">⋯</button>`;
      row.onclick = () => {
        const ids = list.map((x) => x.id);
        setQueue(ids, ids.indexOf(t.id), true);
      };
      row.querySelector('.t-more').onclick = (e) => {
        e.stopPropagation();
        showPlaylistMenu(e.clientX, e.clientY, t);
      };
      el.appendChild(row);
    });
  }

  // ─── 加入歌单菜单 ───────────────────────────────────────
  function showPlaylistMenu(x, y, track) {
    const menu = $('playlist-menu');
    menu.innerHTML = '';
    if (!state.playlists.length) {
      menu.innerHTML = '<div class="menu-item" style="color:var(--text-dim)">暂无歌单，请先新建</div>';
    }
    for (const pl of state.playlists) {
      const item = document.createElement('div');
      item.className = 'menu-item';
      const has = pl.trackIds.includes(track.id);
      item.textContent = (has ? '✓ ' : '') + pl.name;
      item.onclick = async () => {
        menu.classList.add('hidden');
        try {
          await api(`/api/playlists/${pl.id}/tracks`, { method: 'POST', body: JSON.stringify({ trackId: track.id }) });
          await loadPlaylists();
        } catch { alert('加入歌单失败'); }
      };
      menu.appendChild(item);
    }
    // 删除歌曲
    const del = document.createElement('div');
    del.className = 'menu-item menu-item-danger';
    del.textContent = '🗑 删除歌曲';
    del.onclick = () => {
      menu.classList.add('hidden');
      deleteTrack(track);
    };
    menu.appendChild(del);
    menu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 40 * (state.playlists.length + 2)) + 'px';
    menu.classList.remove('hidden');
  }

  /** 删除歌曲：物理删除文件，处理队列与播放状态 */
  async function deleteTrack(track) {
    if (!confirm(`删除歌曲「${track.title}」？文件将从磁盘上永久删除，无法恢复。`)) return;
    try {
      await api(`/api/tracks/${track.id}`, { method: 'DELETE' });
    } catch (err) {
      alert('删除失败: ' + err.message);
      return;
    }
    const wasCurrent = currentTrack() && currentTrack().id === track.id;
    const qi = state.queue.indexOf(track.id);
    if (qi !== -1) {
      state.queue.splice(qi, 1);
      if (wasCurrent) {
        if (state.queue.length === 0) {
          stopPlayback();
        } else {
          // queueIndex 保持原位，splice 后该位置即下一首；越界则回绕
          if (state.queueIndex >= state.queue.length) state.queueIndex = 0;
          playCurrent(true);
        }
      } else if (qi < state.queueIndex) {
        state.queueIndex -= 1;
      }
    }
    await loadLibrary();
    await loadPlaylists();
    renderQueue();
    persistNow();
  }

  document.addEventListener('click', (e) => {
    const menu = $('playlist-menu');
    if (!menu.classList.contains('hidden') && !menu.contains(e.target)) menu.classList.add('hidden');
  });

  // ─── 队列 ──────────────────────────────────────────────
  function currentTrack() {
    if (state.queueIndex < 0 || state.queueIndex >= state.queue.length) return null;
    return state.trackMap.get(state.queue[state.queueIndex]) ?? null;
  }

  function setQueue(ids, index, autoplay) {
    state.queue = [...ids];
    state.queueIndex = index;
    renderQueue();
    if (autoplay) playCurrent(true);
    persistNow();
  }

  function buildQueueItem(t, i) {
    const item = document.createElement('div');
    item.className = 'queue-item' + (i === state.queueIndex ? ' playing' : '');
    item.innerHTML = `
      <span class="q-title">${i === state.queueIndex ? '▶ ' : ''}${esc(t.title)}</span>
      <span class="q-artist">${esc(t.artist || '')}</span>
      <button class="q-remove" title="移除">✕</button>`;
    item.onclick = () => { state.queueIndex = i; playCurrent(true); };
    item.querySelector('.q-remove').onclick = (e) => {
      e.stopPropagation();
      removeFromQueue(i);
    };
    return item;
  }

  function renderQueue() {
    // 桌面右栏
    const el = $('queue-list');
    el.innerHTML = '';
    // 移动端队列视图
    const mel = $('m-queue-list');
    if (mel) mel.innerHTML = '';

    if (!state.queue.length) {
      el.innerHTML = '<div class="empty-tip">队列为空</div>';
      if (mel) mel.innerHTML = '<div class="empty-tip">队列为空</div>';
      return;
    }
    state.queue.forEach((id, i) => {
      const t = state.trackMap.get(id);
      if (!t) return;
      el.appendChild(buildQueueItem(t, i));
      if (mel) mel.appendChild(buildQueueItem(t, i));
    });
  }

  function removeFromQueue(i) {
    const wasCurrent = i === state.queueIndex;
    state.queue.splice(i, 1);
    if (i < state.queueIndex) state.queueIndex -= 1;
    if (wasCurrent) {
      if (state.queue.length === 0) {
        stopPlayback();
      } else {
        if (state.queueIndex >= state.queue.length) state.queueIndex = 0;
        playCurrent(true);
      }
    }
    renderQueue();
    persistNow();
  }

  function stopPlayback() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    state.queueIndex = -1;
    state.lyrics = [];
    renderLyrics();
    updateNowPlaying(null);
    updatePlayButton();
    renderQueue();
    persistNow();
  }

  // ─── 播放核心 ───────────────────────────────────────────
  function playCurrent(autoplay) {
    const t = currentTrack();
    if (!t) return;
    audio.src = `/api/stream/${t.id}`;
    if (autoplay) audio.play().catch(() => { /* 浏览器自动播放策略拦截时忽略 */ });
    updateNowPlaying(t);
    loadLyrics(t);
    renderQueue();
    renderTracks();
    persistNow();
  }

  function updateNowPlaying(t) {
    const title = t ? t.title : '未在播放';
    const artist = t ? [t.artist, t.album].filter(Boolean).join(' · ') : '';
    $('np-title').textContent = title;
    $('np-artist').textContent = artist;
    $('mini-title').textContent = title;
    $('mini-artist').textContent = artist;
    $('fp-title').textContent = title;
    $('fp-artist').textContent = artist;
    document.title = t ? `${t.title} - 音乐` : '音乐';
    // 迷你播放条：有当前曲目时显示
    $('mini-player').classList.toggle('hidden', !t);
    document.body.classList.toggle('no-mini', !t);
  }

  function updatePlayButton() {
    const icon = audio.paused ? '▶' : '⏸';
    $('btn-play').textContent = icon;
    $('mini-btn-play').textContent = icon;
    $('fp-btn-play').textContent = icon;
  }

  function nextIndex(dir) {
    const n = state.queue.length;
    if (n === 0) return -1;
    if (state.mode === 'shuffle' && n > 1) {
      let i;
      do { i = Math.floor(Math.random() * n); } while (i === state.queueIndex || i === state.lastShuffle);
      return i;
    }
    return (state.queueIndex + dir + n) % n;
  }

  function playNext(dir) {
    const i = nextIndex(dir);
    if (i < 0) return;
    state.lastShuffle = state.queueIndex;
    state.queueIndex = i;
    playCurrent(true);
  }

  function togglePlay() {
    if (!currentTrack()) {
      const list = visibleTracks();
      if (list.length) setQueue(list.map((t) => t.id), 0, true);
      return;
    }
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  function cycleMode() {
    const i = (MODES.indexOf(state.mode) + 1) % MODES.length;
    state.mode = MODES[i];
    updateModeButton();
    persistNow();
  }

  // ─── 歌词 ──────────────────────────────────────────────
  async function loadLyrics(track) {
    state.lyrics = [];
    state.lyricIndex = -1;
    try {
      const data = await api(`/api/lyrics/${track.id}`);
      if (data.found) state.lyrics = parseLrc(data.text);
    } catch { /* 无歌词 */ }
    renderLyrics();
  }

  function renderLyrics() {
    for (const id of ['lyrics-content', 'fp-lyrics-content']) {
      const el = $(id);
      if (!el) continue;
      if (!state.lyrics.length) {
        el.innerHTML = '<div class="lyrics-empty">暂无歌词</div>';
        continue;
      }
      el.innerHTML = '';
      state.lyrics.forEach((l, i) => {
        const line = document.createElement('div');
        line.className = 'lyric-line' + (i === state.lyricIndex ? ' current' : '');
        line.textContent = l.text || '♪';
        line.onclick = () => { audio.currentTime = l.time; if (audio.paused) audio.play().catch(() => {}); };
        el.appendChild(line);
      });
    }
  }

  function updateLyricHighlight() {
    if (!state.lyrics.length) return;
    const t = audio.currentTime;
    let idx = -1;
    for (let i = 0; i < state.lyrics.length; i++) {
      if (state.lyrics[i].time <= t) idx = i;
      else break;
    }
    if (idx !== state.lyricIndex) {
      state.lyricIndex = idx;
      for (const id of ['lyrics-content', 'fp-lyrics-content']) {
        const lines = $(id).children;
        for (let i = 0; i < lines.length; i++) {
          lines[i].classList.toggle('current', i === idx);
        }
        if (idx >= 0 && lines[idx] && !$(id).closest('.hidden')) {
          lines[idx].scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
    }
  }

  // ─── 进度与音量 ─────────────────────────────────────────
  function updateProgress() {
    const cur = audio.currentTime || 0;
    const dur = audio.duration || 0;
    const pct = dur ? `${(cur / dur) * 100}%` : '0%';
    $('time-current').textContent = fmtTime(cur);
    $('time-total').textContent = fmtTime(dur);
    $('progress-fill').style.width = pct;
    $('fp-time-current').textContent = fmtTime(cur);
    $('fp-time-total').textContent = fmtTime(dur);
    $('fp-progress-fill').style.width = pct;
    updateLyricHighlight();
  }

  /** 进度条 seek（pointer 事件，鼠标与触摸通用） */
  function bindSeek(barEl, fillEl) {
    let dragging = false;
    const seekAt = (clientX) => {
      const rect = barEl.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      if (audio.duration) audio.currentTime = ratio * audio.duration;
    };
    barEl.addEventListener('pointerdown', (e) => {
      dragging = true;
      barEl.setPointerCapture(e.pointerId);
      seekAt(e.clientX);
    });
    barEl.addEventListener('pointermove', (e) => { if (dragging) seekAt(e.clientX); });
    barEl.addEventListener('pointerup', () => { dragging = false; });
    barEl.addEventListener('pointercancel', () => { dragging = false; });
  }

  function setVolume(v) {
    audio.volume = v;
    audio.muted = false;
    $('volume-slider').value = Math.round(v * 100);
    $('fp-volume-slider').value = Math.round(v * 100);
    updateVolumeIcon();
    persistNow();
  }

  function updateVolumeIcon() {
    $('btn-mute').textContent = audio.muted || audio.volume === 0 ? '🔇' : audio.volume < 0.5 ? '🔉' : '🔊';
  }

  // ─── 移动端：视图切换 / 迷你播放条 / 全屏播放页 ─────────
  function switchMobileView(view) {
    state.mobileView = view;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    $('main').classList.toggle('hidden', view !== 'library');
    $('m-view-playlists').classList.toggle('hidden', view !== 'playlists');
    $('m-view-queue').classList.toggle('hidden', view !== 'queue');
  }

  function openFullPlayer() {
    const fp = $('full-player');
    fp.classList.remove('hidden', 'slide-down');
  }

  function closeFullPlayer() {
    const fp = $('full-player');
    fp.classList.add('slide-down');
    setTimeout(() => {
      fp.classList.add('hidden');
      fp.classList.remove('slide-down');
      $('fp-lyrics').classList.add('hidden');
    }, 280);
  }

  // ─── 事件绑定 ───────────────────────────────────────────
  function bindEvents() {
    // 播放控制（桌面 + 迷你条 + 全屏播放页）
    $('btn-play').onclick = togglePlay;
    $('mini-btn-play').onclick = (e) => { e.stopPropagation(); togglePlay(); };
    $('fp-btn-play').onclick = togglePlay;
    for (const id of ['btn-prev', 'fp-btn-prev']) $(id).onclick = () => playNext(-1);
    for (const id of ['btn-next', 'fp-btn-next', 'mini-btn-next']) {
      $(id).onclick = (e) => { e.stopPropagation(); playNext(1); };
    }
    $('btn-mode').onclick = cycleMode;
    $('fp-btn-mode').onclick = cycleMode;

    // 主题切换
    $('btn-theme').onclick = cycleTheme;
    $('fp-btn-theme').onclick = cycleTheme;

    audio.addEventListener('play', updatePlayButton);
    audio.addEventListener('pause', updatePlayButton);
    audio.addEventListener('timeupdate', () => { updateProgress(); schedulePersist(); });
    audio.addEventListener('ended', () => {
      if (state.mode === 'single') {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } else {
        playNext(1);
      }
    });
    audio.addEventListener('error', () => {
      const t = currentTrack();
      if (t) console.error(`播放失败: ${t.title}（浏览器可能不支持该格式）`);
    });

    // 进度条（桌面 + 全屏）
    bindSeek($('progress-bar'), $('progress-fill'));
    bindSeek($('fp-progress-bar'), $('fp-progress-fill'));

    // 音量（桌面 + 全屏同步）
    $('volume-slider').addEventListener('input', (e) => setVolume(e.target.value / 100));
    $('fp-volume-slider').addEventListener('input', (e) => setVolume(e.target.value / 100));
    $('btn-mute').onclick = () => {
      audio.muted = !audio.muted;
      updateVolumeIcon();
      persistNow();
    };

    $('search-input').addEventListener('input', (e) => {
      state.search = e.target.value;
      renderTracks();
    });

    $('btn-play-all').onclick = () => {
      const list = visibleTracks();
      if (list.length) setQueue(list.map((t) => t.id), 0, true);
    };

    $('btn-clear-queue').onclick = () => {
      state.queue = [];
      state.queueIndex = -1;
      stopPlayback();
    };
    $('m-btn-clear-queue').onclick = () => {
      state.queue = [];
      state.queueIndex = -1;
      stopPlayback();
    };

    const newPlaylist = async () => {
      const name = prompt('新建歌单，请输入名称');
      if (!name || !name.trim()) return;
      try {
        await api('/api/playlists', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
        await loadPlaylists();
      } catch (err) {
        alert(err.status === 409 ? '歌单名已存在' : '创建失败: ' + err.message);
      }
    };
    $('btn-new-playlist').onclick = newPlaylist;
    $('m-btn-new-playlist').onclick = newPlaylist;

    // 桌面右栏 tab 切换
    document.querySelectorAll('#rightbar-tabs .rb-tab').forEach((tab) => {
      tab.onclick = () => {
        document.querySelectorAll('#rightbar-tabs .rb-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        $('queue-panel').classList.toggle('active', tab.dataset.tab === 'queue');
        $('lyrics-panel').classList.toggle('active', tab.dataset.tab === 'lyrics');
      };
    });

    // 移动端：标签栏
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.onclick = () => switchMobileView(btn.dataset.view);
    });

    // 移动端：迷你播放条 → 全屏播放页
    $('mini-player').onclick = openFullPlayer;
    $('fp-close').onclick = closeFullPlayer;
    $('fp-btn-lyrics').onclick = () => $('fp-lyrics').classList.toggle('hidden');
    $('fp-lyrics-close').onclick = () => $('fp-lyrics').classList.add('hidden');

    // 全屏播放页下滑手势关闭
    let touchStartY = null;
    const fp = $('full-player');
    fp.addEventListener('touchstart', (e) => { touchStartY = e.touches[0].clientY; }, { passive: true });
    fp.addEventListener('touchend', (e) => {
      if (touchStartY !== null && e.changedTouches[0].clientY - touchStartY > 90) closeFullPlayer();
      touchStartY = null;
    }, { passive: true });

    // 上传
    $('upload-input').addEventListener('change', async (e) => {
      const files = [...e.target.files];
      if (!files.length) return;
      const status = $('upload-status');
      let ok = 0;
      let fail = 0;
      for (const file of files) {
        status.textContent = `上传中：${file.name}`;
        const fd = new FormData();
        fd.append('file', file);
        try {
          await api('/api/upload', { method: 'POST', body: fd });
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      status.textContent = `上传完成：成功 ${ok}${fail ? `，失败 ${fail}` : ''}`;
      e.target.value = '';
      await loadLibrary();
    });

    // 键盘快捷键：空格播放/暂停
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        e.preventDefault();
        togglePlay();
      }
    });

    // 桌面/移动布局切换时恢复状态
    mqMobile.addEventListener('change', (e) => {
      if (!e.matches) {
        // 切回桌面：恢复主区显示，隐藏移动视图与全屏播放页
        $('main').classList.remove('hidden');
        $('m-view-playlists').classList.add('hidden');
        $('m-view-queue').classList.add('hidden');
        $('full-player').classList.add('hidden');
      } else {
        switchMobileView(state.mobileView);
      }
    });
  }

  function updateModeButton() {
    for (const id of ['btn-mode', 'fp-btn-mode']) {
      const btn = $(id);
      btn.textContent = MODE_ICONS[state.mode];
      btn.title = MODE_TITLES[state.mode];
      btn.classList.toggle('on', state.mode !== 'loop');
    }
  }

  // ─── 启动 ──────────────────────────────────────────────
  async function init() {
    // 主题：先恢复记忆，再监听系统偏好变化
    let savedTheme = 'auto';
    try { savedTheme = localStorage.getItem(THEME_KEY) || 'auto'; } catch { /* ignore */ }
    applyTheme(savedTheme);
    mqDark.addEventListener('change', () => {
      // auto 模式由 CSS 媒体查询自动生效，无需手动处理；
      // 此处触发一次重绘以确保滚动条等原生元素刷新
      if (state.theme === 'auto') document.body.style.display = '';
    });

    bindEvents();
    await loadLibrary();
    await loadPlaylists();

    // 恢复状态
    const saved = restoreState();
    if (saved) {
      const validQueue = (saved.queue ?? []).filter((id) => state.trackMap.has(id));
      if (validQueue.length) {
        state.queue = validQueue;
        state.queueIndex = Math.min(Math.max(saved.queueIndex ?? 0, 0), validQueue.length - 1);
        if (saved.mode && MODES.includes(saved.mode)) state.mode = saved.mode;
        const t = currentTrack();
        if (t) {
          audio.src = `/api/stream/${t.id}`;
          audio.volume = typeof saved.volume === 'number' ? saved.volume : 0.8;
          audio.muted = !!saved.muted;
          $('volume-slider').value = Math.round(audio.volume * 100);
          $('fp-volume-slider').value = Math.round(audio.volume * 100);
          updateVolumeIcon();
          updateModeButton();
          updateNowPlaying(t);
          loadLyrics(t);
          audio.addEventListener('loadedmetadata', function once() {
            if (saved.position && saved.position < (audio.duration || Infinity)) {
              audio.currentTime = saved.position;
            }
            audio.removeEventListener('loadedmetadata', once);
          });
        }
      }
    } else {
      audio.volume = 0.8;
    }
    updateModeButton();
    updateVolumeIcon();
    renderQueue();
    updateNowPlaying(currentTrack());
  }

  init().catch((err) => {
    console.error('初始化失败', err);
    document.getElementById('track-list').innerHTML =
      '<div class="empty-tip">加载失败，请确认服务已启动后刷新页面。</div>';
  });
})();
