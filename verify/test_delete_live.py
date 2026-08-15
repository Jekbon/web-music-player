"""「删除歌曲」真实端到端验证（模拟真实用户操作，删除曲库最后一首）。

运行：
  PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers \
  python3 -m pytest verify/test_delete_live.py --browser chromium -v -s

约定：
  - Chromium，启动参数 --autoplay-policy=no-user-gesture-required --no-sandbox
  - 桌面视口 1280x800，全新 context 且 bypassCSP=True
  - 只允许删除列表最后一行（避免误删用户想保留的歌）
  - 每步证据写入 verify/delete_live_report.json，截图存 verify/shots/
"""
import json
import os
import traceback

import pytest
from playwright.sync_api import expect

BASE = "http://127.0.0.1:8787"
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots")
REPORT = os.path.join(HERE, "delete_live_report.json")


# ─── 浏览器 / 上下文配置 ─────────────────────────────────────
@pytest.fixture(scope="session")
def browser_type_launch_args(browser_type_launch_args):
    args = list(browser_type_launch_args.get("args") or [])
    args += [
        "--autoplay-policy=no-user-gesture-required",
        "--no-sandbox",
        "--disable-dev-shm-usage",
    ]
    return {**browser_type_launch_args, "args": args}


@pytest.fixture()
def browser_context_args(browser_context_args):
    """全新 context：桌面视口 1280x800 + bypassCSP。"""
    return {
        **browser_context_args,
        "viewport": {"width": 1280, "height": 800},
        "bypass_csp": True,
    }


# ─── 工具 ────────────────────────────────────────────────────
def shot(page, name):
    os.makedirs(SHOTS, exist_ok=True)
    try:
        page.screenshot(path=os.path.join(SHOTS, name))
    except Exception:
        pass


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


def api_library_tracks(page):
    return page.evaluate(
        """async () => {
            const r = await fetch('/api/library');
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return (await r.json()).tracks;
        }"""
    )


def test_delete_last_track_live(page):
    ev = {}          # 每步证据
    console_errors = []
    dialogs = []

    def _on_console(m):
        if m.type == "error":
            console_errors.append(f"[console.error] {m.text}")

    page.on("console", _on_console)
    page.on("pageerror", lambda e: console_errors.append(f"[pageerror] {e}"))

    try:
        # ── 步骤 0：页面加载 + app.js 版本 / deleteTrack 存在性 ──
        page.goto(BASE, wait_until="domcontentloaded")
        app_js_src = page.evaluate(
            "() => document.querySelector('script[src*=\"app.js\"]')?.src ?? null"
        )
        has_delete_track = page.evaluate(
            """async () => {
                const r = await fetch('/app.js?v=2');
                if (!r.ok) return {ok: false, status: r.status, has: false};
                const text = await r.text();
                return {ok: true, status: r.status, has: text.includes('deleteTrack')};
            }"""
        )
        ev["step0"] = {
            "app_js_src": app_js_src,
            "app_js_src_has_v2": bool(app_js_src and "?v=2" in app_js_src),
            "fetch_app_js_v2": has_delete_track,
        }
        print(f"\n[STEP0] app.js URL          = {app_js_src}")
        print(f"[STEP0] URL 含 ?v=2         = {ev['step0']['app_js_src_has_v2']}")
        print(f"[STEP0] /app.js?v=2 含 deleteTrack = {has_delete_track}")
        assert app_js_src and "?v=2" in app_js_src, f"app.js 版本异常: {app_js_src}"
        assert has_delete_track.get("has") is True, f"app.js?v=2 未包含 deleteTrack: {has_delete_track}"

        # ── 步骤 1：等待曲目列表渲染，记录 N 与标题 ──
        expect(page.locator(".track-row").first).to_be_visible(timeout=15000)
        n_before = page.locator(".track-row").count()
        titles_before = track_titles(page)
        api_tracks_before = api_library_tracks(page)
        ev["step1"] = {
            "track_count_N": n_before,
            "titles": titles_before,
            "api_last_track": api_tracks_before[-1] if api_tracks_before else None,
        }
        print(f"[STEP1] 删除前曲目数 N = {n_before}")
        print(f"[STEP1] 删除前标题   = {titles_before}")
        shot(page, "delete_live_01_before.png")
        assert n_before >= 1, "曲库为空，无法执行删除验证"
        # DOM 最后一行应与 API 最后一首一致（删除目标）
        target_title = titles_before[-1]
        assert api_tracks_before and api_tracks_before[-1]["title"] == target_title, (
            f"DOM 最后一行({target_title}) 与 API 最后一首"
            f"({api_tracks_before[-1]['title'] if api_tracks_before else None}) 不一致"
        )
        target_id = api_tracks_before[-1]["id"]

        # ── 步骤 2：注册 confirm 对话框自动 accept ──
        def _on_dialog(d):
            dialogs.append({"type": d.type, "message": d.message})
            d.accept()

        page.on("dialog", _on_dialog)
        ev["step2"] = {"dialog_handler": "page.on('dialog') -> accept (已注册)"}
        print("[STEP2] dialog 自动 accept 处理器已注册")

        # ── 步骤 3：hover 最后一行，点击 .t-more（force=True）──
        last_row = page.locator(".track-row").nth(n_before - 1)
        last_row.hover()
        last_row.locator(".t-more").click(force=True)
        print(f"[STEP3] 已 hover 最后一行并点击 .t-more（目标歌曲：{target_title}）")

        # ── 步骤 4：确认 #playlist-menu 可见，记录菜单文本 ──
        menu = page.locator("#playlist-menu")
        expect(menu).to_be_visible(timeout=5000)
        menu_text = menu.inner_text()
        danger = page.locator("#playlist-menu .menu-item-danger")
        danger_count = danger.count()
        danger_text = danger.first.inner_text() if danger_count else None
        ev["step4"] = {
            "menu_visible": True,
            "menu_text": menu_text,
            "danger_item_count": danger_count,
            "danger_item_text": danger_text,
        }
        print(f"[STEP4] #playlist-menu 可见，菜单文本 = {menu_text!r}")
        print(f"[STEP4] .menu-item-danger 数量 = {danger_count}, 文本 = {danger_text!r}")
        shot(page, "delete_live_02_menu.png")
        assert danger_count == 1 and "删除歌曲" in (danger_text or ""), "未找到『删除歌曲』菜单项"

        # ── 步骤 5：点击「删除歌曲」，等待 1.5 秒 ──
        danger.first.click()
        page.wait_for_timeout(1500)
        ev["step5"] = {
            "clicked": "删除歌曲 (.menu-item-danger)",
            "dialogs_seen": dialogs,
        }
        print(f"[STEP5] 已点击『删除歌曲』；confirm 对话框记录 = {dialogs}")
        assert dialogs and target_title in dialogs[-1]["message"], (
            f"未出现包含目标歌曲的 confirm 对话框: {dialogs}"
        )

        # ── 步骤 6：删除后数量 / 标题 / API 校验 ──
        n_after = page.locator(".track-row").count()
        titles_after = track_titles(page)
        api_tracks_after = api_library_tracks(page)
        api_ids_after = [t["id"] for t in api_tracks_after]
        api_titles_after = [t["title"] for t in api_tracks_after]
        ev["step6"] = {
            "track_count_after": n_after,
            "titles_after": titles_after,
            "deleted_target": {"id": target_id, "title": target_title},
            "target_id_in_api": target_id in api_ids_after,
            "target_title_in_api": target_title in api_titles_after,
        }
        print(f"[STEP6] 删除后曲目数 = {n_after}（期望 {n_before - 1}）")
        print(f"[STEP6] 删除后标题   = {titles_after}")
        print(f"[STEP6] 被删曲目     = {target_title!r} (id={target_id})")
        print(f"[STEP6] /api/library 仍含被删曲目 = {target_id in api_ids_after}")
        shot(page, "delete_live_03_after.png")
        assert n_after == n_before - 1, f"删除后数量 {n_after} != N-1 ({n_before - 1})"
        assert titles_after == titles_before[:-1], (
            f"删除后标题列表异常: {titles_after} != {titles_before[:-1]}"
        )
        assert target_id not in api_ids_after, "被删曲目仍在 /api/library 中"

        # ── 步骤 7：console errors ──
        ev["step7"] = {"console_errors": console_errors}
        print(f"[STEP7] console errors = {console_errors if console_errors else '无'}")

        ev["final"] = {
            "result": "PASS",
            "deleted_track_title": target_title,
            "deleted_track_id": target_id,
        }
        print(f"\nFINAL RESULT: PASS（被删歌曲：{target_title!r}）")

    except Exception:
        ev["final"] = {
            "result": "FAIL",
            "traceback": traceback.format_exc(limit=8),
            "console_errors": console_errors,
        }
        print(f"\nFINAL RESULT: FAIL\n{ev['final']['traceback']}")
        raise
    finally:
        with open(REPORT, "w", encoding="utf-8") as f:
            json.dump(ev, f, ensure_ascii=False, indent=2)

    # 非致命告警：console error 仅记录不阻断（真实曲库场景下避免误判）
    assert not console_errors, f"存在 console errors: {console_errors}"
