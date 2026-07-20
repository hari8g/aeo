# Business Value Studio — Cursor Implementation Guide
## The business-user-facing UI for the Business Value Agent (Decide phase, agent 2 of 5)

> **How to use this file**: This extends the same `studio-web` app built in the
> VoC Intelligence and Business Cases guides — same sidebar, same layout, same
> design tokens, same auth/RBAC. Do not scaffold a new app. Hand each prompt to
> Cursor in order inside the existing `packages/studio-web/` package.
>
> **What this is**: The screen that shows a PM or Finance partner what a business
> case is actually worth — a value range, a confidence level, the assumptions
> behind it, and the specific bets (hypotheses) that will later be measured
> against reality. No dollar-range math shown as a raw computation, no LLM prompt
> visible, no "VALUE_HYPOTHESIS" terminology. Plain business language: "the bet,"
> "how sure we are," "what we're measuring."
>
> **Where it sits**: This screen only becomes reachable once a business case has
> been sent for sizing (the last action in the Business Cases guide). It runs
> alongside Engineering Estimation — the two are parallel, not sequential — so
> this guide also has to show that "sizing in progress" state honestly, since
> the effort estimate may not be ready yet when value is.

---

## Prerequisites

```bash
cd avp/packages/studio-web
pnpm dev

# Confirms the Business Cases guide's routes and seed data are already in place
curl http://localhost:7070/health
```

At least one business case must exist with `sentForSizing: true` in its metadata
(from Prompt 7/8 of the Business Cases guide) before this guide's screens have
anything to show.

---

## Ground rules for Cursor

1. **Reuse everything already built.** `Sidebar`, `EditableField`, `ReadOnlyField`,
   card/pill/button styles, the amber warning pattern — all exist. Import, don't
   recreate.
2. **No graph or statistics jargon.** Never show "VALUE_HYPOTHESIS," "confidence:
   0.62," "attribution_method: before_after." Say "the bet," "62% confident,"
   "we'll compare before and after."
3. **A value range is always a range, never collapsed to one number in the UI.**
   The agent itself refuses to produce a single point estimate — the interface
   must honor that discipline, not average the range down to something that
   looks more precise than it is.
4. **Calibration history is shown as a trend, not raw numbers.** If this is the
   agent's first estimate ever, say so plainly rather than showing an empty chart.
5. **Role behavior**: Viewers can read the value case. Editors and Admins can
   adjust assumptions and re-run the estimate. Enforce server-side.

---

## PROMPT 1 — Add the Business Value screen to navigation and the case detail page

**Problem it solves:** The Business Case review screen (previous guide) ends at
"Send for sizing" with no visible destination. This prompt adds the destination.

**Modify** `packages/studio-web/components/Sidebar.tsx` — Business Value doesn't
get its own top-level nav item (it's not something a user browses to directly;
it's reached from a specific business case). Instead, it appears as a tab inside
the case detail page. Skip sidebar changes in this guide.

**Modify** `packages/studio-web/app/(app)/business-cases/[id]/page.tsx` — add a
tab strip once `sentForSizing` is true:

```tsx
{feature.metadata?.sentForSizing && (
  <div className="flex gap-1 border-b border-line mb-5 mt-6">
    <Tab href={`/business-cases/${id}`} label="The Case" active={activeTab === 'case'} />
    <Tab href={`/business-cases/${id}/value`} label="Business Value" active={activeTab === 'value'} />
    <Tab href={`/business-cases/${id}/effort`} label="Engineering Effort" active={activeTab === 'effort'} />
  </div>
)}
```

`Tab` is a small shared component — underline-on-active, muted otherwise, matching
the filter-chip visual weight already established.

**Acceptance gate:** Opening a business case that has been sent for sizing shows
three tabs. Opening one that hasn't shows none — the tabs themselves are the
signal that sizing has started.

---

## PROMPT 2 — Trigger the estimate and show the waiting state honestly

**Problem it solves:** Business Value and Engineering Estimation run in parallel
and take real time (LLM calls + calibration lookups). The UI must never fake
instant results, and must be honest when one finishes before the other.

**Create** `packages/studio-web/app/(app)/business-cases/[id]/value/page.tsx`

```typescript
async function getValueAssessment(featureId: string) {
  const res = await fetch('http://localhost:7070/graph/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: `
        SELECT b.id, b.description, b.created_at
        FROM graph_nodes b
        JOIN graph_edges ge ON ge.from_node_id = b.id AND ge.kind = 'ESTIMATES'
        WHERE ge.to_node_id = $1 AND b.kind = 'BUSINESS_IMPACT'
        ORDER BY b.created_at DESC LIMIT 1
      `, params: [featureId],
    }), cache: 'no-store',
  })
  const [row] = await res.json()
  return row ? { ...row, data: JSON.parse(row.description) } : null
}
```

**If no assessment exists yet**, show a clear trigger state — not an auto-fired
background call, since this is a real LLM cost the user should knowingly initiate:

```tsx
<div className="text-center py-16">
  <div className="text-4xl mb-3">💰</div>
  <h3 className="font-bold text-base mb-2">Let's figure out what this is worth</h3>
  <p className="text-ink-3 text-sm mb-5">This takes about 15 seconds — we'll look at similar past cases to calibrate the estimate.</p>
  <button className="btn-primary" onClick={runValueEstimate}>Estimate the value</button>
</div>
```

**Add Platform API route:**

```typescript
app.post<{ Params: { id: string } }>('/business-cases/:id/estimate-value', async (req) => {
  const brief = await queryOne<{ id: number; description: string }>(
    `SELECT b.id, b.description FROM graph_nodes b
     JOIN graph_edges ge ON ge.to_node_id = b.id AND ge.kind='MOTIVATES'
     WHERE ge.from_node_id = $1 AND b.kind='BRIEF' LIMIT 1`, [req.params.id]
  )
  const adapter = await createHttpAdapter(PLATFORM_URL, BUSINESS_VALUE_MANIFEST)
  const agent = new BusinessValueAgent(adapter, llm)
  const result = await agent.run({ briefId: brief!.id, featureId: parseInt(req.params.id) })
  return result
})
```

**Acceptance gate:** A business case with no value estimate yet shows the trigger
button, not a spinner that implies something is already running. Clicking it
shows a loading skeleton, then the populated view from Prompt 3.

---

## PROMPT 3 — The value case card

**What to build:** Once `data` exists, render it as a business-readable card —
this is the core screen.

```tsx
<div className="card">
  <div className="card-hd">
    <h2>What this is worth</h2>
    <p>{data.executiveSummary}</p>
  </div>
  <div className="card-bd">

    {/* The range — always a range, rendered large and centered */}
    <div className="text-center py-6 border-b border-line mb-6">
      <div className="text-3xl font-extrabold tracking-tight">
        ${data.valueLow.toLocaleString()} – ${data.valueHigh.toLocaleString()}
        <span className="text-base font-medium text-ink-3"> / {data.valuePeriod}</span>
      </div>
      <ConfidenceBadge pct={data.confidence} />
    </div>

    {/* Assumptions — plain bullet list, each one a thing a human could challenge */}
    <div className="mb-6">
      <h4 className="text-sm font-bold mb-2">What we're assuming</h4>
      <ul className="space-y-1.5">
        {data.assumptions.map((a: string, i: number) => (
          <li key={i} className="text-[13px] text-ink-2 flex gap-2">
            <span className="text-ink-3">•</span>{a}
          </li>
        ))}
      </ul>
    </div>

    {/* The bets — each hypothesis as its own small card */}
    <div>
      <h4 className="text-sm font-bold mb-2">What we'll measure</h4>
      <div className="space-y-2">
        {data.hypotheses.map((h: any, i: number) => <BetCard key={i} hypothesis={h} />)}
      </div>
    </div>

  </div>
</div>
```

**`ConfidenceBadge`** — a small pill, colored by tier, never showing a bare decimal:

```tsx
function ConfidenceBadge({ pct }: { pct: number }) {
  const tier = pct >= 70 ? 'ok' : pct >= 40 ? 'amber' : 'pink'
  const label = pct >= 70 ? 'Fairly confident' : pct >= 40 ? 'Somewhat confident' : 'Early guess'
  return <span className={`badge ${tier} mt-2`}>{label} ({pct}%)</span>
}
```

**`BetCard`** — translates the raw hypothesis fields into a sentence, exactly the
pattern used in every earlier flow explanation ("Cut dispute_rate by 15% within
90 days"):

```tsx
function BetCard({ hypothesis }: { hypothesis: any }) {
  const verb = hypothesis.direction === 'decrease' ? 'Cut' : 'Grow'
  return (
    <div className="border border-line rounded-lg px-4 py-3 flex items-center justify-between">
      <div>
        <div className="text-[13px] font-semibold">
          {verb} <span className="font-mono text-[12px] bg-surface-1 px-1.5 py-0.5 rounded">{prettifyKpiName(hypothesis.kpi)}</span> by {hypothesis.magnitudePct}%
        </div>
        <div className="text-[11.5px] text-ink-3 mt-0.5">
          Within {hypothesis.timeframeDays} days · we'll compare {attributionLabel(hypothesis.attributionMethod)}
        </div>
      </div>
      <span className="badge blue">Not yet locked in</span>
    </div>
  )
}
```

`prettifyKpiName` and `attributionLabel` are small string-mapping helpers —
`dispute_rate` → "dispute rate," `before_after` → "before and after," etc.

**The "Not yet locked in" pill is deliberate and important** — every hypothesis
here is a draft (`committed: false` on the graph). Nothing here becomes a real,
measured commitment until the Portfolio Advisor's gate is approved. The UI must
never let this look final.

**Acceptance gate:** The value range never renders as a single number anywhere on
the page. Every hypothesis card shows the "Not yet locked in" pill. Confidence
shows as a tiered label with percentage in parentheses, never a bare decimal.

---

## PROMPT 4 — Calibration trend (shown only when history exists)

**Problem it solves:** The Business Value Agent reads its own calibration history
before estimating — that's a real capability the UI should surface, but only
meaningfully once there's more than one data point.

**Add to the same page**, below the bet cards, conditionally:

```typescript
async function getCalibrationHistory() {
  const res = await fetch('http://localhost:7070/graph/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: `SELECT metadata, created_at FROM graph_nodes
            WHERE kind='CALIBRATION_RECORD' ORDER BY created_at DESC LIMIT 5`,
    }), cache: 'no-store',
  })
  return res.json()
}
```

```tsx
{calibration.length === 0 ? (
  <div className="mt-6 pt-5 border-t border-line text-[12.5px] text-ink-3">
    This is the first time we're sizing something like this — there's no track
    record yet to compare against.
  </div>
) : (
  <div className="mt-6 pt-5 border-t border-line">
    <h4 className="text-sm font-bold mb-3">How accurate have we been?</h4>
    <div className="flex items-center gap-4">
      <TrendArrow trend={computeTrend(calibration)} />
      <p className="text-[12.5px] text-ink-2">
        {trendSentence(computeTrend(calibration))}
      </p>
    </div>
  </div>
)}
```

`trendSentence` maps to plain language: improving → "Our estimates have been
getting closer to what actually happened." degrading → "Our recent estimates
have been further off than usual — treat this range with a bit more caution."
stable → "Our estimates have been consistently in the right ballpark."

**Acceptance gate:** A fresh workspace with zero calibration records shows the
honest "first time" message, not an empty chart or a misleading 0% trend.

---

## PROMPT 5 — Adjust an assumption and re-run (Editor/Admin only)

**Problem it solves:** A Finance partner reviewing this might disagree with a
specific assumption ("this assumes 100% of the affected segment adopts the
feature — that's too optimistic"). They need a way to push back without editing
raw JSON.

**Add an "Adjust assumptions" action** below the assumptions list:

```tsx
<button className="btn-ghost btn-sm mt-2" onClick={() => setAdjusting(true)}>
  ✏️ Adjust an assumption
</button>

{adjusting && (
  <div className="mt-3 space-y-2">
    {data.assumptions.map((a: string, i: number) => (
      <textarea key={i} defaultValue={a} className="w-full text-[13px] border border-line2 rounded-lg p-2" rows={2} />
    ))}
    <div className="flex gap-2 justify-end">
      <button className="btn-ghost btn-sm" onClick={() => setAdjusting(false)}>Cancel</button>
      <button className="btn-primary btn-sm" onClick={saveAndReestimate}>Save and re-estimate</button>
    </div>
  </div>
)}
```

**Add Platform API route** — this doesn't call the LLM again from scratch; it
patches the assumption text and re-derives the range using the same agent logic,
now grounded in the corrected assumption:

```typescript
app.post<{ Params: { id: string }; Body: { assumptions: string[] } }>(
  '/business-cases/:id/value/adjust', async (req) => {
    const brief = await queryOne<{ id: number }>(/* same lookup as Prompt 2 */)
    const adapter = await createHttpAdapter(PLATFORM_URL, BUSINESS_VALUE_MANIFEST)
    const agent = new BusinessValueAgent(adapter, llm)
    // Pass the human-edited assumptions back in as context so the re-estimate
    // is grounded in the correction rather than repeating the same reasoning.
    const result = await agent.run({
      briefId: brief!.id, featureId: parseInt(req.params.id),
      humanAdjustedAssumptions: req.body.assumptions,
    })
    return result
  }
)
```

This requires a small addition to the agent's `run()` signature to accept and
fold `humanAdjustedAssumptions` into its prompt — flag this as a backend change
needed alongside the UI, not something the UI can fake on its own.

**Acceptance gate:** Editing an assumption and saving produces a new value range
in the card (may differ from the original), and the assumptions list reflects
the edited text, not the original LLM draft. This action is entirely absent
(not just disabled) for Viewer-role users.

---

## PROMPT 6 — Cross-link from the Business Cases board

**Modify** `packages/studio-web/app/(app)/business-cases/page.tsx` — once a case
has a value assessment, show the range inline on the board row instead of the
placeholder "—" customer count used in the previous guide:

```tsx
<div className="pp-size">
  <div className="n">{item.value_low ? `$${formatCompact(item.value_low)}–${formatCompact(item.value_high)}` : '—'}</div>
  <div className="lbl">{item.value_low ? 'estimated value' : 'not yet sized'}</div>
</div>
```

`formatCompact` renders `450000` as `450K`, keeping the board row readable at a
glance without forcing a click into the detail page just to see the range.

**Acceptance gate:** The Business Cases board shows a real value range for any
case that has one, and "not yet sized" for any that don't — never a blank cell.

---

## PROMPT 7 — Seed a demo value assessment

**Extend** `packages/platform/src/db/seed.ts`:

```typescript
const valueAssessment = await queryOne<{ id: number }>(`
  INSERT INTO graph_nodes (kind, label, description, metadata)
  VALUES ('BUSINESS_IMPACT', 'Business impact: Bulk dispute filing for fleet accounts',
    '{"executiveSummary":"Reduces support burden and lowers churn risk among enterprise fleet accounts.","valueLow":180000,"valueHigh":420000,"valueCurrency":"USD","valuePeriod":"year","confidence":62,"assumptions":["Assumes 60% of eligible fleet accounts adopt bulk filing within 90 days","Assumes current dispute-related churn continues at the observed rate if unaddressed"],"hypotheses":[{"kpi":"dispute_resolution_time","direction":"decrease","magnitudePct":40,"timeframeDays":90,"attributionMethod":"before_after","rationale":"Bulk filing removes the per-transaction bottleneck"},{"kpi":"fleet_churn_rate","direction":"decrease","magnitudePct":8,"timeframeDays":180,"attributionMethod":"ab_test","rationale":"Directly addresses the top cited churn reason in this segment"}]}',
    '{"valueLow":180000,"valueHigh":420000,"confidence":62}')
  RETURNING id
`)

await query(`INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'ESTIMATES')`,
  [valueAssessment!.id, feature!.id])   // feature from the Business Cases seed

console.log('Seeded 1 business value assessment for demo purposes')
```

**Acceptance gate:** After seeding, opening the demo case's Business Value tab
shows the $180K–$420K range, 62% confidence ("Somewhat confident"), two
assumptions, and two bet cards — all without needing to trigger a live LLM call.

---

## PROMPT 8 — End-to-end validation

1. **Log in** as the seeded Editor.
2. Open the seeded demo business case → confirm three tabs appear (case sent for
   sizing in the earlier guide's seed data).
3. Click **Business Value** tab → confirm the pre-seeded range, confidence badge,
   assumptions, and two bet cards render correctly.
4. Confirm every bet card shows **"Not yet locked in"** — nothing reads as final.
5. Click **"Adjust an assumption"**, change the adoption percentage assumption
   text, save → confirm the value range updates and the new assumption text
   persists on refresh.
6. **Log in as the seeded Viewer** → open the same tab → confirm "Adjust an
   assumption" is absent entirely.
7. **Business Cases board** → confirm this case's row now shows the value range
   inline (e.g. "$180K–$420K") instead of a blank customer count.
8. Create a **second, fresh business case** with no value assessment yet → open
   its Business Value tab → confirm the honest trigger state appears ("Let's
   figure out what this is worth") rather than an empty or broken card.

**If any step fails**, check first whether `BUSINESS_VALUE_MANIFEST` matches the
actual export name from the AVP agent package (it may still be named
`VALUE_ENGINEERING_MANIFEST` from before the renaming decision — rename the
export in the agent package itself if so, don't just alias it in the UI layer).

---

## File map — what each prompt creates or modifies

| Prompt | Files |
|---|---|
| 1 | `app/(app)/business-cases/[id]/page.tsx` (modified — tab strip), `components/Tab.tsx` |
| 2 | `app/(app)/business-cases/[id]/value/page.tsx`, `platform/server.ts` (+1 route) |
| 3 | Same page — `ConfidenceBadge`, `BetCard` components |
| 4 | Same page — calibration trend section |
| 5 | Same page — adjust flow, `platform/server.ts` (+1 route), agent signature change |
| 6 | `app/(app)/business-cases/page.tsx` (modified — inline value range) |
| 7 | `platform/src/db/seed.ts` (extended) |
| 8 | Validation only |

**New Platform API routes added in this guide:** 2
**New Next.js pages:** 1
**New shared components:** 3 (`Tab`, `ConfidenceBadge`, `BetCard`)

---

*End of implementation guide. The next guide in this series covers the Engineering
Estimation Agent's screen — the parallel counterpart to this one, reachable via
the "Engineering Effort" tab already scaffolded in Prompt 1. After that, GTM
Strategy and Portfolio Advisor close out the Decide phase.*
