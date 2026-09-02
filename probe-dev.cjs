const url = 'http://127.0.0.1:5175/share/lot-8-sturdivant-island-cumberland-me-04021-sale-analysis-9fcf2223-84fe-4587-96b7-9d4116693868';
(async () => {
  const r = await fetch(url);
  const t = await r.text();
  console.log('STATUS', r.status);
  console.log('LENGTH', t.length);
  console.log('--- snippet ---');
  console.log(t.slice(0, 800));
})();
