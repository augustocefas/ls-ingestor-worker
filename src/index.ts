// src/index.ts — Entry point da API
// Responsabilidade: receber uploads e enfileirar. NÃO processa jobs.
import 'dotenv/config'
import express from 'express'
import { config } from './config'
import uploadRoute from './api/uploadRoute'
import { createBoardRouter } from './api/board'
import { disconnectAll } from './db'
import { telemetryQueue } from './jobs/telemetryQueue'

const app = express()
app.use(express.json())

// ── Health check ──────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    const [waiting, active, failed] = await Promise.all([
      telemetryQueue.getWaitingCount(),
      telemetryQueue.getActiveCount(),
      telemetryQueue.getFailedCount(),
    ])
    res.json({
      status:  'ok',
      queue:   { waiting, active, failed },
      ts:      new Date().toISOString(),
    })
  } catch {
    res.status(503).json({ status: 'degraded' })
  }
})

// ── Rotas ─────────────────────────────────────────────────────────
app.use('/upload', uploadRoute)

// ── Bull Board (monitoramento de filas) ───────────────────────────
if (config.board.enabled) {
  app.use(config.board.path, createBoardRouter())
  console.log(`[API] Bull Board em http://localhost:${config.port}${config.board.path}`)
}

// ── Start ─────────────────────────────────────────────────────────
const server = app.listen(config.port, () => {
  console.log(`[API] Rodando na porta ${config.port}`)
  console.log(`[API] Fila: ${config.queues.telemetry}`)
})

// ── Graceful shutdown ─────────────────────────────────────────────
async function shutdown(signal: string) {
  console.log(`\n[API] ${signal} recebido. Encerrando...`)
  server.close(async () => {
    await telemetryQueue.close()
    await disconnectAll()
    console.log('[API] Encerrado.')
    process.exit(0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))
