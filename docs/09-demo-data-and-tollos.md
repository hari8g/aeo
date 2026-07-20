# Demo data & Toll.OS narrative

## Seed entrypoint

`packages/platform/src/db/seed.ts` → `pnpm -F @avp/platform db:seed`

1. Purges graph (`purgeGraph`)  
2. Seeds **Toll.OS** end-to-end including Ship → Learn → loop closed  
3. Seeds **StaaS** through packet assembly (awaiting decision)  
4. Seeds users + Hariprasad as CPO approver  

## Pricing

| Product | Unit price | Value currency |
|---------|------------|----------------|
| Toll.OS MLFF orchestration event | **₹5 / event (INR)** | INR (₹7.0M–₹11.0M/yr band) |
| StaaS 3PL inventory | n/a (project value) | EUR (€420K–€980K/yr) |

Per-event language appears in pain points, stories, ACs, domain rules, architecture interfaces, build docs, ship/learn copy, and fixtures (`meter-anpr-inr-event`).

## Toll.OS story arc

1. **Listen** — Under-captured ANPR / FASTag / LiDAR events lose ₹5 revenue  
2. **Decide** — Sized, GTM for national toll concessionaires, **Admitted**  
3. **Define** — Stories + domain + four bounded contexts  
4. **Build** — Changeset + QA pass + docs  
5. **Ship** — Green pipeline, clean scan, release approved, production healthy  
6. **Learn** — Outcomes judged, impact positive, lessons captured, **cycle closed**  

## Fixtures (Studio)

- `packages/studio-web/demo/mps-pain-points.json`  
- `packages/studio-web/demo/mps-feedback.csv`  

Keep these aligned with seed labels when editing demo copy.
