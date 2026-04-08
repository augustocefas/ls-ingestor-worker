// src/config/index.ts
import 'dotenv/config'

function requireEnv(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Variável de ambiente obrigatória ausente: ${key}`)
  return val
}

export const config = {
  port:    parseInt(process.env.PORT ?? '3000', 10),

  redis: {
    host:     process.env.REDIS_HOST     ?? '127.0.0.1',
    port:     parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? undefined,
  },

  db: {
    provider: 'mysql' as const,
  },

  worker: {
    concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10),
  },

  board: {
    enabled:  process.env.BOARD_ENABLED !== 'false',
    path:     process.env.BOARD_PATH    ?? '/board',
    user:     process.env.BOARD_USER    ?? 'admin',
    pass:     process.env.BOARD_PASS    ?? 'admin123',
  },

  // Nome da fila BullMQ — centralizado para não errar nos workers
  queues: {
    telemetry: 'telemetry-ingest',
  },
  
  debugSql: process.env.DEBUG_SQL === 'true',
} as const
