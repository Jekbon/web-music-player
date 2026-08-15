"""补充 e2e 实测：A49-A51 播放模式续播、A69 歌单跳过失效 id、A70/A71 歌单 UI 操作。"""
import json
import urllib.request
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:18787'
results = {}


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    try:
        r = urllib.request.urlopen(req)
        return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


with sync_playwright() as p:
    browser = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required',
                                      '--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page()
    dialogs = []
    page.on('dialog', lambda d: (dialogs.append((d.type, d.message)), d.accept(d.message if d.type == 'prompt' else None) if False else None))
    # 用可控的 dialog 处理器
    page.close()
    page = browser.new_page()

    pending_response = {'value': None}

    def handle_dialog(d):
        dialogs.append((d.type, d.message))
        if pending_response['value'] is not None:
            d.accept(pending_response['value'])
        else:
            d.accept()

    page.on('dialog', handle_dialog)
    page.goto(BASE + '/')
    page.wait_for_selector('.track-row')

    # ── A49 列表循环：播完自动播下一首 ──
    page.click('#btn-play-all')
    page.wait_for_timeout(600)
    # 确保模式为列表循环（图标 🔁）
    for _ in range(3):
        if page.text_content('#btn-mode').strip() == '🔁':
            break
        page.click('#btn-mode')
    t1 = page.text_content('#np-title')
    page.evaluate('document.getElementById("audio").currentTime = 5.6')
    page.wait_for_timeout(2000)  # 等待播完触发 ended
    t2 = page.text_content('#np-title')
    paused = page.evaluate('document.getElementById("audio").paused')
    results['A49'] = {'pass': t2 != t1 and not paused, 'before': t1, 'after': t2, 'paused': paused}

    # ── A50 单曲循环：播完重播本曲 ──
    page.click('#btn-mode')  # 🔁→🔂
    assert page.text_content('#btn-mode').strip() == '🔂'
    t1 = page.text_content('#np-title')
    page.evaluate('document.getElementById("audio").currentTime = 5.6')
    page.wait_for_timeout(2000)
    t2 = page.text_content('#np-title')
    cur = page.evaluate('document.getElementById("audio").currentTime')
    paused = page.evaluate('document.getElementById("audio").paused')
    results['A50'] = {'pass': t2 == t1 and not paused and cur < 3, 'title': t2, 'currentTime': cur}

    # ── A51 随机播放：播完换另一首 ──
    page.click('#btn-mode')  # 🔂→🔀
    assert page.text_content('#btn-mode').strip() == '🔀'
    t1 = page.text_content('#np-title')
    page.evaluate('document.getElementById("audio").currentTime = 5.6')
    page.wait_for_timeout(2000)
    t2 = page.text_content('#np-title')
    paused = page.evaluate('document.getElementById("audio").paused')
    results['A51'] = {'pass': t2 != t1 and not paused, 'before': t1, 'after': t2}

    # ── A70 歌单 UI：新建/重命名/删除 ──
    pending_response['value'] = '临时歌单'
    page.click('#btn-new-playlist')
    page.wait_for_timeout(500)
    pl_text = page.text_content('#playlist-list')
    created = '临时歌单' in pl_text
    # 重命名
    pending_response['value'] = '改名歌单'
    page.locator('.playlist-item').first.hover()
    page.locator('.playlist-item').first.locator('.pl-actions button', has_text='✎').click(force=True)
    page.wait_for_timeout(500)
    renamed = '改名歌单' in page.text_content('#playlist-list')
    results['A70_part1'] = {'pass': created and renamed, 'created': created, 'renamed': renamed,
                            'dialogs': dialogs[-2:]}

    # ── A71 加入歌单 + 播放歌单 ──
    # 取第一首歌的 id
    first_track_id = page.evaluate('''() => {
        const rows = document.querySelectorAll(".track-row");
        return rows.length;
    }''')
    page.locator('.track-row').first.hover()
    page.locator('.track-row').first.locator('.t-more').click(force=True)
    page.wait_for_timeout(300)
    menu_visible = not page.locator('#playlist-menu').evaluate('el => el.classList.contains("hidden")')
    page.locator('#playlist-menu .menu-item').first.click()
    page.wait_for_timeout(500)
    # 歌单计数应变为 (1)
    pl_text = page.text_content('#playlist-list')
    added = '(1)' in pl_text
    # 播放歌单
    page.locator('.playlist-item').first.hover()
    page.locator('.playlist-item').first.locator('.pl-actions button', has_text='▶').click(force=True)
    page.wait_for_timeout(800)
    queue_count = page.locator('.queue-item').count()
    np = page.text_content('#np-title')
    results['A71'] = {'pass': menu_visible and added and queue_count == 1 and np != '未在播放',
                      'menu_visible': menu_visible, 'added': added, 'queue_count': queue_count, 'np': np}

    # ── A69 歌单含失效 id 时播放跳过 ──
    # 通过 API 向歌单加入一个不存在的 trackId
    _, pls = api('GET', '/api/playlists')
    pl_id = pls['playlists'][0]['id']
    api('POST', f'/api/playlists/{pl_id}/tracks', {'trackId': 'ffffffffffffffff'})
    # UI 播放该歌单
    page.reload()
    page.wait_for_selector('.playlist-item')
    page.locator('.playlist-item').first.hover()
    page.locator('.playlist-item').first.locator('.pl-actions button', has_text='▶').click(force=True)
    page.wait_for_timeout(800)
    queue_count = page.locator('.queue-item').count()
    np = page.text_content('#np-title')
    results['A69'] = {'pass': queue_count == 1 and np != '未在播放',
                      'queue_count': queue_count, 'np': np,
                      'note': '歌单含 1 有效 + 1 失效 id，播放时只构建 1 项队列'}

    # ── A70_part2 删除歌单 ──
    page.locator('.playlist-item').first.hover()
    page.locator('.playlist-item').first.locator('.pl-actions button', has_text='🗑').click(force=True)
    page.wait_for_timeout(500)
    deleted = '改名歌单' not in page.text_content('#playlist-list')
    results['A70_part2'] = {'pass': deleted, 'deleted': deleted}

    browser.close()

print(json.dumps(results, ensure_ascii=False, indent=1))
all_pass = all(r['pass'] for r in results.values())
print('EXTRA E2E RESULT:', 'ALL PASS' if all_pass else 'FAILURES')
