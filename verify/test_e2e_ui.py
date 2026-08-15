"""UI 改造（Apple Music 极简风格）端到端实测：T1 主题 / T2 桌面 / T3 移动端。

运行：
  PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers \
  python3 -m pytest verify/test_e2e_ui.py --browser chromium -v -s

环境要求：服务运行在 http://127.0.0.1:8787，曲库含 test-song.wav。
Chromium 启动参数 --autoplay-policy=no-user-gesture-required 由 conftest.py 提供。

每个测试函数内部按子项（T1.1…T3.7）独立判定：单项失败不中断后续子项，
全部证据写入 evidence（conftest 汇总到 verify/e2e_report.json），
截图存 verify/shots/。
"""
import os
import re
import time
import traceback

import pytest
from playwright.sync_api import expect

BASE = "http://127.0.0.1:8787"
SONG = "test-song"
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")


# ─── fixtures / 工具 ─────────────────────────────────────────
@pytest.fixture(scope="function")
def browser_context_args(browser_context_args):
    """桌面测试视口 1280x800。"""
    return {**browser_context_args, "viewport": {"width": 1280, "height": 800}}


def open_page(page):
    page.goto(BASE)
    expect(page.locator(".track-row").first).to_be_attached(timeout=15000)


def disp(page, sel):
    """getComputedStyle(el).display"""
    return page.evaluate(f"getComputedStyle(document.querySelector('{sel}')).display")


def body_bg(page):
    return page.evaluate("getComputedStyle(document.body).backgroundColor")


def rgb_lum(color):
    m = re.findall(r"\d+", color)
    r, g, b = (int(x) for x in m[:3])
    return round((r + g + b) / 3, 1)


def theme_of(page):
    return page.evaluate("document.documentElement.dataset.theme")


def box(page, sel):
    return page.evaluate(
        f"""() => {{
            const el = document.querySelector('{sel}');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
        }}"""
    )


def hit_test(page, sel):
    """元素中心点的命中元素 —— 判断是否被其他元素遮挡。"""
    return page.evaluate(
        f"""() => {{
            const el = document.querySelector('{sel}');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return {{
                rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
                hit: hit ? (hit.id ? '#' + hit.id : hit.className || hit.tagName) : null,
                hits_self: !!(hit && el.contains(hit)),
            }};
        }}"""
    )


def shot(page, name):
    os.makedirs(SHOTS, exist_ok=True)
    path = os.path.join(SHOTS, name)
    try:
        page.screenshot(path=path)
    except Exception:
        return None
    return path


class Checks:
    """子项收集器：单项失败不中断，最后统一断言。"""

    def __init__(self, ev):
        self.ev = ev
        ev["sub_results"] = {}
        ev["failures"] = []

    def run(self, name, fn):
        try:
            fn()
            self.ev["sub_results"][name] = "PASS"
        except Exception:
            self.ev["sub_results"][name] = "FAIL"
            self.ev["failures"].append(f"{name}: {traceback.format_exc(limit=6)}")

    def finish(self):
        assert not self.ev["failures"], "\n\n".join(self.ev["failures"])


# ─── T1 主题三态切换与记忆（桌面 1280x800）──────────────────
def test_T1_theme_cycle_and_memory(page, console_errors, evidence):
    ev = evidence
    open_page(page)
    ck = Checks(ev)

    # T1.1 初始主题 = auto（或 localStorage 记忆值）
    def t1_1():
        init_theme = theme_of(page)
        saved = page.evaluate("localStorage.getItem('wmp-theme')")
        ev["t1_1_initial"] = {"dataset.theme": init_theme, "localStorage_wmp_theme": saved}
        if saved is None:
            assert init_theme == "auto", f"全新环境初始主题应为 auto，实际 {init_theme}"
        else:
            assert init_theme == saved, f"初始主题 {init_theme} 与记忆值 {saved} 不一致"

    ck.run("T1.1 初始主题", t1_1)

    # T1.2 点击 #btn-theme 3 次循环 + title 含"主题："
    def t1_2():
        seq = [theme_of(page)]
        titles = []
        for _ in range(3):
            page.click("#btn-theme")
            seq.append(theme_of(page))
            titles.append(page.get_attribute("#btn-theme", "title"))
        ev["t1_2_cycle"] = {"theme_sequence": seq, "button_titles": titles}
        assert seq == ["auto", "light", "dark", "auto"], f"主题循环异常: {seq}"
        assert all(t and "主题：" in t for t in titles), f"按钮 title 未含'主题：': {titles}"

    ck.run("T1.2 三态循环", t1_2)

    # T1.3 dark 下刷新，记忆生效
    def t1_3():
        while theme_of(page) != "dark":
            page.click("#btn-theme")
        page.reload()
        page.wait_for_load_state("domcontentloaded")
        expect(page.locator(".track-row").first).to_be_attached(timeout=15000)
        after = theme_of(page)
        ev["t1_3_reload"] = {
            "dataset.theme_after_reload": after,
            "localStorage_wmp_theme": page.evaluate("localStorage.getItem('wmp-theme')"),
        }
        assert after == "dark", f"刷新后主题记忆失效: {after}"
        time.sleep(0.5)
        ev["t1_3_dark_body_bg"] = body_bg(page)
        shot(page, "t1_dark.png")

    ck.run("T1.3 dark 刷新记忆", t1_3)

    # T1.4 深色背景接近黑 / 浅色背景接近白
    def t1_4():
        dark_bg = ev.get("t1_3_dark_body_bg") or body_bg(page)
        while theme_of(page) != "light":
            page.click("#btn-theme")
        time.sleep(0.5)  # body background 有 0.25s transition
        light_bg = body_bg(page)
        shot(page, "t1_light.png")
        ev["t1_4_background"] = {
            "dark_theme_body_bg": dark_bg,
            "dark_luminance": rgb_lum(dark_bg),
            "light_theme_body_bg": light_bg,
            "light_luminance": rgb_lum(light_bg),
        }
        assert rgb_lum(dark_bg) < 40, f"深色主题 body 背景未接近黑色: {dark_bg}"
        assert rgb_lum(light_bg) > 200, f"浅色主题 body 背景未接近白色: {light_bg}"

    ck.run("T1.4 深浅色背景", t1_4)

    ev["console_errors"] = list(console_errors)
    ck.finish()


# ─── T2 桌面布局与播放回归（桌面 1280x800）──────────────────
def test_T2_desktop_layout_and_playback(page, console_errors, evidence):
    ev = evidence
    open_page(page)
    ck = Checks(ev)

    # T2.1 布局元素
    def t2_1():
        app_display = disp(page, "#app")
        exists = {sel: page.locator(sel).count() for sel in ["#sidebar", "#main", "#rightbar", "#player-bar"]}
        ev["t2_1_layout"] = {
            "#app_display": app_display,
            "elements_exist": exists,
            "boxes": {sel: box(page, sel) for sel in ["#app", "#player-bar", "#tabbar"]},
        }
        assert app_display != "none", f"#app 不可见: display={app_display}"
        assert all(c == 1 for c in exists.values()), f"布局元素缺失: {exists}"
        shot(page, "t2_desktop.png")

    ck.run("T2.1 布局元素", t2_1)

    # T2.2 点击曲目行播放
    def t2_2():
        page.locator(".track-row", has_text=SONG).first.click(timeout=8000)
        expect(page.locator("#np-title")).to_have_text(SONG, timeout=5000)
        expect(page.locator("#btn-play")).to_have_text("⏸", timeout=5000)
        page.wait_for_function("() => !document.getElementById('audio').paused", timeout=5000)
        t1 = page.evaluate("document.getElementById('audio').currentTime")
        time.sleep(1.2)
        t2 = page.evaluate("document.getElementById('audio').currentTime")
        ev["t2_2_play"] = {
            "np_title": page.text_content("#np-title"),
            "btn_play_icon": page.text_content("#btn-play"),
            "currentTime": [round(t1, 2), round(t2, 2)],
            "audio_src": page.evaluate("document.getElementById('audio').src"),
        }
        assert t2 > t1 + 0.3, f"audio.currentTime 未增长: {t1} -> {t2}"

    ck.run("T2.2 点击播放", t2_2)

    # T2.3 播放模式图标循环 🔁→🔂→🔀→🔁
    def t2_3():
        diag = hit_test(page, "#btn-mode")
        ev["t2_3_hit_test_btn_mode"] = diag
        modes = [page.text_content("#btn-mode")]
        if diag and not diag["hits_self"]:
            # 被遮挡（如移动端 tabbar 泄漏到桌面视口）：记录缺陷，改用事件直发验证 JS 逻辑
            for _ in range(3):
                page.locator("#btn-mode").dispatch_event("click")
                modes.append(page.text_content("#btn-mode"))
            ev["t2_3_note"] = f"#btn-mode 被 {diag['hit']} 遮挡，无法真实点击（CSS 缺陷），已用 dispatchEvent 验证图标逻辑"
        else:
            for _ in range(3):
                page.click("#btn-mode")
                modes.append(page.text_content("#btn-mode"))
        ev["t2_3_mode_icons"] = modes
        assert modes == ["🔁", "🔂", "🔀", "🔁"], f"播放模式图标循环异常: {modes}"
        if diag and not diag["hits_self"]:
            raise AssertionError(
                f"#btn-mode 在桌面视口被 {diag['hit']} 遮挡（rect={diag['rect']}），点击无法触达"
            )

    ck.run("T2.3 播放模式切换", t2_3)

    # T2.4 搜索过滤
    def t2_4():
        rows_before = page.locator(".track-row").count()
        page.fill("#search-input", "test")
        expect(page.locator(".track-row")).to_have_count(1, timeout=3000)
        matched = page.text_content(".track-row .t-title")
        page.fill("#search-input", "zzz-no-match")
        expect(page.locator(".track-row")).to_have_count(0, timeout=3000)
        empty_tip = page.text_content("#track-list .empty-tip")
        page.fill("#search-input", "")
        expect(page.locator(".track-row")).to_have_count(rows_before, timeout=3000)
        ev["t2_4_search"] = {
            "rows_before": rows_before,
            "keyword_test_rows": 1,
            "matched_title": matched,
            "keyword_nomatch_rows": 0,
            "empty_tip": empty_tip,
            "rows_after_clear": rows_before,
        }
        assert SONG in (matched or ""), f"过滤结果不是 {SONG}: {matched}"

    ck.run("T2.4 搜索过滤", t2_4)

    ev["console_errors"] = list(console_errors)
    ck.finish()


# ─── T3 移动端（同一浏览器新建 context，viewport 375x812）────
def test_T3_mobile(browser, evidence):
    ev = evidence
    errors = []
    ctx = browser.new_context(viewport={"width": 375, "height": 812})
    page = ctx.new_page()
    page.on(
        "console",
        lambda m: errors.append(f"[console.error] {m.text}") if m.type == "error" else None,
    )
    page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))

    try:
        page.goto(BASE)
        expect(page.locator(".track-row").first).to_be_attached(timeout=15000)
        ck = Checks(ev)

        # T3.1 #app 隐藏、#tabbar 可见、3 个 .tab-btn
        def t3_1():
            app_display = disp(page, "#app")
            tabbar_display = disp(page, "#tabbar")
            tab_count = page.locator(".tab-btn").count()
            ev["t3_1_layout"] = {
                "#app_display": app_display,
                "#tabbar_display": tabbar_display,
                "tab_btn_count": tab_count,
            }
            assert app_display == "none", f"移动端 #app 应隐藏: display={app_display}"
            assert tabbar_display != "none", f"#tabbar 不可见: display={tabbar_display}"
            assert tab_count == 3, f"tab 按钮数量应为 3，实际 {tab_count}"

        ck.run("T3.1 移动布局", t3_1)

        # T3.2 未播放时 #mini-player 隐藏
        def t3_2():
            mini_hidden = page.evaluate(
                "document.getElementById('mini-player').classList.contains('hidden')"
            )
            mini_display = disp(page, "#mini-player")
            ev["t3_2_mini_idle"] = {"hidden_class": mini_hidden, "display": mini_display}
            assert mini_hidden and mini_display == "none", (mini_hidden, mini_display)

        ck.run("T3.2 mini-player 初始隐藏", t3_2)

        # T3.3 点击曲目行播放 → mini-player 出现
        def t3_3():
            main_box = box(page, "#main")
            row_box = box(page, ".track-row")
            ev["t3_3_geometry"] = {"#main_box": main_box, ".track-row_box": row_box}
            row = page.locator(".track-row", has_text=SONG).first
            clicked = True
            try:
                row.click(timeout=4000)
            except Exception:
                clicked = False
            if not clicked:
                row.dispatch_event("click")
                ev["t3_3_note"] = (
                    f"曲目行无法真实点击（#main box={main_box}，零尺寸/不可见），"
                    "改用 dispatchEvent 触发播放"
                )
            page.wait_for_function(
                "() => !document.getElementById('mini-player').classList.contains('hidden')",
                timeout=5000,
            )
            page.wait_for_function("() => !document.getElementById('audio').paused", timeout=5000)
            ev["t3_3_mini_playing"] = {
                "mini_title": page.text_content("#mini-title"),
                "mini_display": disp(page, "#mini-player"),
                "row_clickable_naturally": clicked,
            }
            assert page.text_content("#mini-title") == SONG
            shot(page, "t3_mini.png")
            if not clicked:
                raise AssertionError(
                    f"移动端曲目列表不可见/不可点击：#main 计算盒 {main_box}，"
                    "用户无法通过点击曲目开始播放（CSS 缺陷）"
                )

        ck.run("T3.3 点击播放出 mini-player", t3_3)

        # T3.4 点击 mini-player → full-player 出现
        def t3_4():
            page.locator("#mini-player").click(position={"x": 60, "y": 20}, timeout=5000)
            page.wait_for_function(
                "() => !document.getElementById('full-player').classList.contains('hidden')",
                timeout=5000,
            )
            fp_display = disp(page, "#full-player")
            ev["t3_4_full_player"] = {
                "full_player_display": fp_display,
                "fp_title": page.text_content("#fp-title"),
                "fp_btn_play": page.text_content("#fp-btn-play"),
            }
            assert fp_display != "none", f"#full-player 未显示: {fp_display}"
            assert page.text_content("#fp-title") == SONG
            assert page.text_content("#fp-btn-play") == "⏸"
            shot(page, "t3_fullplayer.png")

        ck.run("T3.4 全屏播放页", t3_4)

        # T3.5 #fp-close 收起（280ms 下滑动画）
        def t3_5():
            page.click("#fp-close")
            page.wait_for_function(
                "() => document.getElementById('full-player').classList.contains('hidden')",
                timeout=3000,
            )
            ev["t3_5_close"] = {"full_player_display": disp(page, "#full-player")}
            assert disp(page, "#full-player") == "none"

        ck.run("T3.5 收起全屏播放页", t3_5)

        # T3.6 底部 tab 视图切换
        def t3_6():
            def snap():
                return {
                    "#m-view-queue": disp(page, "#m-view-queue"),
                    "#m-view-playlists": disp(page, "#m-view-playlists"),
                    "#main": disp(page, "#main"),
                    "active_tab": page.evaluate(
                        "document.querySelector('.tab-btn.active')?.dataset.view"
                    ),
                }

            page.click('.tab-btn[data-view="queue"]')
            vq = snap()
            page.click('.tab-btn[data-view="playlists"]')
            vp = snap()
            page.click('.tab-btn[data-view="library"]')
            vl = snap()
            ev["t3_6_tabs"] = {"queue": vq, "playlists": vp, "library": vl}
            assert vq["#m-view-queue"] != "none" and vq["active_tab"] == "queue", vq
            assert vp["#m-view-playlists"] != "none" and vp["active_tab"] == "playlists", vp
            assert (
                vl["#main"] != "none"
                and vl["#m-view-queue"] == "none"
                and vl["#m-view-playlists"] == "none"
                and vl["active_tab"] == "library"
            ), vl

        ck.run("T3.6 tab 视图切换", t3_6)

        # T3.7 full-player 打开时 #fp-btn-lyrics 切换歌词层
        def t3_7():
            if page.evaluate("document.getElementById('full-player').classList.contains('hidden')"):
                page.locator("#mini-player").click(position={"x": 60, "y": 20}, timeout=5000)
            page.wait_for_function(
                "() => !document.getElementById('full-player').classList.contains('hidden')",
                timeout=5000,
            )
            before = disp(page, "#fp-lyrics")
            page.click("#fp-btn-lyrics", timeout=5000)
            opened = disp(page, "#fp-lyrics")
            shot(page, "t3_lyrics_open.png")
            real_close = True
            try:
                page.click("#fp-btn-lyrics", timeout=5000)
            except Exception:
                real_close = False
                page.locator("#fp-btn-lyrics").dispatch_event("click")
            closed = disp(page, "#fp-lyrics")
            ev["t3_7_lyrics"] = {
                "before": before,
                "after_open_click": opened,
                "after_close_click": closed,
                "close_click_naturally": real_close,
            }
            assert before == "none", f"歌词层初始应隐藏: {before}"
            assert opened != "none", f"点击后歌词层未显示: {opened}"
            assert closed == "none", f"再次点击后歌词层未收起: {closed}"
            if not real_close:
                raise AssertionError(
                    "歌词层打开后(#fp-lyrics position:absolute;inset:0)覆盖整个播放页，"
                    "#fp-btn-lyrics 被遮挡无法真实点击收起（CSS 缺陷）；"
                    "JS toggle 逻辑本身经 dispatchEvent 验证可用"
                )

        ck.run("T3.7 歌词层切换", t3_7)

        ev["console_errors"] = list(errors)
        ck.finish()
    finally:
        ctx.close()
