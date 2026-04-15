const fs = require('fs');

const filePath = 'extension/content.js';
let content = fs.readFileSync(filePath, 'utf8');

// 删除独立的 console.log 行（不包括 console.warn、console.error）
const lines = content.split('\n');
const cleanedLines = [];
let inMultiLine = false;
let multiLineBuffer = [];

for (let i = 0; i < lines.length; i++) {
  let line = lines[i];

  // 处理多行语句
  if (inMultiLine) {
    multiLineBuffer.push(line);
    if (line.includes(';') || line.includes('}') || line.includes(')')) {
      const combined = multiLineBuffer.join('\n');
      // 检查是否包含 console.log（保留 warn/error）
      if (!/console\.log\s*\(/.test(combined) || /console\.(warn|error)\s*\(/.test(combined)) {
        cleanedLines.push(combined);
      }
      inMultiLine = false;
      multiLineBuffer = [];
    }
    continue;
  }

  // 检测多行开始（不完整语句）
  const trimmed = line.trim();
  if (!trimmed.endsWith(';') && !trimmed.endsWith('}') && !trimmed.endsWith(')') && !trimmed.endsWith(',') && (trimmed.includes('console.log') || /log\s*\(/.test(trimmed))) {
    inMultiLine = true;
    multiLineBuffer = [line];
    continue;
  }

  // 单行语句：跳过 console.log 调用（但保留 warn/error/info/debug）
  if (/console\.log\s*\(/.test(line) && !/console\.(warn|error|info|debug)\s*\(/.test(line)) {
    continue; // 跳过
  }

  cleanedLines.push(line);
}

const cleanedContent = cleanedLines.join('\n');

fs.writeFileSync(filePath, cleanedContent);
console.log('Cleaned content.js');

// 验证
const remainingLogs = (cleanedContent.match(/console\.log\s*\(/g) || []).length;
console.log(`Remaining console.log calls: ${remainingLogs}`);
