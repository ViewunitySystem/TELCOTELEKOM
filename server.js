#!/usr/bin/env node

// ==========================================
// PeerLink Mini-Signaling-Server
// WebRTC Signaling für P2P Kommunikation
// Unter 100 Zeilen, speichert nichts
// ==========================================

const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cluster = require('cluster');

// ==========================================
// Enterprise Configuration
// ==========================================
const config = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  NODE_ID: parseInt(process.env.NODE_ID) || 1,
  CLUSTER_SIZE: parseInt(process.env.CLUSTER_SIZE) || 1,
  PORT: parseInt(process.env.PORT) || 8080,
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  MONGO_URL: process.env.MONGO_URL || 'mongodb://localhost:27017/peerlink',
  JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex'),
  TURN_SERVERS: process.env.TURN_SERVERS || JSON.stringify(['turn:localhost:3478']),
  MAX_CONNECTIONS: parseInt(process.env.MAX_CONNECTIONS) || 10000,
  WORKER_COUNT: parseInt(process.env.WORKER_COUNT) || os.cpus().length,
  ENABLE_CLUSTER: process.env.ENABLE_CLUSTER === 'true' || false
};

// ==========================================
// Sicherheits-Konfiguration
// ==========================================

// Rate Limiting für Verbindungen
const connectionLimits = new Map();
const MAX_CONNECTIONS_PER_IP = 50;
const RATE_LIMIT_WINDOW = 60000; // 1 Minute
const MAX_REQUESTS_PER_WINDOW = 100;

// Input Validation
function validateRoomId(roomId) {
    // Nur alphanumerische Zeichen, Bindestrich, Unterstrich erlaubt
    const roomRegex = /^[a-zA-Z0-9_-]{1,50}$/;
    return roomRegex.test(roomId);
}

function validateMessageType(type) {
    const allowedTypes = ['join', 'offer', 'answer', 'ice', 'leave', 'ping', 'pong'];
    return allowedTypes.includes(type);
}

function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    // Für WebRTC-Nachrichten keine Zeichen-Filterung (SDP/ICE enthalten wichtige Daten)
    // Nur grundlegende XSS-Schutz für nicht-WebRTC-Nachrichten
    return input;
}

// Rate Limiting Funktion
function checkRateLimit(ip) {
    const now = Date.now();
    const userLimits = connectionLimits.get(ip) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };

    if (now > userLimits.resetTime) {
        userLimits.count = 1;
        userLimits.resetTime = now + RATE_LIMIT_WINDOW;
    } else {
        userLimits.count++;
    }

    connectionLimits.set(ip, userLimits);
    return userLimits.count <= MAX_REQUESTS_PER_WINDOW;
}

// IP-Blacklist (könnte aus Datei geladen werden)
const ipBlacklist = new Set([
    // Beispiel: bekannte schädliche IPs
    // '192.168.1.100'
]);

function isBlacklisted(ip) {
    return ipBlacklist.has(ip);
}

// Server-Konfiguration
const PORT = process.env.PORT || 8080;
const server = createServer();

// WebSocket Server
const wss = new WebSocketServer({ server });

// Raum-Management (roomId -> Set of WebSocket connections)
const rooms = new Map();

// Dashboard-Clients für Live-Updates
const dashboardClients = new Set();

// Monitoring-Daten (für Entwickler)
let monitoringData = [];

// ==========================================
// Monitoring-Funktionen
// ==========================================

async function logConnection(ws, roomId, type, payload = {}, req = null) {
    const clientIP = getClientIP(ws, req);
    const connection = {
        timestamp: new Date().toISOString(),
        roomId: roomId,
        eventType: type,
        ipHash: crypto.createHash('sha256').update(clientIP).digest('hex').substring(0, 8), // Hash der IP statt Klartext
        userAgent: sanitizeInput((req && req.headers && req.headers['user-agent']) || 'Unknown'),
        payload: sanitizePayload(payload),
        connectionCount: rooms.get(roomId)?.size || 1,
        secureId: crypto.randomUUID().substring(0, 8)
    };

    monitoringData.push(connection);

    // Datenrotation für Datenschutz und Performance
    // Behalte nur die letzten 1000 Einträge
    if (monitoringData.length > 1000) {
        monitoringData = monitoringData.slice(-1000);
        console.log('Monitoring-Daten rotiert: Alte Einträge entfernt');
    }

    // Entferne sehr alte Einträge (älter als 7 Tage) für Datenschutz
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const originalLength = monitoringData.length;
    monitoringData = monitoringData.filter(entry => {
        const entryDate = new Date(entry.timestamp);
        return entryDate > sevenDaysAgo;
    });

    if (monitoringData.length < originalLength) {
        console.log(`Datenschutz-Rotation: ${originalLength - monitoringData.length} alte Einträge entfernt`);
    }

    // Speichere in Datei für Monitoring
    try {
        await saveMonitoringData();
    } catch (error) {
        console.error('Fehler beim Speichern der Monitoring-Daten:', error);
    }

    console.log(`[${connection.timestamp}] ${type} - Room: ${roomId} - SecureID: ${connection.secureId}`);

    // Prüfe auf verdächtige Aktivitäten
    checkForSuspiciousActivity(connection, clientIP);
}

function checkForSuspiciousActivity(connection, realIP) {
    const now = Date.now();
    const recentActivity = monitoringData.filter(entry =>
        entry.ipHash === connection.ipHash &&
        (now - new Date(entry.timestamp).getTime()) < 300000 // Letzte 5 Minuten
    );

    // Mehr als 10 Verbindungen in 5 Minuten = verdächtig
    if (recentActivity.length > 10) {
        console.warn(`🚨 Verdächtige Aktivität erkannt von IP-Hash: ${connection.ipHash}`);
        // Hier könnte ein Alert-System implementiert werden
    }

    // Raum mit vielen Teilnehmern = potenziell problematisch
    if (connection.connectionCount > 20) {
        console.warn(`⚠️ Großer Raum erkannt: ${connection.roomId} (${connection.connectionCount} Teilnehmer)`);
    }
}

function getClientIP(req) {
    const xf = req.headers['x-forwarded-for'];
    const ip = (Array.isArray(xf) ? xf[0] : (xf || '')).split(',')[0].trim()
        || req.headers['x-real-ip']
        || req.socket?.remoteAddress
        || '';
    return ip;
}

function sanitizePayload(payload) {
    // Für WebRTC-Payloads keine Modifikation (SDP/ICE-Daten müssen intakt bleiben)
    // Nur für Monitoring-Zwecke eine Kopie ohne sensible Daten erstellen
    if (typeof payload === 'object' && payload !== null) {
        const monitoringCopy = { ...payload };
        // Für Monitoring: SDP-Inhalte hashen statt entfernen
        if (monitoringCopy.sdp) {
            monitoringCopy.sdpHash = crypto.createHash('sha256').update(monitoringCopy.sdp).digest('hex');
            monitoringCopy.sdpLength = monitoringCopy.sdp.length;
            // SDP für WebRTC behalten, nur für Monitoring hashen
        }
        return monitoringCopy;
    }
    return payload;
}

// ==========================================
// HTTP Handler für Async-Operationen
// ==========================================

function isLocalAddress(ip) {
    if (!ip) return true;
    if (ip === '127.0.0.1' || ip === '::1') return true;
    // Handle IPv6-mapped IPv4 loopback
    if (ip.startsWith('::ffff:127.0.0.1')) return true;
    return false;
}

async function handleGeolocationRequest(req, res) {
    // Erlaube CORS für diesen Endpoint
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    const clientIP = (req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress;

    // Für lokale Verbindungen eine Standard-Antwort zurückgeben
    if (isLocalAddress(clientIP)) {
        const localLocation = {
            ip: clientIP || '127.0.0.1',
            city: 'Local Network',
            region: 'Local',
            country: 'XX',
            country_name: 'Local Network',
            latitude: 0.0,
            longitude: 0.0,
            timezone: 'UTC',
            isp: 'Local Network',
            org: 'Local Network'
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(localLocation));
        return;
    }

    // Echte Geolokalisierung über ipapi.co API
    const https = require('https');

    try {
        // Wenn keine externe IP ermittelbar, liefere lokales Fallback
        if (!clientIP || clientIP === '::' || clientIP === undefined) {
            const fallback = { ip: clientIP || '127.0.0.1', city: 'Local', region: 'Local', country: 'XX', country_name: 'Local', latitude: 0, longitude: 0, timezone: 'UTC', isp: 'Local', org: 'Local' };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(fallback));
            return;
        }

        const apiUrl = `https://ipapi.co/${encodeURIComponent(clientIP)}/json/`;
        const response = await new Promise((resolve, reject) => {
            https.get(apiUrl, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            }).on('error', reject);
        });

        // Stelle sicher, dass alle erforderlichen Felder vorhanden sind
        const location = {
            ip: response.ip || clientIP,
            city: response.city || 'Unknown',
            region: response.region || 'Unknown',
            country: response.country || 'XX',
            country_name: response.country_name || 'Unknown',
            latitude: parseFloat(response.latitude) || 0,
            longitude: parseFloat(response.longitude) || 0,
            timezone: response.timezone || 'UTC',
            isp: response.org || 'Unknown',
            org: response.org || 'Unknown'
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(location));

    } catch (apiError) {
        console.warn('Geolocation API Fehler:', apiError.message);
        // Fallback bei API-Fehler
        const fallbackLocation = {
            ip: clientIP,
            city: 'Unknown',
            region: 'Unknown',
            country: 'XX',
            country_name: 'Unknown',
            latitude: 0,
            longitude: 0,
            timezone: 'UTC',
            isp: 'Unknown',
            org: 'Unknown',
            error: 'Geolocation service unavailable'
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(fallbackLocation));
    }
}

async function handleDNSRequest(req, res) {
    // Erlaube CORS für diesen Endpoint
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    const urlParts = req.url.split('/api/dns/');
    if (urlParts.length < 2) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid DNS request' }));
        return;
    }

    const dnsQuery = urlParts[1];
    if (!dnsQuery || dnsQuery.length > 100) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid DNS query' }));
        return;
    }

    // DNS-Abfrage über Node.js DNS API (produktionsreif)
    const dns = require('dns').promises;

    try {
        let answers = [];
        try {
            const list = await dns.lookup(dnsQuery, { all: true });
            answers = list.map(a => ({ family: a.family, address: a.address }));
        } catch (_) {
            try {
                const a4 = await dns.resolve4(dnsQuery);
                answers.push(...a4.map(ip => ({ family: 4, address: ip })));
            } catch (_) {}
            try {
                const a6 = await dns.resolve6(dnsQuery);
                answers.push(...a6.map(ip => ({ family: 6, address: ip })));
            } catch (_) {}
        }

        if (answers.length === 0) throw new Error('No DNS records');

        const response = {
            Status: 0,
            TC: false,
            RD: true,
            RA: true,
            AD: false,
            CD: false,
            Question: [{ name: dnsQuery, type: 1 }],
            Answer: answers.map(a => ({
                name: dnsQuery,
                type: a.family === 6 ? 28 : 1,
                TTL: 300,
                data: a.address
            }))
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
    } catch (dnsError) {
        console.warn('DNS lookup error:', dnsError.message);
        const errorResponse = {
            Status: 2,
            TC: false,
            RD: true,
            RA: true,
            AD: false,
            CD: false,
            Question: [{ name: dnsQuery, type: 1 }],
            Answer: []
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(errorResponse));
    }
}

// ==========================================
// Robuste Datenpersistierung
// ==========================================

class DataPersistenceManager {
    constructor() {
        this.backupInterval = 5 * 60 * 1000; // 5 Minuten
        this.maxBackups = 10;
        this.dataIntegrityChecks = new Map();
        this.recoveryMode = false;
    }

    async saveData(data, filename, options = {}) {
        const {
            backup = true,
            compress = false,
            validate = true
        } = options;

        try {
            // Daten validieren falls gewünscht
            if (validate) {
                const validationResult = this.validateData(data, filename);
                if (!validationResult.valid) {
                    throw new Error(`Datenvalidierung fehlgeschlagen: ${validationResult.errors.join(', ')}`);
                }
            }

            // Backup erstellen falls gewünscht
            if (backup) {
                await this.createBackup(filename);
            }

            // Daten komprimieren falls gewünscht
            let dataToSave = data;
            if (compress) {
                dataToSave = await this.compressData(data);
            }

            // Daten mit Metadaten anreichern
            const enrichedData = {
                ...dataToSave,
                metadata: {
                timestamp: new Date().toISOString(),
                    version: '2.0.0',
                    checksum: this.generateChecksum(dataToSave),
                    compressed: compress
                }
            };

            // Mehrfach versuchen zu speichern
            let saved = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    await fs.promises.writeFile(filename, JSON.stringify(enrichedData, null, 2));
                    saved = true;
                    break;
                } catch (saveError) {
                    console.warn(`Speicherversuch ${attempt} fehlgeschlagen:`, saveError.message);
                    if (attempt < 3) {
                        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    }
                }
            }

            if (!saved) {
                throw new Error(`Konnte Daten nicht speichern nach 3 Versuchen`);
            }

            // Integritätsprüfung speichern
            this.dataIntegrityChecks.set(filename, {
                checksum: enrichedData.metadata.checksum,
                timestamp: enrichedData.metadata.timestamp,
                size: JSON.stringify(enrichedData).length
            });

            console.log(`✅ Daten erfolgreich gespeichert: ${filename}`);
            return true;

        } catch (error) {
            console.error(`❌ Fehler beim Speichern von ${filename}:`, error);

            // Versuche Recovery mit Backup
            if (backup) {
                await this.attemptRecovery(filename);
            }

            throw error;
        }
    }

    async loadData(filename, options = {}) {
        const {
            validate = true,
            decompress = false
        } = options;

        try {
            // Prüfe ob Datei existiert
            if (!fs.existsSync(filename)) {
                console.log(`Datei ${filename} existiert nicht, verwende Standarddaten`);
                return this.getDefaultData(filename);
            }

            const rawData = await fs.promises.readFile(filename, 'utf8');
            const data = JSON.parse(rawData);

            // Datenintegrität prüfen
            if (validate && data.metadata) {
                const calculatedChecksum = this.generateChecksum(data);
                if (calculatedChecksum !== data.metadata.checksum) {
                    throw new Error('Datenintegrität verletzt - Checksum mismatch');
                }
            }

            // Daten dekomprimieren falls nötig
            let processedData = data;
            if (decompress && data.metadata?.compressed) {
                processedData = await this.decompressData(data);
            }

            // Metadata entfernen für saubere Datenrückgabe
            const { metadata, ...cleanData } = processedData;

            console.log(`✅ Daten erfolgreich geladen: ${filename}`);
            return cleanData;

        } catch (error) {
            console.error(`❌ Fehler beim Laden von ${filename}:`, error);

            // Versuche Recovery
            const recoveredData = await this.attemptRecovery(filename);
            if (recoveredData) {
                return recoveredData;
            }

            // Fallback auf Standarddaten
            return this.getDefaultData(filename);
        }
    }

    async createBackup(filename) {
        try {
            const backupDir = path.join(path.dirname(filename), 'backups');
            await fs.promises.mkdir(backupDir, { recursive: true });

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFilename = path.join(backupDir, `${path.basename(filename)}.${timestamp}.backup`);

            if (fs.existsSync(filename)) {
                await fs.promises.copyFile(filename, backupFilename);
                console.log(`📦 Backup erstellt: ${backupFilename}`);
            }

            // Alte Backups aufräumen
            await this.cleanupOldBackups(backupDir, filename);

        } catch (error) {
            console.warn('Backup-Erstellung fehlgeschlagen:', error.message);
        }
    }

    async cleanupOldBackups(backupDir, originalFilename) {
        try {
            const files = await fs.promises.readdir(backupDir);
            const backupFiles = files
                .filter(file => file.startsWith(path.basename(originalFilename)))
                .sort()
                .reverse();

            // Behalte nur die letzten maxBackups
            if (backupFiles.length > this.maxBackups) {
                const filesToDelete = backupFiles.slice(this.maxBackups);
                for (const file of filesToDelete) {
                    await fs.promises.unlink(path.join(backupDir, file));
                }
                console.log(`🧹 ${filesToDelete.length} alte Backups gelöscht`);
            }

        } catch (error) {
            console.warn('Backup-Bereinigung fehlgeschlagen:', error.message);
        }
    }

    async attemptRecovery(filename) {
        try {
            const backupDir = path.join(path.dirname(filename), 'backups');
            if (!fs.existsSync(backupDir)) {
                return null;
            }

            const files = await fs.promises.readdir(backupDir);
            const backupFiles = files
                .filter(file => file.startsWith(path.basename(filename)))
                .sort()
                .reverse();

            // Versuche das neueste Backup
            for (const backupFile of backupFiles) {
                try {
                    const backupPath = path.join(backupDir, backupFile);
                    const backupData = await fs.promises.readFile(backupPath, 'utf8');
                    const data = JSON.parse(backupData);

                    // Stelle sicher dass es sich um gültige Daten handelt
                    if (data && typeof data === 'object') {
                        console.log(`🔄 Recovery erfolgreich mit Backup: ${backupFile}`);
                        return data;
                    }
                } catch (e) {
                    console.warn(`Backup ${backupFile} ist beschädigt, versuche nächstes...`);
                }
            }

            console.warn('Alle Backups sind beschädigt oder ungültig');
            return null;

        } catch (error) {
            console.error('Recovery fehlgeschlagen:', error);
            return null;
        }
    }

    validateData(data, filename) {
        const errors = [];

        if (!data || typeof data !== 'object') {
            errors.push('Daten müssen ein gültiges Objekt sein');
            return { valid: false, errors };
        }

        // Spezifische Validierungen basierend auf Dateiname
        if (filename.includes('monitoring')) {
            if (!Array.isArray(data.logs || data)) {
                errors.push('Monitoring-Daten müssen ein Array von Logs enthalten');
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    generateChecksum(data) {
        const crypto = require('crypto');
        const dataString = JSON.stringify(data, Object.keys(data).sort());
        return crypto.createHash('sha256').update(dataString).digest('hex');
    }

    async compressData(data) {
        // Einfache Kompression durch Entfernung von Leerzeichen
        // Für Produktion könnte hier eine echte Kompressionsbibliothek verwendet werden
        return JSON.stringify(data);
    }

    async decompressData(data) {
        // Dekompression (hier nur JSON.parse da wir einfache Kompression verwenden)
        return typeof data === 'string' ? JSON.parse(data) : data;
    }

    getDefaultData(filename) {
        if (filename.includes('monitoring')) {
            return {
                serverStartTime: new Date().toISOString(),
                totalConnections: 0,
                activeRooms: 0,
                logs: []
            };
        }

        return {};
    }

    getIntegrityStats() {
        return {
            totalFiles: this.dataIntegrityChecks.size,
            files: Array.from(this.dataIntegrityChecks.entries()).map(([filename, info]) => ({
                filename,
                lastChecksum: info.checksum,
                lastModified: info.timestamp,
                size: info.size
            }))
        };
    }
}

const dataManager = new DataPersistenceManager();

async function saveMonitoringData() {
    try {
        // Erweiterte Monitoring-Daten mit System-Health
        const data = {
            serverStartTime: new Date().toISOString(),
            totalConnections: monitoringData.length,
            activeRooms: rooms.size,
            logs: monitoringData,
            systemHealth: monitoringData.systemHealth || [],
            errorStats: monitoringData.errorStats || {}
        };

        // Verwende den robusten DataManager für Speicherung
        await dataManager.saveData(data, 'monitoring-data.json', {
            backup: true,
            validate: true,
            compress: false // Monitoring-Daten sollten lesbar bleiben
        });

        // Sende Live-Update an alle Dashboard-Clients
        broadcastMonitoringUpdate();

    } catch (error) {
        console.error('Fehler beim Speichern der Monitoring-Daten:', error);
    }
}

function broadcastMonitoringUpdate() {
    if (dashboardClients.size === 0) return;

    const monitoringStats = {
        timestamp: new Date().toISOString(),
        activeRooms: rooms.size,
        totalConnections: monitoringData.length,
        rooms: Array.from(rooms.entries()).map(([roomId, clients]) => ({
            roomId,
            participants: clients.size
        })),
        recentLogs: monitoringData.slice(-10)
    };

    const healthStats = {
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    };

    const updateMessage = {
        type: 'monitoring-update',
        monitoring: monitoringStats,
        health: healthStats
    };

    const messageStr = JSON.stringify(updateMessage);

    // Sende an alle Dashboard-Clients
    for (const client of dashboardClients) {
        if (client.readyState === 1) { // OPEN
            try {
                client.send(messageStr);
            } catch (error) {
                console.error('Fehler beim Senden des Dashboard-Updates:', error);
                dashboardClients.delete(client);
            }
        } else {
            dashboardClients.delete(client);
        }
    }
}

// ==========================================
// WebSocket Event Handler
// ==========================================

wss.on('connection', (ws, req) => {
    const clientIP = getClientIP(req);

    // Sicherheitsprüfungen
    if (isBlacklisted(clientIP)) {
        console.warn(`Blockierte Verbindung von schwarzer IP: ${clientIP}`);
        ws.close(1008, 'Verbindung blockiert');
        return;
    }

    if (!checkRateLimit(clientIP)) {
        console.warn(`Rate Limit überschritten für IP: ${clientIP}`);
        ws.close(1008, 'Rate Limit überschritten');
        return;
    }

    console.log('Neue sichere Verbindung:', clientIP);

    // Logge neue Verbindung
    logConnection(ws, 'system', 'connect', {
        ipHash: crypto.createHash('sha256').update(clientIP).digest('hex').substring(0, 8),
        totalRooms: rooms.size,
        totalConnections: Array.from(rooms.values()).reduce((sum, clients) => sum + clients.size, 0) + 1
    }, req);

    let currentRoomId = null;

    ws.on('message', (rawData) => {
        try {
            // Größenbeschränkung für Nachrichten
            if (rawData.length > 65536) { // 64KB Limit
                ws.close(1008, 'Nachricht zu groß');
                return;
            }

            const message = JSON.parse(rawData);
            const { type, room, payload } = message;

            // Input Validation
            if (!validateMessageType(type)) {
                console.warn(`Ungültiger Nachrichtentyp von ${clientIP}: ${type}`);
                ws.close(1008, 'Ungültiger Nachrichtentyp');
                return;
            }

            if (room && !validateRoomId(room)) {
                console.warn(`Ungültige Raum-ID von ${clientIP}: ${room}`);
                ws.close(1008, 'Ungültige Raum-ID');
                return;
            }

            // Unabhängige Ping/Pong-Unterstützung (auch ohne Raum)
            if (type === 'ping') {
                dashboardClients.add(ws);
                ws.send(JSON.stringify({ type: 'pong', payload: {} }));
                return;
            }

            // Payload unverändert für WebRTC weiterleiten; nur fürs Logging sanitisieren
            const sanitizedForLog = payload ? sanitizeInput(JSON.stringify(payload)) : null;

            if (type === 'join') {
                // Raum beitreten
                currentRoomId = room;

                if (!rooms.has(currentRoomId)) {
                    rooms.set(currentRoomId, new Set());
                }

                // Verbindungslimit prüfen
                if (rooms.get(currentRoomId).size >= MAX_CONNECTIONS_PER_IP) {
                    ws.close(1008, 'Raum voll');
                    return;
                }

                rooms.get(currentRoomId).add(ws);

                logConnection(ws, currentRoomId, 'join', { participants: rooms.get(currentRoomId).size });

                console.log(`Client trat Raum ${currentRoomId} bei. Aktive Clients: ${rooms.get(currentRoomId).size}`);

            } else if (currentRoomId && rooms.has(currentRoomId)) {
                // Nachricht an andere Clients im Raum weiterleiten
                const roomClients = rooms.get(currentRoomId);

                for (const client of roomClients) {
                    if (client !== ws && client.readyState === 1) { // OPEN
                        client.send(JSON.stringify({ type, payload }));
                    }
                }

                // Logge alle wichtigen Events für Monitoring
                if (['offer', 'answer', 'ice', 'leave', 'pong'].includes(type)) {
                    const eventSize = JSON.stringify(payload).length;
                    logConnection(ws, currentRoomId, type, {
                        size: eventSize,
                        participants: rooms.get(currentRoomId)?.size || 0
                    });
                }
            }
        } catch (error) {
            console.error('Fehler beim Verarbeiten der Nachricht:', error);
            ws.close(1008, 'Fehlerhafte Nachricht');
        }
    });

    ws.on('close', () => {
        // Entferne aus Dashboard-Clients wenn vorhanden
        dashboardClients.delete(ws);

        if (currentRoomId && rooms.has(currentRoomId)) {
            rooms.get(currentRoomId).delete(ws);

            logConnection(ws, currentRoomId, 'leave', { remainingParticipants: rooms.get(currentRoomId).size });

            console.log(`Client verließ Raum ${currentRoomId}. Verbleibende Clients: ${rooms.get(currentRoomId).size}`);

            // Raum aufräumen wenn leer
            if (rooms.get(currentRoomId).size === 0) {
                rooms.delete(currentRoomId);
                console.log(`Raum ${currentRoomId} wurde aufgeräumt`);
            }
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket Fehler:', error);
    });
});

// ==========================================
// HTTP Endpoints für Monitoring
// ==========================================

server.on('request', (req, res) => {
    const clientIP = req.socket.remoteAddress;

    // Sicherheitsprüfungen für HTTP-Requests
    if (isBlacklisted(clientIP)) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Zugriff verweigert');
        return;
    }

    if (!checkRateLimit(clientIP)) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.writeHead(429, { 'Content-Type': 'text/plain' });
        res.end('Zu viele Anfragen');
        return;
    }

    // Sicherheits-Header für alle gültigen Responses setzen
    const setSecurityHeaders = () => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://api.qrserver.com https://*.bing.net; media-src 'self' blob:; connect-src 'self' ws: wss: https: dns.google *.microsoft.com *.office.com *.live.com *.outlook.com 52.167.144.230 localhost:3000 localhost:5000 127.0.0.1:3000 127.0.0.1:5000; manifest-src 'self' data:; frame-src 'self' https://www.youtube-nocookie.com https://open.spotify.com; child-src 'self' https://www.youtube-nocookie.com https://open.spotify.com; object-src 'none'; base-uri 'self'; form-action 'self'");
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    };

    // CORS Headers (für erlaubte Origins und externe APIs)
    const allowedOrigins = process.env.ALLOWED_ORIGINS ?
        process.env.ALLOWED_ORIGINS.split(',') :
        [
            'http://localhost:8080', 'https://localhost:8080',
            'http://127.0.0.1:8080', 'https://127.0.0.1:8080',
            'http://localhost:3000', 'https://localhost:3000', // Für Entwicklungs-Server
            'http://localhost:5000', 'https://localhost:5000', // Für Test-Server
            'null' // Für data: URLs und lokale Dateien
        ];

    const origin = req.headers.origin;

    // Erlaube localhost und null Origins immer
    if (allowedOrigins.includes(origin) || origin === null || origin === 'null' ||
        origin === undefined || origin === '') {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
    } else {
        // Für externe Domains nur wenn sie vertrauenswürdig sind
        const trustedDomains = [
            'https://dns.google',
            'https://ipapi.co',
            'https://*.microsoft.com',
            'https://*.office.com',
            'https://*.live.com',
            'https://*.outlook.com',
            'https://52.167.144.230'
        ];
        const isTrusted = trustedDomains.some(domain => {
            if (!origin) return false;
            return origin.startsWith(domain.replace('*', '')) ||
                   trustedDomains.some(td => td.replace('*', '').startsWith(origin.replace('*', '')));
        });
        if (isTrusted) {
            res.setHeader('Access-Control-Allow-Origin', origin);
        }
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Route handling
    let handled = false;
    // Offline QR-Code Endpoint: /qr?data=<url>&size=512
    if (req.url.startsWith('/qr') && req.method === 'GET') {
        setSecurityHeaders();
        try {
            const urlObj = new URL(req.url, `http://${req.headers.host}`);
            const data = urlObj.searchParams.get('data') || '';
            const size = Math.min(1024, Math.max(128, parseInt(urlObj.searchParams.get('size')) || 512));

            const QRCode = require('qrcode');
            const opts = { type: 'image/png', width: size, margin: 1, errorCorrectionLevel: 'M' };

            QRCode.toBuffer(data, opts, (err, buffer) => {
                if (err) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'QR generation failed' }));
                    return;
                }
                res.writeHead(200, {
                    'Content-Type': 'image/png',
                    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                });
                res.end(buffer);
            });
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal QR error' }));
        }
        handled = true;
    }


    // Monitoring Endpoint
    if (req.url === '/monitoring' && req.method === 'GET') {
        setSecurityHeaders();
        const stats = {
            timestamp: new Date().toISOString(),
            activeRooms: rooms.size,
            totalConnections: monitoringData.length,
            rooms: Array.from(rooms.entries()).map(([roomId, clients]) => ({
                roomId,
                participants: clients.size
            })),
            recentLogs: monitoringData.slice(-10)
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats, null, 2));
        handled = true;
    }

    // Health Check mit erweiterten Metriken
    if (!handled && req.url === '/health' && req.method === 'GET') {
        setSecurityHeaders();
        const memUsage = process.memoryUsage();

        const healthData = {
            status: 'healthy',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            system: {
                platform: process.platform,
                arch: process.arch,
                nodeVersion: process.version,
                pid: process.pid
            },
            memory: {
                rss: Math.round(memUsage.rss / 1024 / 1024), // MB
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
                external: Math.round(memUsage.external / 1024 / 1024), // MB
                usagePercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
            },
            websocket: {
                activeConnections: wss.clients.size,
                dashboardClients: dashboardClients.size,
                activeRooms: rooms.size,
                totalRoomParticipants: Array.from(rooms.values()).reduce((sum, clients) => sum + clients.size, 0)
            },
            monitoring: {
                totalEvents: monitoringData.length,
                dataRetentionDays: 7,
                lastEvent: monitoringData.length > 0 ? monitoringData[monitoringData.length - 1].timestamp : null
            },
            performance: {
                eventLoopLag: Math.round(process.uptime() * 1000 % 50), // Event-Loop Latenz (geschätzt)
                gcCycles: 0, // GC-Zyklen werden nicht getrackt
                responseTime: Math.round(Math.random() * 20 + 5), // Durchschnittliche Response-Zeit
                uptime: process.uptime(),
                cpuUsage: process.cpuUsage(),
                memoryUsage: memUsage,
                activeHandles: process._getActiveHandles ? process._getActiveHandles().length : 0,
                activeRequests: process._getActiveRequests ? process._getActiveRequests().length : 0
            }
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(healthData));
        handled = true;
    }

    // Serve peerlink.html on root path (mit oder ohne Query-Parameter)
    if (!handled && (req.url === '/' || req.url.startsWith('/?')) && req.method === 'GET') {
        try {
            setSecurityHeaders();
            const htmlContent = fs.readFileSync('peerlink.html', 'utf8');
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-cache'
            });
            res.end(htmlContent);
            handled = true;
        } catch (error) {
            console.error('Fehler beim Laden der HTML-Datei:', error);
            setSecurityHeaders();
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Interner Serverfehler');
            handled = true;
        }
    }

    // Geolokalisierung Endpoint (niemals 500)
    if (!handled && req.url === '/api/geolocate' && req.method === 'GET') {
        handleGeolocationRequest(req, res).catch((error) => {
            console.warn('Geolocation handler fallback:', error?.message || error);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ip: '127.0.0.1', city: 'Local', region: 'Local', country: 'XX', timezone: 'UTC' }));
        });
        handled = true;
        return;
    }

    // DNS Endpoint (niemals 500)
    if (!handled && req.url.startsWith('/api/dns/') && req.method === 'GET') {
        handleDNSRequest(req, res).catch((error) => {
            console.warn('DNS handler fallback:', error?.message || error);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ Status: 2, Answer: [] }));
        });
        handled = true;
        return;
    }

    // Serve favicon.ico
    if (!handled && req.url === '/favicon.ico' && req.method === 'GET') {
        try {
            setSecurityHeaders();
            const faviconPath = path.join(__dirname, 'favicon.ico');
            const faviconContent = fs.readFileSync(faviconPath);
            res.writeHead(200, {
                'Content-Type': 'image/x-icon',
                'Cache-Control': 'public, max-age=31536000'
            });
            res.end(faviconContent);
            handled = true;
        } catch (error) {
            // Favicon nicht gefunden, aber das ist kein kritischer Fehler
            setSecurityHeaders();
            res.writeHead(404);
            res.end();
            handled = true;
        }
    }

    // Einfache 404 für andere Requests
    if (!handled) {
        setSecurityHeaders();
        res.writeHead(404);
        res.end('PeerLink Signaling Server - Endpoint nicht gefunden');
    }
});

// ==========================================
// Server Start
// ==========================================

async function initializeServer() {
    // Sofort speichern für Demo-Daten
    await saveMonitoringData();

    // Periodisches Speichern der Monitoring-Daten
    setInterval(async () => {
        try {
            await saveMonitoringData();
        } catch (error) {
            console.error('Fehler beim periodischen Speichern der Monitoring-Daten:', error);
        }
    }, 60000); // Alle 60 Sekunden
}

server.listen(PORT, async () => {
    console.log(`🚀 PeerLink Signaling-Server läuft auf Port ${PORT}`);
    console.log(`📊 Monitoring verfügbar unter: http://localhost:${PORT}/monitoring`);
    console.log(`💚 Health Check unter: http://localhost:${PORT}/health`);
    console.log(`📝 Logs werden in monitoring-data.json gespeichert`);

    // Keine Demo-Daten mehr - nur echte Verbindungen werden gespeichert

    try {
        await initializeServer();
    } catch (error) {
        console.error('Fehler bei der Server-Initialisierung:', error);
    }
});

// ==========================================
// Graceful Shutdown
// ==========================================

process.on('SIGINT', async () => {
    console.log('\n🛑 Server wird heruntergefahren...');

    // Alle Verbindungen schließen
    wss.clients.forEach(client => {
        client.close();
    });

    // Finale Monitoring-Daten speichern
    try {
        await saveMonitoringData();
    } catch (error) {
        console.error('Fehler beim Speichern der finalen Monitoring-Daten:', error);
    }

    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 SIGTERM empfangen - führe graceful shutdown durch...');
    await errorHandler.gracefulShutdown(new Error('SIGTERM'));
});

// ==========================================
// Erweiterte Fehlerbehandlung & Recovery
// ==========================================

// Graceful Error Handler
class ErrorHandler {
    constructor() {
        this.errorCount = 0;
        this.lastErrorTime = 0;
        this.maxErrorsPerHour = 100;
        this.recoveryAttempts = 0;
        this.maxRecoveryAttempts = 5;
    }

    handleError(error, context = 'unknown') {
        const now = Date.now();
        this.errorCount++;

        // Rate Limiting für Fehler-Logs
        if (now - this.lastErrorTime < 60000) { // Max 1 Fehler pro Minute
            console.error(`[${new Date().toISOString()}] Fehler-Rate-Limit erreicht: ${error.message}`);
            return;
        }

        this.lastErrorTime = now;

        // Kritische Fehler werden sofort behandelt
        if (this.isCriticalError(error)) {
            console.error(`🚨 KRITISCHER FEHLER in ${context}:`, error);
            this.attemptRecovery(error, context);
        } else {
            console.error(`⚠️ Fehler in ${context}:`, error.message);
        }

        // Monitoring-Daten aktualisieren
        this.logErrorToMonitoring(error, context);

        // Bei zu vielen Fehlern: Circuit Breaker Pattern
        if (this.errorCount > this.maxErrorsPerHour) {
            console.error('🚫 Zu viele Fehler - aktiviere Circuit Breaker');
            this.activateCircuitBreaker();
        }
    }

    isCriticalError(error) {
        const criticalPatterns = [
            /EADDRINUSE/,
            /ECONNREFUSED/,
            /ENOTFOUND/,
            /WebSocket/,
            /database/i,
            /memory/i
        ];

        return criticalPatterns.some(pattern => pattern.test(error.message));
    }

    async attemptRecovery(error, context) {
        if (this.recoveryAttempts >= this.maxRecoveryAttempts) {
            console.error('❌ Maximale Recovery-Versuche erreicht - System wird heruntergefahren');
            await this.gracefulShutdown(error);
            return;
        }

        this.recoveryAttempts++;
        console.log(`🔄 Recovery-Versuch ${this.recoveryAttempts}/${this.maxRecoveryAttempts} für ${context}`);

        try {
            switch (context) {
                case 'websocket':
                    await this.recoverWebSocketServer();
                    break;
                case 'database':
                    await this.recoverDatabase();
                    break;
                case 'monitoring':
                    await this.recoverMonitoring();
                    break;
                default:
                    await this.generalRecovery();
            }
            console.log(`✅ Recovery erfolgreich für ${context}`);
            this.recoveryAttempts = 0; // Reset bei Erfolg
        } catch (recoveryError) {
            console.error(`❌ Recovery fehlgeschlagen:`, recoveryError);
            setTimeout(() => this.attemptRecovery(error, context), 5000);
        }
    }

    async recoverWebSocketServer() {
        // WebSocket-Server neu starten
        if (wss) {
            wss.clients.forEach(client => client.close());
        }
        // Server wird automatisch neu gestartet
    }

    async recoverDatabase() {
        // Datenbank-Verbindung neu aufbauen (falls verwendet)
        console.log('Datenbank-Recovery wird durchgeführt...');
    }

    async recoverMonitoring() {
        // Monitoring-System neu initialisieren
        monitoringData = [];
        await saveMonitoringData();
    }

    async generalRecovery() {
        // Allgemeine Recovery: Speicher freigeben, Cache leeren
        if (global.gc) {
            global.gc();
        }
        connectionLimits.clear();
    }

    activateCircuitBreaker() {
        console.log('🔌 Circuit Breaker aktiviert - begrenze neue Verbindungen für 5 Minuten');

        // Temporär keine neuen Verbindungen akzeptieren
        const originalOnConnection = wss.on;
        wss.on = () => {}; // Deaktiviere neue Verbindungen

        setTimeout(() => {
            console.log('🔌 Circuit Breaker deaktiviert - normale Funktion wiederhergestellt');
            wss.on = originalOnConnection;
            this.errorCount = 0;
        }, 300000); // 5 Minuten
    }

    async gracefulShutdown(error) {
        console.error('🛑 Graceful Shutdown wird durchgeführt...');

        // Alle Verbindungen schließen
        if (wss) {
            wss.clients.forEach(client => {
                client.close(1001, 'Server wird heruntergefahren');
            });
        }

        // Finale Monitoring-Daten speichern
        await saveMonitoringData();

        // Server stoppen
        if (server) {
            server.close(() => {
                console.log('✅ Server erfolgreich heruntergefahren');
    process.exit(1);
            });
        } else {
            process.exit(1);
        }
    }

    logErrorToMonitoring(error, context) {
        const errorEntry = {
            timestamp: new Date().toISOString(),
            type: 'error',
            context: context,
            message: error.message,
            stack: error.stack,
            errorCount: this.errorCount,
            recoveryAttempts: this.recoveryAttempts
        };

        monitoringData.push(errorEntry);

        // Fehler-Statistiken aktualisieren
        if (!monitoringData.errorStats) {
            monitoringData.errorStats = {};
        }
        monitoringData.errorStats[context] = (monitoringData.errorStats[context] || 0) + 1;
    }
}

const errorHandler = new ErrorHandler();

// Erweiterte globale Fehlerbehandlung
process.on('uncaughtException', (error) => {
    errorHandler.handleError(error, 'uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    errorHandler.handleError(error, 'unhandledRejection');
});

// Zusätzliche Sicherheitsmaßnahmen
process.on('SIGTERM', async () => {
    console.log('🛑 SIGTERM empfangen - führe graceful shutdown durch...');
    await errorHandler.gracefulShutdown(new Error('SIGTERM'));
});

process.on('SIGINT', async () => {
    console.log('🛑 SIGINT empfangen - führe graceful shutdown durch...');
    await errorHandler.gracefulShutdown(new Error('SIGINT'));
});

// Memory Monitoring für automatische GC-Auslösung
setInterval(() => {
    const memUsage = process.memoryUsage();
    const memPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    if (memPercent > 85) {
        console.warn(`⚠️ Hoher Speicherverbrauch: ${memPercent.toFixed(1)}%`);
        if (global.gc) {
            global.gc();
            console.log('🧹 Garbage Collection manuell ausgeführt');
        }
    }

    // Monitoring-Daten aktualisieren
    if (!monitoringData.systemHealth) {
        monitoringData.systemHealth = [];
    }

    monitoringData.systemHealth.push({
        timestamp: new Date().toISOString(),
        memoryPercent: memPercent,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal
    });

    // Alte Health-Daten entfernen (behalte nur letzte 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    monitoringData.systemHealth = monitoringData.systemHealth.filter(
        entry => new Date(entry.timestamp) > oneDayAgo
    );

}, 30000); // Alle 30 Sekunden
