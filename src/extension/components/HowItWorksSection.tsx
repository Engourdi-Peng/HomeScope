import { useAppState } from '../store';

export function HowItWorksSection() {
  const { authStatus } = useAppState();

  const isLoggedIn = authStatus === 'logged_in';

  const STEPS = isLoggedIn
    ? [
        'Open a Zillow or realestate.com.au listing page',
        'Click Run Full Property Check and wait 1–3 minutes',
        'Review the full report and find it later in your saved reports',
      ]
    : [
        'Open a Zillow or realestate.com.au listing page',
        'Run a free Basic Check — no sign-in required',
        'Review the Basic report before you book a viewing',
      ];

  return (
    <div className="ext-how-to-use">
      <p className="ext-how-to-use-title">How it works</p>
      <ol className="ext-how-to-use-steps">
        {STEPS.map((step, i) => (
          <li key={i} className="ext-how-to-use-step">
            <span className="ext-how-to-use-num">{i + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
