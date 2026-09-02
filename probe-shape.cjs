const d = JSON.parse(require('fs').readFileSync('share-response.json','utf8'));
const fr = d.analysis.full_result;
console.log('=== FIELDS WITH CONTENT ===');
for (const [k, v] of Object.entries(fr)) {
  if (v === null || v === undefined) continue;
  if (Array.isArray(v) && v.length === 0) continue;
  if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
  if (typeof v === 'string' && v.trim() === '') continue;
  let summary;
  if (Array.isArray(v)) summary = '[' + v.length + ']';
  else if (typeof v === 'object') summary = JSON.stringify(v).slice(0, 100);
  else summary = String(v).slice(0, 140);
  console.log(k, '=>', summary);
}
