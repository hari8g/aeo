# API routes (Platform ↔ Studio BFF)

All Platform studio routes require header:

```http
X-Studio-Secret: avp-studio-dev-secret
```

Next BFF routes live under `packages/studio-web/app/api/**` and add session RBAC.

## Listen / shared

| Platform | Next BFF |
|----------|----------|
| `GET /studio/stats` | home |
| `GET /studio/pain-points` | `/api/pain-points` |
| `GET /studio/public/settings` | login / settings |
| `GET /studio/loop/closed` | home closed-cycle banner |

## Decide

| Platform | Next BFF |
|----------|----------|
| `GET /studio/business-cases` | `/api/business-cases` |
| `GET/PATCH/POST /studio/business-cases/:id…` | `/api/business-cases/:id…` |
| `GET/POST /studio/gtm…` | `/api/gtm…` |
| `GET/POST /studio/portfolio…` | `/api/portfolio…` |
| `GET /studio/decisions` | `/api/decisions` |
| `GET/POST/DELETE /team/approvers…` | `/api/team/approvers…` |

## Define

| Platform | Next BFF |
|----------|----------|
| `GET /studio/requirements` | `/api/requirements` |
| `GET /studio/requirements/:id` | `/api/requirements/:id` |
| `POST /studio/requirements/:id/draft` | `/api/requirements/:id/draft` |
| `GET /studio/domain` | `/api/domain` |
| `GET /studio/domain/:id` | `/api/domain/:id` |
| `POST /studio/domain/:id/draft` | `/api/domain/:id/draft` |
| `GET /studio/architecture` | `/api/architecture` |
| `GET /studio/architecture/:id` | `/api/architecture/:id` |
| `POST /studio/architecture/:id/draft` | `/api/architecture/:id/draft` |

## Build

| Platform | Next BFF |
|----------|----------|
| `GET /studio/build` | `/api/build` |
| `GET /studio/build/:id` | `/api/build/:id` |
| `POST /studio/build/:id/record` | `/api/build/:id/record` |
| `GET /studio/quality` | `/api/quality` |
| `GET /studio/quality/:id` | `/api/quality/:id` |
| `POST /studio/quality/:id/run` | `/api/quality/:id/run` |
| `GET /studio/docs` | `/api/docs` |
| `GET /studio/docs/:id` | `/api/docs/:id` |
| `POST /studio/docs/:id/draft` | `/api/docs/:id/draft` |

## Ship

| Platform | Next BFF |
|----------|----------|
| `GET /studio/builds` | `/api/builds` |
| `POST /studio/builds/:id/record` | `/api/builds/:id/record` |
| `GET /studio/safety` | `/api/safety` |
| `POST /studio/safety/:id/run` | `/api/safety/:id/run` |
| `GET /studio/release` | `/api/release` |
| `POST /studio/release/:id/check` | `/api/release/:id/check` |
| `POST /studio/release/:id/approve` | `/api/release/:id/approve` |
| `GET /studio/rollout` | `/api/rollout` |
| `POST /studio/rollout/:id/deploy` | `/api/rollout/:id/deploy` |
| `POST /studio/rollout/:id/observe` | `/api/rollout/:id/observe` |

## Learn

| Platform | Next BFF |
|----------|----------|
| `GET /studio/outcomes` | `/api/outcomes` |
| `POST /studio/outcomes/:id/judge` | `/api/outcomes/:id/judge` |
| `GET /studio/impact` | `/api/impact` |
| `POST /studio/impact/:id/assess` | `/api/impact/:id/assess` |
| `GET /studio/lessons` | `/api/lessons` |
| `POST /studio/lessons/:id/capture` | `/api/lessons/:id/capture` |
| `POST /studio/lessons/:id/close` | `/api/lessons/:id/close` |

## Other Platform endpoints

- `POST /calibration` — used by Calibration agent  
- Graph / agent JWT routes remain separate from studio secret routes  

Full UI checklist: [`studio_implementation.md`](../studio_implementation.md).
