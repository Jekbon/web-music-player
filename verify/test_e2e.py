"""Web 音乐播放器端到端实测（A10-A13）。

运行：
  PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers \
  python3 -m pytest verify/test_e2e.py --browser chromium -v -s
"""
import time

from playwright.sync_api import expect

BASE = "http://127.0.0.1:18787"


# ─── 工具函数 ────────────────────────────────────────────────
def audio_state(page):
    return page.evaluate(
        """() => {
            const a = document.getElementById('audio');
            return {currentTime: a.currentTime, paused: a.paused,
                    volume: a.volume, muted: a.muted,
                    duration: a.duration, src: a.src};
        }"""
    )


def open_page(page):
    page.goto(BASE)
    expect(page.locator(".track-row")).to_have_count(3, timeout=15000)


def queue_titles(page):
    return page.eval_on_selector_all(
        "#queue-list .queue-item .q-title",
        "els => els.map(e => e.textContent.replace(/^▶\\s*/, ''))",
    )


def set_slider(page, value):
    page.evaluate(
        """(v) => {
            const s = document.getElementById('volume-slider');
            s.value = String(v);
            s.dispatchEvent(new Event('input', {bubbles: true}));
        }""",
        value,
    )


# ─── A10 曲库渲染与播放控制 ──────────────────────────────────
def test_A10_library_and_playback_controls(page, console_errors, evidence):
    ev = evidence
    open_page(page)

    # 1. 曲目列表 3 首 + 左侧"演示专辑"分组
    ev["track_rows"] = page.locator(".track-row").count()
    ev["track_titles"] = page.eval_on_selector_all(
        "#track-list .t-title", "els => els.map(e => e.childNodes[0].textContent)"
    )
    folders = page.locator("#folder-list .folder-item").all_text_contents()
    ev["folder_items"] = folders
    assert ev["track_rows"] == 3
    assert any("演示专辑" in f for f in folders), folders

    # 2. 点击"晨光"开始播放
    page.locator(".track-row", has_text="晨光").first.click()
    expect(page.locator("#np-title")).to_have_text("晨光", timeout=5000)
    expect(page.locator("#btn-play")).to_have_text("⏸", timeout=5000)
    page.wait_for_function(
        "() => !document.getElementById('audio').paused", timeout=5000
    )
    t1 = audio_state(page)["currentTime"]
    time.sleep(1.2)
    t2 = audio_state(page)["currentTime"]
    ev["play_growth"] = {"t1": round(t1, 2), "t2_after_1.2s": round(t2, 2)}
    assert t2 > t1 + 0.3, f"currentTime 未增长: {t1} -> {t2}"

    # 3. 暂停 / 恢复
    page.click("#btn-play")
    page.wait_for_function("() => document.getElementById('audio').paused", timeout=5000)
    ev["pause_button_text"] = page.text_content("#btn-play")
    p1 = audio_state(page)["currentTime"]
    time.sleep(0.8)
    p2 = audio_state(page)["currentTime"]
    ev["pause_drift"] = round(abs(p2 - p1), 3)
    assert abs(p2 - p1) < 0.05, f"暂停后 currentTime 仍在增长: {p1} -> {p2}"
    page.click("#btn-play")
    page.wait_for_function(
        "() => !document.getElementById('audio').paused", timeout=5000
    )
    r1 = audio_state(page)["currentTime"]
    time.sleep(0.8)
    r2 = audio_state(page)["currentTime"]
    ev["resume_growth"] = round(r2 - r1, 2)
    assert r2 > r1 + 0.2, "恢复播放后 currentTime 未增长"

    # 4. 下一首 / 上一首
    titles = queue_titles(page)
    ev["queue_after_click_track"] = titles
    assert "晨光" in titles and len(titles) == 3
    page.click("#btn-next")
    expect(page.locator("#np-title")).not_to_have_text("晨光", timeout=5000)
    next_title = page.text_content("#np-title")
    ev["after_next"] = next_title
    assert next_title == titles[2], f"期望 {titles[2]}，实际 {next_title}"
    page.click("#btn-prev")
    expect(page.locator("#np-title")).to_have_text("晨光", timeout=5000)
    ev["after_prev"] = page.text_content("#np-title")

    # 5. 点击进度条中部跳转
    page.wait_for_function(
        "() => isFinite(document.getElementById('audio').duration) && document.getElementById('audio').duration > 0",
        timeout=5000,
    )
    dur = audio_state(page)["duration"]
    before = audio_state(page)["currentTime"]
    bar = page.locator("#progress-bar")
    box = bar.bounding_box()
    bar.click(position={"x": box["width"] / 2, "y": box["height"] / 2})
    page.wait_for_function(
        f"() => document.getElementById('audio').currentTime > {before + 1}",
        timeout=5000,
    )
    after = audio_state(page)["currentTime"]
    ev["seek"] = {"duration": dur, "before": round(before, 2), "after": round(after, 2)}
    assert after > before + 1, "进度条点击未引起明显跳转"
    assert abs(after - dur / 2) < 1.5, f"未跳到中部: after={after}, dur/2={dur/2}"

    # 6. 音量 30 / 静音切换
    set_slider(page, 30)
    v = audio_state(page)["volume"]
    ev["volume_at_30"] = v
    assert abs(v - 0.3) < 0.01, f"audio.volume={v}"
    page.click("#btn-mute")
    st = audio_state(page)
    ev["mute"] = {"muted": st["muted"], "icon": page.text_content("#btn-mute")}
    assert st["muted"] is True
    page.click("#btn-mute")
    st = audio_state(page)
    ev["unmute"] = {"muted": st["muted"], "icon": page.text_content("#btn-mute")}
    assert st["muted"] is False

    # 7. 播放模式切换 🔁 -> 🔂 -> 🔀
    m0 = page.text_content("#btn-mode")
    page.click("#btn-mode")
    m1 = page.text_content("#btn-mode")
    page.click("#btn-mode")
    m2 = page.text_content("#btn-mode")
    ev["modes"] = [m0, m1, m2]
    assert (m0, m1, m2) == ("🔁", "🔂", "🔀"), (m0, m1, m2)

    ev["console_errors"] = list(console_errors)
    assert not console_errors, console_errors


# ─── A11 播放队列 ────────────────────────────────────────────
def test_A11_play_queue(page, console_errors, evidence):
    ev = evidence
    open_page(page)

    # 1. 播放全部 -> 队列 3 项，当前项高亮
    page.click("#btn-play-all")
    expect(page.locator("#queue-list .queue-item")).to_have_count(3, timeout=5000)
    playing = page.locator("#queue-list .queue-item.playing")
    ev["queue_items"] = queue_titles(page)
    ev["playing_item"] = playing.text_content()
    ev["np_title"] = page.text_content("#np-title")
    assert playing.count() == 1, "应有且仅有一个高亮项"
    assert "▶" in playing.text_content()
    assert page.text_content("#np-title") == ev["queue_items"][0]

    # 2. 点击队列第 2 项
    page.locator("#queue-list .queue-item").nth(1).click()
    expect(page.locator("#np-title")).to_have_text(ev["queue_items"][1], timeout=5000)
    ev["after_click_item2"] = page.text_content("#np-title")
    playing_idx = page.evaluate(
        "() => [...document.querySelectorAll('#queue-list .queue-item')]"
        ".findIndex(e => e.classList.contains('playing'))"
    )
    ev["highlight_index_after_click"] = playing_idx
    assert playing_idx == 1

    # 3. 移除一项 -> 剩 2 项（✕ 按钮 hover 时才可见，先 hover 队列项）
    first_item = page.locator("#queue-list .queue-item").first
    first_item.hover()
    first_item.locator(".q-remove").click()
    expect(page.locator("#queue-list .queue-item")).to_have_count(2, timeout=5000)
    ev["queue_after_remove"] = queue_titles(page)

    # 4. 清空队列 -> 队列空 + 播放停止
    page.click("#btn-clear-queue")
    expect(page.locator("#queue-list .queue-item")).to_have_count(0, timeout=5000)
    ev["queue_empty_tip"] = page.text_content("#queue-list")
    expect(page.locator("#np-title")).to_have_text("未在播放", timeout=5000)
    page.wait_for_function("() => document.getElementById('audio').paused", timeout=5000)
    ev["paused_after_clear"] = audio_state(page)["paused"]

    ev["console_errors"] = list(console_errors)
    assert not console_errors, console_errors


# ─── A12 状态记忆 ────────────────────────────────────────────
def test_A12_state_persistence(page, console_errors, evidence):
    ev = evidence
    open_page(page)

    # 1. 播放全部，等约 2 秒，音量 55，切换一次播放模式
    page.click("#btn-play-all")
    page.wait_for_function(
        "() => !document.getElementById('audio').paused", timeout=5000
    )
    time.sleep(2.0)
    set_slider(page, 55)
    page.click("#btn-mode")
    mode_before = page.text_content("#btn-mode")
    title_before = page.text_content("#np-title")
    live_pos = audio_state(page)["currentTime"]
    saved = page.evaluate(
        "() => JSON.parse(localStorage.getItem('wmp-state-v1') || 'null')"
    )
    ev["before_reload"] = {
        "np_title": title_before,
        "mode_icon": mode_before,
        "live_currentTime": round(live_pos, 2),
        "saved_state": saved,
    }
    assert saved is not None, "localStorage 中无持久化状态"
    assert abs(saved["volume"] - 0.55) < 0.01
    assert saved["mode"] == "single" and mode_before == "🔂"
    assert len(saved["queue"]) == 3

    # 2. 刷新页面
    page.reload()
    expect(page.locator(".track-row")).to_have_count(3, timeout=15000)
    page.wait_for_function(
        "() => document.getElementById('audio').readyState >= 1", timeout=10000
    )
    time.sleep(0.5)

    # 3. 恢复校验
    st = audio_state(page)
    after = {
        "np_title": page.text_content("#np-title"),
        "mode_icon": page.text_content("#btn-mode"),
        "currentTime": round(st["currentTime"], 2),
        "volume": st["volume"],
        "paused": st["paused"],
        "queue_count": page.locator("#queue-list .queue-item").count(),
        "slider_value": page.input_value("#volume-slider"),
    }
    ev["after_reload"] = after
    assert after["np_title"] == title_before, (after["np_title"], title_before)
    assert abs(st["currentTime"] - saved["position"]) <= 1.5, (
        f"位置恢复偏差: restored={st['currentTime']} saved={saved['position']}"
    )
    assert abs(st["volume"] - 0.55) < 0.01, st["volume"]
    assert after["mode_icon"] == mode_before
    assert after["queue_count"] == 3
    assert st["paused"] is True, "刷新后不应自动播放"

    ev["console_errors"] = list(console_errors)
    assert not console_errors, console_errors


# ─── A13 搜索与歌词 ──────────────────────────────────────────
def test_A13_search_and_lyrics(page, console_errors, evidence):
    ev = evidence
    open_page(page)

    # 1. 搜索"晨光" -> 1 首；清空 -> 3 首
    page.fill("#search-input", "晨光")
    expect(page.locator(".track-row")).to_have_count(1, timeout=5000)
    ev["search_result"] = page.locator(".track-row").all_text_contents()
    page.fill("#search-input", "")
    expect(page.locator(".track-row")).to_have_count(3, timeout=5000)

    # 2. 播放晨光，切到歌词 tab，3 行歌词
    page.locator(".track-row", has_text="晨光").first.click()
    expect(page.locator("#np-title")).to_have_text("晨光", timeout=5000)
    page.click('#rightbar-tabs .tab[data-tab="lyrics"]')
    expect(page.locator(".lyric-line")).to_have_count(3, timeout=5000)
    ev["lyric_lines"] = page.locator(".lyric-line").all_text_contents()

    # 3. 高亮行随时间推进
    page.wait_for_function(
        "() => document.querySelector('#lyrics-content .lyric-line.current') !== null",
        timeout=6000,
    )
    idx1 = page.evaluate(
        "() => [...document.querySelectorAll('.lyric-line')]"
        ".findIndex(e => e.classList.contains('current'))"
    )
    t_at_line1 = audio_state(page)["currentTime"]
    ev["first_highlight"] = {"index": idx1, "currentTime": round(t_at_line1, 2)}
    assert idx1 == 0 and t_at_line1 >= 0.4, (idx1, t_at_line1)

    page.wait_for_function(
        "() => [...document.querySelectorAll('.lyric-line')]"
        ".findIndex(e => e.classList.contains('current')) === 1",
        timeout=8000,
    )
    t_at_line2 = audio_state(page)["currentTime"]
    ev["second_highlight"] = {"index": 1, "currentTime": round(t_at_line2, 2)}
    assert t_at_line2 >= 1.8, t_at_line2

    # 4. 点击第 3 行歌词 -> currentTime 跳到约 4s
    page.locator(".lyric-line").nth(2).click()
    page.wait_for_function(
        "() => document.getElementById('audio').currentTime >= 3.5", timeout=5000
    )
    jump_to = audio_state(page)["currentTime"]
    ev["click_line3_jump"] = round(jump_to, 2)
    assert abs(jump_to - 4.0) <= 0.6, jump_to

    ev["console_errors"] = list(console_errors)
    assert not console_errors, console_errors
