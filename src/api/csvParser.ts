// src/api/csvParser.ts
import { parse } from 'csv-parse'
import { Readable } from 'stream'
import { z } from 'zod'
import type { TelemetryRow, TotalizerRow } from '../types'

// ── Schema: trilha GPS (tipoArquivo=2) ────────────────────────────
const TrackRowSchema = z.object({
  timestamp:    z.string().min(1),
  serial:       z.string().min(1),
  lat:          z.coerce.number().min(-90).max(90),
  lon:          z.coerce.number().min(-180).max(180),
  speed_kmh:    z.coerce.number().min(0),
  nserie_item:  z.string().default(''),
})

// ── Schema: totalizador (tipoArquivo=1) ───────────────────────────
const TotRowSchema = z.object({
  timestamp:       z.string().min(1),
  serial:          z.string().min(1),
  totalizer_hours: z.coerce.number().min(0),
})

function toTelemetryRow(raw: z.infer<typeof TrackRowSchema>): TelemetryRow {
  return {
    timestamp:    raw.timestamp,
    numero_serie: raw.serial,
    lat:          raw.lat,
    lng:          raw.lon,
    speed_kmh:    raw.speed_kmh,
    nserie_item:  raw.nserie_item,
  }
}

function toTotalizerRow(raw: z.infer<typeof TotRowSchema>): TotalizerRow {
  return {
    timestamp:       raw.timestamp,
    serial:          raw.serial,
    totalizer_hours: raw.totalizer_hours,
  }
}

export interface ParseResult {
  tipo_arquivo: number
  rows:         (TelemetryRow | TotalizerRow)[]
  errors:       Array<{ line: number; reason: string }>
}

// ── Parseia o CSV e detecta o tipo pelo cabeçalho ─────────────────
export async function parseTelemetryCsv(
  buffer:      Buffer,
  tipoArquivo: number,
): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const rows:   (TelemetryRow | TotalizerRow)[]          = []
    const errors: Array<{ line: number; reason: string }>  = []
    let lineNumber = 1

    const parser = parse({
      columns:          true,
      skip_empty_lines: true,
      trim:             true,
      bom:              true,
    })

    parser.on('readable', () => {
      let record
      while ((record = parser.read()) !== null) {
        lineNumber++

        if (tipoArquivo === 1) {
          // ── Totalizador ──────────────────────────────────────
          const parsed = TotRowSchema.safeParse(record)
          if (parsed.success) {
            rows.push(toTotalizerRow(parsed.data))
          } else {
            errors.push({
              line:   lineNumber,
              reason: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
            })
          }
        } else {
          // ── Trilha GPS (padrão) ──────────────────────────────
          const parsed = TrackRowSchema.safeParse(record)
          if (parsed.success) {
            rows.push(toTelemetryRow(parsed.data))
          } else {
            errors.push({
              line:   lineNumber,
              reason: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
            })
          }
        }
      }
    })

    parser.on('error', reject)
    parser.on('end',   () => resolve({ tipo_arquivo: tipoArquivo, rows, errors }))

    Readable.from(buffer).pipe(parser)
  })
}
