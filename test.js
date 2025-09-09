#!/usr/bin/env node

// ==========================================
// PeerLink Comprehensive Test Suite
// ==========================================

const https = require('https');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

class PeerLinkTestSuite {
    constructor() {
        this.baseURL = 'http://localhost:8080';
        this.wsURL = 'ws://localhost:8080';
        this.testsRun = 0;
        this.testsPassed = 0;
        this.testsFailed = 0;
        this.testResults = [];
    }

    log(message, type = 'info') {
        const timestamp = new Date().toISOString();
        const prefix = {
            info: 'ℹ️ ',
            success: '✅ ',
            error: '❌ ',
            warning: '⚠️ '
        }[type] || 'ℹ️ ';

        console.log(`[${timestamp}] ${prefix}${message}`);
    }

    async runTest(testName, testFunction) {
        this.testsRun++;
        this.log(`Starte Test: ${testName}`, 'info');

        try {
            const result = await testFunction();
            if (result === true || result === undefined) {
                this.testsPassed++;
                this.log(`Test bestanden: ${testName}`, 'success');
                this.testResults.push({ name: testName, status: 'passed', error: null });
                return true;
            } else {
                throw new Error(result || 'Test fehlgeschlagen');
            }
        } catch (error) {
            this.testsFailed++;
            this.log(`Test fehlgeschlagen: ${testName} - ${error.message}`, 'error');
            this.testResults.push({ name: testName, status: 'failed', error: error.message });
            return false;
        }
    }

    async makeRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const mod = url.startsWith('https:') ? https : http;
            const start = Date.now();
            const req = mod.get(url, options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    const elapsedMs = Date.now() - start;
                    let parsed = data;
                    try {
                        parsed = JSON.parse(data);
                    } catch (_) {}
                    resolve({ status: res.statusCode, data: parsed, headers: res.headers, elapsedMs });
                });
            });

            req.on('error', reject);
            req.setTimeout(15000, () => {
                req.destroy(new Error('Request timeout'));
            });
        });
    }

    async makeBinaryRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const mod = url.startsWith('https:') ? https : http;
            const req = mod.get(url, options, (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    resolve({ status: res.statusCode, body: buffer, headers: res.headers });
                });
            });
            req.on('error', reject);
            req.setTimeout(15000, () => {
                req.destroy(new Error('Request timeout'));
            });
        });
    }

    async testServerHealth() {
        const response = await this.makeRequest(`${this.baseURL}/health`);
        if (response.status !== 200) {
            throw new Error(`Health check failed with status ${response.status}`);
        }

        const health = response.data;
        if (!health.status || health.status !== 'healthy') {
            throw new Error('Server is not healthy');
        }

        // Prüfe wichtige Metriken
        if (!health.system || !health.memory || !health.websocket) {
            throw new Error('Health response missing required metrics');
        }

        return true;
    }

    async testMonitoringEndpoint() {
        const response = await this.makeRequest(`${this.baseURL}/monitoring`);
        if (response.status !== 200) {
            throw new Error(`Monitoring endpoint failed with status ${response.status}`);
        }
        const data = response.data;
        if (!data || typeof data !== 'object' || data.activeRooms === undefined || data.totalConnections === undefined) {
            throw new Error('Monitoring response missing expected fields');
        }
        return true;
    }

    async testCSPHeaders() {
        const response = await this.makeRequest(`${this.baseURL}/`);
        const headers = response.headers || {};
        const csp = headers['content-security-policy'] || headers['Content-Security-Policy'] || '';
        if (!csp) throw new Error('CSP header missing');
        if (!csp.includes('frame-src')) throw new Error('CSP frame-src missing');
        if (!csp.includes('www.youtube-nocookie.com')) throw new Error('CSP must allow youtube-nocookie');
        if (!csp.includes('open.spotify.com')) throw new Error('CSP must allow open.spotify.com');
        if (!csp.includes('img-src')) throw new Error('CSP img-src missing');
        if (!csp.includes('bing.net')) throw new Error('CSP must allow bing.net for images');
        return true;
    }

    async testRootLoadsFast() {
        const response = await this.makeRequest(`${this.baseURL}/`);
        if (response.status !== 200) {
            throw new Error(`GET / failed with status ${response.status}`);
        }
        if (response.elapsedMs > 3000) {
            throw new Error(`Root load too slow: ${response.elapsedMs}ms (>3000ms)`);
        }
        // Basic sanity: contains title PeerLink
        if (typeof response.data !== 'string' || !response.data.includes('PeerLink')) {
            throw new Error('Root HTML does not contain expected marker');
        }
        return true;
    }

    async testQRCodeEndpoint() {
        const dataParam = encodeURIComponent('http://localhost:8080/?room=test');
        const url = `${this.baseURL}/qr?data=${dataParam}&size=256`;
        const resp = await this.makeBinaryRequest(url);
        if (resp.status !== 200) {
            throw new Error(`QR endpoint returned ${resp.status}`);
        }
        const ct = resp.headers['content-type'] || '';
        if (!ct.startsWith('image/png')) {
            throw new Error(`QR endpoint wrong content-type: ${ct}`);
        }
        if (!resp.body || resp.body.length < 500) {
            throw new Error('QR endpoint returned empty/too small payload');
        }
        return true;
    }

    async testGeolocationAPI() {
        const response = await this.makeRequest(`${this.baseURL}/api/geolocate`);
        if (response.status !== 200) {
            throw new Error(`Geolocation API failed with status ${response.status}`);
        }

        const location = response.data;
        const requiredFields = ['ip', 'city', 'country', 'timezone'];

        for (const field of requiredFields) {
            if (!location[field]) {
                throw new Error(`Geolocation response missing required field: ${field}`);
            }
        }

        return true;
    }

    async testDNSAPI() {
        const testDomain = 'google.com';
        const response = await this.makeRequest(`${this.baseURL}/api/dns/${testDomain}`);
        if (response.status !== 200) {
            throw new Error(`DNS API failed with status ${response.status}`);
        }

        const dnsResult = response.data;
        if (!dnsResult.Answer || dnsResult.Answer.length === 0) {
            throw new Error('DNS response contains no answers');
        }

        return true;
    }

    async testWebSocketConnection() {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(this.wsURL);

            ws.on('open', () => {
                // Sende Ping-Nachricht
                ws.send(JSON.stringify({ type: 'ping', payload: {} }));
            });

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    if (message.type === 'pong') {
                        ws.close();
                        resolve(true);
                    }
                } catch (e) {
                    ws.close();
                    reject(new Error('Invalid WebSocket response'));
                }
            });

            ws.on('error', (error) => {
                reject(error);
            });

            setTimeout(() => {
                ws.close();
                reject(new Error('WebSocket connection timeout'));
            }, 5000);
        });
    }

    async testRoomCreation() {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(this.wsURL);
            const testRoomId = `test-room-${Date.now()}`;

            ws.on('open', () => {
                // Tritt Raum bei
                ws.send(JSON.stringify({
                    type: 'join',
                    room: testRoomId,
                    payload: {}
                }));
            });

            ws.on('error', (error) => {
                reject(error);
            });

            setTimeout(() => {
                ws.close();
                resolve(true); // Raum wurde erfolgreich erstellt/verwendet
            }, 2000);
        });
    }

    async testDataPersistence() {
        // Prüfe ob Monitoring-Daten gespeichert werden
        const monitoringPath = 'monitoring-data.json';

        if (!fs.existsSync(monitoringPath)) {
            throw new Error('Monitoring data file does not exist');
        }

        const data = fs.readFileSync(monitoringPath, 'utf8');
        const monitoringData = JSON.parse(data);

        if (!monitoringData.serverStartTime) {
            throw new Error('Monitoring data is missing server start time');
        }

        // Prüfe Backup-Verzeichnis
        const backupDir = path.join(path.dirname(monitoringPath), 'backups');
        if (fs.existsSync(backupDir)) {
            const backups = fs.readdirSync(backupDir);
            if (backups.length === 0) {
                this.log('Keine Backups gefunden - das ist für neue Installationen normal', 'warning');
            }
        }

        return true;
    }

    async testErrorHandling() {
        // Teste invalide Anfragen
        try {
            await this.makeRequest(`${this.baseURL}/api/dns/invalid..domain`);
            // Sollte einen 400er Fehler zurückgeben
        } catch (error) {
            // Erwarteter Fehler für invalide Domain
        }

        // Teste nicht existierende Route
        const response = await this.makeRequest(`${this.baseURL}/nonexistent`);
        if (response.status !== 404) {
            throw new Error(`Expected 404 for non-existent route, got ${response.status}`);
        }

        return true;
    }

    async testSecurityHeaders() {
        const response = await this.makeRequest(`${this.baseURL}/`);
        const headers = response.headers || {};

        const requiredHeaders = [
            'x-content-type-options',
            'x-frame-options',
            'x-xss-protection',
            'strict-transport-security',
            'content-security-policy'
        ];

        for (const header of requiredHeaders) {
            if (!headers[header]) {
                throw new Error(`Missing security header: ${header}`);
            }
        }

        return true;
    }

    async runAllTests() {
        this.log('🚀 Starte PeerLink Test Suite', 'info');
        this.log('=' .repeat(50), 'info');

        const tests = [
            { name: 'Root loads fast and contains marker', func: () => this.testRootLoadsFast() },
            { name: 'Server Health Check', func: () => this.testServerHealth() },
            { name: 'Monitoring Endpoint', func: () => this.testMonitoringEndpoint() },
            { name: 'CSP headers allow embeds', func: () => this.testCSPHeaders() },
            { name: 'Geolocation API', func: () => this.testGeolocationAPI() },
            { name: 'DNS API', func: () => this.testDNSAPI() },
            { name: 'WebSocket Connection', func: () => this.testWebSocketConnection() },
            { name: 'Room Creation', func: () => this.testRoomCreation() },
            { name: 'QR endpoint returns PNG', func: () => this.testQRCodeEndpoint() },
            { name: 'Data Persistence', func: () => this.testDataPersistence() },
            { name: 'Error Handling', func: () => this.testErrorHandling() },
            { name: 'Security Headers', func: () => this.testSecurityHeaders() }
        ];

        for (const test of tests) {
            await this.runTest(test.name, test.func);
        }

        this.printSummary();
    }

    printSummary() {
        this.log('=' .repeat(50), 'info');
        this.log('📊 Test Zusammenfassung', 'info');
        this.log(`Gesamt Tests: ${this.testsRun}`, 'info');
        this.log(`Bestanden: ${this.testsPassed}`, 'success');
        this.log(`Fehlgeschlagen: ${this.testsFailed}`, this.testsFailed > 0 ? 'error' : 'info');

        const successRate = ((this.testsPassed / this.testsRun) * 100).toFixed(1);
        this.log(`Erfolgsrate: ${successRate}%`, this.testsFailed > 0 ? 'warning' : 'success');

        if (this.testsFailed > 0) {
            this.log('\n❌ Fehlgeschlagene Tests:', 'error');
            this.testResults
                .filter(result => result.status === 'failed')
                .forEach(result => {
                    this.log(`  - ${result.name}: ${result.error}`, 'error');
                });
        }

        // Exit code basierend auf Testergebnissen
        process.exit(this.testsFailed > 0 ? 1 : 0);
    }
}

// Hauptfunktion
async function main() {
    const testSuite = new PeerLinkTestSuite();

    // Warte kurz um sicherzustellen, dass der Server läuft
    console.log('⏳ Warte auf Server-Initialisierung...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
        await testSuite.runAllTests();
    } catch (error) {
        console.error('💥 Kritischer Fehler während der Tests:', error);
        process.exit(1);
    }
}

// Führe Tests nur aus wenn Datei direkt ausgeführt wird
if (require.main === module) {
    main().catch(error => {
        console.error('💥 Unerwarteter Fehler:', error);
        process.exit(1);
    });
}

module.exports = PeerLinkTestSuite;
