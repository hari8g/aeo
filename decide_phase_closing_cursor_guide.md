# Decide Phase — Closing Implementation Guide
## The connective work that ties all five agent screens into one coherent phase

> **How to use this file**: This is the capstone guide for Decide. The five
> previous guides each built one agent's screen correctly in isolation —
> Business Case, Business Value, Engineering Effort, GTM Strategy, Portfolio
> Advisor. What's still missing is what makes them read as *one phase* rather
> than five separate tools: a board that reflects the full lifecycle end to
> end, a record of past decisions for governance, Home-page visibility for
> people waiting on a decision, honest post-decision feedback, and a
> notification hook so approvers don't have to remember to check back.
>
> Hand each prompt to Cursor in order, inside the existing `packages/studio-web/`
> package. Nothing here creates a new app or a new agent — everything below
> reads from data the five previous guides already produce.

---

## Prerequisites

```bash
cd avp/packages/studio-web
pnpm dev
curl http://localhost:7070/health
```

All five previous guides' prompts must be complete — this guide assumes
`/business-cases`, and the five tabs on `/business-cases/[id]/*`, all exist and
work.

---

## Ground rules for Cursor

1. **No new agents, no new LLM calls.** Everything in this guide reads and
   organizes data the five agent guides already write. If a prompt seems to
   need a new agent, that's a signal something upstream was missed — stop and
   flag it rather than inventing one here.
2. **The board's status lifecycle is the single source of truth for "where is
   this case."** Once this guide is done, a user should never need to click
   into a case to know roughly what stage it's at — the board row tells them.
3. **Decision history is append-only and admin-visible to everyone**, not just
   approvers — a Viewer should be able to see *what* was decided and *why*,
   even though they couldn't have made the decision themselves. Transparency
   after the fact is different from authority beforehand.
4. **Every notification is opt-in and tied to the existing Settings screen**,
   not a new preferences system. Reuse `studio_settings` from the VoC guide.

---

## PROMPT 1 — Complete the Business Cases board's status lifecycle

**Problem it solves:** The board (built in the Business Cases guide) only ever
learned three statuses: Needs your review, Draft, Sent for sizing. It has no
idea a case can be mid-sizing, waiting at the gate, or already decided — which
means right now every case that's been through the whole phase still just says
"Sent for sizing" forever. This is the single biggest gap left in Decide.

**Modify** `packages/studio-web/app/(app)/business-cases/page.tsx` — replace the
status derivation with the full lifecycle:

```typescript
type CaseStatus =
  | 'needs_review'      // duplicate flagged, unresolved
  | 'draft'             // brief written, not sent for sizing yet
  | 'sizing'             // sent for sizing, at least one of value/effort/gtm still missing
  | 'awaiting_decision'  // all three assessments done, packet assembled, no gate decision yet
  | 'admitted'
  | 'deferred'
  | 'rejected'

async function getBusinessCases() {
  const res = await fetch('http://localhost:7070/graph/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: `
        SELECT
          f.id as feature_id, f.label as title, f.metadata as feature_meta,
          b.description as brief_json,
          (SELECT description FROM graph_nodes WHERE kind='BUSINESS_IMPACT'
            AND id IN (SELECT from_node_id FROM graph_edges WHERE to_node_id=f.id AND kind='ESTIMATES')
            ORDER BY created_at DESC LIMIT 1) as value_json,
          (SELECT description FROM graph_nodes WHERE kind='DEV_IMPACT'
            AND id IN (SELECT from_node_id FROM graph_edges WHERE to_node_id=f.id AND kind='ESTIMATES')
            ORDER BY created_at DESC LIMIT 1) as effort_json,
          (SELECT description FROM graph_nodes WHERE kind='GTM_PROJECTION'
            AND id IN (SELECT from_node_id FROM graph_edges WHERE to_node_id=f.id AND kind='INFORMS')
            ORDER BY created_at DESC LIMIT 1) as gtm_json,
          (SELECT description FROM graph_nodes WHERE kind='PORTFOLIO_PACKET'
            AND id IN (SELECT from_node_id FROM graph_edges WHERE to_node_id=f.id AND kind='FUNDED_BY')
            ORDER BY created_at DESC LIMIT 1) as packet_json,
          (SELECT metadata FROM graph_nodes WHERE kind='DECISION_RECORD'
            AND (metadata->>'gate')='PORTFOLIO_GATE' AND (metadata->>'cycleId') IN
            (SELECT id::text FROM cycles WHERE feature_id=f.id)
            ORDER BY created_at DESC LIMIT 1) as decision_meta
        FROM graph_nodes f WHERE f.kind='FEATURE'
        ORDER BY f.created_at DESC
      `,
    }), cache: 'no-store',
  })
  return res.json()
}

function deriveStatus(row: any): CaseStatus {
  const brief = JSON.parse(row.brief_json ?? '{}')
  const decision = row.decision_meta

  if (decision?.decision === 'admit')  return 'admitted'
  if (decision?.decision === 'defer')  return 'deferred'
  if (decision?.decision === 'reject') return 'rejected'
  if (brief.isDuplicate && !brief.duplicateResolved) return 'needs_review'
  if (!row.feature_meta?.sentForSizing) return 'draft'
  if (row.packet_json) return 'awaiting_decision'
  return 'sizing'
}
```

**Status badge styling** — this is the visual language for the whole board now:

```tsx
const STATUS_CONFIG: Record<CaseStatus, { label: string; tier: string }> = {
  needs_review:      { label: 'Needs your review',   tier: 'amber' },
  draft:             { label: 'Draft',                tier: 'grey'  },
  sizing:            { label: 'Sizing in progress',   tier: 'blue'  },
  awaiting_decision: { label: 'Awaiting decision',    tier: 'amber' },
  admitted:          { label: '✓ Admitted',           tier: 'ok'    },
  deferred:          { label: '↩ Deferred',           tier: 'grey'  },
  rejected:          { label: '✗ Rejected',           tier: 'pink'  },
}
```

**Acceptance gate:** A case that has all three assessments and a packet, but no
gate decision, now correctly shows "Awaiting decision" instead of the old
permanent "Sent for sizing." A case that's been admitted shows "✓ Admitted" and
this status never reverts. Deferred cases show "↩ Deferred."

---

## PROMPT 2 — Filters that match the new lifecycle

**Modify** the filter chips row on the same page:

```tsx
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'needs_review', label: 'Needs your review' },
  { key: 'sizing', label: 'Being sized' },
  { key: 'awaiting_decision', label: 'Awaiting decision' },
  { key: 'admitted', label: 'Admitted' },
]
```

Deferred and Rejected are deliberately **not** given their own filter chips —
they're accessible via "All" but don't get prime real estate, since they're not
active work. This matches how the Pain Points board already treats stale items
(present, but visually and navigationally de-emphasized).

**Acceptance gate:** Filtering by "Awaiting decision" shows exactly the cases
sitting at the gate — this is now the most operationally useful filter on the
whole board, since it answers "what needs a steering committee to look at it."

---

## PROMPT 3 — Decision History (governance record)

**Problem it solves:** Once a decision is made, there's currently no page that
shows *why*, in one place, across all cases — this is what any real governance
process needs, and what the Organizational Learning Agent will eventually read
from months later.

**Create** `packages/studio-web/app/(app)/decisions/page.tsx` — a new top-level
page, added to the sidebar under the Decide group:

```tsx
// Sidebar addition (Prompt 3a)
{ href: '/decisions', label: 'Decision History', icon: ScrollText }
```

```typescript
async function getDecisionHistory() {
  const res = await fetch('http://localhost:7070/graph/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: `
        SELECT d.label, d.metadata, d.created_at,
               f.id as feature_id, f.label as feature_title
        FROM graph_nodes d
        JOIN cycles c ON (d.metadata->>'cycleId') = c.id::text
        JOIN graph_nodes f ON f.id = c.feature_id
        WHERE d.kind = 'DECISION_RECORD' AND (d.metadata->>'gate') = 'PORTFOLIO_GATE'
        ORDER BY d.created_at DESC
      `,
    }), cache: 'no-store',
  })
  return res.json()
}
```

**Render as a simple, dense timeline** — this page is reference material, not a
dashboard, so it should feel more like an audit log than a board:

```tsx
<div className="card">
  <div className="card-hd">
    <h2>Decision History</h2>
    <p>Every portfolio decision ever recorded, and why</p>
  </div>
  <div className="card-bd divide-y divide-line">
    {decisions.map((d: any) => (
      <div key={d.created_at} className="py-4 flex gap-4">
        <DecisionIcon decision={d.metadata.decision} />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Link href={`/business-cases/${d.feature_id}`} className="font-bold text-[13.5px] hover:underline">
              {d.feature_title}
            </Link>
            <DecisionBadge decision={d.metadata.decision} />
          </div>
          <p className="text-[12.5px] text-ink-2 mb-1">"{d.metadata.rationale}"</p>
          <p className="text-[11px] text-ink-3">
            {d.metadata.role} · {new Date(d.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>
    ))}
  </div>
</div>
```

**This page has no filters or search in this prompt** — keep it simple and
chronological. If the workspace grows large enough to need search, that's a
follow-up, not part of closing out Decide.

**Acceptance gate:** Every gate decision made across all five previous guides'
testing is visible here, in reverse-chronological order, with the actual
rationale text a reviewer typed — not a placeholder. This page is visible to
Viewers, unlike the decision-making controls themselves.

---

## PROMPT 4 — Home page: "waiting on you" for approvers

**Problem it solves:** The Home page (from the VoC guide) only ever showed
Listen-phase stats. An approver logging in has no way to know something needs
them without navigating to Business Cases and checking manually.

**Modify** `packages/studio-web/app/(app)/page.tsx`:

```typescript
async function getAwaitingDecisionCount(userId: string) {
  const res = await fetch('http://localhost:7070/graph/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: `
        SELECT COUNT(*) as count FROM graph_nodes p
        JOIN graph_edges ge ON ge.from_node_id = p.id AND ge.kind='FUNDED_BY'
        WHERE p.kind='PORTFOLIO_PACKET'
          AND NOT EXISTS (
            SELECT 1 FROM graph_nodes d WHERE d.kind='DECISION_RECORD'
              AND (d.metadata->>'gate')='PORTFOLIO_GATE'
              AND (d.metadata->>'cycleId') IN (SELECT id::text FROM cycles WHERE feature_id = ge.to_node_id)
          )
      `,
    }), cache: 'no-store',
  })
  const [row] = await res.json()
  return parseInt(row.count)
}
```

```tsx
{isApprover && awaitingCount > 0 && (
  <Link href="/business-cases?filter=awaiting_decision">
    <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-4 mb-6 flex items-center gap-3 hover:brightness-95">
      <span className="text-2xl">⏳</span>
      <div>
        <div className="font-bold text-[13.5px]">
          {awaitingCount} business case{awaitingCount > 1 ? 's' : ''} waiting on your decision
        </div>
        <div className="text-[12px] text-ink-2">Head to Business Cases to review →</div>
      </div>
    </div>
  </Link>
)}
```

This banner only renders for users who are actual approvers (`studio_approvers`
membership, from the Portfolio Advisor guide) — a Viewer or non-approving
Editor never sees it, since it wouldn't be actionable for them.

**Acceptance gate:** Logging in as the seeded approver with one packet awaiting
decision shows the banner at the very top of Home, above the existing stats
row. Logging in as a non-approver never shows it, even if packets are waiting.

---

## PROMPT 5 — Honest post-decision confirmation

**Problem it solves:** Right now, clicking through the Admit confirmation
dialog (from the Portfolio Advisor guide) just... finishes. There's no moment
that tells the user what happens next, which matters especially for Admit,
where a real, significant thing has just occurred.

**Modify** `packages/studio-web/app/(app)/business-cases/[id]/gate/page.tsx` —
after `submitDecision` succeeds, replace the decision form with a result state
rather than just refetching silently:

```tsx
{justDecided && (
  <div className={`text-center py-10 ${resultConfig[justDecided].bg} rounded-xl2`}>
    <div className="text-4xl mb-3">{resultConfig[justDecided].icon}</div>
    <h3 className="font-bold text-base mb-2">{resultConfig[justDecided].title}</h3>
    <p className="text-ink-2 text-[13px] max-w-sm mx-auto">{resultConfig[justDecided].body}</p>
  </div>
)}
```

```typescript
const resultConfig = {
  admit: {
    icon: '🎉', bg: 'bg-ok-bg',
    title: 'This is moving forward',
    body: 'The bets are locked in. This now heads into Define, where the actual requirements and architecture get worked out.',
  },
  defer: {
    icon: '↩️', bg: 'bg-surface-1',
    title: 'Sent back to Listen',
    body: "This will show up again once there's more customer evidence to bring to a future review.",
  },
  reject: {
    icon: '📋', bg: 'bg-surface-1',
    title: 'Closed out',
    body: "This won't move forward, but the reasoning is saved — it'll help avoid re-proposing the same idea without new information.",
  },
}
```

**Acceptance gate:** Immediately after confirming any of the three decisions,
the page shows a plain-language explanation of what happens next — not just a
silently updated status badge somewhere else on the screen.

---

## PROMPT 6 — Notify approvers when a packet is ready

**Problem it solves:** Right now an approver only finds out a packet is waiting
by logging in and seeing the Home banner from Prompt 4. This wires an actual
notification, reusing the existing settings infrastructure rather than
building a new preferences system.

**Modify** `packages/platform/src/server.ts` — inside the packet-assembly route
from the Portfolio Advisor guide, after the packet is written:

```typescript
// After: const result = await agent.run({...}) in /business-cases/:id/assemble-packet
const settings = await queryOne<{ notify_big_problems: boolean }>(
  `SELECT notify_big_problems FROM studio_settings WHERE workspace_id='default'`
)
if (settings?.notify_big_problems) {
  const approvers = await query<{ email: string; name: string }>(
    `SELECT u.email, u.name FROM studio_approvers a JOIN studio_users u ON u.id = a.user_id`
  )
  // Reuses whatever email provider is already configured for invitations
  // (Resend, SES, etc. — same one wired in the Team & Access guide's invite flow)
  for (const approver of approvers) {
    await sendEmail({
      to: approver.email,
      subject: `A business case needs your review`,
      body: `Hi ${approver.name} — a new business case is ready for your decision. Take a look: ${process.env.APP_URL}/business-cases/${req.params.id}/gate`,
    })
  }
}
```

**Note on the setting name**: this reuses `notify_big_problems` rather than
adding a new column — the existing VoC guide framed that toggle broadly enough
("Notify me about big problems") to cover this case too. If you want a
dedicated toggle instead, add one column (`notify_awaiting_decision`) to
`studio_settings` and a matching row on the Settings page — but don't build a
whole new notification preferences system for one email type.

**Acceptance gate:** Assembling a packet with the notification setting on sends
an email to every current approver. Turning the setting off in Settings and
assembling a different packet sends no email — confirming it's actually
respected, not just decorative.

---

## PROMPT 7 — End-to-end validation of the complete Decide phase

This is the full run-through, start to finish, that the previous five guides
each only validated in pieces.

1. **Log in** as the seeded admin/approver.
2. **Pain Points** → start a fresh business case from a pain point.
3. Confirm it shows **"Draft"** on the Business Cases board.
4. Open it, **Send for sizing** → confirm the board now shows **"Sizing in
   progress."**
5. Run **Business Value**, then **Engineering Effort**, then **GTM Strategy**
   → confirm the board status is still "Sizing in progress" after only two of
   three are done, and flips to **"Awaiting decision"** only once all three
   plus the packet exist.
6. Confirm the **Home page banner** now shows "1 business case waiting on your
   decision."
7. Open **Portfolio Gate** → **Admit** with a real rationale → confirm the
   honest post-decision message appears ("This is moving forward...").
8. Confirm the board now shows **"✓ Admitted"**, permanently.
9. **Decision History** → confirm the decision appears with the exact rationale
   typed, the right approver name/title, and today's date.
10. Confirm the **Home banner disappears** now that nothing is awaiting
    decision.
11. Repeat steps 2–6 with a second case, this time choosing **Defer** →
    confirm the board shows "↩ Deferred," Decision History logs it, and the
    case does not reappear in "Awaiting decision" filters.

**If any step fails**, the derived status logic in Prompt 1 is almost always
the culprit — walk through `deriveStatus()` by hand against the actual rows in
`graph_nodes`/`graph_edges` for that specific feature before assuming a UI bug.

---

## File map — what each prompt creates or modifies

| Prompt | Files |
|---|---|
| 1 | `app/(app)/business-cases/page.tsx` (modified — full status lifecycle) |
| 2 | Same page — updated filter chips |
| 3 | `app/(app)/decisions/page.tsx`, `components/Sidebar.tsx` (modified) |
| 4 | `app/(app)/page.tsx` (modified — approver banner) |
| 5 | `app/(app)/business-cases/[id]/gate/page.tsx` (modified — result state) |
| 6 | `platform/server.ts` (notification hook in existing route) |
| 7 | Validation only |

**New Next.js pages:** 1 (`/decisions`)
**New Platform API routes:** 0 — this guide only reads existing data and
extends one existing route with a notification side effect
**New database changes:** 0 (reuses `studio_settings`, `studio_approvers`,
`graph_nodes`/`graph_edges` entirely as-is)

---

*End of the Decide phase implementation series. Six guides total — VoC
Intelligence for Listen, five agent screens for Decide, and this closing guide
— now form one coherent product: a pain point becomes a business case, gets
sized from two independent angles plus a go-to-market read, converges into one
packet, and receives a real, auditable human decision that either locks in a
measured commitment or sends the idea back with a reason attached. The next
phase in the series is Define, picking up the moment a feature is Admitted here.*
