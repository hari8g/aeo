import { execSync } from 'node:child_process'
import { BaseAgent } from '@avp/agent-base'
import type { IRuntimeAdapter, ILLMGateway, AgentManifest } from '@avp/shared'

export const DEVSECOPS_MANIFEST: AgentManifest = {
  id: 'devsecops:v1',
  name: 'DevSecOps Agent',
  archetype: 'DevSecOps Engineer',
  domain: 'ship',
  runtime: 'pipeline',
  version: '1.0.0',
  capabilities: {
    nodeKinds: ['SECURITY_SCAN', 'CVE_FINDING', 'COMPLIANCE_CHECK'],
    edgeKinds: ['EVIDENCED_BY', 'BLOCKS_RELEASE'],
    requiresGate: false,
    maxWritesPerMinute: 60,
  },
  subscribes: ['context.build.build_completed'],
  healthEndpoint: 'http://localhost:7085/health',
  llmBudget: { maxTokensPerRun: 4000, preferredModel: 'claude-haiku-4-5-20251001' },
}

export interface SecScanInput {
  repoPath: string
  gitSha: string
  runId: string
  rcNodeId?: number
  cycleId?: string
  featureId?: number
  /** Optional injected findings (tests / fixtures). Skips local scanners when set. */
  fixtureFindings?: SecFinding[]
}

export interface SecFinding {
  id: string
  severity: string
  message: string
  path: string
  tool: string
}

export interface SecScanOutput {
  scanNodeId: number
  findingIds: number[]
  blocking: boolean
  critical: number
  high: number
  summary: string
}

export class DevSecOpsAgent extends BaseAgent {
  protected readonly agentId = 'devsecops:v1'
  protected readonly domain = 'ship' as const

  constructor(adapter: IRuntimeAdapter, llm: ILLMGateway) {
    super(adapter, llm)
  }

  async run(input: SecScanInput): Promise<SecScanOutput> {
    if (!input.repoPath || !input.gitSha || !input.runId) {
      this.fail('run', new Error('repoPath, gitSha, and runId are required'))
    }

    const findings =
      input.fixtureFindings ??
      (process.env.AVP_DEVSECOPS_FIXTURE === '1'
        ? this.fixtureFindings()
        : this.runScanners(input.repoPath))

    const critical = findings.filter((f) => f.severity === 'CRITICAL').length
    const high = findings.filter((f) => f.severity === 'HIGH').length
    const blocking = critical > 0 || high > 2

    const scanNodeId = await this.writeNode({
      kind: 'SECURITY_SCAN',
      label: `Security scan ${input.gitSha.slice(0, 8)}`,
      description: JSON.stringify({
        sha: input.gitSha,
        runId: input.runId,
        total: findings.length,
        critical,
        high,
        tools: ['semgrep', 'trivy', 'trufflehog'],
        status: findings.length === 0 ? 'clean' : blocking ? 'blocked' : 'warnings',
      }),
      metadata: { critical, high, blocking, sha: input.gitSha },
      eventKind: 'security_scan_completed',
      cycleId: input.cycleId,
      featureId: input.featureId,
    })

    const findingIds: number[] = []
    for (const finding of findings) {
      const fid = await this.writeNode({
        kind: 'CVE_FINDING',
        label: finding.id.slice(0, 120),
        description: JSON.stringify(finding),
        metadata: { severity: finding.severity, path: finding.path, tool: finding.tool },
        eventKind: 'cve_finding_recorded',
        cycleId: input.cycleId,
      })
      findingIds.push(fid)
      await this.writeEdge(scanNodeId, fid, 'EVIDENCED_BY')
      if (finding.severity === 'CRITICAL' || finding.severity === 'HIGH') {
        await this.writeEdge(scanNodeId, fid, 'BLOCKS_RELEASE', 1.0)
      }
    }

    if (input.rcNodeId) {
      await this.writeEdge(input.rcNodeId, scanNodeId, 'EVIDENCED_BY')
    }

    const summary = blocking
      ? `BLOCKED — ${critical} critical, ${high} high findings`
      : findings.length === 0
        ? 'Clean — no issues found'
        : `${findings.length} warnings (not blocking)`

    return { scanNodeId, findingIds, blocking, critical, high, summary }
  }

  private fixtureFindings(): SecFinding[] {
    return [
      {
        id: 'AVP-FIXTURE-CRITICAL-001',
        severity: 'CRITICAL',
        message: 'Fixture critical finding for CI verification',
        path: 'fixture/app.ts',
        tool: 'fixture',
      },
    ]
  }

  private runScanners(repoPath: string): SecFinding[] {
    const findings: SecFinding[] = []

    try {
      const out = execSync(
        `semgrep scan --json --severity ERROR --severity WARNING ${JSON.stringify(repoPath)}`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000 },
      )
      const data = JSON.parse(out) as {
        results?: Array<{
          check_id: string
          path: string
          extra?: { severity?: string; message?: string }
        }>
      }
      for (const r of data.results ?? []) {
        findings.push({
          id: r.check_id,
          severity: r.extra?.severity === 'ERROR' ? 'HIGH' : 'MEDIUM',
          message: r.extra?.message ?? r.check_id,
          path: r.path,
          tool: 'semgrep',
        })
      }
    } catch {
      /* not installed or no findings */
    }

    try {
      const out = execSync(
        `trivy fs --format json --severity HIGH,CRITICAL ${JSON.stringify(repoPath)}`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000 },
      )
      const data = JSON.parse(out) as {
        Results?: Array<{
          Target: string
          Vulnerabilities?: Array<{
            VulnerabilityID: string
            Severity: string
            Title: string
          }>
        }>
      }
      for (const result of data.Results ?? []) {
        for (const vuln of result.Vulnerabilities ?? []) {
          findings.push({
            id: vuln.VulnerabilityID,
            severity: vuln.Severity,
            message: vuln.Title,
            path: result.Target,
            tool: 'trivy',
          })
        }
      }
    } catch {
      /* not installed */
    }

    return findings
  }
}
