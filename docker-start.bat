@echo off
REM ==========================================
REM PeerLink Docker Start-Script
REM 11000% User-Freundlichkeitsgarantie!
REM ==========================================

echo.
echo ==========================================
echo 🚀 PeerLink Docker-System starten...
echo ==========================================
echo.

REM Prüfen ob Docker läuft
docker info >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Docker ist nicht verfügbar!
    echo    Bitte starten Sie Docker Desktop zuerst.
    echo.
    echo 💡 Tipp: Docker Desktop starten und dann dieses Script erneut ausführen.
    pause
    exit /b 1
)

echo ✅ Docker ist verfügbar
echo.

REM Verzeichnisse erstellen falls sie nicht existieren
if not exist "logs" mkdir logs
if not exist "data" mkdir data
if not exist "backup" mkdir backup

echo 📁 Verzeichnisse überprüft
echo.

REM System starten
echo 🔄 Starte PeerLink-System...
docker-compose up -d

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ==========================================
    echo 🎉 PeerLink-System erfolgreich gestartet!
    echo ==========================================
    echo.
    echo 🌐 Zugriff:
    echo    📄 PeerLink:    http://localhost:8080
    echo    📊 Monitoring:  http://localhost:8080/monitoring
    echo    💚 Health:      http://localhost:8080/health
    echo    🌍 Traefik:     http://localhost:8081
    echo.
    echo 🛑 Zum Stoppen: docker-stop.bat
    echo 💾 Backups:      ./backup/ Ordner
    echo 📝 Logs:         ./logs/ Ordner
    echo.
    echo ⏳ Warte auf System-Start...
    timeout /t 5 /nobreak >nul

    REM System-Status überprüfen
    echo 📊 System-Status:
    docker-compose ps

    echo.
    echo 💡 Tipp: Öffnen Sie http://localhost:8080 in Ihrem Browser!

) else (
    echo.
    echo ❌ Fehler beim Starten des Systems!
    echo.
    echo 🔍 Mögliche Ursachen:
    echo    • Docker-Desktop nicht gestartet
    echo    • Port 8080 bereits belegt
    echo    • Berechtigungsprobleme
    echo.
    echo 💡 Lösungen:
    echo    • Docker Desktop starten
    echo    • Anderen Port verwenden (ändern in docker-compose.yml)
    echo    • Als Administrator ausführen
)

echo.
pause
