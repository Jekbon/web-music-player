"""A30 验证：移动端上传入口可达 + 移动端主题切换可达。"""
import json
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required', '--no-sandbox'])
    ctx = browser.new_context(viewport={'width': 375, 'height': 812})
    page = ctx.new_page()
    page.goto('http://127.0.0.1:8787/')
    page.wait_for_selector('.track-row')

    # 移动端上传按钮可见
    up = page.locator('.mobile-upload')
    up_visible = up.is_visible()
    up_for = page.evaluate('document.querySelector(".mobile-upload").getAttribute("for")')
    input_exists = page.evaluate('!!document.getElementById("upload-input")')

    # 移动端主题切换可达（全屏播放页内的主题按钮）
    page.locator('.track-row').first.click()
    page.wait_for_timeout(600)
    page.locator('#mini-player').click()
    page.wait_for_timeout(400)
    fp_theme_visible = page.locator('#fp-btn-theme').is_visible()
    theme_before = page.evaluate('document.documentElement.dataset.theme')
    page.locator('#fp-btn-theme').click()
    page.wait_for_timeout(200)
    theme_after = page.evaluate('document.documentElement.dataset.theme')

    print(json.dumps({
        'mobile_upload_visible': up_visible,
        'upload_label_for': up_for,
        'upload_input_exists': input_exists,
        'fp_theme_visible': fp_theme_visible,
        'theme_before': theme_before,
        'theme_after': theme_after,
        'theme_switched': theme_before != theme_after,
    }, ensure_ascii=False))
    browser.close()
