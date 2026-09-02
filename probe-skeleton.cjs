const fs = require('fs');
const t = fs.readFileSync('src/components/report/NewReportUI.tsx', 'utf8');
const lines = t.split(/\r?\n/);
console.log('TOTAL LINES', lines.length);

const out = [];
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  const stripped = l.trim();
  if (
    /^[\s\/*]*={3,}/.test(l) || // ===== banners
    /^[\s\/*]*-{3,}/.test(l) || // ---- banners
    /^\s*\/\* [-=]+\s*[A-Z]/.test(l) ||
    /^\s*\/\/\s*={3,}/.test(l) ||
    /^\s*\/\/ [-=]+\s*[A-Z]/.test(l) ||
    /function\s+[A-Z][A-Za-z]+/.test(stripped) ||
    /^export\s+function/.test(stripped) ||
    /^const\s+[A-Z][A-Za-z]+(:\s*React\.FC|\s*=\s*React\.memo)/.test(stripped) ||
    (/^\s*\/\/\s+[A-Z][^/]{4,80}$/.test(stripped)) ||
    (/^\/\*\*?\s*$/.test(stripped)) ||
    (/^[\s\/*]*#{1,6}\s+/.test(stripped)) ||
    /return\s*\(\s*$/.test(stripped) ||
    /^[\s\/*]*={2,}/.test(stripped) ||
    (/^export\s+default/.test(stripped))
  ) {
    out.push(((i + 1) + '').padStart(5) + '  ' + stripped.slice(0, 110));
  }
}
fs.writeFileSync('newreportui-skeleton.txt', out.join('\n'));
console.log('Kept', out.length, 'markers');
