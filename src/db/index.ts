// src/db/index.ts
import { PrismaClient } from '@prisma/client'
import { config } from '../config'

// ── Tipo do JSON armazenado em Tenant.data ────────────────────────
interface TenantData {
  tenancy_db_name: string
  [key: string]:   unknown
}

// ── Cliente do banco CENTRAL (singleton) ─────────────────────────
let _central: PrismaClient | null = null

export function getCentralDb(): PrismaClient {
  if (!_central) {
    _central = new PrismaClient({
      datasources: { db: { url: config.db.centralUrl } },
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    })
  }
  return _central
}

// ── Resolve tenant a partir do nserie ────────────────────────────
// Faz o lookup: nserie.nserie → nserie.tenants_id → tenants.data
export async function resolveTenantByNserie(nserie: string) {
  const db = getCentralDb()

  const record = await db.nserie.findUnique({
    where:   { nserie },
    include: { tenant: true },
  })

  if (!record) return null
  if (!record.active) return null

  const data = record.tenant.data as TenantData

  if (!data?.tenancy_db_name) {
    throw new Error(`Tenant ${record.tenants_id} sem tenancy_db_name no campo data.`)
  }

  return {
    tenantId:       record.tenants_id,
    tenancyDbName:  data.tenancy_db_name,
    tenantDbUrl:    buildTenantUrl(data.tenancy_db_name),
  }
}

// ── Monta a connection string do tenant ───────────────────────────
// Reaproveita host/porta/usuário/senha da URL central.
// Só substitui o nome do banco pelo tenancy_db_name.
// Ex: mysql://user:pass@host:3306/LS  →  mysql://user:pass@host:3306/LS_4d7bd05e-...
function buildTenantUrl(tenancyDbName: string): string {
  const centralUrl = config.db.centralUrl
  const lastSlash  = centralUrl.lastIndexOf('/')

  if (lastSlash === -1) {
    throw new Error('CENTRAL_DB_URL inválida — sem barra separando o nome do banco.')
  }

  return `${centralUrl.substring(0, lastSlash)}/${tenancyDbName}`
}

// ── Cache de clientes Prisma por tenant ───────────────────────────
// Evita abrir nova conexão a cada job do mesmo tenant.
const tenantClients = new Map<string, PrismaClient>()

export function getTenantDb(tenantId: string, tenantDbUrl: string): PrismaClient {
  if (tenantClients.has(tenantId)) {
    return tenantClients.get(tenantId)!
  }

  const client = new PrismaClient({
    datasources: { db: { url: tenantDbUrl } },
    log: ['error'],
  })

  tenantClients.set(tenantId, client)
  return client
}

// ── Graceful shutdown ─────────────────────────────────────────────
export async function disconnectAll(): Promise<void> {
  const { disconnectLogDb } = await import('./logDb')
  if (_central) await _central.$disconnect()
  for (const client of tenantClients.values()) {
    await client.$disconnect()
  }
  tenantClients.clear()
  await disconnectLogDb()
}
