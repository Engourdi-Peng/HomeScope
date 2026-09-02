const fs = require('fs');
const content = fs.readFileSync('src/components/report/NewReportUI.tsx', 'utf8');
const lines = content.split('\n');
const line = lines[1671]; // 1672 - 1
console.log('Length:', line.length);
console.log('Char at 50:', JSON.stringify(line[49]));
console.log('Around col 45-60:');
for (let i = 45; i < 60; i++) {
  if (i < line.length) {
    console.log(`  col ${i + 1}: ${JSON.stringify(line[i])} (${line.charCodeAt(i)})`);
  }
}