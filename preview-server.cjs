const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5176;

const server = http.createServer((req, res) => {
  const filePath = path.join(__dirname, 'report-preview.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end('Error loading preview');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Preview server running at http://127.0.0.1:${PORT}/report-preview.html`);
  console.log('Press Ctrl+C to stop.');
});
