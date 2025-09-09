@echo off
REM ==========================================
REM PeerLink Windows Stop-Script (Simple)
REM Stoppt alle PeerLink Komponenten
REM ==========================================

if "%1"=="help" goto help
if "%1"=="-h" goto help
if "%1"=="--help" goto help

echo 🛑 Stoppe PeerLink P2P Kommunikationssystem...
echo.

REM Signaling Server stoppen
taskkill /F /IM node.exe >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo ✅ Signaling Server gestoppt
) else (
    echo ⚠️  Kein Signaling Server gefunden
)

REM Docker Container stoppen
docker compose down >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo ✅ Docker Services gestoppt
) else (
    echo ⚠️  Keine Docker Services gefunden
)

echo ✅ System gestoppt
goto end

:help
echo PeerLink Windows Stop-Script
echo.
echo Verwendung:
echo   .\stop-peerlink-simple.bat          - Stoppe das System
echo   .\stop-peerlink-simple.bat help     - Diese Hilfe anzeigen
echo.
echo Stoppt:
echo   - WebRTC Signaling Server (Node.js)
echo   - TURN/STUN Server (Docker)
echo   - Monitoring Dashboard (Docker)
goto end

:end
echo.
pause
