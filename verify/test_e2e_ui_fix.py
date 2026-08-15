"""UI 缺陷修复复测：F1 桌面 tabbar 泄漏 / F2 移动端资料库可达 / F3 移动端视图切换 / F4 歌词层收起。

运行：
  PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers \
  python3 -m pytest verify/test_e2e_ui_fix.py --browser chromium -v -s

环境：服务 http://127.0.0.1:8787；Chromium 启动参数
--autoplay-policy=no-user-gesture-required --no-sandbox 由 conftest.py 注入。
证据写入 verify/e2e_report_fix.json，截图 verify/shots/fix_*。
"""
import json
import os
import time
import traceback

import pytest

BASE = "http://127.0.0.1:8787"
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots")
REPORT = os.path.join(HERE, "e2e_report_fix.json")
MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)

RESULTS = {}


# ─── fixtures ────────────────────────────────────────────────
@pytest.fixture(scope="function")
def browser_context_args(browser_context_args):
    """F1 桌面视口 1280x800。"""
    return {**browser_context_args, "viewport": {"width": 1280, "height": 800}}


@pytest.fixture()
def mobile_ctx(browser):
    """F2/F3/F4 移动端：新 context，视口 375x812。"""
    ctx = browser.new_context(
        viewport={"width": 375, "height": 812},
        user_agent=MOBILE_UA,
        is_mobile=True,
        has_touch=True,
    )
    yield ctx
    ctx.close()


# ─── 工具 ────────────────────────────────────────────────────
def shot(page, name):
    os.makedirs(SHOTS, exist_ok=True)
    try:
        page.screenshot(path=os.path.join(SHOTS, name))
    except Exception:
        pass


def cdisp(page, sel):
    return page.evaluate(f"getComputedStyle(document.querySelector('{sel}')).display")


def bbox(page, sel):
    return page.evaluate(
        f"""() => {{
            const el = document.querySelector('{sel}');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {{x: r.x, y: r.y, w: r.width, h: r.height}};
        }}"""
    )


def wait_play(page, timeout=12):
    """等待 audio 开始播放（currentTime>0 且未暂停）。"""
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = page.evaluate(
            "() => { const a = document.querySelector('#audio');"
            " return a ? {t: a.currentTime, p: !a.paused, r: a.readyState, src: a.currentSrc} : null; }"
        )
        if st and st.get("t", 0) > 0 and st.get("p"):
            return st
        time.sleep(0.25)
    return st


def open_mobile(mobile_ctx):
    page = mobile_ctx.new_page()
    page.goto(BASE)
    page.wait_for_selector(".track-row", timeout=15000)
    return page


def flush_report():
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(RESULTS, f, ensure_ascii=False, indent=2)


# ─── F1 桌面 tabbar 泄漏修复（1280x800）────────────────────
def test_F1_desktop_tabbar_hidden_and_playback(page, console_errors, evidence):
    ev = evidence
    ev["viewport"] = page.viewport_size
    try:
        _run_F1(page, ev)
    finally:
        ev["console_errors"] = list(console_errors)
        if "F1" not in RESULTS:
            RESULTS["F1"] = {"pass": False, "evidence": ev}
        flush_report()


def _run_F1(page, ev):
    page.goto(BASE)
    page.wait_for_selector(".track-row", timeout=15000)

    # F1.1 #tabbar 不可见（display none 或高度为 0）
    d_tab = cdisp(page, "#tabbar")
    b_tab = bbox(page, "#tabbar")
    ev["tabbar"] = {"display": d_tab, "rect": b_tab}
    assert d_tab == "none" or (b_tab and b_tab["h"] == 0), f"tabbar 泄漏: {d_tab} {b_tab}"

    # F1.2 #player-bar 可见
    d_pb = cdisp(page, "#player-bar")
    b_pb = bbox(page, "#player-bar")
    ev["player_bar"] = {"display": d_pb, "rect": b_pb}
    assert d_pb != "none" and b_pb and b_pb["h"] > 0, f"player-bar 不可见: {d_pb} {b_pb}"

    # F1.2 #btn-mode 真实点击，图标 🔁→🔂
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_selector(".track-row", timeout=15000)
    icon0 = (page.text_content("#btn-mode") or "").strip()
    ev["btn_mode_before"] = icon0
    page.locator("#btn-mode").click()
    page.wait_for_timeout(300)
    icon1 = (page.text_content("#btn-mode") or "").strip()
    ev["btn_mode_after"] = icon1
    assert icon0 == "🔁", f"初始模式图标应为 🔁，实际 {icon0!r}"
    assert icon1 == "🔂", f"click 后图标应为 🔂，实际 {icon1!r}"

    # F1.3 点击曲目行播放
    row = page.locator(".track-row").first
    row_name = " ".join((row.text_content() or "").split())
    page.evaluate("document.querySelector('#audio').currentTime = 0")
    row.click()
    st = wait_play(page)
    ev["audio_after_click"] = st
    ev["row_clicked"] = row_name
    assert st and st.get("p") and st.get("t", 0) > 0, f"点击曲目行后未播放: {st}"
    np = (page.text_content("#np-title") or "").strip()
    ev["np_title"] = np
    assert np, "#np-title 为空"
    t1 = page.evaluate("document.querySelector('#audio').currentTime")
    page.wait_for_timeout(1500)
    t2 = page.evaluate("document.querySelector('#audio').currentTime")
    ev["currentTime_growth"] = [t1, t2]
    assert t2 > t1, f"audio.currentTime 未增长: {t1} -> {t2}"
    shot(page, "fix_f1_desktop.png")
    RESULTS["F1"] = {"pass": True, "evidence": ev}


# ─── F2 移动端资料库可达（375x812 新 context）───────────────
def test_F2_mobile_library_reachable(mobile_ctx, evidence):
    ev = evidence
    errors = []
    try:
        _run_F2(mobile_ctx, ev, errors)
    finally:
        ev["console_errors"] = errors
        if "F2" not in RESULTS:
            RESULTS["F2"] = {"pass": False, "evidence": ev}
        flush_report()


def _run_F2(mobile_ctx, ev, errors):
    page = mobile_ctx.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))

    page.goto(BASE)
    page.wait_for_selector(".track-row", timeout=15000)
    ev["viewport"] = page.viewport_size

    # F2.1 #main 宽高 > 0
    b_main = bbox(page, "#main")
    ev["main_rect"] = b_main
    assert b_main and b_main["w"] > 0 and b_main["h"] > 0, f"#main 宽高为 0: {b_main}"

    # F2.2 可见 .track-row 数量 > 0
    n_total = page.locator(".track-row").count()
    n_visible = page.locator(".track-row:visible").count()
    ev["track_rows"] = {"total": n_total, "visible": n_visible}
    assert n_visible > 0, f"可见 .track-row 数量为 0（总数 {n_total}）"

    # F2.3 真实点击第一个 .track-row → #mini-player 出现且 #mini-title 有歌名
    first_name = " ".join((page.locator(".track-row").first.text_content() or "").split())
    ev["first_track"] = first_name
    page.locator(".track-row").first.click()
    page.wait_for_timeout(600)
    st = wait_play(page)
    ev["audio_after_click"] = st
    d_mini = cdisp(page, "#mini-player")
    cls_mini = page.evaluate("document.querySelector('#mini-player').className")
    b_mini = bbox(page, "#mini-player")
    mini_title = (page.text_content("#mini-title") or "").strip()
    ev["mini_player"] = {"display": d_mini, "class": cls_mini, "rect": b_mini, "title": mini_title}
    assert d_mini != "none" and b_mini and b_mini["h"] > 0, f"#mini-player 未出现: {d_mini} {b_mini}"
    assert mini_title, "#mini-title 为空"
    shot(page, "fix_f2_mobile.png")
    RESULTS["F2"] = {"pass": True, "evidence": ev}


# ─── F3 移动端队列/歌单视图显示 ─────────────────────────────
def test_F3_mobile_view_switch(mobile_ctx, evidence):
    ev = evidence
    errors = []
    try:
        _run_F3(mobile_ctx, ev, errors)
    finally:
        ev["console_errors"] = errors
        if "F3" not in RESULTS:
            RESULTS["F3"] = {"pass": False, "evidence": ev}
        flush_report()


def _run_F3(mobile_ctx, ev, errors):
    page = mobile_ctx.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))

    page.goto(BASE)
    page.wait_for_selector(".track-row", timeout=15000)

    def view_state():
        return {
            "main": cdisp(page, "#main"),
            "queue": cdisp(page, "#m-view-queue"),
            "playlists": cdisp(page, "#m-view-playlists"),
            "active_tab": page.evaluate(
                "(document.querySelector('.tab-btn.active')||{}).dataset?.view || null"
            ),
        }

    ev["initial"] = view_state()

    # F3.1 queue
    page.locator('.tab-btn[data-view="queue"]').click()
    page.wait_for_timeout(300)
    s1 = view_state()
    ev["after_queue"] = s1
    assert s1["queue"] != "none", f"#m-view-queue 不可见: {s1}"

    # F3.2 playlists
    page.locator('.tab-btn[data-view="playlists"]').click()
    page.wait_for_timeout(300)
    s2 = view_state()
    ev["after_playlists"] = s2
    assert s2["playlists"] != "none", f"#m-view-playlists 不可见: {s2}"
    shot(page, "fix_f3_playlists.png")

    # F3.3 回到 library
    page.locator('.tab-btn[data-view="library"]').click()
    page.wait_for_timeout(300)
    s3 = view_state()
    ev["after_library"] = s3
    assert s3["main"] != "none", f"回到 library 后 #main 不可见: {s3}"
    assert page.locator(".track-row:visible").count() > 0, "回到 library 后无可见曲目行"
    RESULTS["F3"] = {"pass": True, "evidence": ev}


# ─── F4 歌词层收起 ───────────────────────────────────────────
def test_F4_lyrics_close(mobile_ctx, evidence):
    ev = evidence
    errors = []
    try:
        _run_F4(mobile_ctx, ev, errors)
    finally:
        ev["console_errors"] = errors
        if "F4" not in RESULTS:
            RESULTS["F4"] = {"pass": False, "evidence": ev}
        flush_report()


def _run_F4(mobile_ctx, ev, errors):
    page = mobile_ctx.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))

    page.goto(BASE)
    page.wait_for_selector(".track-row", timeout=15000)

    # F4.1 播放歌曲 → 点击 #mini-player 打开 #full-player
    page.locator(".track-row").first.click()
    st = wait_play(page)
    ev["audio_after_play"] = st
    assert st and st.get("p") and st.get("t", 0) > 0, f"歌曲未播放: {st}"
    page.wait_for_timeout(400)
    page.locator("#mini-player").click()
    page.wait_for_timeout(700)  # 等待 slide 动画
    d_fp = cdisp(page, "#full-player")
    ev["full_player_display"] = d_fp
    assert d_fp != "none", f"#full-player 未打开: display={d_fp}"

    # F4.2 点击 #fp-btn-lyrics → #fp-lyrics 可见
    page.locator("#fp-btn-lyrics").click()
    page.wait_for_timeout(300)
    d_ly1 = cdisp(page, "#fp-lyrics")
    ev["fp_lyrics_after_open"] = d_ly1
    assert d_ly1 != "none", f"#fp-lyrics 未显示: display={d_ly1}"
    shot(page, "fix_f4_lyrics_open.png")

    # F4.3 真实点击 #fp-lyrics-close（右上角 ✕）→ #fp-lyrics 隐藏
    page.locator("#fp-lyrics-close").click()
    page.wait_for_timeout(300)
    d_ly2 = cdisp(page, "#fp-lyrics")
    cls_ly2 = page.evaluate("document.querySelector('#fp-lyrics').className")
    ev["fp_lyrics_after_close"] = {"display": d_ly2, "class": cls_ly2}
    assert d_ly2 == "none", f"#fp-lyrics 未收起: display={d_ly2} class={cls_ly2!r}"
    shot(page, "fix_f4_lyrics_closed.png")
    RESULTS["F4"] = {"pass": True, "evidence": ev}
