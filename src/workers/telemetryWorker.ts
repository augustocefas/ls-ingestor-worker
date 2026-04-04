// src/workers/telemetryWorker.ts
import { Worker, Job } from 'bullmq'
import { PrismaClient } from '@prisma/client'
import { getCentralDb, getTenantDb } from '../db'
import { getLogDb } from '../db/logDb'
import { redisConnection } from '../jobs/telemetryQueue'
import { config } from '../config'
import type { TelemetryJobPayload, JobResult, TelemetryRow } from '../types'

// ── Processador do job ────────────────────────────────────────────
async function processTelemetryJob(
  job: Job<TelemetryJobPayload>,
): Promise<JobResult> {
  const { upload_id, nserie, tenant_id, tenant_db_url, rows } = job.data

  console.log(`[Worker] Job ${upload_id} | nserie=${nserie} | ${rows.length} linhas`)

  // ── 1. Obtém cliente do banco do tenant ───────────────────────
  const tenantDb = getTenantDb(tenant_id, tenant_db_url)

  // ── 2. Busca equipamento_id no banco do tenant via SQL nativo ─
  // O banco do tenant é gerenciado pelo Laravel — sem schema Prisma próprio.
  // Usamos $queryRaw para compatibilidade total com MySQL.
  const equipamentos = await tenantDb.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM equipamento WHERE nserie = ${nserie} LIMIT 1
  `

  if (!equipamentos || equipamentos.length === 0) {
    const msg = `Equipamento nserie="${nserie}" não encontrado no banco do tenant.`
    console.warn(`[Worker] ${upload_id} — ${msg}`)
    await updateJobLog(upload_id, { status: 'failed', error: msg, rows_total: rows.length })
    return { rows_total: rows.length, rows_ok: 0, rows_err: rows.length, tenant_id }
  }

  const equipamento_id = equipamentos[0].id

  // ── 3. Insere em equipamento_mov em lotes de 500 ──────────────
  let rows_ok  = 0
  let rows_err = 0
  const errors: string[] = []
  const BATCH_SIZE = 500

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)

    try {
      await insertBatch(tenantDb, equipamento_id, batch)
      rows_ok += batch.length
    } catch (err) {
      rows_err += batch.length
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Lote ${Math.floor(i / BATCH_SIZE) + 1}: ${msg}`)
      console.error(`[Worker] ${upload_id} lote ${Math.floor(i / BATCH_SIZE) + 1}:`, msg)
    }

    await job.updateProgress(Math.round(((i + batch.length) / rows.length) * 100))
  }

  // ── 4. Atualiza log de auditoria ──────────────────────────────
  const status = rows_err === 0 ? 'success' : rows_ok > 0 ? 'partial' : 'failed'
  await updateJobLog(upload_id, {
    status,
    rows_total: rows.length,
    rows_ok,
    rows_err,
    error: errors.length > 0 ? errors.join(' | ') : undefined,
    tenant_id,
  })

  console.log(`[Worker] Job ${upload_id} — ok=${rows_ok} err=${rows_err} status=${status}`)

  return { rows_total: rows.length, rows_ok, rows_err, tenant_id }
}

// ── Insere um lote em equipamento_mov via SQL nativo ─────────────
// O banco do tenant é gerenciado pelo Laravel — sem schema Prisma próprio.
// Mapeamento:
//   timestamp  → created_at + updated_at
//   lat        → latitude
//   lon        → longitude
//   speed_kmh  → data_float_0
async function insertBatch(
  tenantDb:       PrismaClient,
  equipamento_id: string,
  batch:          TelemetryRow[],
): Promise<void> {
  // Monta VALUES para INSERT em lote único
  // Prisma $executeRaw com tagged template não aceita arrays dinâmicos,
  // por isso usamos $executeRawUnsafe com parâmetros posicionais.
  const placeholders = batch.map(() => '(UUID(), ?, ?, ?, ?, ?, ?)').join(', ')

  const values: unknown[] = []
  for (const row of batch) {
    const ts = new Date(row.timestamp).toISOString().slice(0, 19).replace('T', ' ')
    values.push(
      equipamento_id,
      row.lat,
      row.lng,
      row.speed_kmh,  // → data_float_0
      ts,             // → created_at
      ts,             // → updated_at
    )
  }

  await tenantDb.$executeRawUnsafe(
    `INSERT INTO equipamento_mov
       (id, equipamento_id, latitude, longitude, data_float_0, created_at, updated_at)
     VALUES ${placeholders}`,
    ...values,
  )
}

// ── Atualiza JobLog no SQLite local ───────────────────────────────
async function updateJobLog(
  job_id: string,
  data: {
    status:      string
    rows_total?: number
    rows_ok?:    number
    rows_err?:   number
    error?:      string
    tenant_id?:  string
  },
): Promise<void> {
  try {
    await getLogDb().jobLog.updateMany({
      where: { job_id },
      data: {
        status:       data.status,
        rows_ok:      data.rows_ok,
        rows_err:     data.rows_err,
        error:        data.error,
        processed_at: new Date(),
      },
    })
  } catch {
    // Log nunca derruba o worker
  }
}

// ── Instancia o Worker ────────────────────────────────────────────
export function createTelemetryWorker() {
  const worker = new Worker<TelemetryJobPayload, JobResult>(
    config.queues.telemetry,
    processTelemetryJob,
    {
      connection:       redisConnection,
      concurrency:      config.worker.concurrency,
      removeOnComplete: { count: 500 },
      removeOnFail:     { count: 200 },
    },
  )

  worker.on('completed', (job, result) => {
    console.log(`[Worker] ✓ ${job.id} | tenant=${result.tenant_id} | ok=${result.rows_ok}`)
  })

  worker.on('failed', (job, err) => {
    console.error(`[Worker] ✗ ${job?.id} | tentativa=${job?.attemptsMade} | ${err.message}`)
  })

  worker.on('error', err => {
    console.error('[Worker] Erro interno:', err)
  })

  return worker
}
