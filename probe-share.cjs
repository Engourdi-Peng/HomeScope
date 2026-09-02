const slug = 'lot-8-sturdivant-island-cumberland-me-04021-sale-analysis-9fcf2223-84fe-4587-96b7-9d4116693868';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRydGVld2dwbGtxaWVkb25vbXpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NzcwMDIsImV4cCI6MjA4ODU1MzAwMn0.1IteG22e3MYfsupkGcER4SkFc1drA15rMH62_u0o-A0';
const url = 'https://trteewgplkqiedonomzg.supabase.co/functions/v1/analyze?action=public&slug=' + encodeURIComponent(slug);

(async () => {
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': 'Bearer ' + anonKey,
      },
    });
    console.log('STATUS', r.status, r.statusText);
    const text = await r.text();
    console.log('LENGTH', text.length);
    // Save full body
    require('fs').writeFileSync('share-response.json', text);
    console.log('Saved share-response.json');
    // Print first 1500 chars
    console.log('--- BODY (first 1500) ---');
    console.log(text.slice(0, 1500));
  } catch (e) {
    console.error('ERR', e.message);
  }
})();
