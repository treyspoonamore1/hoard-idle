// Wraps index.html (page content only) into dev.html, a full HTML document for local testing.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const body = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const out = '<!doctype html><html><head><meta charset=utf-8>' +
  '<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<style>[hidden]{display:none!important}body{margin:0}</style></head><body>\n' +
  body + '\n</body></html>\n';
fs.writeFileSync(path.join(root, 'dev.html'), out);
console.log('wrote dev.html (' + out.length + ' bytes)');
