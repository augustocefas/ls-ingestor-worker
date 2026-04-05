// src/types/index.ts

// ── Linha do CSV de trilha (tipoArquivo=2) ────────────────────────
export interface TelemetryRow {
  timestamp:    string
  numero_serie: string
  lat:          number
  lng:          number
  speed_kmh:    number
  nserie_item:  string
}

// ── Linha do CSV de totalizador (tipoArquivo=1) ───────────────────
export interface TotalizerRow {
  timestamp:       string
  serial:          string
  totalizer_hours: number
}

// ── Payload do job enfileirado no BullMQ ─────────────────────────
export interface TelemetryJobPayload {
  upload_id:     string
  nserie:        string
  tenant_id:     string
  tenant_db_url: string
  tipo_arquivo:  number        // 1 = totalizador | 2 = trilha
  rows:          (TelemetryRow | TotalizerRow)[]
  received_at:   string
}

// ── Resposta imediata da API ──────────────────────────────────────
export interface UploadAcceptedResponse {
  success:   true
  upload_id: string
  message:   string
  queued_at: string
}

// ── Resultado interno do processamento do job ────────────────────
export interface JobResult {
  rows_total: number
  rows_ok:    number
  rows_err:   number
  tenant_id:  string
}
