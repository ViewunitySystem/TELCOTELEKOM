@echo off
REM ==========================================
REM PeerLink Docker Update-Script
REM Automatische Aktualisierung
REM ==========================================

echo.
echo ==========================================
echo 🔄 PeerLink-System aktualisieren...
echo ==========================================
echo.

REM Prüfen ob System läuft
docker-compose ps | findstr "peerlink-server" >nul
if %ERRORLEVEL% EQU 0 (
    echo ⚠️  System läuft noch!
    echo    Stoppe System zuerst...
    docker-compose down
    echo ✅ System gestoppt
    echo.
)

echo 🔄 Ziehe neueste Images...
docker-compose pull

if %ERRORLEVEL% EQU 0 (
    echo ✅ Images aktualisiert
    echo.
    echo 🚀 Starte aktualisiertes System...
    docker-compose up -d

    if %ERRORLEVEL% EQU 0 (
        echo.
        echo ==========================================
        echo 🎉 Update erfolgreich abgeschlossen!
        echo ==========================================
        echo.
        echo 🌐 Zugriff:
        echo    📄 PeerLink:    http://localhost:8080
        echo    📊 Monitoring:  http://localhost:8080/monitoring
        echo    💚 Health:      http://localhost:8080/health
        echo.
        echo 📋 Was wurde aktualisiert:
        echo    • Docker-Images
        echo    • Konfigurationen
        echo    • Sicherheitspatches
        echo.
        echo 💾 Ihre Daten bleiben unverändert erhalten!

    ) else (
        echo ❌ Fehler beim Neustart des Systems!
        echo 💡 Versuchen Sie manuell: docker-compose up -d
    )

) else (
    echo ❌ Fehler beim Aktualisieren der Images!
    echo 💡 Überprüfen Sie Ihre Internetverbindung
)

echo.
pause
