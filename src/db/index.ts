// src/db/index.ts
import { PrismaClient } from '@prisma/client'

// ── Tipo do JSON armazenado em Tenant.data ────────────────────────
interface TenantData {
  tenancy_db_name: string
  [key: string]:   unknown
}

// ── Monta URL do banco central a partir de variáveis separadas ────
// Usar variáveis separadas evita problemas de escape de caracteres
// especiais na senha quando passada como URL.
function buildCentralUrl(): string {
  const host = process.env.DB_HOST     ?? 'localhost'
  const port = process.env.DB_PORT     ?? '3306'
  const user = process.env.DB_USER     ?? 'root'
  const pass = process.env.DB_PASSWORD ?? ''
  const name = process.env.DB_NAME     ?? 'LS'

  // encodeURIComponent escapa corretamente @, ;, /, {, }, +, = etc.
  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${name}`
}

// ── Monta URL do tenant trocando só o nome do banco ───────────────
function buildTenantUrl(tenancyDbName: string): string {
  const host = process.env.DB_HOST     ?? 'localhost'
  const port = process.env.DB_PORT     ?? '3306'
  const user = process.env.DB_USER     ?? 'root'
  const pass = process.env.DB_PASSWORD ?? ''

  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${tenancyDbName}`
}

// ── Cliente do banco CENTRAL (singleton) ─────────────────────────
let _central: PrismaClient | null = null

export function getCentralDb(): PrismaClient {
  if (!_central) {
    _central = new PrismaClient({
      datasources: { db: { url: buildCentralUrl() } },
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    })
  }
  return _central
}

// ── Resolve tenant a partir do nserie ────────────────────────────
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
    tenantId:      record.tenants_id,
    tenancyDbName: data.tenancy_db_name,
    tenantDbUrl:   buildTenantUrl(data.tenancy_db_name),
  }
}

// ── Cache de clientes Prisma por tenant ───────────────────────────
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
