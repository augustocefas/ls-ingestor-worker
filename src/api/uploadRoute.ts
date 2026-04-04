// src/api/uploadRoute.ts
import { Router, Request, Response } from 'express'
import multer from 'multer'
import { randomUUID } from 'crypto'
import { parseTelemetryCsv } from './csvParser'
import { getCentralDb, resolveTenantByNserie } from '../db'
import { getLogDb } from '../db/logDb'
import { enqueueTelemetry } from '../jobs/telemetryQueue'
import type { UploadAcceptedResponse } from '../types'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true)
    } else {
      cb(new Error('Apenas arquivos CSV são aceitos'))
    }
  },
})

// ── POST /upload ──────────────────────────────────────────────────
router.post('/', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const { numeroSerie, tipoArquivo } = req.body as {
      numeroSerie?: string
      tipoArquivo?: string
    }

    // ── 1. Validações básicas ─────────────────────────────────
    if (!req.file) {
      res.status(400).json({ success: false, error: 'Arquivo CSV não enviado.' })
      return
    }
    if (!numeroSerie) {
      res.status(400).json({ success: false, error: 'numeroSerie é obrigatório.' })
      return
    }

    // ── 2. Verifica nserie no banco central e resolve tenant ──
    // Única consulta síncrona — leve e indexada.
    const tenant = await resolveTenantByNserie(numeroSerie)

    if (!tenant) {
      res.status(404).json({
        success: false,
        error:   `Número de série "${numeroSerie}" não encontrado ou inativo.`,
      })
      return
    }

    // ── 3. Parseia o CSV ──────────────────────────────────────
    const { rows, errors } = await parseTelemetryCsv(req.file.buffer)

    if (rows.length === 0) {
      res.status(422).json({
        success: false,
        error:   'CSV sem linhas válidas.',
        parse_errors: errors.slice(0, 10),
      })
      return
    }

    // ── 4. Enfileira o job — NÃO aguarda processamento ────────
    const upload_id = randomUUID()

    await enqueueTelemetry({
      upload_id,
      nserie:       numeroSerie,
      tenant_id:    tenant.tenantId,
      tenant_db_url: tenant.tenantDbUrl,
      rows,
      received_at:  new Date().toISOString(),
    })

    // Registra no log de auditoria (fire-and-forget)
    getLogDb().jobLog.create({
      data: {
        job_id:    upload_id,
        nserie:    numeroSerie,
        tenant_id: tenant.tenantId,
        status:    'pending',
        rows_total: rows.length,
      },
    }).catch(err => console.error('[JobLog] Falha ao registrar:', err))

    // ── 5. Resposta imediata ──────────────────────────────────
    const response: UploadAcceptedResponse = {
      success:   true,
      upload_id,
      message:   `${rows.length} linha(s) aceita(s) para processamento.`,
      queued_at: new Date().toISOString(),
    }

    res.status(202).json(response)

  } catch (err) {
    console.error('[Upload] Erro inesperado:', err)
    res.status(500).json({ success: false, error: 'Erro interno.' })
  }
})

export default router
