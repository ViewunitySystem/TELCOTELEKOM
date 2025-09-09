@echo off
REM Test-Server für PeerLink
echo Starte Test-Server...
node -e "
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  console.log('Request:', req.method, req.url);
  
  // Sicherheits-Header
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', \"default-src 'self'; script-src 'self' 'unsafe-inline'; manifest-src 'self' data:;\");
  
  if (req.url === '/' && req.method === 'GET') {
    try {
      const htmlPath = path.join(__dirname, 'peerlink.html');
      console.log('Serving HTML from:', htmlPath);
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(htmlContent);
      return;
    } catch (error) {
      console.error('HTML Error:', error.message);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error loading HTML');
      return;
    }
  }
  
  if (req.url === '/favicon.ico' && req.method === 'GET') {
    try {
      const faviconPath = path.join(__dirname, 'favicon.ico');
      const faviconContent = fs.readFileSync(faviconPath);
      res.writeHead(200, { 'Content-Type': 'image/x-icon' });
      res.end(faviconContent);
      return;
    } catch (error) {
      res.writeHead(404);
      res.end();
      return;
    }
  }
  
  // 404 für alles andere
  res.writeHead(404);
  res.end('Not found');
});

server.listen(8080, () => {
  console.log('Test-Server läuft auf Port 8080');
  console.log('CSP sollte manifest-src erlauben');
});
"
