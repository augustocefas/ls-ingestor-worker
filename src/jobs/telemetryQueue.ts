// src/jobs/telemetryQueue.ts
import { Queue, QueueOptions } from 'bullmq'
import IORedis from 'ioredis'
import { config } from '../config'
import type { TelemetryJobPayload } from '../types'

// ── Conexão Redis compartilhada ───────────────────────────────────
// maxRetriesPerRequest=null é obrigatório para BullMQ
export const redisConnection = new IORedis({
  host:              config.redis.host,
  port:              config.redis.port,
  password:          config.redis.password,
  maxRetriesPerRequest: null,
  enableReadyCheck:  false,
})

const queueOptions: QueueOptions = {
  connection:   redisConnection,
  defaultJobOptions: {
    attempts:    5,                  // até 5 tentativas em caso de falha
    backoff: {
      type:      'exponential',
      delay:     2000,               // começa em 2s, dobra a cada falha
    },
    removeOnComplete: { count: 500 }, // mantém últimos 500 jobs concluídos
    removeOnFail:     { count: 200 }, // mantém últimos 200 jobs falhos
  },
}

// ── Instância da fila ─────────────────────────────────────────────
export const telemetryQueue = new Queue<TelemetryJobPayload>(
  config.queues.telemetry,
  queueOptions,
)

// ── Helper para enfileirar ────────────────────────────────────────
export async function enqueueTelemetry(
  payload: TelemetryJobPayload,
): Promise<string> {
  const job = await telemetryQueue.add(
    'process-telemetry',
    payload,
    { jobId: payload.upload_id },   // idempotência: mesmo upload_id = mesmo job
  )
  return job.id ?? payload.upload_id
}
