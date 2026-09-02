const d = JSON.parse(require('fs').readFileSync('share-response.json','utf8'));
const fr = d.analysis.full_result;

function show(name, val, max = 400) {
  console.log('=== ' + name + ' ===');
  if (val === undefined) { console.log('(missing)'); return; }
  console.log(JSON.stringify(val, null, 2).slice(0, max));
  if (JSON.stringify(val).length > max) console.log('... (truncated, full len ' + JSON.stringify(val).length + ')');
}

show('photoReview.areas[0..2]', fr.photoReview?.areas?.slice(0, 2), 700);
show('risk_categories', fr.risk_categories, 800);
show('price_assessment', fr.price_assessment, 400);
show('listing_does_not_prove[0]', fr.listing_does_not_prove?.[0], 400);
show('deeper_due_diligence[0]', fr.deeper_due_diligence?.[0], 400);
show('before_you_book_showing[0]', fr.before_you_book_showing?.[0], 400);
show('inspectionFit', fr.inspectionFit, 300);
show('carrying_costs', fr.carrying_costs, 300);
show('_scoreBreakdown', fr._scoreBreakdown, 200);
show('property_snapshot', fr.property_snapshot, 200);
show('competitionRisk', fr.competitionRisk, 200);
show('listingInfo (keys/images count)', { keys: Object.keys(fr.listingInfo || {}), imageCount: fr.listingInfo?.images?.length }, 200);
