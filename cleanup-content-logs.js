const fs = require('fs');

// 读取文件
const filePath = 'extension/content.js';
let code = fs.readFileSync(filePath, 'utf8');

// 使用正则删除所有 console.log 调用（但保留 console.warn/error）
// 匹配 console.log 的各种调用形式
const originalLogCount = (code.match(/console\.log\s*\(/g) || []).length;

// 删除 console.log( 语句
code = code.replace(/console\.log\s*\([^;)]*;[^)]*\)/g, '');  // 多行或复杂语句
code = code.replace(/console\.log\s*\([^;]*?\);?\s*$/gm, '');  // 单行语句
code = code.replace(/console\.log\s*\([^)]*\)/g, '');  // 通用

// 清理多余的空行
code = code.replace(/\n{3,}/g, '\n\n');

fs.writeFileSync(filePath, code);

const remainingLogs = (code.match(/console\.log\s*\(/g) || []).length;
const remainingWarn = (code.match(/console\.warn\s*\(/g) || []).length;
const remainingError = (code.match(/console\.error\s*\(/g) || []).length;

console.log(`清理完成！`);
console.log(`原 console.log 数量: ${originalLogCount}`);
console.log(`剩余 console.log: ${remainingLogs}`);
console.log(`保留 console.warn: ${remainingWarn}`);
console.log(`保留 console.error: ${remainingError}`);
