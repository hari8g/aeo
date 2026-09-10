import { DEPTS, KIND_TO_PHASE, PHASE_ORDER, PHASE_TO_DEPT } from './theme.js'

const PHASE_LABEL = {
  listen: 'Listen',
  decide: 'Decide',
  define: 'Define',
  build: 'Build',
  ship: 'Ship',
  learn: 'Learn',
}

const STATE_LABEL = {
  doing: 'In progress',
  waiting: 'Waiting approval',
  next: 'Queued',
  done: 'Done',
  sched: 'Scheduled',
}

export function createInspector({ onSelect, onGate, onClose }) {
  const el = document.createElement('aside')
  el.id = 'office-inspect'
  el.hidden = true
  document.body.appendChild(el)

  function hide() {
    el.hidden = true
    el.innerHTML = ''
    onClose?.()
  }

  function showGraph(graph, state, focusNode) {
    const nodes = graph?.nodes ?? []
    const links = graph?.links ?? []
    const features = state?.features ?? []
    const byPhase = Object.fromEntries(PHASE_ORDER.map((p) => [p, 0]))
    const kinds = {}
    for (const n of nodes) {
      const phase = KIND_TO_PHASE[n.kind] ?? 'decide'
      byPhase[phase] = (byPhase[phase] || 0) + 1
      kinds[n.kind] = (kinds[n.kind] || 0) + 1
    }
    const topKinds = Object.entries(kinds)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
    const featureIds = new Set(nodes.map((n) => n.featureId).filter(Boolean))
    const maxPhase = Math.max(1, ...Object.values(byPhase))

    el.hidden = false
    el.innerHTML = `
      <div class="inspect__head" style="--chip:#98A5EF">
        <div class="inspect__kicker">Shared memory</div>
        <div class="inspect__code">MPS</div>
        <h2>Knowledge graph</h2>
        <p>What has gone in as the MPS Knowledge graph — live snapshot of graph_nodes and graph_edges that every department writes into.</p>
        <button type="button" class="inspect__close" data-close>Close</button>
      </div>
      <div class="inspect__stats">
        <div><b>${nodes.length}</b><span>Nodes</span></div>
        <div><b>${links.length}</b><span>Edges</span></div>
        <div><b>${featureIds.size || features.length}</b><span>Features</span></div>
      </div>
      ${
        focusNode
          ? `<div class="inspect__focus">Selected <strong>${escapeHtml(prettyKind(focusNode.kind))}</strong> · #${focusNode.id}</div>`
          : ''
      }
      <h3>By department</h3>
      <div class="inspect__bars">
        ${PHASE_ORDER.map((p) => {
          const d = DEPTS[PHASE_TO_DEPT[p]]
          const n = byPhase[p] || 0
          return `<div class="inspect__bar">
            <div class="inspect__bar-label"><strong>${d.name}</strong><em>${d.full}</em><span>${n}</span></div>
            <i style="width:${(n / maxPhase) * 100}%;background:${d.chip}"></i>
          </div>`
        }).join('')}
      </div>
      <h3>Artifact kinds in the graph</h3>
      <ul class="inspect__kinds">
        ${
          topKinds.length
            ? topKinds
                .map(
                  ([k, n]) =>
                    `<li><span>${escapeHtml(prettyKind(k))}</span><b>${n}</b></li>`,
                )
                .join('')
            : '<li class="empty">No nodes yet.</li>'
        }
      </ul>
      <h3>Open features</h3>
      <div class="inspect__list">
        ${
          features.length
            ? features.map((f) => featureRow(f)).join('')
            : '<p class="empty">No open features.</p>'
        }
      </div>
    `
    bind(el, features)
  }

  function showDept(deptId, roster, state, graph) {
    const d = DEPTS[deptId]
    if (!d) return
    const agents = (roster?.agents ?? []).filter((a) => a.dept === deptId)
    const features = (state?.features ?? []).filter((f) => PHASE_TO_DEPT[f.phase] === deptId)
    const busy = new Set((state?.busyAgents ?? []).map((b) => b.agentId))
    const nodes = (graph?.nodes ?? []).filter((n) => PHASE_TO_DEPT[KIND_TO_PHASE[n.kind] ?? ''] === deptId)
    const kinds = {}
    for (const n of nodes) kinds[n.kind] = (kinds[n.kind] || 0) + 1
    const topKinds = Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 8)

    el.hidden = false
    el.innerHTML = `
      <div class="inspect__head" style="--chip:${d.chip}">
        <div class="inspect__kicker">${d.phase} · ${PHASE_LABEL[d.phase]}</div>
        <div class="inspect__code">${d.name}</div>
        <h2>${d.full}</h2>
        <p>${agents.length} agents on this floor · ${nodes.length} graph artifacts in this phase · ${features.length} open features.</p>
        <button type="button" class="inspect__close" data-close>Close</button>
      </div>
      <div class="inspect__stats">
        <div><b>${agents.length}</b><span>Agents</span></div>
        <div><b>${features.filter((f) => f.state === 'doing').length}</b><span>In progress</span></div>
        <div><b>${features.filter((f) => f.state === 'waiting').length}</b><span>Gates</span></div>
      </div>
      <h3>Agents</h3>
      <ul class="inspect__agents">
        ${agents
          .map((a) => {
            const on = busy.has(a.id)
            return `<li>
              <div>
                <strong>${escapeHtml(a.name.replace(/\s+Agent$/i, ''))}</strong>
                ${a.lead ? '<em>Lead</em>' : ''}
                ${on ? '<em class="live">Live</em>' : ''}
                <span>${escapeHtml(a.archetype)}</span>
              </div>
              <small>${a.maxWritesPerMinute ?? '—'} writes/min${a.requiresGate ? ' · gate' : ''}</small>
            </li>`
          })
          .join('')}
      </ul>
      <h3>Graph intake · ${d.name}</h3>
      <ul class="inspect__kinds">
        ${
          topKinds.length
            ? topKinds
                .map(([k, n]) => `<li><span>${escapeHtml(prettyKind(k))}</span><b>${n}</b></li>`)
                .join('')
            : '<li class="empty">No artifacts in this phase yet.</li>'
        }
      </ul>
      <h3>Features here</h3>
      <div class="inspect__list">
        ${
          features.length
            ? features.map((f) => featureRow(f)).join('')
            : '<p class="empty">No open features in this department.</p>'
        }
      </div>
    `
    bind(el, features)
  }

  function bind(root, features) {
    root.querySelector('[data-close]')?.addEventListener('click', hide)
    root.querySelectorAll('[data-feature]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.getAttribute('data-feature'))
        const feature = features.find((f) => f.id === id)
        if (!feature) return
        if (feature.state === 'waiting') onGate?.(feature)
        else onSelect?.(feature)
      })
    })
  }

  return { el, hide, showGraph, showDept, isOpen: () => !el.hidden }
}

function featureRow(f) {
  const d = DEPTS[PHASE_TO_DEPT[f.phase]] ?? DEPTS.cor
  return `<button type="button" class="inspect__feat" data-feature="${f.id}">
    <span class="pill">${STATE_LABEL[f.state] ?? f.state}</span>
    <strong>${escapeHtml(f.name)}</strong>
    <small>${d.name} · ${PHASE_LABEL[f.phase]} · ${escapeHtml(f.currentStage ?? '')}</small>
  </button>`
}

function prettyKind(kind) {
  return String(kind || 'node').replace(/_/g, ' ')
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

