const fs = require('fs');
const path = 'e:/cursor/HomeScope/src/index.css';
const lines = fs.readFileSync(path, 'utf-8').split('\n');

// Find where the real content starts - look for 'button:hover,'
let realStart = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('button:hover,')) { realStart = i; break; }
}
console.log('realStart:', realStart, JSON.stringify(lines[realStart]));

// The real content starts at realStart (button:hover)
// From realStart to end is the tail
const tail = lines.slice(realStart);

// Build the new index.css
const head = [
  '@import "tailwindcss";',
  '@import "../shared/report/reportStyles.css";',
  '',
  '/* Google Fonts loaded via <link> in index.html (preconnect + stylesheet) */',
  '',
  '/* Report design system tokens, components, and animations now live in',
  '   src/shared/report/reportStyles.css and are imported above so that the',
  '   web app and the browser extension render reports identically. */',
  '',
  ':root {',
  '  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
  '  line-height: 1.5;',
  '  font-weight: 400;',
  '}',
  '',
  'body {',
  '  margin: 0;',
  '  min-height: 100vh;',
  '  background-color: #FAF8F3;',
  '  color: #1e293b;',
  '}',
  '',
  '* {',
  '  box-sizing: border-box;',
  '}',
  '',
  '/* ─────────────────────────────────────────────────────────────',
  '   App-level base styles + animations + article prose styles',
  '   (Report design system tokens/components/animations now live in',
  '    src/shared/report/reportStyles.css and are imported at the top.)',
  '   ───────────────────────────────────────────────────────────── */',
  '',
].join('\n');

const newContent = head + tail.join('\n');
fs.writeFileSync(path, newContent, 'utf-8');
console.log('New length:', newContent.split('\n').length);
console.log('Done!');

// Verify first 15 lines
const newLines = fs.readFileSync(path, 'utf-8').split('\n');
console.log('\nFirst 15 lines:');
for (let i = 0; i < 15; i++) {
  console.log(i + ': ' + JSON.stringify(newLines[i]));
}
