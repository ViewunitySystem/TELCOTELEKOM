@echo off
REM ==========================================
REM PeerLink Windows Stop-Script (Fixed)
REM Stoppt alle Komponenten sauber
REM ==========================================

if "%1"=="help" goto show_help
if "%1"=="-h" goto show_help
if "%1"=="--help" goto show_help

echo 🛑 Stoppe PeerLink P2P Kommunikationssystem...
echo.

REM Signaling Server stoppen
echo 📡 Stoppe Signaling Server...
taskkill /F /IM node.exe >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo ✅ Signaling Server gestoppt
) else (
    echo ⚠️  Kein Signaling Server gefunden
)

REM Docker Container stoppen
echo 🔄 Stoppe Docker Services...
docker compose down >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo ✅ Docker Services gestoppt
) else (
    echo ⚠️  Keine Docker Services gefunden
)

echo ✅ System gestoppt
goto end

:show_help
echo PeerLink Windows Stop-Script
echo.
echo Verwendung:
echo   .\stop-peerlink-fixed.bat          - Stoppe das System
echo   .\stop-peerlink-fixed.bat help     - Diese Hilfe anzeigen
echo.
echo Stoppt folgende Komponenten:
echo   - WebRTC Signaling Server (Node.js)
echo   - TURN/STUN Server (Docker)
echo   - Monitoring Dashboard (Docker)
goto end

:end
echo.
pause
