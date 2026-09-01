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

        # --- 1) Theme toggle ---
        toggle = page.locator("#theme-toggle-btn")
        assert await toggle.count() == 1
        html_theme_before = await page.evaluate("document.documentElement.getAttribute('data-theme')")
        print("theme before:", html_theme_before)
        await toggle.click()
        await page.wait_for_timeout(200)
        html_theme_after = await page.evaluate("document.documentElement.getAttribute('data-theme')")
        print("theme after click:", html_theme_after)
        assert html_theme_after in ("dark", "light")
        bg_after = await page.evaluate("getComputedStyle(document.body).backgroundColor")
        print("body bg after toggle:", bg_after)

        # reload -> persisted via localStorage
        await page.reload()
        await page.wait_for_timeout(400)
        html_theme_reload = await page.evaluate("document.documentElement.getAttribute('data-theme')")
        print("theme after reload:", html_theme_reload)
        assert html_theme_reload == html_theme_after, "theme choice should persist across reload"
        print("OK: theme toggle works and persists")

        # toggle back to light explicitly for consistent screenshots below
        if html_theme_reload == "dark":
            await toggle.click()
            await page.wait_for_timeout(200)

        # --- 2) Sticky topnav ---
        position = await page.evaluate("getComputedStyle(document.querySelector('.topnav')).position")
        assert position == "sticky", f"expected sticky, got {position}"
        # scroll down and check topnav stays near top of viewport
        await page.evaluate("window.scrollTo(0, 1200)")
        await page.wait_for_timeout(300)
        box = await page.locator(".topnav").bounding_box()
        print("topnav bbox after scroll:", box)
        assert box["y"] <= 5, f"topnav should be stuck near top, y={box['y']}"
        print("OK: topnav sticky on scroll")
        await page.evaluate("window.scrollTo(0, 0)")
        await page.wait_for_timeout(200)

        # --- 3) Tooltip fix: hover ACWR gauge, check tooltip not blank/white-on-white ---
        async def move_to_path_midpoint(locator):
            # Echte Maus-Koordinaten treffen bei duennen SVG-Bogen-Strokes
            # (nur Stroke, kein Fill) oft knapp daneben (Sub-Pixel-Hit-Testing).
            # Fuer den Test genuegt ein synthetisches mousemove direkt auf dem
            # Element - die App-Logik (showTip/hideTip) reagiert identisch,
            # ob echte Maus oder Skript-Event.
            rect = await locator.evaluate("el => { const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; }")
            cx, cy = rect["x"] + rect["w"] / 2, rect["y"] + rect["h"] / 2
            await locator.evaluate(
                "(el, [cx, cy]) => el.dispatchEvent(new MouseEvent('mousemove', {clientX: cx, clientY: cy, bubbles: true}))",
                [cx, cy],
            )

        acwr_path = page.locator("#chart-acwr path").first
        if await acwr_path.count():
            await move_to_path_midpoint(acwr_path)
            await page.wait_for_timeout(200)
            tip = page.locator("#tooltip")
            opacity = await tip.evaluate("el => getComputedStyle(el).opacity")
            bg = await tip.evaluate("el => getComputedStyle(el).backgroundColor")
            color = await tip.evaluate("el => getComputedStyle(el).color")
            text = await tip.inner_text()
            print("tooltip opacity/bg/color/text:", opacity, bg, color, repr(text))
            assert opacity == "1", "tooltip should be visible on hover"
            assert text.strip() != "", "tooltip text should not be empty"
            assert bg != color, "tooltip background and text color must differ (not invisible)"
        else:
            print("WARN: no ACWR gauge path found to hover")

        # Also check dark mode specifically (the original bug report was in dark mode)
        await toggle.click()  # switch to dark
        await page.wait_for_timeout(200)
        is_dark = await page.evaluate("document.documentElement.getAttribute('data-theme')") == "dark"
        assert is_dark
        if await acwr_path.count():
            await page.mouse.move(0, 0)
            await page.wait_for_timeout(100)
            await move_to_path_midpoint(acwr_path)
            await page.wait_for_timeout(200)
            tip = page.locator("#tooltip")
            bg = await tip.evaluate("el => getComputedStyle(el).backgroundColor")
            color = await tip.evaluate("el => getComputedStyle(el).color")
            text_primary = await page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim()")
            print("DARK MODE tooltip bg/color, --text-primary:", bg, color, text_primary)
            assert bg == "rgba(20, 19, 17, 0.94)", f"tooltip bg should stay fixed dark, got {bg}"
        await page.screenshot(path="/tmp/dark_acwr_tooltip.png")
        await toggle.click()  # back to light
        await page.wait_for_timeout(200)

        # --- 4) Modal detail with cadence chart (real running data has cadence) ---
        # switch to overview tab (default) and click a running workout row
        await page.wait_for_timeout(300)
        rows = page.locator("#workouts-table tbody tr[data-file]")
        n = await rows.count()
        print("workout rows:", n)
        opened_cadence = False
        for i in range(min(n, 60)):
            row = rows.nth(i)
            cls = await row.get_attribute("class") or ""
            text = await row.inner_text()
            if "Laufen" in text:
                await row.click()
                await page.wait_for_timeout(400)
                cad_chart = page.locator("#modal-body .wd-cad-chart")
                if await cad_chart.count():
                    svg_count = await cad_chart.locator("svg").count()
                    print(f"row {i} Laufen -> cadence chart svg count:", svg_count)
                    if svg_count > 0:
                        opened_cadence = True
                        await page.screenshot(path="/tmp/modal_running_detail.png")
                        break
                await page.locator("#modal-close").click()
                await page.wait_for_timeout(200)
        assert opened_cadence, "expected at least one running workout with a rendered cadence chart"
        print("OK: cadence chart renders for a real running workout")

        # check modal stats grid includes a cadence stat tile
        stat_labels = await page.locator(".modal-stats .st .l").all_inner_texts()
        print("modal stat labels:", stat_labels)
        assert any("Kadenz" in s for s in stat_labels), "expected a cadence stat tile"
        await page.locator("#modal-close").click()
        await page.wait_for_timeout(200)

        # --- 5) Non-running workout (e.g. cycling) should not show cadence/power charts (no such data) ---
        for i in range(min(n, 60)):
            row = rows.nth(i)
            text = await row.inner_text()
            if "Rad" in text:
                await row.click()
                await page.wait_for_timeout(400)
                has_cad = await page.locator("#modal-body .wd-cad-chart").count()
                has_power = await page.locator("#modal-body .wd-power-chart").count()
                print(f"cycling row {i}: cad chart present={bool(has_cad)} power chart present={bool(has_power)}")
                await page.locator("#modal-close").click()
                await page.wait_for_timeout(200)
                break

        # --- 6) No console/page errors so far ---
        print("\nerrors so far:", errors)

        # --- 7) Mobile viewport regression check across all 4 tabs ---
        await page.set_viewport_size({"width": 390, "height": 844})
        await page.wait_for_timeout(300)
        for tab in ["overview", "calendar", "records", "coach"]:
            await page.locator(f'.tab-btn[data-view="{tab}"]').click()
            await page.wait_for_timeout(300)
            overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            print(f"mobile overflow on {tab}:", overflow)
            assert overflow <= 1, f"unexpected horizontal overflow on {tab}: {overflow}px"
        await page.screenshot(path="/tmp/mobile_overview.png")

        await browser.close()

    print("\n--- Console/page errors captured ---")
    for e in errors:
        print("ERROR:", e)
    if errors:
        raise SystemExit(f"{len(errors)} console/page errors detected")
    print("\nALL CHECKS PASSED, no console errors.")

asyncio.run(main())
