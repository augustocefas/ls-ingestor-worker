// src/workers/telemetryWorker.ts
import { Worker, Job } from 'bullmq'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { getCentralDb, getTenantDb } from '../db'
import { getLogDb } from '../db/logDb'
import { redisConnection } from '../jobs/telemetryQueue'
import { config } from '../config'
import type { TelemetryJobPayload, JobResult, TelemetryRow, TotalizerRow } from '../types'

// ── Processador principal ─────────────────────────────────────────
async function processTelemetryJob(
  job: Job<TelemetryJobPayload>,
): Promise<JobResult> {
  const { upload_id, nserie, tenant_id, tenant_db_url, tipo_arquivo, rows } = job.data

  console.log(`[Worker] Job ${upload_id} | nserie=${nserie} | tipo=${tipo_arquivo} | ${rows.length} linhas`)

  const tenantDb = getTenantDb(tenant_id, tenant_db_url)

  // ── Busca equipamento_id no banco do tenant ───────────────────
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

  // ── Roteia pelo tipo de arquivo ───────────────────────────────
  if (tipo_arquivo === 1) {
    return processTotalizer(job, tenantDb, equipamento_id, tenant_id, rows as TotalizerRow[])
  }
  return processTrack(job, tenantDb, equipamento_id, tenant_id, rows as TelemetryRow[])
}

// ── Processa totalizador (tipoArquivo=1) ──────────────────────────
// Lê o último registro do CSV (maior totalizer_hours) e atualiza
// o campo horimetro na tabela equipamento do tenant.
async function processTotalizer(
  job:            Job<TelemetryJobPayload>,
  tenantDb:       PrismaClient,
  equipamento_id: string,
  tenant_id:      string,
  rows:           TotalizerRow[],
): Promise<JobResult> {
  const { upload_id } = job.data

  try {
    // Pega o maior valor de horas do CSV (último registro enviado)
    const maxHoras = Math.max(...rows.map(r => r.totalizer_hours))

    // Converte horas decimais para milissegundos
    const horimetro = Math.round(maxHoras * 3600 * 1000)

    await tenantDb.$executeRaw`
      UPDATE equipamento
      SET    horimetro  = ${horimetro},
             updated_at = NOW()
      WHERE  id         = ${equipamento_id}
    `

    console.log(`[Worker] ${upload_id} — horimetro atualizado: ${horimetro}ms (${maxHoras.toFixed(6)}h)`)
    await job.updateProgress(100)
    await updateJobLog(upload_id, { status: 'success', rows_total: rows.length, rows_ok: 1, tenant_id })

    return { rows_total: rows.length, rows_ok: 1, rows_err: 0, tenant_id }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[Worker] ${upload_id} — erro ao atualizar horimetro:`, msg)
    await updateJobLog(upload_id, { status: 'failed', error: msg, rows_total: rows.length, rows_err: 1 })
    return { rows_total: rows.length, rows_ok: 0, rows_err: 1, tenant_id }
  }
}

// ── Processa trilha GPS (tipoArquivo=2) ───────────────────────────
async function processTrack(
  job:            Job<TelemetryJobPayload>,
  tenantDb:       PrismaClient,
  equipamento_id: string,
  tenant_id:      string,
  rows:           TelemetryRow[],
): Promise<JobResult> {
  const { upload_id } = job.data
  let rows_ok  = 0
  let rows_err = 0
  const errors: string[] = []
  const BATCH_SIZE = 500

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    try {
      await insertTrackBatch(tenantDb, equipamento_id, batch)
      rows_ok += batch.length
    } catch (err) {
      rows_err += batch.length
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Lote ${Math.floor(i / BATCH_SIZE) + 1}: ${msg}`)
      console.error(`[Worker] ${upload_id} lote ${Math.floor(i / BATCH_SIZE) + 1}:`, msg)
    }
    await job.updateProgress(Math.round(((i + batch.length) / rows.length) * 100))
  }

  const status = rows_err === 0 ? 'success' : rows_ok > 0 ? 'partial' : 'failed'
  await updateJobLog(upload_id, {
    status, rows_total: rows.length, rows_ok, rows_err, tenant_id,
    error: errors.length > 0 ? errors.join(' | ') : undefined,
  })

  console.log(`[Worker] ${upload_id} — ok=${rows_ok} err=${rows_err} status=${status}`)
  return { rows_total: rows.length, rows_ok, rows_err, tenant_id }
}

// ── Insert em lote em equipamento_mov ────────────────────────────
async function insertTrackBatch(
  tenantDb:       PrismaClient,
  equipamento_id: string,
  batch:          TelemetryRow[],
): Promise<void> {
  // Agora usamos apenas ? para todos os campos, incluindo o ID gerado no JS
  const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')
  const values: unknown[] = []

  for (const row of batch) {
    // Geramos o UUID no lado do servidor para evitar conflitos com funções SQL em raw query
    const id = randomUUID()
    
    // Converte timestamp do CSV para objeto Date (compatível com colunas TIMESTAMP do MySQL)
    const dateObj = new Date(row.timestamp)
    
    values.push(
      id,
      equipamento_id,
      row.lat,
      row.lng,
      row.speed_kmh,
      dateObj,
      dateObj
    )
  }

  console.log(`[Worker] Tentando inserir ${batch.length} linhas para equipamento_id: ${equipamento_id}`)

  try {
    const result = await tenantDb.$executeRawUnsafe(
      `INSERT INTO equipamento_mov
         (id, equipamento_id, latitude, longitude, data_float_0, created_at, updated_at)
       VALUES ${placeholders}`,
      ...values,
    )
    console.log(`[Worker] Sucesso: ${result} linhas afetadas no banco.`)
  } catch (err) {
    console.error('[Worker] ERRO FATAL NO BATCH INSERT:', err)
    throw err
  }
}

// ── Atualiza JobLog no MySQL de logs ──────────────────────────────
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
    console.log(`[Worker] ✓ ${job.id} | tipo=${job.data.tipo_arquivo} | tenant=${result.tenant_id} | ok=${result.rows_ok}`)
  })

  worker.on('failed', (job, err) => {
    console.error(`[Worker] ✗ ${job?.id} | tentativa=${job?.attemptsMade} | ${err.message}`)
  })

  worker.on('error', err => {
    console.error('[Worker] Erro interno:', err)
  })

  return worker
}
