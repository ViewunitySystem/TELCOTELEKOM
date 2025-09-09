#!/bin/bash

# ==========================================
# PeerLink Start-Script
# Einfache Installation und Start aller Komponenten
# ==========================================

echo "🚀 Starte PeerLink P2P Kommunikationssystem..."
echo ""

# Farbcodes für bessere Lesbarkeit
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ==========================================
# Funktionen
# ==========================================

check_dependencies() {
    echo -e "${BLUE}📋 Prüfe Enterprise-Abhängigkeiten...${NC}"

    # Docker prüfen
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}❌ Docker ist nicht installiert. Installiere Docker:${NC}"
        echo "   Ubuntu/Debian: sudo apt install docker.io docker-compose-plugin"
        echo "   CentOS/RHEL: sudo yum install docker docker-compose-plugin"
        echo "   macOS: brew install docker docker-compose"
        exit 1
    fi

    # Docker Compose prüfen (neue Version)
    if ! command -v docker &> /dev/null || ! docker compose version &> /dev/null; then
        echo -e "${RED}❌ Docker Compose ist nicht verfügbar.${NC}"
        echo "   Installiere Docker Desktop oder docker-compose"
        exit 1
    fi

    # Node.js prüfen
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js ist nicht installiert. Installiere Node.js 18+...${NC}"
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi

    # System-Ressourcen prüfen
    local total_ram=$(free -m | awk 'NR==2{printf "%.0f", $2}')
    local available_ram=$(free -m | awk 'NR==2{printf "%.0f", $4}')
    local cpu_cores=$(nproc)

    echo "System-Ressourcen:"
    echo "  RAM: ${total_ram}MB gesamt, ${available_ram}MB verfügbar"
    echo "  CPU: ${cpu_cores} Kerne"

    if [ $total_ram -lt 4096 ]; then
        echo -e "${YELLOW}⚠️  Warnung: Weniger als 4GB RAM verfügbar. Performance könnte eingeschränkt sein.${NC}"
    fi

    if [ $cpu_cores -lt 2 ]; then
        echo -e "${YELLOW}⚠️  Warnung: Weniger als 2 CPU-Kerne. Clustering wird deaktiviert.${NC}"
    fi

    # Port-Verfügbarkeit prüfen
    local ports=(8080 6379 27017 3478 8081)
    for port in "${ports[@]}"; do
        if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null; then
            echo -e "${YELLOW}⚠️  Port $port ist bereits belegt. Möglicher Konflikt!${NC}"
        fi
    done

    echo -e "${GREEN}✅ Enterprise-Abhängigkeiten geprüft${NC}"
}

install_dependencies() {
    echo -e "${BLUE}📦 Installiere Node.js Abhängigkeiten...${NC}"

    # WebSocket Server Abhängigkeiten
    if [ ! -d "node_modules" ]; then
        npm init -y > /dev/null 2>&1
        npm install ws > /dev/null 2>&1
        echo -e "${GREEN}✅ Node.js Pakete installiert${NC}"
    else
        echo -e "${GREEN}✅ Node.js Pakete bereits installiert${NC}"
    fi
}

start_turn_server() {
    echo -e "${BLUE}🔄 Starte TURN/STUN Server...${NC}"

    # Docker Container starten
    docker-compose up -d turn-server

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ TURN Server gestartet${NC}"
        echo "   TURN Server: turn:localhost:3478"
        echo "   Username: peeruser"
        echo "   Password: peerpass123"
    else
        echo -e "${RED}❌ Fehler beim Starten des TURN Servers${NC}"
        exit 1
    fi
}

start_signaling_server() {
    echo -e "${BLUE}📡 Starte Signaling Server...${NC}"

    # Prüfe ob Port frei ist
    if lsof -Pi :8080 -sTCP:LISTEN -t >/dev/null ; then
        echo -e "${YELLOW}⚠️  Port 8080 ist bereits belegt. Versuche Server zu stoppen...${NC}"
        pkill -f "node server.js" || true
        sleep 2
    fi

    # Server im Hintergrund starten
    nohup node server.js > signaling.log 2>&1 &
    SERVER_PID=$!

    # Warte kurz und prüfe ob Server läuft
    sleep 3
    if ps -p $SERVER_PID > /dev/null; then
        echo -e "${GREEN}✅ Signaling Server gestartet (PID: $SERVER_PID)${NC}"
        echo "   WebSocket: ws://localhost:8080"
        echo "   Monitoring: http://localhost:8080/monitoring"
        echo "   Logs: signaling.log"
    else
        echo -e "${RED}❌ Fehler beim Starten des Signaling Servers${NC}"
        echo "   Prüfe signaling.log für Details"
        exit 1
    fi
}

start_monitoring() {
    echo -e "${BLUE}📊 Starte Monitoring Dashboard...${NC}"

    docker-compose up -d monitoring

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Monitoring Dashboard gestartet${NC}"
        echo "   URL: http://localhost:8081"
    else
        echo -e "${YELLOW}⚠️  Monitoring Dashboard konnte nicht gestartet werden${NC}"
        echo "   Das ist optional - PeerLink funktioniert auch ohne"
    fi
}

show_status() {
    echo ""
    echo -e "${GREEN}🎉 PeerLink System erfolgreich gestartet!${NC}"
    echo ""
    echo -e "${BLUE}📋 System Status:${NC}"
    echo "   Signaling Server: http://localhost:8080/health"
    echo "   TURN Server: curl -f http://localhost:3478"
    echo "   Monitoring: http://localhost:8081"
    echo ""
    echo -e "${BLUE}🌐 PeerLink Anwendung:${NC}"
    echo "   Öffne peerlink.html in deinem Browser"
    echo "   Oder hoste die Datei auf einem Webserver"
    echo ""
    echo -e "${BLUE}⚙️  Konfiguration:${NC}"
    echo "   Signaling URL: ws://localhost:8080"
    echo "   STUN Server: stun:stun.l.google.com:19302"
    echo "   TURN Server: turn:localhost:3478"
    echo "   TURN User: peeruser"
    echo "   TURN Pass: peerpass123"
    echo ""
    echo -e "${YELLOW}🛑 Zum Stoppen:${NC}"
    echo "   ./stop-peerlink.sh"
}

stop_system() {
    echo -e "${BLUE}🛑 Stoppe PeerLink System...${NC}"

    # Signaling Server stoppen
    pkill -f "node server.js" || true

    # Docker Container stoppen
    docker-compose down || true

    echo -e "${GREEN}✅ System gestoppt${NC}"
}

show_help() {
    echo "PeerLink Start-Script"
    echo ""
    echo "Verwendung:"
    echo "  $0 start    - Starte das komplette System"
    echo "  $0 stop     - Stoppe das komplette System"
    echo "  $0 restart  - Neustart des Systems"
    echo "  $0 status   - Zeige Status aller Komponenten"
    echo "  $0 logs     - Zeige Logs des Signaling Servers"
    echo "  $0 help     - Diese Hilfe anzeigen"
    echo ""
    echo "Komponenten:"
    echo "  - TURN/STUN Server (Docker)"
    echo "  - WebRTC Signaling Server (Node.js)"
    echo "  - Monitoring Dashboard (Docker)"
}

show_logs() {
    if [ -f "signaling.log" ]; then
        echo -e "${BLUE}📝 Signaling Server Logs:${NC}"
        tail -n 50 signaling.log
    else
        echo -e "${YELLOW}⚠️  Keine Log-Datei gefunden${NC}"
    fi
}

check_status() {
    echo -e "${BLUE}📊 System Status:${NC}"
    echo ""

    # Signaling Server
    if pgrep -f "node server.js" > /dev/null; then
        echo -e "${GREEN}✅ Signaling Server läuft${NC}"
    else
        echo -e "${RED}❌ Signaling Server gestoppt${NC}"
    fi

    # TURN Server
    if docker ps | grep -q peerlink-turn; then
        echo -e "${GREEN}✅ TURN Server läuft${NC}"
    else
        echo -e "${RED}❌ TURN Server gestoppt${NC}"
    fi

    # Monitoring
    if docker ps | grep -q peerlink-monitoring; then
        echo -e "${GREEN}✅ Monitoring Dashboard läuft${NC}"
    else
        echo -e "${YELLOW}⚠️  Monitoring Dashboard gestoppt${NC}"
    fi
}

# ==========================================
# Hauptprogramm
# ==========================================

case "${1:-start}" in
    "start")
        echo -e "${GREEN}🚀 Starte PeerLink System...${NC}"
        check_dependencies
        install_dependencies
        start_turn_server
        start_signaling_server
        start_monitoring
        show_status
        ;;
    "stop")
        stop_system
        ;;
    "restart")
        echo -e "${GREEN}🔄 Neustart PeerLink System...${NC}"
        stop_system
        sleep 2
        $0 start
        ;;
    "status")
        check_status
        ;;
    "logs")
        show_logs
        ;;
    "help"|"-h"|"--help")
        show_help
        ;;
    *)
        echo -e "${RED}❌ Unbekannter Befehl: $1${NC}"
        echo "Verwende '$0 help' für Hilfe"
        exit 1
        ;;
esac
