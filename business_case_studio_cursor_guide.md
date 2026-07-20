# Business Cases Studio — Cursor Implementation Guide
## The business-user-facing UI for the Business Case Agent (Decide phase, agent 1 of 5)

> **How to use this file**: This extends the same `studio-web` app built in the
> VoC Intelligence Studio guide — same sidebar, same layout, same design tokens,
> same auth/RBAC. Do not scaffold a new app. Hand each prompt to Cursor in order
> inside the existing `packages/studio-web/` package.
>
> **What this is**: The screen a Product Manager or Business Analyst uses to turn
> a customer pain point into a structured business case — title, problem
> statement, affected segment, evidence, and a duplicate check — before it moves
> on to value and effort sizing. No graph terminology, no LLM prompt visibility,
> no confidence-interval math. Plain business language throughout, same as the
> VoC screens.
>
> **Where it sits**: The Pain Points board (built in the VoC guide) is the entry
> point. Clicking "Start working on this" on a pain point lands here instead of
> silently starting a cycle — this screen is the missing middle step.

---

## Prerequisites

```bash
# Assumes packages/studio-web/ already exists and runs
cd avp/packages/studio-web
pnpm dev   # localhost:3000, already logged in as a seeded user

# Assumes Platform API is running with the VoC guide's routes already added
curl http://localhost:7070/health
```

---

## Ground rules for Cursor

1. **Reuse existing components.** `Sidebar`, `StatCard`, the toggle component, the
   button/pill styles, and the Tailwind tokens from Prompt 1 of the VoC guide are
   already built — import them, don't recreate them.
2. **No graph terminology in any UI string.** No "node," "FEATURE," "BRIEF,"
   "MOTIVATES edge." Use "business case," "problem," "idea already in progress."
3. **The agent's LLM output is never shown raw.** `isDuplicate`, `recommendation`,
   `evidenceSummary` are JSON fields on the graph — they get rendered as editable
   plain-language cards, never as a JSON blob or a technical field list.
4. **Every edit a user makes must be persisted**, not just held in React state.
   A PM editing the problem statement and refreshing the page must see their edit,
   not the agent's original draft.
5. **Role behavior**: Viewers can read a business case but not edit or send it.
   Editors and Admins can do both. Enforce this server-side in the API routes,
   not just by disabling buttons.

---

## PROMPT 1 — Extend navigation for the Decide domain

**Problem it solves:** The sidebar currently only has Listen-phase items. This adds
a "Decide" section, starting with Business Cases — more agents in Decide (Business
Value, Engineering Estimation, GTM Strategy, Portfolio Advisor) will each add their
own item here in later guides, following the same pattern.

**Modify** `packages/studio-web/components/Sidebar.tsx`:

```tsx
import { Home, Inbox, Lightbulb, Settings, Users, FileText } from 'lucide-react'

const NAV_GROUPS = [
  {
    label: null,   // ungrouped items at the top
    items: [{ href: '/', label: 'Home', icon: Home }],
  },
  {
    label: 'Listen',
    items: [
      { href: '/feedback', label: 'Add Feedback', icon: Inbox },
      { href: '/pain-points', label: 'Pain Points', icon: Lightbulb },
    ],
  },
  {
    label: 'Decide',
    items: [
      { href: '/business-cases', label: 'Business Cases', icon: FileText },
    ],
  },
  {
    label: null,
    items: [
      { href: '/settings', label: 'Settings', icon: Settings, adminOnly: true },
      { href: '/access', label: 'Team & Access', icon: Users, adminOnly: true },
    ],
  },
]
```

Render each group with a small uppercase label (matching the existing `grp` style
from the earlier mockup — `text-[9px] font-bold uppercase tracking-wider text-ink-3
px-3 pt-3 pb-1.5`) above its items, and no label at all for the ungrouped sections.

**Acceptance gate:** Sidebar now shows Home, a "Listen" group with 2 items, a
"Decide" group with 1 item (Business Cases), then Settings and Team & Access —
all in the same visual style as before, just organized into labeled sections.

---

## PROMPT 2 — Connect Pain Points to Business Cases

**Problem it solves:** Right now "Start working on this" on the Pain Points board
starts a cycle with no visible next step. It needs to land the user on a screen
where they can actually see and shape the business case being written.

**Modify** `packages/studio-web/app/(app)/pain-points/page.tsx` — change the CTA:

```tsx
// Before: calls POST /cycles directly with no visible follow-through
// After: navigates to the review screen, passing the pain point id
<Link href={`/business-cases/new?painPointId=${pp.id}&label=${encodeURIComponent(pp.label)}`}>
  <button className="btn-primary btn-sm">Start working on this →</button>
</Link>
```

**Acceptance gate:** Clicking the CTA on any pain point card navigates to
`/business-cases/new?painPointId=123&label=...` instead of silently starting
something in the background.

---

## PROMPT 3 — Business Cases board

**Create** `packages/studio-web/app/(app)/business-cases/page.tsx`

This is the list view — every business case in flight, at whatever stage, with
simple status filtering. Fetch from the graph:

```typescript
async function getBusinessCases() {
  const res = await fetch('http://localhost:7070/graph/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: `
        SELECT
          f.id as feature_id, f.label as title, f.metadata as feature_meta,
          b.id as brief_id, b.description as brief_json, b.created_at,
          (SELECT COUNT(*) FROM graph_edges ge WHERE ge.to_node_id = f.id AND ge.kind='MOTIVATES') as pain_point_count
        FROM graph_nodes f
        LEFT JOIN graph_edges ge2 ON ge2.to_node_id = f.id AND ge2.kind = 'MOTIVATES'
        LEFT JOIN graph_nodes b ON b.kind='BRIEF' AND b.id = ge2.from_node_id
        WHERE f.kind = 'FEATURE'
        ORDER BY f.created_at DESC
      `,
    }), cache: 'no-store',
  })
  return res.json()
}
```

**Status derivation** (compute client-side or in a view, not stored as a separate
column — it's derived from what's already on the graph):

| Status shown to user | Condition |
|---|---|
| **Needs your review** | Brief has `isDuplicate: true` and no merge decision recorded yet |
| **Draft** | Brief exists, not yet sent (no `brief_written` follow-on event recorded) |
| **Sent for sizing** | Brief exists and downstream `BUSINESS_IMPACT` or `DEV_IMPACT` node exists for this feature |

**Render** as rows matching the Pain Points board's visual style (colored accent
bar, title, tag chips for status, a count, and a CTA):

```tsx
<div className="pp-row">
  <div className={`accent ${statusColor(item.status)}`} />
  <div className="pp-main">
    <div className="pp-title">{item.title}</div>
    <div className="pp-tags">
      <StatusTag status={item.status} />
      <span className="pp-tag">{item.pain_point_count} pain point{item.pain_point_count > 1 ? 's' : ''}</span>
    </div>
  </div>
  <div className="pp-size"><div className="n">—</div><div className="lbl">customers</div></div>
  <Link href={`/business-cases/${item.feature_id}`}>
    <button className="btn-primary btn-sm">
      {item.status === 'Needs your review' ? 'Review →' : 'View case →'}
    </button>
  </Link>
</div>
```

**Filters row** at the top: All / Needs your review / Draft / Sent for sizing —
same filter-chip style as Pain Points.

**Acceptance gate:** Board lists every `FEATURE` node with its derived status.
Filtering by "Needs your review" shows only duplicate-flagged cases.

---

## PROMPT 4 — Generate a new business case

**Create** `packages/studio-web/app/(app)/business-cases/new/page.tsx`

This page reads `painPointId` and `label` from the query string, shows the pain
point summary at the top (reused from the Pain Points card style), and a single
prominent button: **"Write the business case"**.

**Add Platform API route** — `packages/platform/src/server.ts`:

```typescript
app.post<{ Body: { painPointIds: number[] } }>('/business-cases/generate', async (req) => {
  const painPoints = await query<{ id: number; label: string }>(
    `SELECT id, label FROM graph_nodes WHERE id = ANY($1)`, [req.body.painPointIds]
  )
  const adapter = await createHttpAdapter(PLATFORM_URL, BUSINESS_CASE_MANIFEST)
  const agent = new BusinessCaseAgent(adapter, llm)
  const result = await agent.run({
    painPointIds: painPoints.map(p => p.id),
    painPointLabels: painPoints.map(p => p.label),
  })
  return result   // { briefId, featureId }
})
```

**Client behavior**: clicking "Write the business case" calls this route, shows a
short loading state ("Drafting the case… this takes about 10 seconds"), then
redirects to `/business-cases/[featureId]` — the review screen built in Prompt 5.

**Acceptance gate:** From a pain point with no existing business case, clicking
through creates a real `BRIEF` and `FEATURE` node and lands on the review screen
with content already populated — not a blank form.

---

## PROMPT 5 — Business case review screen (the core screen)

**Create** `packages/studio-web/app/(app)/business-cases/[id]/page.tsx`

This is the most important screen in this guide. Fetch the feature and its brief:

```typescript
async function getBusinessCase(featureId: string) {
  const res = await fetch('http://localhost:7070/graph/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: `
        SELECT f.id as feature_id, f.label as title,
               b.id as brief_id, b.description as brief_json
        FROM graph_nodes f
        JOIN graph_edges ge ON ge.to_node_id = f.id AND ge.kind = 'MOTIVATES'
        JOIN graph_nodes b ON b.id = ge.from_node_id AND b.kind = 'BRIEF'
        WHERE f.id = $1 LIMIT 1
      `,
      params: [featureId],
    }), cache: 'no-store',
  })
  const [row] = await res.json()
  return { ...row, brief: JSON.parse(row.brief_json) }
}
```

### 5a — Duplicate warning (shown first, if flagged)

If `brief.isDuplicate === true`, show a warning card at the very top — same visual
pattern as the Pain Points dedup alert from the VoC guide:

```tsx
{brief.isDuplicate && (
  <div className="border-2 border-amber-bd bg-amber-bg rounded-xl2 p-4 mb-6">
    <div className="text-amber font-bold text-sm mb-2">⚠ This might already be in progress</div>
    <p className="text-ink-2 text-[13px] mb-3">
      This looks similar to an existing idea: <b>{brief.duplicateOf}</b>
    </p>
    <div className="flex gap-2">
      <button className="btn-ghost btn-sm" onClick={dismissDuplicate}>No, this is different</button>
      <button className="btn-primary btn-sm" onClick={mergeDuplicate}>Yes, combine these →</button>
    </div>
  </div>
)}
```

### 5b — Editable business case card

Four fields, each editable inline (click to edit, blur or explicit Save to persist):

```tsx
<div className="card">
  <div className="card-hd"><h2>{title}</h2></div>
  <div className="card-bd space-y-5">
    <EditableField label="Problem" value={brief.problemStatement} onSave={v => saveField('problemStatement', v)} multiline />
    <EditableField label="Who's affected" value={brief.customerSegment} onSave={v => saveField('customerSegment', v)} />
    <ReadOnlyField label="What we know" value={brief.evidenceSummary} hint="Pulled directly from customer feedback — not editable" />
    <ReadOnlyField label="Our take" value={brief.recommendation} hint="Suggested by the system based on similar past cases" />
  </div>
</div>
```

`EditableField` is a small shared component: shows plain text by default, becomes
a text input or textarea on click, shows a Save/Cancel pair, calls a PATCH route
on save.

**Add Platform API route:**

```typescript
app.patch<{ Params: { id: string }; Body: { field: string; value: string } }>(
  '/business-cases/:id/field', async (req) => {
    const brief = await queryOne<{ id: number; description: string }>(
      `SELECT b.id, b.description FROM graph_nodes b
       JOIN graph_edges ge ON ge.from_node_id = b.id AND ge.kind='MOTIVATES'
       WHERE ge.to_node_id = $1 AND b.kind='BRIEF' LIMIT 1`, [req.params.id]
    )
    const data = JSON.parse(brief!.description)
    data[req.body.field] = req.body.value
    await query(`UPDATE graph_nodes SET description = $1 WHERE id = $2`, [JSON.stringify(data), brief!.id])
    return { saved: true }
  }
)
```

### 5c — Merge action (for the duplicate warning)

```typescript
app.post<{ Params: { id: string }; Body: { mergeIntoFeatureId: number } }>(
  '/business-cases/:id/merge', async (req) => {
    // Re-point this feature's MOTIVATES edges onto the existing feature instead,
    // and mark this one as merged so it drops off the active board.
    await query(`UPDATE graph_nodes SET metadata = metadata || '{"status":"merged"}' WHERE id=$1`, [req.params.id])
    await query(`
      INSERT INTO graph_edges (from_node_id, to_node_id, kind)
      SELECT from_node_id, $2, kind FROM graph_edges WHERE to_node_id=$1 AND kind='MOTIVATES'
      ON CONFLICT DO NOTHING
    `, [req.params.id, req.body.mergeIntoFeatureId])
    return { merged: true }
  }
)
```

### 5d — Send for sizing

A prominent button at the bottom: **"Send for sizing →"**. This is the action that
actually advances the cycle — publishing the equivalent of `brief_written` so the
Business Value and Engineering Estimation agents (built in later guides) pick it up.

```typescript
app.post<{ Params: { id: string } }>('/business-cases/:id/send', async (req) => {
  // The brief_written event is already published by the agent when it ran —
  // this route just confirms human sign-off and updates status for the board.
  await query(`UPDATE graph_nodes SET metadata = metadata || '{"sentForSizing":true}' WHERE id=$1`, [req.params.id])
  return { sent: true }
})
```

Disable this button for Viewer-role users (check `session.user.role` server-side
in the page component, not just hide it client-side).

**Acceptance gate:** Editing "Who's affected" and refreshing the page shows the
edit persisted. If the brief was flagged as a duplicate, the warning appears
above everything else and clicking "Yes, combine these" removes this case from
the active board. Clicking "Send for sizing" changes the Business Cases board's
status tag for this item to "Sent for sizing."

---

## PROMPT 6 — Empty and loading states

**Add to** `/business-cases` (board): if no `FEATURE` nodes exist yet, show a
friendly empty state — "No business cases yet. Head to Pain Points to start one."
with a direct link.

**Add to** `/business-cases/new`: a loading skeleton (not a spinner) during the
~10-second agent generation call, matching the app's card layout so the page
doesn't jump when content arrives.

**Acceptance gate:** A fresh workspace with zero business cases shows the empty
state, not a blank white page.

---

## PROMPT 7 — Seed a demo business case for local development

**Extend** `packages/platform/src/db/seed.ts` from the VoC guide:

```typescript
// After seeding studio_users, seed one pain point + one business case for demo purposes
const pp = await queryOne<{ id: number }>(`
  INSERT INTO graph_nodes (kind, label, description, metadata)
  VALUES ('PAIN_POINT', 'Fleet operators cannot dispute charges in bulk',
          'Customers managing large fleets have no way to dispute multiple toll charges at once',
          '{"importanceScore":0.82,"signalCount":65}')
  RETURNING id
`)

const brief = await queryOne<{ id: number }>(`
  INSERT INTO graph_nodes (kind, label, description)
  VALUES ('BRIEF', 'Brief: Bulk dispute filing',
    '{"title":"Bulk dispute filing for fleet accounts","problemStatement":"Fleet operators managing 20+ vehicles must dispute each incorrect toll charge individually, costing hours per week.","customerSegment":"Enterprise fleet operators, 20+ vehicles","evidenceSummary":"65 customers raised this across support tickets and NPS comments in the last 30 days.","isDuplicate":false,"duplicateOf":null,"recommendation":"High customer demand with clear evidence — worth sizing."}')
  RETURNING id
`)

const feature = await queryOne<{ id: number }>(`
  INSERT INTO graph_nodes (kind, label, description, metadata)
  VALUES ('FEATURE', 'Bulk dispute filing for fleet accounts', 'Enable fleet customers to dispute multiple toll charges in one action', '{"stage":"INTAKE"}')
  RETURNING id
`)

await query(`INSERT INTO graph_edges (from_node_id, to_node_id, kind) VALUES ($1,$2,'MOTIVATES'), ($3,$2,'MOTIVATES')`,
  [pp!.id, feature!.id, brief!.id])

console.log('Seeded 1 pain point + 1 business case for demo purposes')
```

**Acceptance gate:** After seeding, the Business Cases board shows exactly one
entry, status "Draft," and clicking into it shows the full pre-filled case.

---

## PROMPT 8 — End-to-end validation

1. **Log in** as the seeded Editor (`raj@yourcompany.com`).
2. **Pain Points** → click "Start working on this" on any card → confirm landing
   on `/business-cases/new` with the pain point label shown.
3. Click **"Write the business case"** → confirm a ~10 second wait, then landing
   on the review screen with all four fields populated.
4. **Edit** the "Who's affected" field, save, refresh the page → confirm the edit
   persisted.
5. **Business Cases board** → confirm the new case appears with status "Draft."
6. Go back into the case, click **"Send for sizing"** → confirm the board now
   shows "Sent for sizing" for that row.
7. **Log in as the seeded Viewer** (`anita@yourcompany.com`) → open the same case →
   confirm the Save buttons and "Send for sizing" are disabled or hidden.
8. **Duplicate test**: manually create a second pain point with near-identical
   wording to the seeded one, generate a business case from it, and confirm the
   duplicate warning appears with the seeded case named as the match. Click
   "Yes, combine these" and confirm the new case disappears from the active board.

**If any step fails**, check first whether the Platform API route was registered
(Fastify silently 404s on typo'd routes), then whether the `BUSINESS_CASE_MANIFEST`
import path matches the actual package location from the earlier AVP agent build.

---

## File map — what each prompt creates or modifies

| Prompt | Files |
|---|---|
| 1 | `components/Sidebar.tsx` (modified — grouped nav) |
| 2 | `app/(app)/pain-points/page.tsx` (modified — CTA link) |
| 3 | `app/(app)/business-cases/page.tsx` |
| 4 | `app/(app)/business-cases/new/page.tsx`, `platform/server.ts` (+1 route) |
| 5 | `app/(app)/business-cases/[id]/page.tsx`, `components/EditableField.tsx`, `platform/server.ts` (+3 routes) |
| 6 | Empty/loading states in existing pages |
| 7 | `platform/src/db/seed.ts` (extended) |
| 8 | Validation only |

**New Platform API routes added in this guide:** 4
**New Next.js pages:** 3
**New shared components:** 1 (`EditableField`)

---

*End of implementation guide. The next guide in this series covers the Business
Value Agent and Engineering Estimation Agent screens — the two that run in
parallel once a business case is sent for sizing, each producing their own
independent estimate that the Portfolio Advisor Agent later combines.*
