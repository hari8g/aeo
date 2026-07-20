# GTM Strategy Studio — Cursor Implementation Guide
## The business-user-facing UI for the GTM Strategy Agent (Decide phase, agent 4 of 5)

> **How to use this file**: This extends the same `studio-web` app built in the
> VoC Intelligence, Business Cases, Business Value, and Engineering Effort
> guides — same sidebar, same layout, same design tokens, same auth/RBAC, same
> tab strip on the business case detail page. Do not scaffold a new app. Hand
> each prompt to Cursor in order inside the existing `packages/studio-web/`
> package.
>
> **What this is**: The screen that shows a GTM or Marketing lead who this
> feature is actually for, how it should be positioned, and rough sizing on
> acquisition cost and lifetime value per segment. No "GTM_PROJECTION node," no
> raw CAC/LTV formulas, no confidence math. Plain language: "who this is for,"
> "how we'd talk about it," "is this an easy sell."
>
> **Where it sits**: Unlike Engineering Effort, this agent is sequential, not
> parallel — it only runs once Business Value has finished, because it reads
> that assessment specifically rather than the brief. This guide is the first
> one in the series where the UI has to visibly communicate a real dependency
> rather than hide it, which is the opposite instinct from the last guide.

---

## Prerequisites

```bash
cd avp/packages/studio-web
pnpm dev

curl http://localhost:7070/health
```

A business case must have a completed Business Value assessment (from the
previous guide) before this screen has anything meaningful to trigger from.

---

## Ground rules for Cursor

1. **Reuse everything already built.** `Tab`, `ConfidenceBadge`,
   `ComplexityBadge` pattern, card/pill/button styles — all exist. Import,
   don't recreate.
2. **No GTM-jargon-as-acronym without explanation.** CAC and LTV are real terms
   marketing/GTM audiences know, so they can appear — but always paired with a
   plain-language descriptor ("Cost to acquire," "Lifetime value"), never as
   bare acronyms on first appearance in any card.
3. **This screen must show its dependency honestly, not hide it.** If Business
   Value hasn't run yet, this tab should say exactly that — "We need a value
   estimate first" — not show a generic disabled button with no explanation.
   This is the opposite of the Engineering Effort guide, where independence was
   the thing to protect; here, correctly showing dependency is the thing to protect.
4. **Segments are the primary visual unit, not a wall of text.** Each identified
   segment gets its own compact card — name, fit, size, CAC/LTV — scannable in
   under five seconds each.
5. **Role behavior**: Viewers can read the GTM projection. Editors and Admins
   can trigger it and edit the positioning statement. Enforce server-side.

---

## PROMPT 1 — Add the GTM Strategy tab to the tab strip

**Problem it solves:** The tab strip currently has three tabs (Case, Business
Value, Engineering Effort). This adds the fourth.

**Modify** `packages/studio-web/app/(app)/business-cases/[id]/page.tsx`:

```tsx
<div className="flex gap-1 border-b border-line mb-5 mt-6">
  <Tab href={`/business-cases/${id}`} label="The Case" active={activeTab === 'case'} />
  <Tab href={`/business-cases/${id}/value`} label="Business Value" active={activeTab === 'value'} />
  <Tab href={`/business-cases/${id}/effort`} label="Engineering Effort" active={activeTab === 'effort'} />
  <Tab href={`/business-cases/${id}/gtm`} label="Go-to-Market" active={activeTab === 'gtm'} />
</div>
```

**Acceptance gate:** Four tabs now appear once a case has been sent for sizing,
in the same visual style as the existing three.

---

## PROMPT 2 — The dependency-aware trigger state

**Problem it solves:** This is the one screen in the series that must actively
communicate "you can't do this yet, and here's exactly why" rather than just
offering a generic trigger button.

**Create** `packages/studio-web/app/(app)/business-cases/[id]/gtm/page.tsx`

```typescript
async function getValueAssessment(featureId: string) {
  // Reused lookup from the Business Value guide — GTM Strategy depends on this existing
  const res = await fetch('http://localhost:7070/graph/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: `SELECT b.id, b.description FROM graph_nodes b
            JOIN graph_edges ge ON ge.from_node_id = b.id AND ge.kind = 'ESTIMATES'
            WHERE ge.to_node_id = $1 AND b.kind = 'BUSINESS_IMPACT'
            ORDER BY b.created_at DESC LIMIT 1`,
      params: [featureId],
    }), cache: 'no-store',
  })
  const [row] = await res.json()
  return row ? { id: row.id, data: JSON.parse(row.description) } : null
}

async function getGtmProjection(featureId: string) {
  const res = await fetch('http://localhost:7070/graph/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: `SELECT g.id, g.description FROM graph_nodes g
            JOIN graph_edges ge ON ge.from_node_id = g.id AND ge.kind = 'INFORMS'
            WHERE ge.to_node_id = $1 AND g.kind = 'GTM_PROJECTION'
            ORDER BY g.created_at DESC LIMIT 1`,
      params: [featureId],
    }), cache: 'no-store',
  })
  const [row] = await res.json()
  return row ? { id: row.id, data: JSON.parse(row.description) } : null
}
```

**Three distinct states, each with its own honest message:**

```tsx
{!valueAssessment ? (
  <div className="text-center py-16">
    <div className="text-4xl mb-3">🔒</div>
    <h3 className="font-bold text-base mb-2">We need a value estimate first</h3>
    <p className="text-ink-3 text-sm mb-5 max-w-sm mx-auto">
      Go-to-market planning builds on top of the business value assessment —
      head to the <b>Business Value</b> tab and estimate that first.
    </p>
    <Link href={`/business-cases/${featureId}/value`}>
      <button className="btn-ghost">Go to Business Value →</button>
    </Link>
  </div>
) : !gtmProjection ? (
  <div className="text-center py-16">
    <div className="text-4xl mb-3">🗺️</div>
    <h3 className="font-bold text-base mb-2">Let's figure out who this is for</h3>
    <p className="text-ink-3 text-sm mb-5">This takes about 10 seconds, using the value estimate you already have.</p>
    <button className="btn-primary" onClick={runGtmProjection}>Plan the go-to-market</button>
  </div>
) : (
  <GtmProjectionCard data={gtmProjection.data} />
)}
```

**This three-way branch is the core of this prompt** — a locked state with a
direct link to the thing you're missing, a ready-to-trigger state once the
dependency is satisfied, and the populated state. No generic "disabled button
with a tooltip" pattern anywhere here.

**Add Platform API route:**

```typescript
app.post<{ Params: { id: string } }>('/business-cases/:id/plan-gtm', async (req) => {
  const assessment = await queryOne<{ id: number }>(
    `SELECT id FROM graph_nodes WHERE kind='BUSINESS_IMPACT'
     AND id IN (SELECT from_node_id FROM graph_edges WHERE to_node_id=$1 AND kind='ESTIMATES')
     ORDER BY created_at DESC LIMIT 1`, [req.params.id]
  )
  if (!assessment) return { error: 'No business value assessment exists yet' }

  const adapter = await createHttpAdapter(PLATFORM_URL, GTM_STRATEGY_MANIFEST)
  const agent = new GtmStrategyAgent(adapter, llm)
  const result = await agent.run({
    assessmentId: assessment.id, featureId: parseInt(req.params.id),
    featureLabel: /* fetched separately or passed from client */ req.body.featureLabel,
  })
  return result
})
```

**Acceptance gate:** A case with no value estimate shows the locked state with a
working link to the Business Value tab. A case with a value estimate but no GTM
projection shows the trigger button. Neither state is a dead end — both explain
exactly what to do next.

---

## PROMPT 3 — The GTM projection card

**What to build:** `GtmProjectionCard`, the populated view.

```tsx
function GtmProjectionCard({ data }: { data: any }) {
  return (
    <div className="card">
      <div className="card-hd">
        <h2>How we'd bring this to market</h2>
        <p>{data.positioning}</p>
      </div>
      <div className="card-bd">

        <div className="mb-6">
          <h4 className="text-sm font-bold mb-3">Who this is for</h4>
          <div className="grid grid-cols-2 gap-3">
            {data.segments.map((seg: any, i: number) => <SegmentCard key={i} segment={seg} />)}
          </div>
        </div>

        <div className="mb-6">
          <h4 className="text-sm font-bold mb-2">How we'd reach them</h4>
          <p className="text-[13px] text-ink-2 leading-relaxed">{data.go_to_market}</p>
        </div>

        <div>
          <h4 className="text-sm font-bold mb-2">What makes this different</h4>
          <p className="text-[13px] text-ink-2 leading-relaxed">{data.competitive_differentiation}</p>
        </div>

      </div>
    </div>
  )
}
```

**`SegmentCard`** — the primary scannable unit, four data points at a glance:

```tsx
function SegmentCard({ segment }: { segment: any }) {
  const fitConfig: Record<string, { tier: string; label: string }> = {
    high:   { tier: 'ok',    label: 'Strong fit' },
    medium: { tier: 'amber', label: 'Reasonable fit' },
    low:    { tier: 'pink',  label: 'Uncertain fit' },
  }
  const fit = fitConfig[segment.fit] ?? fitConfig.medium

  return (
    <div className="border border-line rounded-xl2 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="font-bold text-[13.5px]">{segment.name}</div>
        <span className={`badge ${fit.tier}`}>{fit.label}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11.5px]">
        <MetricPair label="Segment size" value={segment.size} />
        <MetricPair label="Cost to acquire (CAC)" value={segment.cac} />
        <MetricPair label="Lifetime value (LTV)" value={segment.ltv} className="col-span-2" />
      </div>
    </div>
  )
}

function MetricPair({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <div className="text-ink-3">{label}</div>
      <div className="font-semibold text-ink-1 capitalize">{value}</div>
    </div>
  )
}
```

**Note on data shape**: the agent currently returns `size`, `cac`, and `ltv` as
qualitative strings (`"small"|"medium"|"large"`, `"low"|"medium"|"high"`, etc.),
not dollar figures — this is intentional and matches how the agent actually
works today. Render them as-is with `capitalize`, don't invent fake numbers to
make the card look more quantitative than the underlying estimate actually is.

**Acceptance gate:** Each segment renders as its own card with a fit badge,
correctly colored (green for high fit, amber for medium, pink for low). CAC and
LTV always appear with their plain-language label attached, never as bare
acronyms.

---

## PROMPT 4 — Editable positioning statement (Editor/Admin only)

**Problem it solves:** The positioning line is the one field in this card a
marketing lead is most likely to want to rewrite in their own voice before it
goes in front of a steering committee — same editability precedent as the
Business Case screen's problem statement.

```tsx
<EditableField
  label="Positioning"
  value={data.positioning}
  onSave={(v) => savePositioning(v)}
  multiline
/>
```

**Add Platform API route:**

```typescript
app.patch<{ Params: { id: string }; Body: { positioning: string } }>(
  '/business-cases/:id/gtm/positioning', async (req) => {
    const projection = await queryOne<{ id: number; description: string }>(
      `SELECT g.id, g.description FROM graph_nodes g
       JOIN graph_edges ge ON ge.from_node_id = g.id AND ge.kind='INFORMS'
       WHERE ge.to_node_id = $1 AND g.kind='GTM_PROJECTION' LIMIT 1`, [req.params.id]
    )
    const data = JSON.parse(projection!.description)
    data.positioning = req.body.positioning
    await query(`UPDATE graph_nodes SET description = $1 WHERE id = $2`, [JSON.stringify(data), projection!.id])
    return { saved: true }
  }
)
```

Segments, go-to-market approach, and competitive differentiation stay read-only
in this prompt — only positioning is editable, matching the precedent that not
every field needs to be, and over-exposing edit controls dilutes which edits
actually matter.

**Acceptance gate:** Editing the positioning line and refreshing the page shows
the edit persisted. Segment cards remain non-editable.

---

## PROMPT 5 — Cross-link from the Business Cases board

**Modify** `packages/studio-web/app/(app)/business-cases/page.tsx` — add a
small top-segment indicator once a GTM projection exists, without crowding the
row (unlike value/effort, this doesn't get its own full stat slot — it's a
single chip):

```tsx
{item.top_segment && (
  <span className="pp-tag">🎯 {item.top_segment}</span>
)}
```

Derive `top_segment` server-side as the highest-fit segment's name from the
latest `GTM_PROJECTION` for that feature.

**Acceptance gate:** A case with a completed GTM projection shows its top
segment as a small chip alongside the existing status and pain-point-count tags
on the board row.

---

## PROMPT 6 — Seed a demo GTM projection

**Extend** `packages/platform/src/db/seed.ts`:

```typescript
const gtmProjection = await queryOne<{ id: number }>(`
  INSERT INTO graph_nodes (kind, label, description)
  VALUES ('GTM_PROJECTION', 'GTM: Bulk dispute filing for fleet accounts',
    '{"positioning":"The only toll platform that lets fleet managers resolve a week of disputes in one sitting.","segments":[{"name":"Enterprise fleet operators","size":"medium","fit":"high","cac":"low","ltv":"high"},{"name":"Mid-size logistics companies","size":"large","fit":"medium","cac":"medium","ltv":"medium"}],"go_to_market":"Lead with existing enterprise accounts already flagged as churn risks — a direct outreach campaign referencing their own support history performs best here.","competitive_differentiation":"Most competitors handle disputes one at a time; bulk resolution is currently a gap across the category."}')
  RETURNING id
`)

await query(`INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'INFORMS')`,
  [gtmProjection!.id, feature!.id])

console.log('Seeded 1 GTM projection for demo purposes')
```

**Acceptance gate:** After seeding, the demo case's Go-to-Market tab shows the
positioning statement, two segment cards (one "Strong fit," one "Reasonable
fit"), the reach strategy, and the differentiation paragraph — all without a
live LLM call.

---

## PROMPT 7 — End-to-end validation

1. **Log in** as the seeded Editor.
2. Open the seeded demo business case → **Go-to-Market** tab → confirm the
   positioning statement, two segment cards, reach strategy, and
   differentiation all render from seed data.
3. Confirm the **Enterprise fleet operators** card shows a green "Strong fit"
   badge and the **Mid-size logistics** card shows an amber "Reasonable fit"
   badge.
4. **Edit the positioning statement**, save, refresh → confirm the edit
   persisted and the segment cards are unaffected.
5. **Business Cases board** → confirm the top segment chip ("🎯 Enterprise
   fleet operators") appears on this case's row.
6. Create a **second, fresh business case** with no Business Value estimate run
   yet → open its Go-to-Market tab → confirm the **locked state** appears with
   a working link back to Business Value, not a generic disabled button.
7. On that same fresh case, **run Business Value first**, then return to
   Go-to-Market → confirm the locked state is now replaced by the trigger
   button ("Plan the go-to-market"), correctly reflecting the satisfied
   dependency.
8. **Log in as the seeded Viewer** → confirm the positioning field is
   read-only, with no edit affordance shown at all.

**If any step fails**, check first whether `GTM_STRATEGY_MANIFEST` matches the
actual export name (it may still be `PRODUCT_STRATEGY_MANIFEST` from before the
renaming decision — rename in the agent package itself, not just in the UI layer).

---

## File map — what each prompt creates or modifies

| Prompt | Files |
|---|---|
| 1 | `app/(app)/business-cases/[id]/page.tsx` (modified — 4th tab) |
| 2 | `app/(app)/business-cases/[id]/gtm/page.tsx`, `platform/server.ts` (+1 route) |
| 3 | Same page — `GtmProjectionCard`, `SegmentCard`, `MetricPair` components |
| 4 | Same page — editable positioning, `platform/server.ts` (+1 route) |
| 5 | `app/(app)/business-cases/page.tsx` (modified — top segment chip) |
| 6 | `platform/src/db/seed.ts` (extended) |
| 7 | Validation only |

**New Platform API routes added in this guide:** 2
**New Next.js pages:** 1
**New shared components:** 3 (`GtmProjectionCard`, `SegmentCard`, `MetricPair`)

---

*End of implementation guide. This is the last agent screen built independently
— the next and final guide in the Decide series covers Portfolio Advisor, which
reads all three assessments (Business Value, Engineering Effort, GTM Strategy)
built across these last three guides, combines them into one packet, and is
also where the human steering committee gate itself gets built — Admit, Defer,
or Reject, the screen where Decide actually ends.*
