const STEPS = [
  { n: 1, label: 'Upload' },
  { n: 2, label: 'Review' },
  { n: 3, label: 'Usage' },
  { n: 4, label: 'Report' },
] as const;

/**
 * A status indicator, not a navigation control — earlier steps aren't
 * guaranteed to still be reachable (a page reload can land you back at
 * /review with nothing left to confirm), so this never renders links.
 */
export function Progress({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <nav className="progress" aria-label="Progress through the audit">
      {STEPS.map((step, i) => {
        const done = step.n < current;
        const isCurrent = step.n === current;
        return (
          <div key={step.n} style={{ display: 'contents' }}>
            <span
              className={`progress-step${done ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span className="progress-step-num" aria-hidden="true">
                {done ? '✓' : step.n}
              </span>
              {step.label}
            </span>
            {i < STEPS.length - 1 ? (
              <span className="progress-sep" aria-hidden="true">
                ···
              </span>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
