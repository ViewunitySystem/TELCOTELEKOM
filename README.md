# 🔗 PeerLink - Sichere P2P Kommunikation

**Eine einzige HTML-Datei für Text, Audio und Video - ohne externe Abhängigkeiten!**

PeerLink ist ein ultraleichtes Peer-to-Peer Kommunikationssystem, das direkt im Browser läuft. Kein Build-Prozess, keine komplexen Installationen - einfach die HTML-Datei öffnen und loslegen!

## ✨ Features

- **🎯 Eine Datei**: Komplette Anwendung in einer einzigen HTML-Datei
- **🔒 Ende-zu-Ende verschlüsselt**: WebRTC mit DTLS-SRTP
- **📱 PWA-fähig**: Installierbar als App auf Desktop/Mobile
- **🎥 Multi-Modi**: Text-Chat, Audio- und Video-Konferenzen
- **🔧 Konfigurierbar**: STUN/TURN/Signaling direkt im Programm einstellbar
- **📓 Telefonbuch**: Verbindungs-Tagebuch mit Notizen und Medien-Speicher
- **📊 Entwickler-Monitoring**: Separate Monitoring-Datei für Statistiken
- **🌐 Minimaler Aufwand**: Automatischer Verbindungsaufbau mit QR-Codes

## 🚀 Schnellstart

### Option 1: Automatisch (Empfohlen)

```bash
# Klone Repository oder lade Dateien herunter
# Starte alles mit einem Befehl
./start-peerlink.sh start
```

### Option 2: Manuell

1. **TURN-Server starten**:
   ```bash
   docker-compose up -d turn-server
   ```

2. **Signaling-Server starten**:
   ```bash
   npm install ws
   node server.js
   ```

3. **PeerLink öffnen**:
   - Öffne `peerlink.html` in deinem Browser
   - Konfiguriere bei Bedarf die Server-Einstellungen

## 📁 Projekt-Struktur

```
peerlink/
├── peerlink.html          # Haupt-PWA-Anwendung
├── monitoring.html        # Entwickler-Monitoring-Dashboard
├── server.js              # WebRTC Signaling-Server
├── docker-compose.yml     # TURN-Server Setup
├── start-peerlink.sh      # Automatischer Start
├── stop-peerlink.sh       # System stoppen
└── README.md             # Diese Datei
```

## 🔧 Konfiguration

### Automatische Konfiguration

Die Anwendung erkennt automatisch lokale Server:
- **Signaling**: `ws://localhost:8080`
- **STUN**: `stun:stun.l.google.com:19302`
- **TURN**: `turn:localhost:3478` (peeruser/peerpass123)

### Manuelle Konfiguration

1. Öffne `peerlink.html`
2. Klicke auf **"⚙️ Konfiguration"**
3. Passe die Server-URLs an deine Bedürfnisse an
4. **"💾 Speichern"** klicken

## 🎯 Verwendung

### Für Benutzer

1. **PeerLink öffnen**: `peerlink.html` im Browser öffnen
2. **Modus wählen**: Text 💬, Audio 🎤 oder Video 📹
3. **Link teilen**: QR-Code oder Link kopieren und an Kontakte senden
4. **Verbinden**: Alle öffnen den gleichen Link und sind automatisch verbunden

### Verbindungs-Tagebuch

- **📓 Automatisch**: Jede Verbindung wird gespeichert
- **📝 Notizen**: Füge persönliche Notizen zu Verbindungen hinzu
- **💾 Medien**: Speichere Screenshots oder Aufzeichnungen
- **🔍 Suchen**: Finde frühere Verbindungen schnell

## 📊 Entwickler-Monitoring

### Separate Monitoring-Datei

Öffne `monitoring.html` für detaillierte Statistiken:

- **📈 Live-Statistiken**: Aktive Verbindungen, IP-Adressen, Geo-Location
- **🌍 Geo-Karte**: Visuelle Darstellung der Nutzer-Standorte
- **📋 Detaillierte Logs**: Zeitstempel, Browser-Info, Verbindungsdaten
- **📤 Export**: JSON/CSV/GeoJSON Export für Analysen
- **🔄 Auto-Refresh**: Automatische Updates alle 30 Sekunden

### Server-Monitoring

Der Signaling-Server sammelt automatisch:
- IP-Adressen und Geo-Location
- Verbindungszeiten und -dauern
- Browser/User-Agent Informationen
- Raum-Statistiken und Teilnehmerzahlen

## 🛠️ Technische Details

### WebRTC Architektur

- **Signaling**: WebSocket-basierter Server für SDP/ICE Austausch
- **NAT-Traversal**: STUN + TURN für Firewall-Umgehung
- **Verschlüsselung**: DTLS-SRTP für Audio/Video, DataChannels für Text
- **Skalierung**: P2P-Mesh für bis zu 6 Teilnehmer

### Sicherheit

- **E2E-Verschlüsselung**: Medienebene vollständig verschlüsselt
- **Keine Logs**: Signaling-Server speichert keine Inhalte
- **HTTPS-Empfehlung**: Für Produktionsumgebungen HTTPS verwenden
- **CORS-Konfiguration**: Nur vertrauenswürdige Domains erlauben

### Browser-Support

- ✅ Chrome 72+
- ✅ Firefox 66+
- ✅ Safari 12+
- ✅ Edge 79+
- ✅ Mobile Safari/iOS Safari

## 🌐 Deployment

### Lokale Entwicklung

```bash
# Klone Repository
git clone <repository-url>
cd peerlink

# Starte System
./start-peerlink.sh start

# Öffne http://localhost:8080 für PeerLink
# Öffne monitoring.html für Monitoring
```

### Produktions-Deployment

#### Option 1: Statisches Hosting
```bash
# Lade peerlink.html auf einen Webserver
# Beispiel: Apache, Nginx, GitHub Pages, Netlify
cp peerlink.html /var/www/html/
```

#### Option 2: Vollständiges System
```bash
# Deploy Signaling + TURN Server
# Verwende Docker Compose in Produktion
docker-compose up -d

# PeerLink-Datei auf HTTPS-Hosting deployen
# Konfiguriere Produktions-URLs in der App
```

#### Option 3: Cloud-Deployment

**Signaling-Server**:
- **Fly.io**: `fly deploy`
- **Railway**: Git-Push Deployment
- **Vercel**: Serverless Functions
- **Cloudflare Workers**: Edge-Computing

**TURN-Server**:
- **AWS EC2** mit Docker
- **DigitalOcean Droplet**
- **Google Cloud Run**

## 🔧 Erweiterte Konfiguration

### TURN-Server Anpassen

```yaml
# docker-compose.yml
environment:
  - TURN_REALM=your-domain.com
  - TURN_USER=your-user
  - TURN_PASSWORD=your-secure-password
```

### Signaling-Server Konfiguration

```javascript
// server.js - Anpassungen
const PORT = process.env.PORT || 8080;
const MONITORING_ENABLED = process.env.MONITORING === 'true';
```

### PWA-Manifest Anpassen

```json
{
  "name": "Dein PeerLink",
  "short_name": "PeerLink",
  "description": "Deine P2P Kommunikation",
  "theme_color": "#2563eb"
}
```

## 📈 Monitoring & Analytics

### Automatische Datensammlung

Der Signaling-Server sammelt automatisch:
- Verbindungszeiten und -dauern
- IP-Adressen (anonymisiert)
- Geo-Location (mit User-Einwilligung)
- Browser und Geräte-Informationen
- Raum-Statistiken

### Datenschutz

- **Keine Speicherung von Inhalten**: Nur Metadaten
- **IP-Anonymisierung**: Optional verfügbar
- **Geo-Daten**: Nur mit User-Einwilligung
- **Lokale Speicherung**: Daten bleiben auf dem Gerät

## 🐛 Fehlerbehebung

### Häufige Probleme

**Verbindung schlägt fehl:**
```bash
# TURN-Server Status prüfen
docker-compose logs turn-server

# Signaling-Server testen
curl http://localhost:8080/health
```

**Audio/Video funktioniert nicht:**
- Browser-Berechtigungen prüfen
- HTTPS für Produktion verwenden
- Firewall-Einstellungen prüfen

**PWA installiert sich nicht:**
- HTTPS-Verbindung erforderlich
- Service-Worker muss verfügbar sein
- Manifest muss korrekt konfiguriert sein

### Logs & Debugging

```bash
# Signaling-Server Logs
tail -f signaling.log

# Docker Logs
docker-compose logs -f

# Browser Console für Client-Debugging
```

## 📄 Lizenz & Rechtliches

### Rechtliche Hinweise

- **WebRTC/VoIP**: Privatnutzung in EU/Deutschland legal
- **Datenschutz**: DSGVO-konform, minimale Datenhaltung
- **Aufzeichnung**: Nur mit Zustimmung aller Teilnehmer
- **Verschlüsselung**: E2E, keine Server-seitige Entschlüsselung

### Open Source

Dieses Projekt ist Open Source und kann frei verwendet werden. Bei kommerzieller Nutzung bitte den Autor kontaktieren.

## 🤝 Mitwirken

### Entwicklung

```bash
# Abhängigkeiten installieren
npm install

# Entwicklungsserver starten
npm run dev

# Tests ausführen
npm test
```

### Beitragen

1. Fork das Repository
2. Erstelle einen Feature-Branch
3. Committe deine Änderungen
4. Push zum Branch
5. Erstelle einen Pull Request

## 📞 Support

### Dokumentation
- [WebRTC Spezifikation](https://webrtc.org/)
- [TURN-Server Setup](https://github.com/coturn/coturn)
- [WebSocket RFC](https://tools.ietf.org/html/rfc6455)

### Community
- GitHub Issues für Bug-Reports
- Pull Requests für Verbesserungen
- Email für direkten Support

---

## 🎉 Los geht's!

**1. Starte das System:**
```bash
./start-peerlink.sh start
```

**2. Öffne PeerLink:**
```
http://localhost:8080/peerlink.html
```

**3. Verbinde dich:**
Teile den Link oder QR-Code mit deinen Kontakten!

**Happy communicating! 🚀**

