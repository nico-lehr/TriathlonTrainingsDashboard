import asyncio
from playwright.async_api import async_playwright

URL = "file:///home/claude/triathlon-dashboard/index.html"

async def main():
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        await page.goto(URL)
        await page.wait_for_timeout(500)

        # 1) Menu trigger exists, menu closed initially
        trigger = page.locator("#update-menu-trigger")
        assert await trigger.count() == 1, "trigger missing"
        menu = page.locator("#update-menu")
        is_open = await menu.evaluate("el => el.classList.contains('open')")
        assert not is_open, "menu should start closed"
        print("OK: menu starts closed")

        # 2) Click trigger -> menu opens, shows 2 items
        await trigger.click()
        await page.wait_for_timeout(200)
        is_open = await menu.evaluate("el => el.classList.contains('open')")
        assert is_open, "menu should open on click"
        items = page.locator(".update-menu-item")
        # Aktualisieren, Drag & Drop, und (neu, kompakt ins Menü verschoben statt
        # separat in der Topbar) Datenstand zurücksetzen.
        assert await items.count() == 3, "expected 3 menu items (Aktualisieren, Drag & Drop, Datenstand zurücksetzen)"
        texts = [await items.nth(i).inner_text() for i in range(3)]
        print("Menu items:", texts)
        assert "Aktualisieren" in texts[0]
        assert "Drag" in texts[1]
        assert "zurücksetzen" in texts[2]
        print("OK: menu opens with 3 items")

        stand_text = await page.locator("#update-meta").inner_text()
        print("Stand-Anzeige im Menü:", stand_text)
        assert "Stand" in stand_text, "Stand-Anzeige sollte jetzt im Dropdown stehen statt separat in der Topbar"

        # 3) Click outside closes menu
        await page.mouse.click(50, 50)
        await page.wait_for_timeout(200)
        is_open = await menu.evaluate("el => el.classList.contains('open')")
        assert not is_open, "menu should close on outside click"
        print("OK: menu closes on outside click")

        # 4) Click "Drag & Drop zur Auswahl" -> opens dnd overlay
        await trigger.click()
        await page.wait_for_timeout(150)
        await page.locator("#menu-item-dnd").click()
        await page.wait_for_timeout(300)
        overlay = page.locator("#dnd-overlay")
        is_open = await overlay.evaluate("el => el.classList.contains('open')")
        assert is_open, "dnd overlay should be open"
        print("OK: dnd overlay opens")

        # 5) Close via close button
        await page.locator("#dnd-close").click()
        await page.wait_for_timeout(300)
        is_open = await overlay.evaluate("el => el.classList.contains('open')")
        assert not is_open, "dnd overlay should close"
        print("OK: dnd overlay closes via close button")

        # 6) Reopen, click outside card (on overlay backdrop) closes it
        await trigger.click()
        await page.wait_for_timeout(150)
        await page.locator("#menu-item-dnd").click()
        await page.wait_for_timeout(300)
        await overlay.click(position={"x": 5, "y": 5})
        await page.wait_for_timeout(300)
        is_open = await overlay.evaluate("el => el.classList.contains('open')")
        assert not is_open, "dnd overlay should close on backdrop click"
        print("OK: dnd overlay closes on backdrop click")

        # 7) Simulate selecting files via the hidden file input (click-to-browse fallback)
        await trigger.click()
        await page.wait_for_timeout(150)
        await page.locator("#menu-item-dnd").click()
        await page.wait_for_timeout(300)

        # Use one of the actual synced .fit source files if available, else build a dummy fit-like file in memory is complex.
        # Instead, verify the click-to-browse triggers the hidden input (file chooser) without error.
        async with page.expect_file_chooser() as fc_info:
            await page.locator("#dnd-zone").click()
        chooser = await fc_info.value
        assert chooser is not None
        print("OK: dnd-zone click triggers native file chooser")
        # cancel it (don't actually pick a file, just verifying wiring)
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(200)

        # 8) Simulate an actual drag & drop of one .fit file via DataTransfer injection
        # Grab a real fit-like File in the page context by fetching one via input[type=file] is not possible
        # without a real user gesture, so instead we simulate the drop event directly with a constructed File
        # (using a minimal buffer) to test that the drop handler runs the parsing pipeline without crashing
        # (errors are expected/tolerated for a fake file, we just check no uncaught exception & status text appears).
        await page.evaluate("""
            () => {
                const zone = document.getElementById('dnd-zone');
                const file = new File([new Uint8Array([1,2,3,4,5,6,7,8])], '2026-08-27-fake.fit', { type: 'application/octet-stream' });
                const dt = new DataTransfer();
                dt.items.add(file);
                const evt = new DragEvent('drop', { bubbles: true, cancelable: true });
                Object.defineProperty(evt, 'dataTransfer', { value: dt });
                zone.dispatchEvent(evt);
            }
        """)
        await page.wait_for_timeout(1000)
        status_text = await page.locator("#dnd-status").inner_text()
        print("dnd-status after fake drop:", status_text)
        assert status_text.strip() != "", "expected some status message after drop"

        # close overlay for cleanup
        await page.locator("#dnd-close").click()
        await page.wait_for_timeout(300)

        # 9) Existing folder-based Aktualisieren flow still wired (menu item click triggers hidden folder input)
        await trigger.click()
        await page.wait_for_timeout(150)
        async with page.expect_file_chooser() as fc_info2:
            await page.locator("#menu-item-folder").click()
        chooser2 = await fc_info2.value
        assert chooser2 is not None
        print("OK: 'Aktualisieren' menu item triggers folder file chooser")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(200)

        # 10) Check dark mode rendering (emulate dark color scheme) - no console errors
        await page.emulate_media(color_scheme="dark")
        await page.wait_for_timeout(300)
        await trigger.click()
        await page.wait_for_timeout(150)
        await page.locator("#menu-item-dnd").click()
        await page.wait_for_timeout(300)
        await page.screenshot(path="/tmp/dnd_dark.png")
        await page.locator("#dnd-close").click()
        await page.emulate_media(color_scheme="light")

        # 11) Mobile viewport check
        await page.set_viewport_size({"width": 390, "height": 844})
        await page.wait_for_timeout(300)
        overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        print("Mobile horizontal overflow (px):", overflow)
        assert overflow <= 1, f"unexpected horizontal overflow: {overflow}px"
        await trigger.click()
        await page.wait_for_timeout(200)
        await page.screenshot(path="/tmp/dnd_mobile_menu.png")
        await page.locator("#menu-item-dnd").click()
        await page.wait_for_timeout(300)
        await page.screenshot(path="/tmp/dnd_mobile_overlay.png")

        await browser.close()

    print("\n--- Console/page errors captured ---")
    for e in errors:
        print("ERROR:", e)
    if errors:
        raise SystemExit(f"{len(errors)} console/page errors detected")
    print("\nALL CHECKS PASSED, no console errors.")

asyncio.run(main())
