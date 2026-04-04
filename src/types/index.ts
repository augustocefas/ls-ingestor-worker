// src/types/index.ts

// ── Linha do CSV de telemetria ────────────────────────────────────
export interface TelemetryRow {
  timestamp:    string
  numero_serie: string
  lat:          number
  lng:          number
  speed_kmh:    number
  nserie_item:  string
}

// ── Payload do job enfileirado no BullMQ ─────────────────────────
export interface TelemetryJobPayload {
  upload_id:     string
  nserie:        string
  tenant_id:     string   // tenants.id resolvido na rota
  tenant_db_url: string   // connection string montada na rota
  rows:          TelemetryRow[]
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
