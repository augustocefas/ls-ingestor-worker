// src/worker.ts — Entry point do Worker
// Processo SEPARADO da API. Pode rodar N instâncias em paralelo.
// Execute: npm run dev:worker  (ou node dist/worker.js em produção)
import 'dotenv/config'
import { createTelemetryWorker } from './workers/telemetryWorker'
import { disconnectAll } from './db'

console.log('[Worker] Iniciando...')

const worker = createTelemetryWorker()

console.log(`[Worker] Aguardando jobs na fila "telemetry-ingest"`)
console.log(`[Worker] Concorrência: ${worker.opts.concurrency ?? 1}`)

// ── Graceful shutdown ─────────────────────────────────────────────
async function shutdown(signal: string) {
  console.log(`\n[Worker] ${signal} recebido. Finalizando jobs em andamento...`)
  await worker.close()        // aguarda jobs ativos terminarem
  await disconnectAll()
  console.log('[Worker] Encerrado.')
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))
process.on('uncaughtException', err => {
  console.error('[Worker] uncaughtException:', err)
  shutdown('uncaughtException')
})
