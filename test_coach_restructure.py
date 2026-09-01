import asyncio, os
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

        # Onboarding ueberspringen, falls Gate aktiv
        await page.locator('.tab-btn[data-view="coach"]').click()
        await page.wait_for_timeout(300)
        gate_active = await page.evaluate("() => { const g = document.getElementById('coach-gate'); return g && getComputedStyle(g).display !== 'none'; }")
        print("coach gate active:", gate_active)
        if gate_active:
            await page.locator("#coach-gate-skip").click()
            await page.wait_for_timeout(300)

        # --- 1) Athletenprofil-Kachel ist NICHT mehr dauerhaft im Coach-Grid ---
        profile_card = await page.locator('#coach-grid [data-card-id="profile"]').count()
        print("profile card still in coach-grid:", profile_card)
        assert profile_card == 0, "Athletenprofil sollte aus dem Coach-Grid entfernt sein"

        # --- 2) Globaler Settings-Button oeffnet eine eigene volle Seite (kein Fenster/Overlay mehr) ---
        settings_view = page.locator("#view-settings")
        assert not await settings_view.evaluate("el => el.classList.contains('active')")
        await page.locator("#global-settings-btn").click()
        await page.wait_for_timeout(300)
        assert await settings_view.evaluate("el => el.classList.contains('active')"), "Settings-Seite sollte aktiv sein"
        # Kein Tab-Button sollte als aktiv markiert sein, solange die Settings-Seite offen ist
        active_tabs = await page.locator(".tab-btn.active").count()
        print("aktive Tab-Buttons waehrend Settings-Seite offen:", active_tabs)
        assert active_tabs == 0
        assert await page.locator("#profile-ftp").count() == 1
        assert await page.locator("#coach-ollama-url").count() == 1
        print("OK: settings gear opens a full page (not a modal) with Ollama + Athletenprofil fields")

        # Athletenprofil-Feld speichern testen
        await page.fill("#profile-ftp", "255")
        await page.locator("#profile-ftp").dispatch_event("change")
        await page.wait_for_timeout(200)
        stored = await page.evaluate("() => JSON.parse(localStorage.getItem('triathlon_dashboard_athlete_profile_v1') || localStorage.getItem('athlete_profile') || '{}')")
        print("profile after saving ftp (best-effort key check):", stored)

        # Seite per Escape verlassen -> zurueck zum Coach-Tab (von dem aus geoeffnet wurde)
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)
        assert not await settings_view.evaluate("el => el.classList.contains('active')"), "Settings-Seite sollte nach Escape zu sein"
        coach_tab_active = await page.locator('.tab-btn[data-view="coach"]').evaluate("el => el.classList.contains('active')")
        assert coach_tab_active, "Nach Escape sollte wieder der Coach-Tab aktiv sein (von dem aus die Settings geoeffnet wurden)"
        print("OK: Escape leaves the settings page and restores the previous tab")

        # Erneut oeffnen, per "Zurueck"-Button verlassen
        await page.locator("#global-settings-btn").click()
        await page.wait_for_timeout(300)
        await page.locator("#settings-back-btn").click()
        await page.wait_for_timeout(300)
        assert not await settings_view.evaluate("el => el.classList.contains('active')"), "Settings-Seite sollte nach 'Zurück' zu sein"
        print("OK: 'Zurück' button leaves the settings page")

        # --- 3) "+ Neues Ziel/Event"-Button toggelt die Formular-Kachel ---
        new_goal_card = page.locator("#new-goal-card")
        assert await new_goal_card.evaluate("el => el.hidden"), "new-goal-card sollte initial hidden sein"
        await page.locator("#new-goal-toggle-btn").click()
        await page.wait_for_timeout(200)
        assert not await new_goal_card.evaluate("el => el.hidden"), "new-goal-card sollte nach Klick sichtbar sein"
        print("OK: new-goal toggle button shows the form card")
        await page.locator("#new-goal-toggle-btn").click()
        await page.wait_for_timeout(200)
        assert await new_goal_card.evaluate("el => el.hidden"), "new-goal-card sollte nach erneutem Klick wieder hidden sein"
        print("OK: new-goal toggle button hides the form card again")

        # Ziel anlegen -> Formular sollte sich danach automatisch wieder schliessen
        await page.locator("#new-goal-toggle-btn").click()
        await page.wait_for_timeout(200)
        await page.fill("#goal-name", "Testlauf Herbst")
        await page.fill("#goal-date", "2026-11-15")
        await page.locator("#goal-form button[type=submit]").click()
        await page.wait_for_timeout(300)
        assert await new_goal_card.evaluate("el => el.hidden"), "Formular sollte nach dem Anlegen wieder eingeklappt sein"
        print("OK: goal form collapses again after submit")

        # --- 4) Coach-Zusammenfassungs-Kachel ganz oben ---
        summary_html = await page.locator("#coach-summary-body").inner_html()
        print("coach summary body length:", len(summary_html))
        assert len(summary_html.strip()) > 0, "Coach-Zusammenfassung sollte Inhalt haben"
        print("OK: coach summary renders content")

        # --- 5) Recovery-Check funktioniert weiterhin, Badge aktualisiert sich ---
        await page.locator('#recovery-energy-group button[data-value="high"]').click()
        await page.wait_for_timeout(200)
        badge_text = await page.locator("#recovery-status-badge").inner_text()
        print("recovery badge after selecting energy=high:", badge_text)

        print("\n--- Console/page errors captured ---")
        for e in errors:
            print("ERROR:", e)
        if errors:
            raise SystemExit(f"{len(errors)} console/page errors detected")
        print("\nALL CHECKS PASSED, no console errors.")

        await browser.close()

asyncio.run(main())
