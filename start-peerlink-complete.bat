@echo off
REM ==========================================
REM PeerLink Vollständiger Start
REM Startet alles automatisch
REM ==========================================

echo 🚀 Starte PeerLink System komplett...
echo.

REM Prüfe ob Server bereits läuft
curl -s http://localhost:8080/ >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo ✅ Server läuft bereits!
    goto open_browser
)

REM Stoppe mögliche alte Prozesse
taskkill /F /IM node.exe >nul 2>nul

REM Starte Server im Hintergrund
echo 📡 Starte Signaling Server...
start /B node server.js > signaling.log 2>&1

REM Warte kurz
timeout /t 3 /nobreak >nul

REM Prüfe ob Server gestartet ist
curl -s http://localhost:8080/ >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Server konnte nicht gestartet werden
    echo Prüfe signaling.log für Details
    pause
    exit /b 1
)

:open_browser
echo ✅ PeerLink Server läuft erfolgreich!
echo.
echo 🌐 Öffne Browser...
start http://localhost:8080/
echo.
echo 🎉 PeerLink ist bereit zur Nutzung!
echo.
echo 📊 Monitoring: http://localhost:8080/monitoring
echo 💚 Health Check: http://localhost:8080/health
echo 📝 Logs: signaling.log
echo.
echo 🛑 Zum Stoppen: taskkill /F /IM node.exe
echo.
timeout /t 2 >nul
