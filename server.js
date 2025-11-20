// Простой HTTP сервер для запуска WebLLM с правильными заголовками
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.woff': 'application/font-woff',
  '.ttf': 'application/font-ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'application/font-otf',
  '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);

  // Устанавливаем критически важные заголовки для WebLLM
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  
  // Для внешних ресурсов (CDN) разрешаем загрузку
  if (req.url.includes('cdn.jsdelivr.net') || req.url.includes('esm.run') || req.url.includes('huggingface.co')) {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }

  let filePath = '.' + req.url;
  if (filePath === './') {
    filePath = './index.html';
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 - File Not Found</h1>', 'utf-8');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`, 'utf-8');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 Сервер запущен на http://localhost:${PORT}`);
  console.log(`📝 Откройте браузер и перейдите по адресу: http://localhost:${PORT}`);
  console.log(`\n⚠️  ВАЖНО: WebLLM требует эти заголовки для работы:`);
  console.log(`   - Cross-Origin-Opener-Policy: same-origin`);
  console.log(`   - Cross-Origin-Embedder-Policy: require-corp`);
  console.log(`\n🛑 Для остановки нажмите Ctrl+C\n`);
});

