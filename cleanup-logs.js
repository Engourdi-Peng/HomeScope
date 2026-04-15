const fs = require('fs');

const filePath = 'extension/background.js';
let content = fs.readFileSync(filePath, 'utf8');

// 删除所有 console.log 行（不包括 console.warn、console.error、console.info）
// 匹配 console.log( 但排除 console.log 后面的 warn、error、info
const logLineRegex = /^\s*console\.log\([^;]*;\s*$/gm;

const originalLines = content.split('\n');
const cleanedLines = originalLines.filter(line => !logLineRegex.test(line));

// 同时清理行内尾部的 console.log 语句（如果一行有多个语句）
const cleanedContent = cleanedLines.join('\n').replace(/;[^;]*console\.log\([^;]*/g, '');

fs.writeFileSync(filePath, cleanedContent);
console.log('Cleaned background.js - removed console.log statements');

// 验证结果
const remainingLogs = (cleanedContent.match(/console\.(log|debug|info)\s*\(/g) || []).length;
const remainingWarn = (cleanedContent.match(/console\.warn\s*\(/g) || []).length;
const remainingError = (cleanedContent.match(/console\.error\s*\(/g) || []).length;
console.log(`Remaining console.log/info/debug: ${remainingLogs}`);
console.log(`Remaining console.warn: ${remainingWarn}`);
console.log(`Remaining console.error: ${remainingError}`);
