import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, 'extension', 'content.js');
let code = fs.readFileSync(filePath, 'utf8');

// 保存原始行数用于对比
const originalLines = code.split('\n').length;

// 策略：逐行处理，删除包含 console.log 的行（但不删除 console.warn/error/info）
const lines = code.split('\n');
const cleaned = lines.filter(line => {
  const trimmed = line.trim();
  // 如果是空行或注释，保留
  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('*/') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('#')) {
    return true;
  }
  // 如果包含 console.log，删除（但保留 console.warn, console.error, console.info, console.debug）
  if (/console\.log\s*\(/.test(line) && !/console\.(warn|error|info|debug)\s*\(/.test(line)) {
    return false;
  }
  return true;
});

const cleanedCode = cleaned.join('\n');
fs.writeFileSync(filePath, cleanedCode);

const remainingLogs = (cleanedCode.match(/console\.log\s*\(/g) || []).length;
const remainingWarn = (cleanedCode.match(/console\.warn\s*\(/g) || []).length;
const remainingError = (cleanedCode.match(/console\.error\s*\(/g) || []).length;

console.log(`✅ Content.js 清理完成！`);
console.log(`   移除行数: ${originalLines - cleaned.length} 行`);
console.log(`   剩余 console.log: ${remainingLogs}`);
console.log(`   保留 console.warn: ${remainingWarn}`);
console.log(`   保留 console.error: ${remainingError}`);
