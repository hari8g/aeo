# Portfolio Advisor Studio — Cursor Implementation Guide
## The business-user-facing UI for the Portfolio Advisor Agent + the Portfolio Gate (Decide phase, agent 5 of 5)

> **How to use this file**: This extends the same `studio-web` app built across
> the VoC Intelligence, Business Cases, Business Value, Engineering Effort, and
> GTM Strategy guides — same sidebar, same layout, same design tokens, same
> auth/RBAC, same tab strip. Do not scaffold a new app. Hand each prompt to
> Cursor in order inside the existing `packages/studio-web/` package.
>
> **What this is**: The screen where three independent assessments — value,
> effort, and go-to-market — get combined into one packet, and where a human
> steering committee actually makes the Admit / Defer / Reject decision. This
> is the last screen in Decide, and it is the only screen in this entire
> five-guide series with a real, permanent, high-stakes write: an Admit
> decision locks every draft hypothesis from the Business Value guide into a
> measured commitment before any code is written.
>
> **Where it sits**: This is the fifth tab on the business case detail page.
> Unlike every previous tab, it has no "trigger and wait" pattern of its own —
> it only becomes meaningful once Business Value, Engineering Effort, and GTM
> Strategy have all completed, and its primary content is a decision form, not
> an estimate.

---

## Prerequisites

```bash
cd avp/packages/studio-web
pnpm dev

curl http://localhost:7070/health
```

A business case needs completed Business Value, Engineering Effort, and GTM
Strategy assessments (from the three previous guides) before this screen has
anything to assemble a packet from.

---

## Ground rules for Cursor

1. **Reuse everything already built.** `Tab`, `ConfidenceBadge`,
   `ComplexityBadge`, `SegmentCard`, card/pill/button styles — all exist.
   Import, don't recreate.
2. **This screen shows evidence, it does not repeat the LLM's recommendation as
   if it were a verdict.** The Portfolio Advisor Agent's recommendation
   (Admit/Defer/Reject) is one input among several a human considers — it must
   be visually distinct from the actual decision controls, never presented in
   a way that could be mistaken for the decision itself.
3. **The Admit action requires unambiguous confirmation.** This is the single
   most consequential click in the entire Decide phase — draft hypotheses
   become permanent, measured commitments. A confirmation dialog explaining
   exactly what becomes irreversible is mandatory, not optional polish.
4. **A rationale is required for every decision**, not just Admit. Defer and
   Reject both need a written reason — this is what the Organizational Learning
   Agent will eventually read back when closing the loop, months from now.
5. **Role behavior**: This is the one screen where even Editors are not
   automatically authorized. Only specific named roles (configured per
   workspace — e.g. "CPO," "VP Product," "VP Engineering") can record a gate
   decision. An Editor who isn't in the approver list can view everything but
   the decision buttons are absent for them, same as a Viewer.

---

## PROMPT 1 — Add the Portfolio Gate tab and the approver role concept

**Problem it solves:** The tab strip has four tabs. This adds the fifth, and
introduces a new idea not present in any earlier guide: a named list of people
authorized to approve, distinct from the existing Admin/Editor/Viewer roles.

**Modify** `packages/platform/src/db/schema.sql` — add one small table:

```sql
-- Named approvers for portfolio decisions — distinct from Admin/Editor/Viewer.
-- A workspace admin can be an approver too, but the two concepts are separate:
-- being able to manage the workspace doesn't automatically mean you're
-- authorized to admit features into the roadmap.
CREATE TABLE IF NOT EXISTS studio_approvers (
  workspace_id TEXT NOT NULL DEFAULT 'default',
  user_id      UUID NOT NULL REFERENCES studio_users(id),
  title        TEXT NOT NULL,   -- 'CPO', 'VP Engineering', 'VP Product', etc — free text
  PRIMARY KEY (workspace_id, user_id)
);
```

**Modify** `packages/studio-web/app/(app)/business-cases/[id]/page.tsx`:

```tsx
<Tab href={`/business-cases/${id}/gate`} label="Portfolio Gate" active={activeTab === 'gate'} />
```

**Acceptance gate:** Five tabs now appear. `studio_approvers` table exists and
is empty by default — no one is a pre-authorized approver until explicitly added
(covered in Prompt 6).

---

## PROMPT 2 — Assemble and display the packet

**Problem it solves:** This is the read-only evidence view — everything a
reviewer needs, pulled from the three prior assessments, presented as one
scannable page rather than three separate tab visits.

**Create** `packages/studio-web/app/(app)/business-cases/[id]/gate/page.tsx`

```typescript
async function getPacket(featureId: string) {
  const res = await fetch('http://localhost:7070/graph/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: `
        SELECT
          (SELECT description FROM graph_nodes WHERE kind='BUSINESS_IMPACT'
            AND id IN (SELECT from_node_id FROM graph_edges WHERE to_node_id=$1 AND kind='ESTIMATES')
            ORDER BY created_at DESC LIMIT 1) as value_json,
          (SELECT description FROM graph_nodes WHERE kind='DEV_IMPACT'
            AND id IN (SELECT from_node_id FROM graph_edges WHERE to_node_id=$1 AND kind='ESTIMATES')
            ORDER BY created_at DESC LIMIT 1) as effort_json,
          (SELECT description FROM graph_nodes WHERE kind='GTM_PROJECTION'
            AND id IN (SELECT from_node_id FROM graph_edges WHERE to_node_id=$1 AND kind='INFORMS')
            ORDER BY created_at DESC LIMIT 1) as gtm_json,
          (SELECT description FROM graph_nodes WHERE kind='PORTFOLIO_PACKET'
            AND id IN (SELECT from_node_id FROM graph_edges WHERE to_node_id=$1 AND kind='FUNDED_BY')
            ORDER BY created_at DESC LIMIT 1) as packet_json
      `, params: [featureId],
    }), cache: 'no-store',
  })
  const [row] = await res.json()
  return {
    value: row.value_json ? JSON.parse(row.value_json) : null,
    effort: row.effort_json ? JSON.parse(row.effort_json) : null,
    gtm: row.gtm_json ? JSON.parse(row.gtm_json) : null,
    packet: row.packet_json ? JSON.parse(row.packet_json) : null,
  }
}
```

**If any of the three assessments is missing**, show which ones and link
directly to them — same honest-dependency pattern as the GTM Strategy guide:

```tsx
{(!value || !effort || !gtm) && (
  <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-4 mb-6">
    <div className="font-bold text-amber text-sm mb-2">Not ready for review yet</div>
    <ul className="text-[13px] text-ink-2 space-y-1">
      {!value  && <li>• <Link href={`/business-cases/${id}/value`} className="underline">Business Value</Link> hasn't been estimated</li>}
      {!effort && <li>• <Link href={`/business-cases/${id}/effort`} className="underline">Engineering Effort</Link> hasn't been estimated</li>}
      {!gtm    && <li>• <Link href={`/business-cases/${id}/gtm`} className="underline">Go-to-Market</Link> hasn't been planned</li>}
    </ul>
  </div>
)}
```

**If a packet doesn't exist yet but all three assessments do**, show the
assemble trigger:

```tsx
{value && effort && gtm && !packet && (
  <div className="text-center py-12">
    <button className="btn-primary" onClick={assemblePacket}>Assemble the packet for review</button>
  </div>
)}
```

**Add Platform API route:**

```typescript
app.post<{ Params: { id: string } }>('/business-cases/:id/assemble-packet', async (req) => {
  const [biz, dev, gtm] = await Promise.all([/* three lookups, same as getPacket */])
  const adapter = await createHttpAdapter(PLATFORM_URL, PORTFOLIO_ADVISOR_MANIFEST)
  const agent = new PortfolioAdvisorAgent(adapter, llm)
  const result = await agent.run({
    featureId: parseInt(req.params.id),
    businessAssessmentId: biz.id, engAssessmentId: dev.id, projectionId: gtm.id,
  })
  return result   // { packetId, recommendation, valueScore, riskScore }
})
```

**Acceptance gate:** A case missing any of the three assessments shows exactly
which ones, each linking to the right tab. A case with all three but no packet
yet shows the assemble button. A case with a packet shows the full review view
built in Prompt 3.

---

## PROMPT 3 — The packet review view

**What to build:** The evidence summary, laid out so a reviewer can scan value,
risk, and the recommendation without re-deriving anything themselves.

```tsx
<div className="card mb-6">
  <div className="card-hd"><h2>The full picture</h2></div>
  <div className="card-bd">

    <div className="grid grid-cols-2 gap-4 mb-6">
      <ScoreGauge label="Value" score={packet.valueScore} />
      <ScoreGauge label="Risk" score={packet.riskScore} inverted />
    </div>

    <div className="p-4 bg-surface-1 rounded-xl2 mb-6">
      <div className="text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">System's suggestion — not the decision</div>
      <div className="flex items-center gap-2">
        <RecommendationBadge recommendation={packet.recommendation} />
        <span className="text-[12.5px] text-ink-2">{packet.summary}</span>
      </div>
    </div>

    <div className="grid grid-cols-3 gap-3 text-[12.5px]">
      <SummaryChip label="Estimated value" value={`$${value.valueLow.toLocaleString()}–${value.valueHigh.toLocaleString()}/yr`} />
      <SummaryChip label="Estimated effort" value={`${effort.effortWeeksLow}–${effort.effortWeeksHigh} weeks`} />
      <SummaryChip label="Best-fit segment" value={gtm.segments.sort((a:any,b:any) => fitRank(b.fit)-fitRank(a.fit))[0]?.name} />
    </div>

  </div>
</div>
```

**`ScoreGauge`** — a simple semicircular or linear gauge, not a raw number
alone, so "62/100" reads visually as "moderate" without requiring the viewer to
know what scale to expect:

```tsx
function ScoreGauge({ label, score, inverted = false }: { label: string; score: number; inverted?: boolean }) {
  const good = inverted ? score < 40 : score >= 60
  const mid  = inverted ? score < 70 : score >= 40
  const color = good ? 'ok' : mid ? 'amber' : 'pink'
  return (
    <div className="border border-line rounded-xl2 p-4 text-center">
      <div className="text-[11px] text-ink-3 mb-1">{label}</div>
      <div className={`text-2xl font-extrabold text-${color}`}>{score}<span className="text-sm text-ink-3">/100</span></div>
      <div className="w-full h-1.5 bg-surface-2 rounded-full mt-2 overflow-hidden">
        <div className={`h-full bg-${color}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  )
}
```

**`RecommendationBadge`** — visually distinct from the gate's own decision
buttons built in Prompt 4, using a lighter, more muted treatment specifically so
it never gets mistaken for an actual approved decision:

```tsx
function RecommendationBadge({ recommendation }: { recommendation: 'ADMIT'|'DEFER'|'REJECT' }) {
  const cfg = {
    ADMIT:  { tier: 'ok',    label: 'Suggests: Admit' },
    DEFER:  { tier: 'amber', label: 'Suggests: Defer' },
    REJECT: { tier: 'pink',  label: 'Suggests: Reject' },
  }[recommendation]
  return <span className={`badge ${cfg.tier}`} style={{ opacity: 0.85 }}>{cfg.label}</span>
}
```

**Acceptance gate:** The recommendation is visually muted (slightly lower
opacity, labeled "System's suggestion — not the decision") and sits in its own
grey box, clearly separated from the actual decision controls below it.

---

## PROMPT 4 — The decision form (the core of this guide)

**Problem it solves:** This is where a real, permanent decision gets recorded.
Every design choice here should make it harder to click through carelessly, not
easier.

```tsx
<div className="card">
  <div className="card-hd"><h2>Steering committee decision</h2></div>
  <div className="card-bd">

    {!isApprover ? (
      <p className="text-[13px] text-ink-3 py-6 text-center">
        Only designated approvers can record a decision here. You can review
        everything above, but this action is reserved for {approverTitles.join(', ')}.
      </p>
    ) : (
      <>
        <div className="grid grid-cols-3 gap-2 mb-4">
          <DecisionOption
            value="admit" selected={decision === 'admit'} onSelect={setDecision}
            title="Admit" tier="ok"
            body="This becomes committed. Every bet in the value estimate locks in as a measured commitment before any code is written."
          />
          <DecisionOption
            value="defer" selected={decision === 'defer'} onSelect={setDecision}
            title="Not now" tier="amber"
            body="Goes back to Listen. More evidence can be gathered before this comes up again."
          />
          <DecisionOption
            value="reject" selected={decision === 'reject'} onSelect={setDecision}
            title="No" tier="pink"
            body="Closes this out. The reasoning is kept so we don't re-propose the same idea blind."
          />
        </div>

        <label className="block mb-4">
          <span className="text-[12.5px] font-bold block mb-1.5">Your reasoning (required)</span>
          <textarea
            className="w-full border border-line2 rounded-lg p-3 text-[13px]" rows={3}
            placeholder="Why this decision — this is permanently recorded."
            value={rationale} onChange={e => setRationale(e.target.value)}
          />
          {rationale.length > 0 && rationale.length < 10 && (
            <span className="text-[11px] text-pink">A few more words would help future reviewers understand this.</span>
          )}
        </label>

        <select className="set-select mb-4 w-full" value={approverTitle} onChange={e => setApproverTitle(e.target.value)}>
          {myApproverTitles.map(t => <option key={t} value={t}>Deciding as: {t}</option>)}
        </select>

        <button
          className="btn-primary w-full"
          disabled={!decision || rationale.length < 10}
          onClick={() => setShowConfirm(true)}
        >
          Record this decision
        </button>
      </>
    )}
  </div>
</div>
```

**`DecisionOption`** — a large, clearly differentiated radio-card, not a
dropdown — the decision should feel weighty, not like picking an item from a list.

**Acceptance gate:** The Record button stays disabled until both a decision is
selected and the rationale is at least 10 characters. Non-approvers see the
explanatory message instead of any decision controls at all — this is not just
a disabled button, the controls are absent from the DOM.

---

## PROMPT 5 — The confirmation dialog for Admit

**Problem it solves:** Ground rule 3 — Admit is irreversible and must feel that
way before it happens, not after.

```tsx
{showConfirm && decision === 'admit' && (
  <ConfirmDialog
    title="This locks in permanently"
    body={
      <>
        <p className="mb-3">Once you confirm, the following becomes permanent and cannot be edited:</p>
        <ul className="space-y-1.5 mb-3">
          {value.hypotheses.map((h: any, i: number) => (
            <li key={i} className="text-[12.5px] flex gap-2">
              <span className="text-ok">🔒</span>
              {h.direction === 'decrease' ? 'Cut' : 'Grow'} {prettifyKpiName(h.kpi)} by {h.magnitudePct}% within {h.timeframeDays} days
            </li>
          ))}
        </ul>
        <p className="text-[12.5px] text-ink-3">
          These become measured commitments. When the feature ships, we'll check
          whether each of these actually happened — regardless of the outcome.
        </p>
      </>
    }
    confirmLabel="Yes, admit this and lock it in"
    onConfirm={submitDecision}
    onCancel={() => setShowConfirm(false)}
  />
)}

{showConfirm && decision !== 'admit' && (
  <ConfirmDialog
    title={decision === 'defer' ? 'Send back to Listen?' : 'Reject this idea?'}
    body={<p>{rationale}</p>}
    confirmLabel={decision === 'defer' ? 'Yes, defer it' : 'Yes, reject it'}
    onConfirm={submitDecision}
    onCancel={() => setShowConfirm(false)}
  />
)}
```

**Add Platform API route** — this is the write that actually flips
`committed: false` to `committed: true` on every hypothesis, and advances the
cycle:

```typescript
app.post<{ Params: { id: string }; Body: {
  decision: 'admit'|'defer'|'reject'; role: string; rationale: string
} }>('/business-cases/:id/gate/decide', async (req) => {
  const cycle = await queryOne<{ id: string }>(`SELECT id FROM cycles WHERE feature_id=$1`, [req.params.id])
  const orchestrator = getOrchestrator()   // the CycleOrchestrator instance from the AVP platform build
  const nodeId = await orchestrator.recordGate(
    cycle!.id, 'PORTFOLIO_GATE', req.body.decision, req.body.role, req.body.rationale,
  )

  if (req.body.decision === 'admit') {
    // Flip every draft hypothesis for this feature to committed
    await query(`
      UPDATE graph_nodes SET metadata = metadata || '{"committed":true}'
      WHERE kind='VALUE_HYPOTHESIS'
        AND id IN (SELECT from_node_id FROM graph_edges WHERE to_node_id IN (
          SELECT id FROM graph_nodes WHERE kind='BUSINESS_IMPACT'
            AND id IN (SELECT from_node_id FROM graph_edges WHERE to_node_id=$1 AND kind='ESTIMATES')
        ) AND kind='SUPPORTS')
    `, [req.params.id])
  }

  return { nodeId, decision: req.body.decision }
})
```

**Acceptance gate:** Confirming Admit lists every specific hypothesis that will
lock, by name, before the click is final. After confirming, querying
`VALUE_HYPOTHESIS` nodes for this feature shows `committed: true` on all of
them. Confirming Defer moves the cycle's stage back to `SIGNALS`. Confirming
Reject sets the cycle status to a terminal rejected state.

---

## PROMPT 6 — Managing approvers (Admin-only, in Team & Access)

**Problem it solves:** Someone has to be able to add approvers — this belongs
in the existing Team & Access screen from the VoC guide, not a new page.

**Modify** `packages/studio-web/app/(app)/access/page.tsx` — add a section:

```tsx
<div className="mt-8 pt-6 border-t border-line">
  <h3 className="font-bold text-sm mb-1">Portfolio approvers</h3>
  <p className="text-[12px] text-ink-3 mb-4">Who can record Admit / Defer / Reject decisions</p>
  <div className="flex gap-2 mb-4">
    <select className="role-select flex-1"><option>Select a team member</option>{/* populate from studio_users */}</select>
    <input className="invite-input" placeholder="Title (e.g. VP Engineering)" style={{ maxWidth: 220 }} />
    <button className="btn btn-primary">Add as approver</button>
  </div>
  <div className="space-y-2">
    {/* list of current approvers, each with a Remove action */}
  </div>
</div>
```

**Add Platform API routes:**

```typescript
app.post<{ Body: { userId: string; title: string } }>('/team/approvers', async (req) => {
  await query(`INSERT INTO studio_approvers (user_id, title) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [req.body.userId, req.body.title])
  return { added: true }
})
app.delete<{ Params: { userId: string } }>('/team/approvers/:userId', async (req) => {
  await query(`DELETE FROM studio_approvers WHERE user_id=$1`, [req.params.userId])
  return { removed: true }
})
```

**Acceptance gate:** Adding a team member as an approver with a title makes the
decision form on the Portfolio Gate tab actually appear for that user on their
next visit. Removing them makes the form disappear again, replaced by the
"reserved for" message.

---

## PROMPT 7 — Seed a demo-ready packet

**Extend** `packages/platform/src/db/seed.ts`:

```typescript
const packet = await queryOne<{ id: number }>(`
  INSERT INTO graph_nodes (kind, label, description, metadata)
  VALUES ('PORTFOLIO_PACKET', 'Decision packet: Bulk dispute filing for fleet accounts',
    '{"featureId":${feature!.id},"valueScore":71,"riskScore":38,"recommendation":"ADMIT","summary":"Strong evidence, moderate effort, clear customer demand across a well-understood segment."}',
    '{"valueScore":71,"riskScore":38,"recommendation":"ADMIT"}')
  RETURNING id
`)

await query(`
  INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES
    ($1,$2,'FUNDED_BY'), ($1,$3,'PACKET_INCLUDES'), ($1,$4,'PACKET_INCLUDES'), ($1,$5,'PACKET_INCLUDES')
`, [packet!.id, feature!.id, valueAssessment!.id, effortAssessment!.id, gtmProjection!.id])

// Make the seeded admin an approver so the demo is immediately usable
const admin = await queryOne<{ id: string }>(`SELECT id FROM studio_users WHERE email='sarah@yourcompany.com'`)
await query(`INSERT INTO studio_approvers (user_id, title) VALUES ($1,'CPO') ON CONFLICT DO NOTHING`, [admin!.id])

console.log('Seeded 1 portfolio packet + 1 approver for demo purposes')
```

**Acceptance gate:** After seeding, the demo case's Portfolio Gate tab shows a
71/100 value gauge, 38/100 risk gauge, a muted "Suggests: Admit" badge, and the
seeded admin (logged in as Sarah) sees the full decision form because she's a
pre-seeded approver.

---

## PROMPT 8 — End-to-end validation

1. **Log in** as the seeded admin/approver (`sarah@yourcompany.com`).
2. Open the demo case → **Portfolio Gate** tab → confirm both gauges, the muted
   recommendation badge, and the summary chips all render from seed data.
3. Confirm the recommendation badge is visually distinct (lighter, labeled
   "System's suggestion") from the decision options below it.
4. Select **Admit**, leave rationale blank → confirm "Record this decision"
   stays disabled.
5. Type a rationale under 10 characters → confirm the gentle length hint
   appears and the button stays disabled.
6. Type a proper rationale, click **Record this decision** → confirm the
   confirmation dialog lists the specific hypotheses by name before anything
   is final.
7. Confirm → query `VALUE_HYPOTHESIS` nodes for this feature → confirm all show
   `committed: true`.
8. **Log in as the seeded Editor** (`raj@yourcompany.com`, not a pre-seeded
   approver) → open the Portfolio Gate tab on a different, fresh case → confirm
   the "reserved for" message appears instead of decision controls.
9. **Team & Access** (as admin) → add Raj as an approver with title "VP
   Engineering" → log back in as Raj → confirm the decision form now appears
   for him on that same case.

**If any step fails**, check first whether `PORTFOLIO_ADVISOR_MANIFEST` matches
the actual export name (it may still be `PORTFOLIO_MGMT_MANIFEST` from before
the renaming decision), and second whether `getOrchestrator()` correctly
references the running `CycleOrchestrator` instance from the platform server
rather than constructing a new, disconnected one.

---

## File map — what each prompt creates or modifies

| Prompt | Files |
|---|---|
| 1 | `platform/src/db/schema.sql` (+1 table), `business-cases/[id]/page.tsx` (5th tab) |
| 2 | `app/(app)/business-cases/[id]/gate/page.tsx`, `platform/server.ts` (+1 route) |
| 3 | Same page — `ScoreGauge`, `RecommendationBadge`, `SummaryChip` components |
| 4 | Same page — `DecisionOption` component, decision form |
| 5 | Same page — `ConfirmDialog` usage, `platform/server.ts` (+1 route, the gate write) |
| 6 | `app/(app)/access/page.tsx` (modified — approver management), `platform/server.ts` (+2 routes) |
| 7 | `platform/src/db/seed.ts` (extended) |
| 8 | Validation only |

**New Platform API routes added in this guide:** 4
**New Next.js pages:** 1
**New shared components:** 4 (`ScoreGauge`, `RecommendationBadge`, `DecisionOption`, `SummaryChip`)
**New database tables:** 1 (`studio_approvers`)

---

*End of implementation guide — and end of the Decide phase series. All five
agents (Business Case, Business Value, Engineering Effort, GTM Strategy,
Portfolio Advisor) now have complete business-facing screens, chained together
on one business case detail page with five tabs, ending in a real, permanent
human decision. The next phase in the series is Define — Requirements Analyst
and Solutions Architect — which begins the moment a feature is Admitted here.*
