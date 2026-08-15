"""「删除歌曲」功能端到端实测：D1 菜单项 / D2 取消删除 / D3 确认删除 / D4 播放中删除续播。

运行：
  PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers \
  python3 -m pytest verify/test_e2e_delete.py --browser chromium -v -s

环境要求：服务运行在 http://127.0.0.1:8787，曲库含若干首测试歌曲。
Chromium 启动参数（--autoplay-policy=no-user-gesture-required --no-sandbox）
由 conftest.py 的 browser_type_launch_args 提供；视口 1280x800。

注意：D3/D4 会真实删除曲库文件（测试歌曲），用例按 D1→D4 顺序执行。
证据写入 evidence（conftest 汇总到 verify/e2e_report.json），截图存 verify/shots/。
"""
import os
import traceback

import pytest
from playwright.sync_api import expect

BASE = "http://127.0.0.1:8787"
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")


# ─── fixtures / 工具 ─────────────────────────────────────────
@pytest.fixture(scope="function")
def browser_context_args(browser_context_args):
    """桌面测试视口 1280x800。"""
    return {**browser_context_args, "viewport": {"width": 1280, "height": 800}}


def shot(page, name):
    os.makedirs(SHOTS, exist_ok=True)
    path = os.path.join(SHOTS, name)
    try:
        page.screenshot(path=path)
    except Exception:
        return None
    return path


def open_page(page):
    page.goto(BASE)
    expect(page.locator(".track-row").first).to_be_visible(timeout=15000)


def track_titles(page):
    """所有曲目行标题（去掉 .t-sub 子文件夹文本）。"""
    return page.evaluate(
        """() => Array.from(document.querySelectorAll('.track-row .t-title'))
            .map(el => {
                const c = el.cloneNode(true);
                c.querySelector('.t-sub')?.remove();
                return c.textContent.trim();
            })"""
    )


def row_count(page):
    return page.locator(".track-row").count()


def open_row_menu(page, row_idx=0):
    """hover 第 row_idx 行并点击 .t-more（hover 才可见，force=True）。"""
    row = page.locator(".track-row").nth(row_idx)
    row.hover()
    row.locator(".t-more").click(force=True)


def menu_visible(page):
    """#playlist-menu 是否可见（无 hidden class 且 display 非 none）。"""
    return page.evaluate(
        """() => {
            const m = document.querySelector('#playlist-menu');
            if (!m) return {exists: false};
            return {
                exists: true,
                hidden_class: m.classList.contains('hidden'),
                display: getComputedStyle(m).display,
            };
        }"""
    )


def click_delete_item(page):
    page.locator("#playlist-menu .menu-item-danger").click()


def library_titles(page):
    """通过页面内 fetch /api/library 获取曲库标题列表。"""
    return page.evaluate(
        "() => fetch('/api/library').then(r => r.json()).then(d => d.tracks.map(t => t.title))"
    )


def np_title(page):
    return page.locator("#np-title").inner_text().strip()


def audio_paused(page):
    return page.evaluate("document.querySelector('#audio').paused")


class DialogRecorder:
    """注册 page.on('dialog')：confirm 按 mode 处理，其余（alert）accept。"""

    def __init__(self, page, mode):
        self.mode = mode  # 'accept' | 'dismiss'
        self.seen = []
        page.on("dialog", self._handle)

    def _handle(self, dialog):
        self.seen.append({"type": dialog.type, "message": dialog.message})
        try:
            if dialog.type == "confirm" and self.mode == "dismiss":
                dialog.dismiss()
            else:
                dialog.accept()
        except Exception:
            pass


# ─── D1 曲目行菜单出现删除项 ─────────────────────────────────
def test_D1_menu_has_delete_item(page, console_errors, evidence):
    ev = evidence
    try:
        open_page(page)
        ev["initial_track_count"] = row_count(page)

        open_row_menu(page, 0)
        page.wait_for_timeout(300)
        ev["menu_state"] = menu_visible(page)
        shot(page, "d1_playlist_menu.png")

        danger = page.locator("#playlist-menu .menu-item-danger")
        ev["danger_item_count"] = danger.count()
        ev["danger_item_text"] = danger.inner_text() if danger.count() else None
        ev["menu_items"] = page.locator("#playlist-menu .menu-item").all_inner_texts()

        assert ev["menu_state"].get("exists"), "#playlist-menu 不存在"
        assert not ev["menu_state"]["hidden_class"], "#playlist-menu 仍带 hidden class"
        assert ev["menu_state"]["display"] != "none", "#playlist-menu display:none"
        assert ev["danger_item_count"] == 1, "未找到 .menu-item-danger 项"
        assert "删除歌曲" in (ev["danger_item_text"] or ""), \
            f"危险菜单项文本不含'删除歌曲': {ev['danger_item_text']!r}"
    finally:
        ev["console_errors"] = list(console_errors)


# ─── D2 取消删除不生效 ───────────────────────────────────────
def test_D2_dismiss_confirm_keeps_track(page, console_errors, evidence):
    ev = evidence
    try:
        open_page(page)
        rec = DialogRecorder(page, mode="dismiss")

        before = row_count(page)
        titles_before = track_titles(page)
        ev["count_before"] = before
        ev["first_title"] = titles_before[0] if titles_before else None

        open_row_menu(page, 0)
        click_delete_item(page)
        page.wait_for_timeout(800)  # 等待 confirm 被 dismiss 后的稳定期

        after = row_count(page)
        titles_after = track_titles(page)
        ev["count_after"] = after
        ev["dialogs_seen"] = rec.seen

        assert any(d["type"] == "confirm" for d in rec.seen), "未出现 confirm 对话框"
        assert after == before, f"取消删除后曲目数变化: {before} -> {after}"
        assert titles_after == titles_before, "取消删除后曲目列表发生变化"
    finally:
        ev["console_errors"] = list(console_errors)


# ─── D3 确认删除生效 ─────────────────────────────────────────
def test_D3_accept_confirm_deletes_track(page, console_errors, evidence):
    ev = evidence
    try:
        open_page(page)
        rec = DialogRecorder(page, mode="accept")

        n = row_count(page)
        titles_before = track_titles(page)
        deleted = titles_before[0]
        ev["count_before"] = n
        ev["deleted_title"] = deleted

        open_row_menu(page, 0)
        click_delete_item(page)

        # 等待列表刷新：行数变为 N-1
        expect(page.locator(".track-row")).to_have_count(n - 1, timeout=10000)
        page.wait_for_timeout(300)
        titles_after = track_titles(page)
        ev["count_after"] = row_count(page)
        ev["titles_after"] = titles_after
        ev["dialogs_seen"] = rec.seen
        shot(page, "d3_after_delete.png")

        api_titles = library_titles(page)
        ev["api_titles"] = api_titles

        assert any(d["type"] == "confirm" for d in rec.seen), "未出现 confirm 对话框"
        assert ev["count_after"] == n - 1, f"行数未变为 N-1: {n} -> {ev['count_after']}"
        assert deleted not in titles_after, f"被删歌曲 {deleted!r} 仍在列表渲染中"
        assert deleted not in api_titles, f"被删歌曲 {deleted!r} 仍在 /api/library 中"
    finally:
        ev["console_errors"] = list(console_errors)


# ─── D4 播放中删除自动续播 ───────────────────────────────────
def test_D4_delete_playing_track_auto_continues(page, console_errors, evidence):
    ev = evidence
    try:
        open_page(page)
        rec = DialogRecorder(page, mode="accept")

        page.click("#btn-play-all")
        # 等待播放开始：#np-title 非"未在播放"
        expect(page.locator("#np-title")).not_to_have_text("未在播放", timeout=10000)
        page.wait_for_timeout(500)
        t0 = np_title(page)
        ev["t0"] = t0
        assert t0 and t0 != "未在播放", f"播放未开始: np-title={t0!r}"

        first_row_title = track_titles(page)[0]
        ev["first_row_title"] = first_row_title
        assert first_row_title == t0, \
            f"当前视图第一行 {first_row_title!r} 与正在播放曲目 {t0!r} 不一致"

        # 删除正在播放的第一行
        open_row_menu(page, 0)
        click_delete_item(page)

        page.wait_for_timeout(1000)
        # 轮询等待 np-title 切换为另一首歌
        new_title = t0
        deadline = page.evaluate("Date.now()") + 8000
        while page.evaluate("Date.now()") < deadline:
            new_title = np_title(page)
            if new_title and new_title != t0 and new_title != "未在播放":
                break
            page.wait_for_timeout(200)
        ev["np_title_after"] = new_title
        ev["paused_after"] = audio_paused(page)
        ev["count_after"] = row_count(page)
        ev["dialogs_seen"] = rec.seen
        shot(page, "d4_after_delete_playing.png")

        assert any(d["type"] == "confirm" for d in rec.seen), "未出现 confirm 对话框"
        assert new_title != t0 and new_title != "未在播放", \
            f"删除正在播放曲目后未续播: np-title={new_title!r} (T0={t0!r})"
        assert ev["paused_after"] is False, \
            f"audio.paused={ev['paused_after']}，未自动续播（新曲目 {new_title!r}）"
    finally:
        ev["console_errors"] = list(console_errors)
