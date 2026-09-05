# Hub UI audit — September 5, 2026

Scope: existing GitHub Pages Hub, seven authenticated panes, desktop and narrow-screen layout. Account data must never be included in public preview fixtures.

| Area | Finding | Implementation |
|---|---|---|
| Shared navigation | Device theme produced inconsistent screenshots; tiny labels and no page heading | Dark default, saved explicit theme choice, descriptive page headings, readable typography, focus indicators, wrapped tablet navigation |
| Overview | Dense microtype obscured hierarchy | Larger metric values and labels, restrained shared cards, preserved entity colors |
| Accounts | Dense operational table | Shared spacing and control sizes; horizontal scrolling retained to preserve detailed controls |
| Investments | Chart consumed disproportionate desktop height | Chart capped at 290px, consistent metric hierarchy |
| Assets | Sparse screen lacked orientation | Purposeful page introduction and shared visual hierarchy |
| Transactions | No search; wide editable table on phones | Merchant/account search, labeled mobile rows, larger native selects; existing classification handlers retained |
| Connections | Technical imperative copy and wide tables | Clear entity instruction, labeled mobile cards, existing connection actions retained |
| Trade | Long expanded proposals hid operational state; watchlist claimed streaming | Activity summary, visible provider health, latest saved decisions, collapsible research, positions moved above research, plain-language metrics, reference-feed disclosure |

## Data boundaries

Alpaca worker subscription was observed, but first usable market observations and complete SIP coverage remain unverified. Tiingo EOD/news connection tests passed at 2026-09-05T04:37:07.097Z; this does not establish recurring ingestion. The UI reads saved health receipts and does not infer successful ingestion from a purchased plan or saved key. Unknown, future, failed and stale receipts cannot appear healthy.

Mac job receipts have not synced. Champion activation, matched evaluation outcomes/cost accounting, and other optional source configuration remain deployment gates. Raw licensed data is not exposed through new grants or client credentials. No real orders, capital transfers, or entry-readiness changes are included.

Latest decisions display each proposal's latest saved state, explicitly not a full event timeline. Reported confidence is not a calibrated probability. Reference quotes are labeled separately from Alpaca SIP, with fetch age, and missing planned prices stay unavailable.

## Verification

Existing full regression suite plus provider-state checks. Synthetic preview contains no live account data and blocks backend connections. Browser checks cover dark/light persistence, collapsed research, mobile overflow, and authenticated page navigation after release.
