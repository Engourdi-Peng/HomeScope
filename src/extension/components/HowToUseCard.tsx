// @ts-nocheck — chrome global type not in tsconfig.libs (pre-existing errors suppressed)

const STEPS = [
  'Open Zillow or realestate.com.au',
  'Open a property listing',
  'Click Basic or Deep Analysis',
  'Review your report',
] as const;

export function HowToUseCard() {
  return (
    <div className="ext-how-to-use">
      <p className="ext-how-to-use-title">How to use</p>
      <ol className="ext-how-to-use-steps">
        {STEPS.map((step, i) => (
          <li key={i} className="ext-how-to-use-step">
            <span className="ext-how-to-use-num">{i + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <p className="ext-how-to-use-tip">
        Tip: Use HomeScope on a property listing page, not a search results page.
      </p>
    </div>
  );
}
