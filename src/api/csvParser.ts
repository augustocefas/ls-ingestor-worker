// src/api/csvParser.ts
import { parse } from 'csv-parse'
import { Readable } from 'stream'
import { z } from 'zod'
import type { TelemetryRow } from '../types'

// ── Schema de validação de cada linha ────────────────────────────
const RowSchema = z.object({
  timestamp:    z.string().min(1),
  serial:       z.string().min(1),          // nome real no CSV do ESP32
  lat:          z.coerce.number().min(-90).max(90),
  lon:          z.coerce.number().min(-180).max(180),  // nome real no CSV
  speed_kmh:    z.coerce.number().min(0),
  nserie_item:  z.string().default(''),
})

// ── Normaliza para o tipo interno TelemetryRow ────────────────────
function toTelemetryRow(raw: z.infer<typeof RowSchema>): TelemetryRow {
  return {
    timestamp:    raw.timestamp,
    numero_serie: raw.serial,
    lat:          raw.lat,
    lng:          raw.lon,
    speed_kmh:    raw.speed_kmh,
    nserie_item:  raw.nserie_item,
  }
}

export interface ParseResult {
  rows:   TelemetryRow[]
  errors: Array<{ line: number; reason: string }>
}

// ── Parseia um Buffer CSV e retorna linhas válidas + erros ────────
export async function parseTelemetryCsv(buffer: Buffer): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const rows:   TelemetryRow[]                    = []
    const errors: Array<{ line: number; reason: string }> = []
    let lineNumber = 1 // começa em 1 (header é linha 0)

    const parser = parse({
      columns:           true,   // usa primeira linha como header
      skip_empty_lines:  true,
      trim:              true,
      bom:               true,   // ignora BOM se existir
    })

    parser.on('readable', () => {
      let record
      while ((record = parser.read()) !== null) {
        lineNumber++
        const parsed = RowSchema.safeParse(record)
        if (parsed.success) {
          rows.push(toTelemetryRow(parsed.data))
        } else {
          errors.push({
            line:   lineNumber,
            reason: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
          })
        }
      }
    })

    parser.on('error', reject)
    parser.on('end',   () => resolve({ rows, errors }))

    Readable.from(buffer).pipe(parser)
  })
}
