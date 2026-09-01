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

        # --- 0) Favicon vorhanden ---
        href = await page.evaluate("() => { const l = document.querySelector('link[rel=icon]'); return l ? l.getAttribute('href').slice(0, 30) : null; }")
        print("favicon href prefix:", href)
        assert href and href.startswith("data:image/svg+xml"), "eigenes Favicon sollte gesetzt sein"
        print("OK: custom favicon set")

        await page.locator('.tab-btn[data-view="coach"]').click()
        await page.wait_for_timeout(300)
        gate_active = await page.evaluate("() => { const g = document.getElementById('coach-gate'); return g && getComputedStyle(g).display !== 'none'; }")
        if gate_active:
            await page.locator("#coach-gate-skip").click()
            await page.wait_for_timeout(300)

        # Ziel mit Datum in ca. 5 Tagen anlegen -> Taper-Fenster fuer Race Fueling test
        import datetime
        near_date = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
        far_date = (datetime.date.today() + datetime.timedelta(days=120)).isoformat()

        await page.locator("#new-goal-toggle-btn").click()
        await page.wait_for_timeout(200)
        await page.fill("#goal-name", "Timeline-Test-Event")
        await page.fill("#goal-date", far_date)
        await page.locator("#goal-form button[type=submit]").click()
        await page.wait_for_timeout(300)

        # --- 1) Trainingsplan-Zeitleiste rendert Phasen-Segmente ---
        seg_count = await page.locator("#plan-timeline .plan-timeline-seg").count()
        print("timeline segments (fern):", seg_count)
        assert seg_count >= 1, "Zeitleiste sollte mindestens ein Phasen-Segment zeigen"
        current_phase_text = await page.locator(".plan-timeline-current").inner_text()
        print("current phase label:", current_phase_text)

        # --- 2) Plan-Status-Badge: zunaechst "kein aktiver Plan" ---
        badge_txt = await page.locator(".plan-status-badge").first.inner_text()
        print("plan status badge (vor generieren):", badge_txt)

        # --- 3) generateTrainingPlan mocken (kein echter Ollama in Tests) und pruefen, dass alte Plaene ersetzt werden ---
        await page.evaluate("""() => {
            const goal = goals.find(g => g.name === 'Timeline-Test-Event');
            // Alten "Fremd-Plan" fuer ein ANDERES (fiktives) Ziel simulieren, um Cross-Goal-Konflikt zu testen
            addPlannedWorkout({ date: new Date().toISOString().slice(0,10), sport: 'Laufen', title: 'Alter Fremdplan', goalId: 'fake-old-goal', source: 'ai' });
            window.__testGoalId = goal.id;
        }""")
        await page.evaluate("""() => {
            // generateTrainingPlan direkt durch eine Fake-Version ersetzen, die ohne Netzwerk arbeitet
            window.generateTrainingPlan = async function(goalId, opts) {
                opts = opts || {};
                const goal = goals.find(g => g.id === goalId);
                if (opts.replace) deleteFuturePlannedWorkoutsForGoal(goal.id);
                deleteFuturePlannedWorkoutsForOtherGoals(goal.id);
                const dates = computePlanningWindow(goal.id);
                dates.slice(0, 3).forEach(d => addPlannedWorkout({ date: d, sport: 'Laufen', title: 'Testeinheit', duration_min: 45, goalId: goal.id, source: 'ai' }));
                renderTrainingPlanCard();
                renderCalendar();
            };
        }""")
        await page.locator('.tab-btn[data-view="coach"]').click()
        await page.wait_for_timeout(200)
        await page.locator(".plan-generate-btn").click()
        await page.wait_for_timeout(300)

        remaining_other_goal = await page.evaluate("() => plannedWorkouts.filter(p => p.goalId === 'fake-old-goal' && p.date >= new Date().toISOString().slice(0,10)).length")
        print("remaining planned workouts for other (old) goal after generating new plan:", remaining_other_goal)
        assert remaining_other_goal == 0, "Plan eines anderen Ziels sollte beim Erstellen eines neuen Plans entfernt werden (Widerspruch im Kalender vermeiden)"
        print("OK: generating a plan clears conflicting plans of other goals")

        badge_txt_after = await page.locator(".plan-status-badge").first.inner_text()
        print("plan status badge (nach generieren):", badge_txt_after)
        assert "Aktueller Plan" in badge_txt_after
        print("OK: plan status badge shows active plan")

        # "Plan neu erstellen" Button sollte jetzt sichtbar sein
        replace_btn = page.locator(".plan-replace-btn")
        assert await replace_btn.count() == 1
        await replace_btn.click()
        await page.wait_for_timeout(300)
        own_goal_count_after_replace = await page.evaluate("() => plannedWorkouts.filter(p => p.goalId === window.__testGoalId && p.date >= new Date().toISOString().slice(0,10)).length")
        print("own-goal planned workouts after 'Plan neu erstellen':", own_goal_count_after_replace)
        assert own_goal_count_after_replace == 3, "Replace sollte alte Einheiten löschen und neue (hier 3) anlegen, nicht anhäufen"
        print("OK: 'Plan neu erstellen' replaces instead of accumulating")

        # --- 4) Ernaehrung: Vor-dem-Training zeigt echte geplante Einheit + Umschalter ---
        await page.locator('.tab-btn[data-view="nutrition"]').click()
        await page.wait_for_timeout(300)
        preworkout_title = await page.locator("#nutrition-preworkout-body .plan-item-title").first.inner_text()
        print("Vor-dem-Training zeigt Einheit:", preworkout_title)
        assert "Testeinheit" in preworkout_title, "Ernaehrung sollte die echte, gerade geplante Einheit zeigen"
        switcher_count = await page.locator(".nutrition-preworkout-chip").count()
        print("Umschalter-Chips:", switcher_count)
        assert switcher_count >= 2, "Bei mehreren anstehenden Einheiten sollte ein Umschalter erscheinen"
        await page.locator(".nutrition-preworkout-chip").nth(1).click()
        await page.wait_for_timeout(200)
        active_chip_text = await page.locator(".nutrition-preworkout-chip.active").inner_text()
        print("aktiver Chip nach Klick:", active_chip_text.strip())
        print("OK: nutrition pre-workout switcher works")

        # --- 5) Wettkampf-Verpflegung: fern liegendes Ziel -> minimal ---
        minimal = await page.locator("#racefueling-card").evaluate("el => el.classList.contains('racefueling-minimal')")
        print("racefueling minimal (fernes Ziel):", minimal)
        assert minimal, "Bei einem weit entfernten Ziel sollte die Verpflegungs-Kachel minimal bleiben"

        # Ziel auf 5 Tage vor dem Event umsetzen -> sollte ausklappen
        await page.evaluate("""(nearDate) => {
            const goal = goals.find(g => g.id === window.__testGoalId);
            goal.date = nearDate;
            goal.targetTime = '05:30:00';
            saveGoals();
            renderNutrition();
        }""", near_date)
        await page.wait_for_timeout(200)
        minimal_after = await page.locator("#racefueling-card").evaluate("el => el.classList.contains('racefueling-minimal')")
        print("racefueling minimal (5 Tage vor Event):", minimal_after)
        assert not minimal_after, "Innerhalb der Taper-Phase sollte die Verpflegungs-Kachel ausklappen"
        print("OK: race fueling card gates on taper window")

        print("\n--- Console/page errors captured ---")
        for e in errors:
            print("ERROR:", e)
        if errors:
            raise SystemExit(f"{len(errors)} console/page errors detected")
        print("\nALL CHECKS PASSED, no console errors.")

        await browser.close()

asyncio.run(main())
