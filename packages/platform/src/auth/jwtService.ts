import {
  SignJWT,
  jwtVerify,
  generateKeyPair,
  exportPKCS8,
  exportSPKI,
  importPKCS8,
  importSPKI,
  type KeyLike,
} from 'jose'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentJwtPayload, AgentManifest } from '@avp/shared'

export class JwtService {
  private privateKey!: KeyLike
  private publicKey!: KeyLike
  private readonly issuer = 'avp-platform'
  private readonly audience = 'avp-agents'

  async init(keyDir: string): Promise<void> {
    const privPath = join(keyDir, 'platform.private.pem')
    const pubPath = join(keyDir, 'platform.public.pem')
    if (existsSync(privPath) && existsSync(pubPath)) {
      this.privateKey = await importPKCS8(readFileSync(privPath, 'utf8'), 'RS256')
      this.publicKey = await importSPKI(readFileSync(pubPath, 'utf8'), 'RS256')
      console.log('[JWT] loaded existing key pair')
    } else {
      const pair = await generateKeyPair('RS256')
      this.privateKey = pair.privateKey
      this.publicKey = pair.publicKey
      mkdirSync(keyDir, { recursive: true })
      writeFileSync(privPath, await exportPKCS8(pair.privateKey))
      writeFileSync(pubPath, await exportSPKI(pair.publicKey))
      console.log('[JWT] generated new RS256 key pair →', keyDir)
    }
  }

  async issue(manifest: AgentManifest): Promise<string> {
    return new SignJWT({
      runtime: manifest.runtime,
      domain: manifest.domain,
      nodeKinds: manifest.capabilities.nodeKinds,
      edgeKinds: manifest.capabilities.edgeKinds,
      requiresGate: manifest.capabilities.requiresGate,
      maxWritesPerMinute: manifest.capabilities.maxWritesPerMinute,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(manifest.id)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(this.privateKey)
  }

  async verify(token: string): Promise<AgentJwtPayload> {
    const { payload } = await jwtVerify(token, this.publicKey, {
      issuer: this.issuer,
      audience: this.audience,
    })
    return payload as unknown as AgentJwtPayload
  }
}
