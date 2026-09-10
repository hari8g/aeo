import * as THREE from 'three'
import { DEPTS, LAYOUT, PHASE_ORDER, PHASE_TO_DEPT, hexToInt } from './theme.js'

const PHASE_LABEL = {
  listen: 'Listen',
  decide: 'Decide',
  define: 'Define',
  build: 'Build',
  ship: 'Ship',
  learn: 'Learn',
}

/** Office I/O catalog — display adapters. Live status overlays from /api/connectors. */
export const ADAPTERS = [
  { id: 'zendesk', name: 'Zendesk', glyph: 'Zd', color: '#03363D', phase: 'listen', family: 'ITSM', io: 'in', reads: 'Tickets, macros, CSAT', writes: 'Triage tags' },
  { id: 'intercom', name: 'Intercom', glyph: 'Ic', color: '#1F8DED', phase: 'listen', family: 'Chat', io: 'in', reads: 'Conversations, tags', writes: 'Bot notes' },
  { id: 'salesforce', name: 'Salesforce', glyph: 'Sf', color: '#00A1E0', phase: 'listen', family: 'CRM', io: 'both', reads: 'Accounts, opportunities', writes: 'Lead scores' },
  { id: 'hubspot', name: 'HubSpot', glyph: 'Hs', color: '#FF7A59', phase: 'listen', family: 'CRM', io: 'both', reads: 'Contacts, deals', writes: 'Lifecycle stage' },
  { id: 'servicenow', name: 'ServiceNow', glyph: 'SN', color: '#81B5A1', phase: 'listen', family: 'ITSM', io: 'in', reads: 'Incidents, changes', writes: 'Problem records' },
  { id: 'qualtrics', name: 'Qualtrics', glyph: 'Qx', color: '#DE4B2A', phase: 'listen', family: 'VoC', io: 'in', reads: 'Surveys, NPS', writes: 'Theme clusters' },
  { id: 'gong', name: 'Gong', glyph: 'Go', color: '#7B61FF', phase: 'listen', family: 'Calls', io: 'in', reads: 'Call transcripts', writes: 'Talk-track gaps' },

  { id: 'sap', name: 'SAP', glyph: 'SA', color: '#0FAAFF', phase: 'decide', family: 'ERP', io: 'both', reads: 'Orders, cost centers', writes: 'Value packets' },
  { id: 'anaplan', name: 'Anaplan', glyph: 'An', color: '#1A73E8', phase: 'decide', family: 'Plan', io: 'both', reads: 'Forecast models', writes: 'Scenario diffs' },
  { id: 'powerbi', name: 'Power BI', glyph: 'PB', color: '#F2C811', phase: 'decide', family: 'BI', io: 'out', reads: 'Controlling cubes', writes: 'Scorecards' },
  { id: 'workday', name: 'Workday', glyph: 'Wd', color: '#0875E1', phase: 'decide', family: 'HR', io: 'in', reads: 'Headcount, cost', writes: 'Capacity notes' },
  { id: 'excel', name: 'Excel', glyph: 'Xl', color: '#217346', phase: 'decide', family: 'Pack', io: 'both', reads: 'Board packs', writes: 'Assumptions' },

  { id: 'jira', name: 'Jira', glyph: 'Jr', color: '#2684FF', phase: 'define', family: 'Work', io: 'both', reads: 'Epics, stories', writes: 'Acceptance criteria' },
  { id: 'confluence', name: 'Confluence', glyph: 'Cf', color: '#1868DB', phase: 'define', family: 'Wiki', io: 'both', reads: 'Specs, ADRs', writes: 'Requirement pages' },
  { id: 'linear', name: 'Linear', glyph: 'Ln', color: '#5E6AD2', phase: 'define', family: 'Work', io: 'both', reads: 'Issues, cycles', writes: 'Priority ranks' },
  { id: 'notion', name: 'Notion', glyph: 'No', color: '#111111', phase: 'define', family: 'Docs', io: 'both', reads: 'Briefs, PRDs', writes: 'Decision logs' },
  { id: 'figma', name: 'Figma', glyph: 'Fg', color: '#F24E1E', phase: 'define', family: 'Design', io: 'in', reads: 'Frames, comments', writes: 'Spec links' },
  { id: 'aha', name: 'Aha!', glyph: 'Ah', color: '#5C2D91', phase: 'define', family: 'Roadmap', io: 'in', reads: 'Releases, ideas', writes: 'Theme maps' },

  { id: 'github', name: 'GitHub', glyph: 'Gh', color: '#24292F', phase: 'build', family: 'Git', io: 'both', reads: 'PRs, commits, checks', writes: 'Review notes' },
  { id: 'gitlab', name: 'GitLab', glyph: 'Gl', color: '#FC6D26', phase: 'build', family: 'Git', io: 'both', reads: 'MRs, pipelines', writes: 'Quality gates' },
  { id: 'azuredevops', name: 'Azure DevOps', glyph: 'Az', color: '#0078D4', phase: 'build', family: 'CI', io: 'both', reads: 'Boards, pipelines', writes: 'Release notes' },
  { id: 'jenkins', name: 'Jenkins', glyph: 'Jk', color: '#D33833', phase: 'build', family: 'CI', io: 'in', reads: 'Job status', writes: 'Build evidence' },
  { id: 'circleci', name: 'CircleCI', glyph: 'Ci', color: '#343434', phase: 'build', family: 'CI', io: 'in', reads: 'Workflows', writes: 'Flake reports' },
  { id: 'sonarqube', name: 'SonarQube', glyph: 'Sq', color: '#4E9BCD', phase: 'build', family: 'Quality', io: 'in', reads: 'Coverage, smells', writes: 'Gate verdicts' },

  { id: 'slack', name: 'Slack', glyph: 'Sl', color: '#4A154B', phase: 'ship', family: 'Collab', io: 'both', reads: 'Channels, threads', writes: 'Launch pings' },
  { id: 'teams', name: 'Teams', glyph: 'Tm', color: '#6264A7', phase: 'ship', family: 'Collab', io: 'both', reads: 'Chats, meetings', writes: 'War-room notes' },
  { id: 'marketo', name: 'Marketo', glyph: 'Mk', color: '#5C4E9E', phase: 'ship', family: 'Campaign', io: 'both', reads: 'Nurture, MQLs', writes: 'Segment sync' },
  { id: 'linkedin', name: 'LinkedIn', glyph: 'Li', color: '#0A66C2', phase: 'ship', family: 'Social', io: 'out', reads: 'Campaigns', writes: 'Creative briefs' },
  { id: 'outreach', name: 'Outreach', glyph: 'Or', color: '#5952FF', phase: 'ship', family: 'Sequence', io: 'both', reads: 'Sequences', writes: 'Talk tracks' },
  { id: 'twilio', name: 'Twilio', glyph: 'Tw', color: '#F22F46', phase: 'ship', family: 'Comms', io: 'out', reads: 'SMS, voice', writes: 'Notify events' },

  { id: 'snowflake', name: 'Snowflake', glyph: 'Sw', color: '#29B5E8', phase: 'learn', family: 'Warehouse', io: 'in', reads: 'Facts, usage', writes: 'Feature impact' },
  { id: 'bigquery', name: 'BigQuery', glyph: 'Bq', color: '#4285F4', phase: 'learn', family: 'Warehouse', io: 'in', reads: 'Events, funnels', writes: 'Cohort marks' },
  { id: 'tableau', name: 'Tableau', glyph: 'Tb', color: '#E97627', phase: 'learn', family: 'BI', io: 'out', reads: 'Workbooks', writes: 'KPI packs' },
  { id: 'looker', name: 'Looker', glyph: 'Lk', color: '#4285F4', phase: 'learn', family: 'BI', io: 'out', reads: 'Looks, Explores', writes: 'Metric defs' },
  { id: 'datadog', name: 'Datadog', glyph: 'Dd', color: '#632CA6', phase: 'learn', family: 'Observability', io: 'in', reads: 'APM, SLOs', writes: 'Incident tags' },
  { id: 'splunk', name: 'Splunk', glyph: 'Sp', color: '#000000', phase: 'learn', family: 'Logs', io: 'in', reads: 'Search jobs', writes: 'Alert routes' },
  { id: 'pagerduty', name: 'PagerDuty', glyph: 'Pd', color: '#06AC38', phase: 'learn', family: 'Incident', io: 'in', reads: 'Pages, on-call', writes: 'Postmortems' },
]

const DEMO_LIVE = new Set([
  'zendesk',
  'intercom',
  'salesforce',
  'servicenow',
  'slack',
  'jira',
  'confluence',
  'figma',
  'github',
  'gitlab',
  'sap',
  'powerbi',
  'snowflake',
  'datadog',
  'teams',
])

export function adapterOf(id) {
  return ADAPTERS.find((a) => a.id === id) ?? null
}

const IO_KEY = 'office-io-collapsed'

function applyIoCollapsed(el, collapsed) {
  el.classList.toggle('is-collapsed', collapsed)
  document.documentElement.classList.toggle('office-io-min', collapsed)
  const toggle = el.querySelector('[data-io-toggle]')
  if (toggle) {
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
    toggle.textContent = collapsed ? 'Show' : 'Hide'
  }
  try {
    localStorage.setItem(IO_KEY, collapsed ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export function createConnectorBar(scene, { onSelect } = {}) {
  const el = document.createElement('div')
  el.id = 'office-connectors'
  el.innerHTML = `
    <div class="office-connectors__head">
      <button type="button" class="office-connectors__toggle" data-io-toggle aria-controls="office-io-grid">Hide</button>
      <div>
        <div class="office-connectors__label">I/O</div>
        <div class="office-connectors__title">Adapters &amp; connectors</div>
      </div>
      <div class="office-connectors__meta" data-meta></div>
    </div>
    <div class="office-connectors__grid" id="office-io-grid"></div>
  `
  document.body.appendChild(el)
  const grid = el.querySelector('.office-connectors__grid')
  const meta = el.querySelector('[data-meta]')
  let collapsed = false
  try {
    collapsed = localStorage.getItem(IO_KEY) === '1'
  } catch {
    collapsed = false
  }
  applyIoCollapsed(el, collapsed)
  const wires = new THREE.Group()
  wires.name = 'connector-wires'
  scene.add(wires)

  const items = ADAPTERS.map((a) => ({
    ...a,
    connected_at: DEMO_LIVE.has(a.id) ? 'demo' : null,
  }))

  function render(list) {
    const live = new Map()
    if (Array.isArray(list)) {
      for (const row of list) {
        const id = row.connector ?? row.id
        if (id) live.set(id, row.connected_at ?? null)
      }
    }
    for (const item of items) {
      if (live.has(item.id)) item.connected_at = live.get(item.id)
    }
    const onCount = items.filter((c) => c.connected_at).length
    meta.textContent = `${items.length} tools · ${onCount} live`
    grid.innerHTML = PHASE_ORDER.map((phase) => {
      const dept = DEPTS[PHASE_TO_DEPT[phase]]
      const group = items.filter((c) => c.phase === phase)
      return `<div class="office-connectors__group" data-phase="${phase}">
        <div class="office-connectors__group-label" style="--chip:${dept.chip}">
          <strong>${PHASE_LABEL[phase]}</strong>
          <em>${dept.name}</em>
        </div>
        <div class="office-connectors__row">
          ${group
            .map((c) => {
              const on = !!c.connected_at
              return `<button type="button" class="office-logo${on ? ' on' : ''}" data-id="${c.id}" title="${c.name} · ${c.family} · ${c.io}">
                <span class="swatch" style="background:${c.color}">${c.glyph}</span>
                <span class="name">${c.name}</span>
              </button>`
            })
            .join('')}
        </div>
      </div>`
    }).join('')
  }

  function pulse(connector, dept) {
    const btn = el.querySelector(`[data-id="${connector}"]`)
    if (btn) {
      btn.classList.add('pulse')
      setTimeout(() => btn.classList.remove('pulse'), 900)
    }
    const adapter = adapterOf(connector)
    const layout = LAYOUT[dept] || LAYOUT[PHASE_TO_DEPT[adapter?.phase]]
    if (!layout) return
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 12, -36),
      new THREE.Vector3(layout.pos[0], 3.2, layout.pos[1]),
    ])
    const line = new THREE.Line(
      geo,
      new THREE.LineDashedMaterial({
        color: hexToInt((adapter ?? { color: '#67e8f9' }).color),
        dashSize: 0.8,
        gapSize: 0.3,
        transparent: true,
        opacity: 0.85,
      }),
    )
    line.computeLineDistances()
    wires.add(line)
    setTimeout(() => {
      wires.remove(line)
      geo.dispose()
    }, 1200)
  }

  el.addEventListener('click', (ev) => {
    const toggle = ev.target.closest('[data-io-toggle]')
    if (toggle) {
      applyIoCollapsed(el, !el.classList.contains('is-collapsed'))
      return
    }
    const btn = ev.target.closest('[data-id]')
    if (!btn) return
    onSelect?.(items.find((a) => a.id === btn.getAttribute('data-id')))
  })

  render()
  return {
    el,
    render,
    pulse,
    list: () => items,
    get: (id) => items.find((a) => a.id === id) ?? adapterOf(id),
  }
}
