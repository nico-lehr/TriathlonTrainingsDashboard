import asyncio, os
from playwright.async_api import async_playwright

async def main():
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        await page.goto("file://" + os.getcwd() + "/index.html")
        await page.wait_for_timeout(800)

        # --- 1) Topnav update-group ist jetzt kompakt: nur 3 sichtbare Steuerelemente ---
        visible_children = await page.evaluate("""() => {
            const group = document.querySelector('.update-group');
            return [...group.children].filter(el => getComputedStyle(el).display !== 'none' && el.type !== 'file').map(el => el.id || el.className);
        }""")
        print("update-group sichtbare Kinder:", visible_children)
        # Zahnrad, Theme-Toggle, Aktualisieren-Dropdown-Wrapper - kein separates Stand-Label, kein separater Reset-Link mehr
        assert len(visible_children) == 3, f"Topnav sollte jetzt nur 3 kompakte Elemente zeigen, hat aber: {visible_children}"
        assert "global-settings-btn" in visible_children
        assert "theme-toggle-btn" in visible_children
        print("OK: topnav update-group is compact (3 elements instead of 5)")

        # Stand + Reset stecken jetzt im Aktualisieren-Dropdown
        await page.locator("#update-menu-trigger").click()
        await page.wait_for_timeout(200)
        reset_visible = await page.locator("#reset-btn").is_visible()
        meta_visible = await page.locator("#update-meta").is_visible()
        print("reset-btn/update-meta im Dropdown sichtbar:", reset_visible, meta_visible)
        assert reset_visible and meta_visible
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(150)

        # --- 2) Zahnrad oeffnet eine eigene Seite, keine sichtbaren Modal-Overlay-Reste ---
        assert await page.locator("#settings-overlay").count() == 0, "altes Modal-Overlay-Markup sollte entfernt sein"
        await page.locator("#global-settings-btn").click()
        await page.wait_for_timeout(300)

        url_before = page.url
        settings_active = await page.locator("#view-settings").evaluate("el => el.classList.contains('active')")
        assert settings_active
        assert page.url == url_before, "es sollte keine echte Seitennavigation stattfinden (weiterhin eine SPA-Seite)"

        # In Kacheln aufgeteilt, wie bei den anderen Tabs (.card-Elemente statt einem Formular-Block)
        card_count = await page.locator("#view-settings .card").count()
        print("Anzahl Kacheln in der Settings-Seite:", card_count)
        assert card_count >= 3, "Ollama/Trainingswerte/Planung sollten getrennte Kacheln sein"

        back_btn_text = await page.locator("#settings-back-btn").inner_text()
        print("Zurueck-Button:", back_btn_text)
        assert "Zurück" in back_btn_text or "zurück" in back_btn_text.lower()

        print("\n--- Console/page errors captured ---")
        for e in errors:
            print("ERROR:", e)
        if errors:
            raise SystemExit(f"{len(errors)} console/page errors detected")
        print("\nALL CHECKS PASSED, no console errors.")

        await browser.close()

asyncio.run(main())
