# Engineering Effort Studio — Cursor Implementation Guide
## The business-user-facing UI for the Engineering Estimation Agent (Decide phase, agent 3 of 5)

> **How to use this file**: This extends the same `studio-web` app built in the
> VoC Intelligence, Business Cases, and Business Value guides — same sidebar,
> same layout, same design tokens, same auth/RBAC, same tab strip on the
> business case detail page. Do not scaffold a new app. Hand each prompt to
> Cursor in order inside the existing `packages/studio-web/` package.
>
> **What this is**: The screen that shows a PM or Engineering Lead what a
> business case will actually cost to build — an effort range in weeks, a
> complexity rating, the specific risks driving that complexity, and a
> recommended team size. No FIS scores, no D-ISS graph traversal terminology,
> no raw file-count numbers. Plain language: "how long," "how risky," "what
> could slow this down."
>
> **Where it sits**: This is the "Engineering Effort" tab already scaffolded in
> the Business Value guide's Prompt 1 — it runs in parallel with Business Value,
> not after it. Both read the same brief; neither waits on the other. This
> guide has to handle the case where Business Value has finished and this
> hasn't yet, or vice versa, without implying a false ordering.

---

## Prerequisites

```bash
cd avp/packages/studio-web
pnpm dev

curl http://localhost:7070/health
```

The tab strip from the Business Value guide's Prompt 1 must already exist on
`/business-cases/[id]/page.tsx` — this guide only adds the third tab's content,
it does not touch the tab strip itself again.

---

## Ground rules for Cursor

1. **Reuse everything already built.** `Tab`, `ConfidenceBadge` (the visual
   pattern, if not the exact component), card/pill/button styles — all exist.
   Import, don't recreate.
2. **No engineering-graph jargon.** Never show "FIS score," "co-change pairs,"
   "D-ISS traversal," "CODE_FILE node count." Say "we looked at how this part of
   the system usually changes," "similar past changes," "affected areas."
3. **An effort range is always a range**, exactly like the value range in the
   previous guide — never collapsed to a single week count. The complexity
   rating and the range are shown together, not as competing headlines.
4. **This agent runs independently of Business Value.** The UI must never
   imply "wait for value first" or "wait for effort first" — both trigger
   independently from the same case, and the page must look correct in all
   four states: neither started, only value done, only effort done, both done.
5. **Role behavior**: Viewers can read the effort estimate. Editors and Admins
   can trigger it and flag a risk as addressed. Enforce server-side.

---

## PROMPT 1 — The Engineering Effort tab content

**Problem it solves:** The tab exists (scaffolded in the Business Value guide)
but has no page behind it yet.

**Create** `packages/studio-web/app/(app)/business-cases/[id]/effort/page.tsx`

```typescript
async function getEffortAssessment(featureId: string) {
  const res = await fetch('http://localhost:7070/graph/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: `
        SELECT d.id, d.description, d.created_at
        FROM graph_nodes d
        JOIN graph_edges ge ON ge.from_node_id = d.id AND ge.kind = 'ESTIMATES'
        WHERE ge.to_node_id = $1 AND d.kind = 'DEV_IMPACT'
        ORDER BY d.created_at DESC LIMIT 1
      `, params: [featureId],
    }), cache: 'no-store',
  })
  const [row] = await res.json()
  return row ? { ...row, data: JSON.parse(row.description) } : null
}
```

**If no assessment exists yet**, the same honest trigger pattern as Business Value
— but with copy specific to engineering, and no implication that value must
finish first:

```tsx
<div className="text-center py-16">
  <div className="text-4xl mb-3">🏗️</div>
  <h3 className="font-bold text-base mb-2">Let's figure out how much work this is</h3>
  <p className="text-ink-3 text-sm mb-5">This takes about 15 seconds — we'll check how similar changes have gone before.</p>
  <button className="btn-primary" onClick={runEffortEstimate}>Estimate the effort</button>
</div>
```

**Add Platform API route:**

```typescript
app.post<{ Params: { id: string } }>('/business-cases/:id/estimate-effort', async (req) => {
  const brief = await queryOne<{ id: number; description: string }>(
    `SELECT b.id, b.description FROM graph_nodes b
     JOIN graph_edges ge ON ge.to_node_id = b.id AND ge.kind='MOTIVATES'
     WHERE ge.from_node_id = $1 AND b.kind='BRIEF' LIMIT 1`, [req.params.id]
  )
  const adapter = await createHttpAdapter(PLATFORM_URL, ENGINEERING_ESTIMATION_MANIFEST)
  const agent = new EngineeringEstimationAgent(adapter, llm)
  const result = await agent.run({ briefId: brief!.id, featureId: parseInt(req.params.id) })
  return result
})
```

**Acceptance gate:** Visiting the Engineering Effort tab on a case with no
estimate yet shows the trigger button — regardless of whether the Business
Value tab has an estimate or not. The two tabs never block each other.

---

## PROMPT 2 — The effort case card

**What to build:** Once `data` exists, render the range, complexity, and team
size as the headline — same visual weight as the Business Value card, so the
two feel like matched halves of one decision.

```tsx
<div className="card">
  <div className="card-hd">
    <h2>How much work this is</h2>
    <p>{data.summary}</p>
  </div>
  <div className="card-bd">

    <div className="text-center py-6 border-b border-line mb-6">
      <div className="text-3xl font-extrabold tracking-tight">
        {data.effortWeeksLow} – {data.effortWeeksHigh}
        <span className="text-base font-medium text-ink-3"> weeks</span>
      </div>
      <div className="flex items-center justify-center gap-2 mt-2">
        <ComplexityBadge level={data.complexity} />
        <span className="text-ink-3 text-[12px]">·</span>
        <span className="text-[12.5px] text-ink-2">Best done by a team of {data.recommendedTeamSize}</span>
      </div>
    </div>

    <div className="mb-6">
      <h4 className="text-sm font-bold mb-2">What could slow this down</h4>
      {data.technicalRisks.length === 0 ? (
        <p className="text-[12.5px] text-ink-3">No specific risks flagged — this looks fairly straightforward.</p>
      ) : (
        <ul className="space-y-1.5">
          {data.technicalRisks.map((r: string, i: number) => (
            <li key={i} className="text-[13px] text-ink-2 flex gap-2">
              <span className="text-amber">⚠</span>{r}
            </li>
          ))}
        </ul>
      )}
    </div>

    <div>
      <h4 className="text-sm font-bold mb-2">Where the time goes</h4>
      <EffortBreakdown breakdown={data.breakdown} />
    </div>

  </div>
</div>
```

**`ComplexityBadge`** — same tier pattern as `ConfidenceBadge` from the previous
guide, but inverted (low complexity is the good outcome, not high):

```tsx
function ComplexityBadge({ level }: { level: 'low' | 'medium' | 'high' }) {
  const cfg = {
    low:    { tier: 'ok',    label: 'Straightforward' },
    medium: { tier: 'amber', label: 'Moderately complex' },
    high:   { tier: 'pink',  label: 'Highly complex' },
  }[level]
  return <span className={`badge ${cfg.tier}`}>{cfg.label}</span>
}
```

**`EffortBreakdown`** — a simple horizontal stacked bar, not a table of numbers,
so a non-technical reader gets the shape of where time goes at a glance:

```tsx
function EffortBreakdown({ breakdown }: { breakdown: Record<string, number> }) {
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0) || 1
  const colors: Record<string, string> = {
    design: '#7C3AED', implementation: '#0369A1', testing: '#0D9268',
    integration: '#D97706', documentation: '#98A2B3',
  }
  const labels: Record<string, string> = {
    design: 'Design', implementation: 'Building it', testing: 'Testing',
    integration: 'Connecting the pieces', documentation: 'Writing it up',
  }
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden mb-3">
        {Object.entries(breakdown).map(([k, v]) => (
          <div key={k} style={{ width: `${(v / total) * 100}%`, background: colors[k] }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {Object.entries(breakdown).map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 text-[11.5px] text-ink-2">
            <span className="w-2 h-2 rounded-sm" style={{ background: colors[k] }} />
            {labels[k]} <span className="ml-auto font-mono text-[10.5px]">{Math.round((v/total)*100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

**Acceptance gate:** The effort range never renders as a single number. The
complexity badge uses the inverted color logic (low = green/good, high =
pink/caution) rather than reusing the confidence badge's tier mapping literally.
The breakdown bar sums to 100% visually even if the underlying numbers don't
perfectly round.

---

## PROMPT 3 — Grounding: what informed this estimate

**Problem it solves:** The agent reads real signals — existing code file
activity and applicable regulations — before estimating. That grounding should
be visible in plain language, not hidden as an implementation detail, because
"why does this say 6-9 weeks" is a question a skeptical stakeholder will ask.

**Add to the same page**, below the breakdown:

```tsx
<div className="mt-6 pt-5 border-t border-line">
  <h4 className="text-sm font-bold mb-3">What we looked at</h4>
  <div className="grid grid-cols-2 gap-3">
    <GroundingCard
      icon="🗂️"
      title="Similar past changes"
      body={data.codeComplexitySignal ?? 'We compared this to how similar parts of the system have changed before.'}
    />
    <GroundingCard
      icon="📋"
      title="Rules that apply here"
      body={data.applicableRegulations?.length > 0
        ? `${data.applicableRegulations.length} compliance rule${data.applicableRegulations.length > 1 ? 's' : ''} apply — this typically adds review time.`
        : 'No special compliance rules apply to this area.'}
    />
  </div>
</div>
```

`GroundingCard` is a small two-line card — icon, bold title, muted body text,
matching the visual weight of the assumption bullets from the Business Value
guide, just packaged as cards instead of a list since there are exactly two.

**Acceptance gate:** A case with applicable regulations shows the specific count
in plain language ("2 compliance rules apply"). A case with none shows the
honest "No special compliance rules apply" message, not a blank or hidden card.

---

## PROMPT 4 — Flag a risk as addressed (Editor/Admin only)

**Problem it solves:** Technical risks aren't static — an engineer might resolve
one before the estimate is acted on (e.g., "no test coverage in this area" gets
fixed by writing tests preemptively). The UI needs a lightweight way to mark
that without re-running the whole estimate.

```tsx
{data.technicalRisks.map((risk: string, i: number) => (
  <li key={i} className="text-[13px] text-ink-2 flex items-center gap-2 group">
    <span className="text-amber">⚠</span>
    <span className={addressedRisks.includes(i) ? 'line-through text-ink-3' : ''}>{risk}</span>
    {!addressedRisks.includes(i) && (
      <button
        className="text-[10.5px] text-blue opacity-0 group-hover:opacity-100 ml-auto"
        onClick={() => markRiskAddressed(i)}
      >
        Mark as handled
      </button>
    )}
  </li>
))}
```

**Add Platform API route:**

```typescript
app.patch<{ Params: { id: string }; Body: { riskIndex: number } }>(
  '/business-cases/:id/effort/risk-addressed', async (req) => {
    const assessment = await queryOne<{ id: number; description: string }>(
      `SELECT d.id, d.description FROM graph_nodes d
       JOIN graph_edges ge ON ge.from_node_id = d.id AND ge.kind='ESTIMATES'
       WHERE ge.to_node_id = $1 AND d.kind='DEV_IMPACT' LIMIT 1`, [req.params.id]
    )
    const data = JSON.parse(assessment!.description)
    data.addressedRiskIndices = [...(data.addressedRiskIndices ?? []), req.body.riskIndex]
    await query(`UPDATE graph_nodes SET description = $1 WHERE id = $2`, [JSON.stringify(data), assessment!.id])
    return { saved: true }
  }
)
```

Note this does **not** recompute the effort range or complexity rating — marking
a risk handled is a human annotation, not a re-estimate. If a risk being resolved
should actually shrink the range, that's a deliberate "Re-estimate" action
(Prompt 5), not an automatic side effect of checking a box.

**Acceptance gate:** Marking a risk as handled shows a strikethrough and persists
across a page refresh, but the effort range and complexity badge stay exactly
the same — confirming the two are decoupled.

---

## PROMPT 5 — Re-estimate after risks change

**What to build:** A visible, separate action for when enough has changed that
the estimate itself should be redone — not folded silently into Prompt 4's
annotation.

```tsx
{addressedRisks.length > 0 && (
  <div className="mt-3 p-3 bg-info-bg border border-info-bd rounded-lg flex items-center justify-between">
    <span className="text-[12.5px] text-blue">
      {addressedRisks.length} risk{addressedRisks.length > 1 ? 's' : ''} marked as handled — the estimate above doesn't reflect this yet.
    </span>
    <button className="btn-primary btn-sm" onClick={reestimate}>Re-estimate</button>
  </div>
)}
```

**Add Platform API route** — re-runs the agent, passing the addressed risks as
context so the new estimate is grounded in what's actually changed:

```typescript
app.post<{ Params: { id: string } }>('/business-cases/:id/effort/reestimate', async (req) => {
  const brief = await queryOne(/* same lookup as Prompt 1 */)
  const previous = await queryOne<{ description: string }>(
    `SELECT description FROM graph_nodes WHERE kind='DEV_IMPACT' AND ... ORDER BY created_at DESC LIMIT 1`
  )
  const adapter = await createHttpAdapter(PLATFORM_URL, ENGINEERING_ESTIMATION_MANIFEST)
  const agent = new EngineeringEstimationAgent(adapter, llm)
  const result = await agent.run({
    briefId: brief!.id, featureId: parseInt(req.params.id),
    resolvedRisks: JSON.parse(previous!.description).addressedRiskIndices?.map(
      (i: number) => JSON.parse(previous!.description).technicalRisks[i]
    ),
  })
  return result   // writes a NEW DEV_IMPACT node — the old one stays as history
})
```

This writes a **new** `DEV_IMPACT` node rather than overwriting the old one —
consistent with how the rest of this system treats estimates as an append-only
history, not a mutable single value.

**Acceptance gate:** Clicking "Re-estimate" produces a new range (which may
differ from the original) and the "risks marked as handled" banner disappears
once the fresh estimate reflects them. The previous estimate is still queryable
in the graph as history, even though the UI only shows the latest.

---

## PROMPT 6 — Cross-link from the Business Cases board

**Modify** `packages/studio-web/app/(app)/business-cases/page.tsx` — add a
second inline stat alongside the value range from the previous guide, so a
reviewer scanning the board sees both value and effort without clicking in:

```tsx
<div className="flex gap-4">
  <div className="pp-size">
    <div className="n">{item.value_low ? `$${formatCompact(item.value_low)}–${formatCompact(item.value_high)}` : '—'}</div>
    <div className="lbl">{item.value_low ? 'estimated value' : 'not yet sized'}</div>
  </div>
  <div className="pp-size">
    <div className="n">{item.effort_low ? `${item.effort_low}–${item.effort_high}w` : '—'}</div>
    <div className="lbl">{item.effort_low ? 'effort' : 'not yet sized'}</div>
  </div>
</div>
```

**Acceptance gate:** The board shows both figures side by side once both
estimates exist, and correctly shows "not yet sized" independently for whichever
one hasn't run yet — never inferring one from the other.

---

## PROMPT 7 — Seed a demo effort assessment

**Extend** `packages/platform/src/db/seed.ts`:

```typescript
const effortAssessment = await queryOne<{ id: number }>(`
  INSERT INTO graph_nodes (kind, label, description, metadata)
  VALUES ('DEV_IMPACT', 'Engineering estimate: Bulk dispute filing for fleet accounts',
    '{"summary":"Moderate complexity — mainly touches the existing dispute workflow with a new bulk-action layer.","effortWeeksLow":6,"effortWeeksHigh":9,"complexity":"medium","technicalRisks":["The dispute API was not originally designed for batch operations","No existing test coverage for concurrent dispute submissions"],"assumptions":["Assumes the existing dispute service can be extended rather than rebuilt"],"breakdown":{"design":15,"implementation":45,"testing":25,"integration":10,"documentation":5},"recommendedTeamSize":2,"codeComplexitySignal":"The dispute module has changed moderately often in the past 6 months, usually alongside the billing service.","applicableRegulations":[]}',
    '{"effortWeeksLow":6,"effortWeeksHigh":9,"complexity":"medium"}')
  RETURNING id
`)

await query(`INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'ESTIMATES')`,
  [effortAssessment!.id, feature!.id])

console.log('Seeded 1 engineering effort assessment for demo purposes')
```

**Acceptance gate:** After seeding, the demo case's Engineering Effort tab shows
6–9 weeks, "Moderately complex," a team of 2, two technical risks, and the
breakdown bar — without needing a live LLM call.

---

## PROMPT 8 — End-to-end validation

1. **Log in** as the seeded Editor.
2. Open the seeded demo business case → **Engineering Effort** tab → confirm
   6–9 weeks, "Moderately complex," team of 2, two risks, and the breakdown bar
   all render from seed data.
3. Confirm the **Business Value** tab still works independently — switching
   tabs doesn't clear or reload the other's data.
4. **Mark one risk as handled** → confirm strikethrough + the blue "doesn't
   reflect this yet" banner appears, and the range/complexity badge do **not**
   change.
5. Click **Re-estimate** → confirm a new range appears and the banner clears.
6. **Business Cases board** → confirm this case's row shows both the value
   range and the effort range side by side.
7. **Log in as the seeded Viewer** → confirm "Mark as handled" and "Re-estimate"
   are both absent from the risks list.
8. Create a **second, fresh business case** → open its Engineering Effort tab
   with no Business Value estimate run yet → confirm the effort trigger state
   still appears correctly, with no error or dependency on the other tab.

**If any step fails**, check first whether `ENGINEERING_ESTIMATION_MANIFEST`
matches the actual export name (it may still be `SOLUTIONS_ESTIMATION_MANIFEST`
from before the renaming decision — rename in the agent package itself).

---

## File map — what each prompt creates or modifies

| Prompt | Files |
|---|---|
| 1 | `app/(app)/business-cases/[id]/effort/page.tsx`, `platform/server.ts` (+1 route) |
| 2 | Same page — `ComplexityBadge`, `EffortBreakdown` components |
| 3 | Same page — `GroundingCard` component |
| 4 | Same page — risk-addressed toggle, `platform/server.ts` (+1 route) |
| 5 | Same page — re-estimate action, `platform/server.ts` (+1 route), agent signature change |
| 6 | `app/(app)/business-cases/page.tsx` (modified — dual inline stats) |
| 7 | `platform/src/db/seed.ts` (extended) |
| 8 | Validation only |

**New Platform API routes added in this guide:** 3
**New Next.js pages:** 1
**New shared components:** 3 (`ComplexityBadge`, `EffortBreakdown`, `GroundingCard`)

---

*End of implementation guide. With both Business Value and Engineering Effort
built, the next guide covers GTM Strategy — the sequential agent that reads
Business Value's output specifically and translates it into segment, CAC, and
LTV language. After that, Portfolio Advisor closes out Decide by combining all
three into the packet a human steering committee actually reviews.*
