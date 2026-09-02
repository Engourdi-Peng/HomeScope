const fs = require('fs');
const content = fs.readFileSync(process.argv[2], 'utf8');
const lines = content.split('\n');
const start = parseInt(process.argv[3]);
const end = parseInt(process.argv[4]);
for (let i = start; i < end && i < lines.length; i++) {
  const lineNum = i + 1;
  console.log(`${lineNum}: ${lines[i]}`);
}