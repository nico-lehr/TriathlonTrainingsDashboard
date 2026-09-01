import asyncio, os, datetime
from playwright.async_api import async_playwright

async def main():
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        await page.goto("file://" + os.getcwd() + "/index.html")
        await page.wait_for_timeout(800)

        await page.locator('.tab-btn[data-view="coach"]').click()
        await page.wait_for_timeout(300)
        gate_active = await page.evaluate("() => { const g = document.getElementById('coach-gate'); return g && getComputedStyle(g).display !== 'none'; }")
        if gate_active:
            await page.locator("#coach-gate-skip").click()
            await page.wait_for_timeout(300)

        far_date = (datetime.date.today() + datetime.timedelta(days=120)).isoformat()
        await page.locator("#new-goal-toggle-btn").click()
        await page.wait_for_timeout(200)
        await page.fill("#goal-name", "Detail-Klick-Test")
        await page.fill("#goal-date", far_date)
        await page.locator("#goal-form button[type=submit]").click()
        await page.wait_for_timeout(300)

        # --- 1) Zeitleiste: 5 unterscheidbare Farben (kein Duplikat mehr) ---
        colors = await page.evaluate("""() => [...document.querySelectorAll('#plan-timeline .plan-timeline-seg')].map(el => getComputedStyle(el).backgroundColor)""")
        print("timeline segment colors:", colors)
        assert len(colors) == len(set(colors)), f"Alle Phasen-Segmente sollten unterscheidbare Farben haben, bekam: {colors}"
        print("OK: all timeline phase segments have distinct colors")

        # Legende hervorhebung fuer aktuelle Phase
        active_legend = await page.locator(".plan-timeline-legend-item.active").count()
        assert active_legend == 1
        print("OK: exactly one legend item marked active")

        # --- 2) Manuelle Einheit anlegen, damit ein klickbarer Eintrag existiert ---
        await page.locator(".plan-add-btn").click()
        await page.wait_for_timeout(200)
        await page.fill("#plan-edit-title", "Grundlagenlauf")
        await page.select_option("#plan-edit-sport", "Laufen")
        await page.fill("#plan-edit-duration", "70")
        await page.select_option("#plan-edit-intensity", "leicht")
        await page.locator(".plan-edit-save").click()
        await page.wait_for_timeout(300)

        # --- 3) Klick auf die ganze Zeile im Trainingsplan (nicht nur den Stift) oeffnet Detail ---
        row = page.locator(".plan-item-clickable").first
        await row.click(position={"x": 5, "y": 5})  # bewusst NICHT auf einen Button klicken
        await page.wait_for_timeout(300)
        overlay_open = await page.locator("#plan-edit-overlay").evaluate("el => el.classList.contains('open')")
        assert overlay_open, "Klick auf die Trainingsplan-Zeile sollte die Detailansicht öffnen"
        title_val = await page.locator("#plan-edit-title").input_value()
        print("Detail-Overlay Titel nach Zeilenklick:", title_val)
        assert title_val == "Grundlagenlauf"
        print("OK: clicking the plan-item row (not just the pencil icon) opens details")

        # --- 4) Ernaehrungsinfo erscheint in der Detailansicht (70min, Ausdauersport) ---
        nut_visible = await page.locator("#plan-edit-nutrition").is_visible()
        print("Ernaehrungsabschnitt sichtbar in Detailansicht:", nut_visible)
        assert nut_visible
        nut_text = await page.locator("#plan-edit-nutrition").inner_text()
        assert "vorher" in nut_text.lower()
        print("OK: nutrition section shown inside workout detail overlay")

        # Auf Kraft umstellen -> Ernaehrungsabschnitt sollte verschwinden (live)
        await page.select_option("#plan-edit-sport", "Kraft")
        await page.wait_for_timeout(150)
        nut_visible_after = await page.locator("#plan-edit-nutrition").is_visible()
        print("Ernaehrungsabschnitt sichtbar nach Wechsel auf Kraft:", nut_visible_after)
        assert not nut_visible_after
        print("OK: nutrition section disappears live when switching to Kraft")

        await page.locator("#plan-edit-close").click()
        await page.wait_for_timeout(200)

        # --- 5) Ernaehrungs-Tab: Klick auf die Vor-dem-Training-Zeile oeffnet dasselbe Detail-Overlay ---
        await page.locator('.tab-btn[data-view="nutrition"]').click()
        await page.wait_for_timeout(300)
        pw_row = page.locator("#nutrition-preworkout-body .plan-item-clickable")
        if await pw_row.count():
            await pw_row.first.click(position={"x": 5, "y": 5})
            await page.wait_for_timeout(300)
            overlay_open2 = await page.locator("#plan-edit-overlay").evaluate("el => el.classList.contains('open')")
            assert overlay_open2, "Klick auf die Einheit im Ernährungs-Tab sollte die Detailansicht öffnen"
            print("OK: clicking the workout in the nutrition tab opens the same detail overlay")
        else:
            print("(kein anstehendes Ausdauer-Workout fuer den Ernaehrungs-Tab-Klicktest vorhanden - uebersprungen)")

        print("\n--- Console/page errors captured ---")
        for e in errors:
            print("ERROR:", e)
        if errors:
            raise SystemExit(f"{len(errors)} console/page errors detected")
        print("\nALL CHECKS PASSED, no console errors.")

        await browser.close()

asyncio.run(main())
