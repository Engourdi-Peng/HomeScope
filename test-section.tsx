function TestComponent() {
  return (
    <section className="report-space-section">
      <div className="report-section">
        <div className="pt-2 sm:pt-2">
          <div className="report-eyebrow text-teal-700 mb-3">Property & Price</div>
          <h2 className="report-display-2 text-stone-900 mb-3 sm:mb-4">Is the Price Fair?</h2>
          {isBasic && (
            <p className="report-caption text-stone-500 mb-8">Based on listing data — condition and market comparison not yet verified.</p>
          )}

          {/* Price block — unified section card */}
          {hasPriceData && (
            <div className="report-paper-muted p-6 md:p-8">
              {/* Estimated Value Range */}
              {(() => {
                const estMin = priceData.find((i) => /min/i.test(i.label))?.value;
                const estMax = priceData.find((i) => /max/i.test(i.label))?.value;
                if (estMin || estMax) {
                  const range = [estMin, estMax].filter(Boolean).join(' – ');
                  return (
                    <div className="mb-6">
                      <div className="report-eyebrow text-teal-700 mb-2">Estimated Value Range</div>
                      <div className="report-data-cell-value">{range}</div>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Asking Price */}
              {(() => {
                const asking = priceData.find((i) =>
                  /asking|list|price/i.test(i.label)
                )?.value;
                if (asking) {
                  return (
                    <div className="mb-6">
                      <div className="report-eyebrow text-stone-500 mb-2">Asking Price</div>
                      <div className="report-data-cell-value">{asking}</div>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Verdict + Confidence row */}
              {(() => {
                const verdict = priceData.find((i) => /verdict|assessment|fair|over|under/i.test(i.label))?.value;
              if (!verdict && !confValue) return null;
              return (
                <div className="report-hairline-bottom pb-4 mb-4 flex items-baseline gap-x-6 gap-y-2 flex-wrap">
                  {verdict && (
                    <>
                      <div className="report-eyebrow text-stone-500">Verdict</div>
                      <div className="report-display-3 text-stone-900">{verdict}</div>
                    </>
                  )}
                  {confValue && (
                    <div className="report-body text-stone-700 ml-auto">
                      Confidence: <span className="font-semibold">{confValue}</span>
                      {confIsLow && <span className="text-amber-700 ml-1">— price may shift with more info</span>}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Analysis paragraph */}
            {(() => {
              if (verdictIsUnknown && analysisText && /reasonable|appears.*fair|good.*value|undervalued/i.test(analysisText)) {
                return (
                  <p className="report-body text-stone-700 leading-relaxed mb-4">
                    Asking price may be within a plausible range based on partial signals, but confidence is low without nearby comparable sales, legal-use verification, rental support, and inspection results.
                  </p>
                );
              }
              if (analysisText) {
                return <p className="report-body text-stone-700 leading-relaxed mb-4">{analysisText}</p>;
              }
              if (confIsLow) {
                return (
                  <p className="report-body text-stone-600 leading-relaxed mb-4">
                    Low confidence means the price may look reasonable on paper, but missing condition details could change the real value.
                  </p>
                );
              }
              return null;
            })()}

            {/* Low confidence explanation — inline callout */}
            {confIsLow && (
              <div className="report-inline-callout mt-4">
                <div className="report-eyebrow text-amber-700 mb-1">Why Price Confidence Is Limited</div>
                <p className="report-body text-stone-700 leading-relaxed">{getPriceConfidenceCopy()}</p>
              </div>
            )}

            {/* Price Confidence box (non-low) */}
            {(() => {
              const conf = priceData.find((i) => /confidence/i.test(i.label) && i.description);
              if (!conf || confIsLow) return null;
              return (
                <div className="report-inline-callout">
                  <div className="report-display-3 text-stone-900 mb-2">Price Confidence: {renderValue(conf.value ?? '')}</div>
                  <p className="report-body text-stone-700 leading-relaxed">{conf.description}</p>
                </div>
              );
            })()}
          </div>
        )}

        {/* Quick Facts — inline hairline list */}
        {hasQuickFacts && (
          <div className="mt-6">
            <div className="report-eyebrow text-stone-500 mb-4">Quick Facts</div>
            <dl className="divide-y divide-stone-200/70 max-w-[640px]">
              {qfItems.map((item, i) => (
                <div key={i} className="py-3 grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1">
                  <dt className="report-body text-stone-600 self-start pt-px">{item.label}</dt>
                  <dd className="report-body font-semibold text-stone-900 text-right leading-relaxed break-words">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}
  );
}