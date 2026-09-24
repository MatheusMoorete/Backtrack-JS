#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const args = process.argv.slice(2);
let port = 5173;

let isExplicitPort = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' || args[i] === '-p') {
    port = parseInt(args[i + 1], 10) || 5173;
    isExplicitPort = true;
  }
}

const viewerDir = path.resolve(__dirname, '../dist/viewer');

if (!fs.existsSync(viewerDir)) {
  console.error('\x1b[31m[Backtrack]\x1b[0m Viewer build not found at dist/viewer.');
  console.error('Please run "npm run build" in @backtrack/browser first.');
  process.exit(1);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function createServerInstance() {
  return http.createServer((req, res) => {
    // CORS permissivo para uso local e integração com ferramentas de desenvolvimento
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const reqUrl = req.url.split('?')[0];
    let safePath = path.normalize(reqUrl).replace(/^(\.\.[\/\\])+/, '');
    let filePath = path.join(viewerDir, safePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
      // SPA fallback
      filePath = path.join(viewerDir, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
}

const os = require('os');

function start(targetPort) {
  const server = createServerInstance();

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      if (!isExplicitPort && targetPort < 5190) {
        console.log(`\x1b[33m[Backtrack]\x1b[0m Porta ${targetPort} ocupada, tentando porta ${targetPort + 1}...`);
        start(targetPort + 1);
      } else {
        console.error(`\x1b[31m[Backtrack]\x1b[0m A porta ${targetPort} já está em uso.`);
        console.error(`Tente passar outra porta com: npm run viewer -- --port <porta>`);
        process.exit(1);
      }
    } else {
      console.error('\x1b[31m[Backtrack]\x1b[0m Erro no servidor:', err.message || err);
      process.exit(1);
    }
  });

  server.listen(targetPort, '0.0.0.0', () => {
    const url = `http://localhost:${targetPort}`;
    console.log('\n\x1b[36m[Backtrack Viewer]\x1b[0m');
    console.log(`  > Local:   \x1b[32m${url}\x1b[0m`);

    // Detecta o IP da máquina na rede local Wi-Fi / Ethernet
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`  > Network: \x1b[32mhttp://${net.address}:${targetPort}\x1b[0m`);
        }
      }
    }

    console.log('  > Ready to inspect incidents. Pressione Ctrl+C para encerrar.\n');

    // Tenta abrir o navegador automaticamente
    const startCmd =
      process.platform === 'darwin'
        ? `open "${url}"`
        : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;

    exec(startCmd, () => {
      // Ignora erros ao abrir automaticamente
    });
  });
}

start(port);
