// Ollama Setup & Model Loader
// Verwaltet Ollama-Konfiguration, Terminal-Commands für Model-Loading,
// und Autostart nach Computer-Restart

function initOllamaSetup() {
  const setupBtn = document.getElementById("ollama-setup-btn");
  if (!setupBtn) return;
  
  setupBtn.addEventListener("click", openOllamaSetupDialog);
}

async function openOllamaSetupDialog() {
  const dialog = document.createElement("div");
  dialog.className = "modal-overlay";
  dialog.innerHTML = `
    <div class="modal-content" style="max-width: 600px;">
      <div class="modal-header">
        <h2>Ollama Setup & Model Manager</h2>
        <button class="modal-close" type="button">✕</button>
      </div>
      <div class="modal-body">
        <div class="ollama-setup-section">
          <h3>🚀 Modell laden</h3>
          <p class="card-sub">Wähle ein Modell aus und kopiere den Befehl ins Terminal:</p>
          
          <div class="ollama-model-options">
            <div class="model-option">
              <span class="model-name">llama3.1 (schnell, empfohlen)</span>
              <button class="chip copy-btn" data-cmd="ollama pull llama3.1">In Clipboard kopieren</button>
            </div>
            <div class="model-option">
              <span class="model-name">llama2 (schneller, weniger präzise)</span>
              <button class="chip copy-btn" data-cmd="ollama pull llama2">In Clipboard kopieren</button>
            </div>
            <div class="model-option">
              <span class="model-name">neural-chat (gut für Anweisungen)</span>
              <button class="chip copy-btn" data-cmd="ollama pull neural-chat">In Clipboard kopieren</button>
            </div>
            <div class="model-option">
              <span class="model-name">mistral (sehr schnell)</span>
              <button class="chip copy-btn" data-cmd="ollama pull mistral">In Clipboard kopieren</button>
            </div>
          </div>
        </div>

        <hr style="margin: 20px 0; opacity: 0.3;">

        <div class="ollama-setup-section">
          <h3>⚙️ Autostart nach Restart konfigurieren</h3>
          <p class="card-sub">Ollama automatisch beim Computer-Start laden:</p>
          
          <div class="autostart-options">
            <button class="chip" id="setup-macos-btn">macOS - Launchd Setup</button>
            <button class="chip" id="setup-linux-btn">Linux - Systemd Setup</button>
            <button class="chip" id="setup-windows-btn">Windows - Task Scheduler Setup</button>
          </div>
        </div>

        <hr style="margin: 20px 0; opacity: 0.3;">

        <div class="ollama-setup-section">
          <h3>🔌 CORS Konfiguration (für dieses Dashboard)</h3>
          <p class="card-sub">Nur nötig, wenn oben "Verbindung testen" fehlschlägt:</p>
          <button class="chip" id="setup-cors-btn">CORS-Befehl kopieren</button>
          <code class="code-snippet" id="cors-snippet" style="display:none;">launchctl setenv OLLAMA_ORIGINS "*"</code>
        </div>

        <p class="card-sub" style="margin-top: 20px; color: #999;">
          💡 Tipp: Nach dem Modell-Download "Verbindung testen" clicken um sicherzustellen dass alles funktioniert.
        </p>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  // Close button
  dialog.querySelector(".modal-close").addEventListener("click", () => dialog.remove());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.remove();
  });

  // Copy-to-Clipboard Buttons
  dialog.querySelectorAll(".copy-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const cmd = btn.dataset.cmd;
      navigator.clipboard.writeText(cmd).then(() => {
        const orig = btn.textContent;
        btn.textContent = "✓ Kopiert!";
        setTimeout(() => { btn.textContent = orig; }, 2000);
      });
    });
  });

  // macOS Setup
  document.getElementById("setup-macos-btn").addEventListener("click", () => {
    const script = `#!/bin/bash
# Ollama Autostart für macOS via Launchd
# Speichere diese Datei als ~/Library/LaunchAgents/com.ollama.startup.plist
# und führe aus: launchctl load ~/Library/LaunchAgents/com.ollama.startup.plist

<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ollama.startup</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/ollama</string>
        <string>serve</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/ollama.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/ollama_err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>OLLAMA_ORIGINS</key>
        <string>*</string>
    </dict>
</dict>
</plist>`;
    navigator.clipboard.writeText(script).then(() => {
      alert("✓ Launchd-Konfiguration kopiert!\n\n1. Öffne Terminal\n2. Füge ein: nano ~/Library/LaunchAgents/com.ollama.startup.plist\n3. Einfügen (Cmd+V)\n4. Speichern (Ctrl+X, dann Y, dann Enter)\n5. Starten: launchctl load ~/Library/LaunchAgents/com.ollama.startup.plist\n\nOllama lädt sich jetzt beim Restart automatisch.");
    });
  });

  // Linux Setup
  document.getElementById("setup-linux-btn").addEventListener("click", () => {
    const script = `[Unit]
Description=Ollama Service
After=network.target

[Service]
Type=simple
User=%u
ExecStart=/usr/local/bin/ollama serve
Restart=always
Environment="OLLAMA_ORIGINS=*"

[Install]
WantedBy=default.target`;
    navigator.clipboard.writeText(script).then(() => {
      alert("✓ Systemd-Service-Config kopiert!\n\n1. Öffne Terminal\n2. Erstelle: ~/.config/systemd/user/ollama.service\n3. Einfügen (Ctrl+Shift+V)\n4. Speichern\n5. Aktivieren: systemctl --user enable ollama\n6. Starten: systemctl --user start ollama\n\nOllama lädt sich jetzt beim Restart automatisch.");
    });
  });

  // Windows Setup
  document.getElementById("setup-windows-btn").addEventListener("click", () => {
    const script = `REM Windows Task Scheduler - Ollama Autostart
REM Führe als Administrator aus:

schtasks /create /tn "Ollama Autostart" /tr "\"C:\\Users\\DEINNAME\\AppData\\Local\\Programs\\Ollama\\ollama.exe\" serve" /sc onlogon /f`;
    navigator.clipboard.writeText(script).then(() => {
      alert("✓ Windows-Befehl kopiert!\n\n1. Öffne Command Prompt als Administrator\n2. Ersetze DEINNAME mit deinem Windows-Benutzernamen\n3. Einfügen und Enter\n\nOllama lädt sich jetzt beim Restart automatisch.");
    });
  });

  // CORS Setup
  document.getElementById("setup-cors-btn").addEventListener("click", () => {
    const cmd = `launchctl setenv OLLAMA_ORIGINS "*" && killall Ollama && open /Applications/Ollama.app`;
    navigator.clipboard.writeText(cmd).then(() => {
      alert("✓ CORS-Befehl kopiert!\n\n1. Öffne Terminal\n2. Einfügen (Cmd+V)\n3. Enter\n\nDas setzt CORS für Ollama und startet es neu.");
    });
  });
}

// Initialisieren wenn DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initOllamaSetup);
} else {
  initOllamaSetup();
}
