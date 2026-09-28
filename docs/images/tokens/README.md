# Telemetry conditions screenshots

These images show the real Tokens UI using **fictional, deterministic sample data**.
They contain no personal telemetry. Both light and dark versions are provided.
Dates use UTC and formatting uses `en-US`.

| Image | Suggested documentation caption |
|---|---|
| `conditions-{light,dark}.png` | Conditions compare observed problem rates with known presence versus known absence. |
| `comparison-detail-{light,dark}.png` | The example has 3 affected of 12 sessions with the condition, versus 9 of 12 without. Two unknown sessions affect coverage only. |
| `model-metrics-{light,dark}.png` | Session token metrics show valid/eligible coverage and approximate model attribution. |
| `event-ledger-{light,dark}.png` | The event ledger places observed problems and recorded changes in time. |
| `recorded-change-{light,dark}.png` | Change comparisons expose before/after counts and excluded boundary observations. |
| `mark-change-{light,dark}.png` | Record a response now or an earlier suspected change, with repository scope and watching kinds. |

## Reproduce

From the feature checkout:

```sh
node scripts/test/telemetry-conditions-matrix-check.mjs
TELEMETRY_DOC_SCREENSHOTS="$PWD/docs/images/tokens" npm run test:portal-ui
```

The screenshot tests are opt-in; ordinary browser runs do not overwrite documentation assets.
Fixture: `scripts/test/fixtures/telemetry-conditions-documentation.mjs`.
Capture script: `scripts/test/portal-ui/telemetry-documentation.spec.mjs`.
The same fixture is checked against fixed numerical expectations by the isolated unit matrix.
Screenshots capture actual rendered sections/dialogs; they are not generated illustrations.

## Test coverage

`telemetry-conditions-matrix-check.mjs` checks 2,850 deterministic scenarios:

- 2,592 condition/event cases: all 6³ three-observation states, all six orderings,
  both with and without duplicated observations.
- 10 explicit rate/sample/event-floor golden cases.
- 16 snapshot evaluability cases, including missing snapshots and v2 unavailable evidence.
- 35 invalid token field cases.
- 162 complete/partial/unavailable token coverage cases across all small-input orderings.
- 24 mirrored-flow/cross-harness permutations.
- 10 marker-boundary cases, including sequence ties and unrelated sequence domains.
- 1 documentation fixture with independently specified cohort counts and rates.

This is exhaustive for the stated small-input spaces, not a claim to enumerate all
possible telemetry records or browser states. Existing integration/cache/boundary suites
cover larger fixtures and persistence behavior.

Portal introduction image: `docs/images/portal-overview.png`. Regenerate with
`PORTAL_DOC_SCREENSHOT="$PWD/docs/images/portal-overview.png" npm run test:portal-ui`.
