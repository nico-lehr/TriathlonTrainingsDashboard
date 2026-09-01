import asyncio
from playwright.async_api import async_playwright

URL = "file:///home/claude/triathlon-dashboard/index.html"

async def main():
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 1000})
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        await page.goto(URL)
        await page.wait_for_timeout(500)

        # --- 0) Onboarding-Gate + erweiterter Fragenkatalog (frisches Profil) ---
        await page.locator('.tab-btn[data-view="coach"]').click()
        await page.wait_for_timeout(300)
        gate_active = await page.locator("#coach-gate").evaluate("el => el.classList.contains('active')")
        content_gated = await page.locator("#coach-content").evaluate("el => el.classList.contains('gated')")
        print("gate active on fresh profile:", gate_active, "content gated:", content_gated)
        assert gate_active and content_gated, "coach content should be gated before onboarding"

        # Onboarding über den Gate-Button starten
        await page.locator("#onboarding-gate-btn").click()
        await page.wait_for_timeout(200)
        overlay_open = await page.locator("#onb-overlay").evaluate("el => el.classList.contains('open')")
        assert overlay_open, "gate button should open the onboarding wizard"

        # Schritt 0: Alter ausfüllen
        await page.fill("#onb-age", "34")
        await page.locator("#onb-age").dispatch_event("change")
        await page.locator("#onb-next-btn").click()
        await page.wait_for_timeout(200)

        # Schritt 1: Trainingstage-Picker (Mo/Mi/Fr trainieren, Mi = Schwimmtag, Fr = lange Einheit)
        for day in ["mo", "mi", "fr"]:
            await page.locator(f'#onb-training-days .onb-weekday-chip[data-value="{day}"]').click()
            await page.wait_for_timeout(100)
        await page.locator('#onb-swim-day .onb-weekday-chip[data-value="mi"]').click()
        await page.wait_for_timeout(100)
        await page.locator('#onb-long-days .onb-weekday-chip[data-value="fr"]').click()
        await page.wait_for_timeout(100)

        # ein Tag, der nicht als Trainingstag gewählt wurde, muss deaktiviert sein
        di_disabled = await page.locator('#onb-swim-day .onb-weekday-chip[data-value="di"]').is_disabled()
        assert di_disabled, "non-selected weekday should be disabled as swim-day option"

        # Trainingstag wieder abwählen -> Schwimmtag/lange-Einheit-Auswahl muss sich anpassen
        await page.locator('#onb-training-days .onb-weekday-chip[data-value="mi"]').click()
        await page.wait_for_timeout(100)
        swim_still_selected = await page.locator('#onb-swim-day .onb-weekday-chip.selected').count()
        assert swim_still_selected == 0, "deselecting the swim day as a training day should clear the swim-day selection"
        # Mi als Trainingstag wieder aktivieren für den Rest des Tests
        await page.locator('#onb-training-days .onb-weekday-chip[data-value="mi"]').click()
        await page.wait_for_timeout(100)
        await page.locator('#onb-swim-day .onb-weekday-chip[data-value="mi"]').click()
        await page.wait_for_timeout(100)

        await page.fill("#onb-session-min", "75")
        await page.locator("#onb-session-min").dispatch_event("change")
        await page.wait_for_timeout(100)

        # restliche Schritte durchklicken bis zum Abschluss
        steps_total = await page.evaluate("() => ONB_STEPS")
        for _ in range(steps_total - 1):
            btn_txt = await page.locator("#onb-next-btn").inner_text()
            await page.locator("#onb-next-btn").click()
            await page.wait_for_timeout(150)
            if "fertig" in btn_txt.lower():
                break

        await page.wait_for_timeout(300)
        overlay_open_after = await page.locator("#onb-overlay").evaluate("el => el.classList.contains('open')")
        assert not overlay_open_after, "onboarding should close after finishing"
        gate_active_after = await page.locator("#coach-gate").evaluate("el => el.classList.contains('active')")
        content_gated_after = await page.locator("#coach-content").evaluate("el => el.classList.contains('gated')")
        assert not gate_active_after and not content_gated_after, "coach content should be revealed after onboarding"
        print("OK: onboarding gate unlocks after completing the wizard")

        profile_after = await page.evaluate("() => athleteProfile")
        print("athleteProfile after onboarding:", profile_after)
        assert profile_after["age"] == 34
        assert set(profile_after["trainingDays"]) == {"mo", "mi", "fr"}
        assert profile_after["swimDay"] == "mi"
        assert profile_after["longDays"] == ["fr"]
        assert profile_after["typicalSessionMin"] == 75
        assert profile_after["onboardingDone"] is True
        print("OK: extended onboarding fields persist into athleteProfile")

        # neues Ziel anlegen, damit buildCompactContext einen Kontext bauen kann
        await page.evaluate("""() => {
            if (typeof goals !== 'undefined' && !goals.length) {
                goals.push({id: 'test2', name: 'Testziel2', sport: 'Triathlon', date: '2026-12-01', targetTime: null, distanceKm: null, notes: null});
            }
        }""")
        ctx2 = await page.evaluate("() => buildCompactContext(goals[0])")
        print("\n--- compact context (after onboarding) ---\n", ctx2)
        assert "34 Jahre" in ctx2
        assert "Mo/Mi/Fr" in ctx2 or ("Mo" in ctx2 and "Mi" in ctx2 and "Fr" in ctx2)
        assert "Schwimmtag Mi" in ctx2
        assert "lange Einheit Fr" in ctx2
        assert "75 Min" in ctx2
        print("OK: extended profile fields flow into the coach context")

        # reload -> Profil bleibt erhalten, Gate bleibt offen (kein erneutes Blockieren)
        await page.reload()
        await page.wait_for_timeout(400)
        await page.locator('.tab-btn[data-view="coach"]').click()
        await page.wait_for_timeout(300)
        gate_active_reload = await page.locator("#coach-gate").evaluate("el => el.classList.contains('active')")
        assert not gate_active_reload, "gate should stay unlocked after reload once onboarding is done"
        print("OK: unlocked coach state persists across reload")

        # zurück zur Übersicht für den Rest der Tests
        await page.locator('.tab-btn[data-view="overview"]').click()
        await page.wait_for_timeout(300)

        # --- 1) Table expand/collapse ---
        rows = page.locator("#workouts-table tbody tr[data-file]")
        n0 = await rows.count()
        print("initial visible rows (should be capped at 10):", n0)
        assert n0 == 10, f"expected 10 preview rows, got {n0}"
        expand_btn = page.locator("#table-expand-btn")
        btn_text = await expand_btn.inner_text()
        print("expand button text:", btn_text)
        assert "Alle" in btn_text
        await expand_btn.click()
        await page.wait_for_timeout(200)
        n1 = await rows.count()
        print("rows after expand:", n1)
        assert n1 > 10, "expected all rows after expanding"
        btn_text2 = await expand_btn.inner_text()
        assert "Weniger" in btn_text2
        await expand_btn.click()
        await page.wait_for_timeout(200)
        n2 = await rows.count()
        assert n2 == 10, "expected collapse back to 10"
        print("OK: table expand/collapse works")

        # switch to a narrower time range with < 10 rows -> expand control should hide
        await page.locator('.chip[data-range="7"]').click()
        await page.wait_for_timeout(300)
        wrap_display = await page.locator("#table-expand-wrap").evaluate("el => getComputedStyle(el).display")
        print("expand wrap display with short range:", wrap_display)

        # reset back to a wide range for the rest of the test
        await page.locator('.chip[data-range="Alle"]').click()
        await page.wait_for_timeout(300)

        # --- 2) Drag & drop layout reorder ---
        card_ids_before = await page.locator("#dash-grid .card").evaluate_all("els => els.map(e => e.dataset.cardId)")
        print("card order before:", card_ids_before)
        assert card_ids_before[0] == "monthcompare"

        # simulate drag: move the "acwr" card to the very first position using
        # synthetic mouse events (matches the app's mousedown/mousemove/mouseup
        # based reorder logic, not native HTML5 DnD)
        await page.evaluate("""() => {
            const grid = document.getElementById('dash-grid');
            const dragged = grid.querySelector('[data-card-id="acwr"]');
            const handle = dragged.querySelector('.card-drag-handle');
            const first = grid.querySelector('[data-card-id="monthcompare"]');
            const hRect = handle.getBoundingClientRect();
            const fRect = first.getBoundingClientRect();
            const fire = (el, type, x, y) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
            fire(handle, 'mousedown', hRect.x + 2, hRect.y + 2);
            fire(document, 'mousemove', fRect.x + 10, fRect.top + 2);
            fire(document, 'mouseup', fRect.x + 10, fRect.top + 2);
        }""")
        await page.wait_for_timeout(300)
        card_ids_after = await page.locator("#dash-grid .card").evaluate_all("els => els.map(e => e.dataset.cardId)")
        print("card order after simulated drag:", card_ids_after)
        assert card_ids_after[0] == "acwr", f"expected acwr first, got {card_ids_after}"

        # reload -> order should persist via localStorage
        await page.reload()
        await page.wait_for_timeout(500)
        card_ids_reload = await page.locator("#dash-grid .card").evaluate_all("els => els.map(e => e.dataset.cardId)")
        print("card order after reload:", card_ids_reload)
        assert card_ids_reload[0] == "acwr", "layout should persist across reload"
        print("OK: drag & drop reorder persists")

        # reset layout
        await page.locator("#reset-layout-btn").click()
        await page.wait_for_timeout(500)
        card_ids_reset = await page.locator("#dash-grid .card").evaluate_all("els => els.map(e => e.dataset.cardId)")
        print("card order after reset:", card_ids_reset)
        assert card_ids_reset[0] == "monthcompare", "layout should reset to default order"
        print("OK: layout reset works")

        # --- 2b) Coach-Grid: eigenes, unabhängiges Drag & Drop-Layout ---
        await page.locator('.tab-btn[data-view="coach"]').click()
        await page.wait_for_timeout(300)
        coach_ids_before = await page.locator("#coach-grid .card").evaluate_all("els => els.map(e => e.dataset.cardId)")
        print("coach card order before:", coach_ids_before)
        assert coach_ids_before[0] == "recovery"
        await page.evaluate("""() => {
            const grid = document.getElementById('coach-grid');
            const dragged = grid.querySelector('[data-card-id="goals"]');
            const handle = dragged.querySelector('.card-drag-handle');
            const first = grid.querySelector('[data-card-id="recovery"]');
            const hRect = handle.getBoundingClientRect();
            const fRect = first.getBoundingClientRect();
            const fire = (el, type, x, y) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
            fire(handle, 'mousedown', hRect.x + 2, hRect.y + 2);
            fire(document, 'mousemove', fRect.x + 10, fRect.top + 2);
            fire(document, 'mouseup', fRect.x + 10, fRect.top + 2);
        }""")
        await page.wait_for_timeout(300)
        coach_ids_after = await page.locator("#coach-grid .card").evaluate_all("els => els.map(e => e.dataset.cardId)")
        print("coach card order after drag:", coach_ids_after)
        assert coach_ids_after[0] == "goals", f"expected goals first, got {coach_ids_after}"
        # muss unabhängig vom Übersicht-Layout bleiben
        overview_ids_untouched = await page.locator("#dash-grid .card").evaluate_all("els => els.map(e => e.dataset.cardId)")
        assert overview_ids_untouched[0] == "monthcompare", "overview layout should be unaffected by coach-grid drag"
        await page.locator("#reset-coach-layout-btn").click()
        await page.wait_for_timeout(500)
        await page.locator('.tab-btn[data-view="coach"]').click()
        await page.wait_for_timeout(300)
        coach_ids_reset = await page.locator("#coach-grid .card").evaluate_all("els => els.map(e => e.dataset.cardId)")
        assert coach_ids_reset[0] == "recovery", "coach layout should reset independently"
        print("OK: coach-grid has its own independent drag & drop layout")

        # --- 3) Recovery check (jetzt im Coach-Tab) ---
        await page.wait_for_timeout(300)
        soreness_chips = page.locator("#recovery-soreness-group .onb-radio-chip")
        assert await soreness_chips.count() == 4
        await soreness_chips.nth(2).click()  # "Mittel"
        await page.wait_for_timeout(150)
        energy_chips = page.locator("#recovery-energy-group .onb-radio-chip")
        await energy_chips.nth(0).click()  # "Erschöpft"
        await page.wait_for_timeout(150)
        injury_chips = page.locator("#recovery-injury-group .onb-radio-chip")
        await injury_chips.nth(1).click()  # "Ja"
        await page.wait_for_timeout(150)
        note_row_display = await page.locator("#recovery-injury-note-row").evaluate("el => getComputedStyle(el).display")
        print("injury note row display after selecting Ja:", note_row_display)
        assert note_row_display != "none"
        await page.fill("#recovery-injury-note", "rechtes Knie, seit 2 Tagen")
        await page.locator("#recovery-injury-note").dispatch_event("change")
        await page.wait_for_timeout(200)

        stored = await page.evaluate("() => localStorage.getItem('triathlon_dashboard_recovery_v1')")
        print("stored recovery state:", stored)
        assert '"soreness":"moderate"' in stored
        assert '"energy":"low"' in stored
        assert '"injury":"yes"' in stored
        assert "rechtes Knie" in stored

        # reload -> chips should reflect saved selection
        await page.reload()
        await page.wait_for_timeout(400)
        await page.locator('.tab-btn[data-view="coach"]').click()
        await page.wait_for_timeout(300)
        selected_soreness = await page.locator("#recovery-soreness-group .onb-radio-chip.selected").inner_text()
        print("soreness selected after reload:", selected_soreness)
        assert selected_soreness == "Mittel"
        note_val = await page.locator("#recovery-injury-note").input_value()
        assert note_val == "rechtes Knie, seit 2 Tagen"
        print("OK: recovery check persists and pre-fills")

        # verify it appears in the compact coach context (requires a goal to build context for)
        await page.evaluate("""() => {
            if (typeof goals !== 'undefined' && !goals.length) {
                goals.push({id: 'test1', name: 'Testziel', sport: 'Triathlon', date: '2026-12-01', targetTime: null, distanceKm: null, notes: null});
            }
        }""")
        ctx = await page.evaluate("() => buildCompactContext(goals[0])")
        print("\n--- compact context ---\n", ctx)
        assert "Erholung heute" in ctx
        assert "Muskelkater mittel" in ctx
        assert "Energie erschöpft" in ctx
        assert "Verletzung: rechtes Knie" in ctx
        print("OK: recovery check flows into coach context")

        prompt = await page.evaluate("() => buildCoachPrompt(goals[0])")
        assert "Erholung heute" in prompt.split("\n\n")[0] or "Erholung heute" in prompt
        assert "Muskelkater" in prompt or "wenig Energie" in prompt
        print("OK: coach prompt includes recovery-aware instruction")

        await browser.close()

    print("\n--- Console/page errors captured ---")
    for e in errors:
        print("ERROR:", e)
    if errors:
        raise SystemExit(f"{len(errors)} console/page errors detected")
    print("\nALL CHECKS PASSED, no console errors.")

asyncio.run(main())
