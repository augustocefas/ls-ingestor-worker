# telemetry-ingest

Serviço de ingestão de telemetria agrícola — multi-tenant, BullMQ + Redis.

## Arquitetura

```
Dispositivo ESP32
      │
      │  POST /upload  (multipart CSV)
      ▼
┌─────────────┐     enfileira     ┌───────────────┐
│   API        │ ──────────────▶  │  Redis / BullMQ│
│  (index.ts)  │  resposta 202    └───────────────┘
└─────────────┘  imediata               │
                                        │  job
                                        ▼
                              ┌──────────────────┐
                              │  Worker(s)        │
                              │  (worker.ts)      │
                              │  1..N processos   │
                              └──────────────────┘
                                        │
                              ┌─────────┴─────────┐
                              ▼                   ▼
                        Banco Central       Banco Tenant
                        (equipamentos,      (telemetria_positions)
                         tenants, logs)
```

## Pré-requisitos

- Node.js 20+
- Redis 7+
- MySQL 8+ ou PostgreSQL 14+

## Instalação

```bash
cp .env.example .env
# Edite .env com suas credenciais

npm install
npx prisma generate
npx prisma migrate dev --name init
```

## Rodando

```bash
# Terminal 1 — API
npm run dev

# Terminal 2 — Worker (pode abrir quantos quiser)
npm run dev:worker

# Worker adicional (escala horizontal)
npm run dev:worker
```

## Variável de intervalo

No firmware (`Logger_CAN_online.ino`):
```cpp
const unsigned long UPLOAD_INTERVAL_MS = 60UL * 1000UL; // 1 minuto
```

## Endpoints

### POST /upload
Recebe o CSV do dispositivo e enfileira para processamento.

**Body:** `multipart/form-data`
| Campo         | Tipo   | Descrição                          |
|---------------|--------|------------------------------------|
| `file`        | File   | Arquivo CSV                        |
| `numeroSerie` | string | Número de série do equipamento     |
| `tipoArquivo` | number | `1` = totalizador · `2` = trilha   |

**Resposta 202 — aceito:**
```json
{
  "success":   true,
  "upload_id": "uuid-gerado",
  "message":   "714 linha(s) aceita(s) para processamento.",
  "queued_at": "2025-04-02T10:31:00.000Z"
}
```

**Resposta 404 — série não encontrada:**
```json
{
  "success": false,
  "error":   "Equipamento \"NS40433882\" não encontrado ou inativo."
}
```

### GET /health
Retorna status da API e contadores da fila.

```json
{
  "status": "ok",
  "queue":  { "waiting": 3, "active": 1, "failed": 0 },
  "ts":     "2025-04-02T10:31:05.000Z"
}
```

## Schema esperado no banco do tenant

```sql
-- PostgreSQL
CREATE TABLE telemetria_positions (
  id              BIGSERIAL PRIMARY KEY,
  equipamento_id  TEXT NOT NULL,
  tenant_id       TEXT NOT NULL,
  upload_id       TEXT NOT NULL,
  registrado_em   TIMESTAMPTZ NOT NULL,
  latitude        DECIMAL(10,7) NOT NULL,
  longitude       DECIMAL(10,7) NOT NULL,
  speed_kmh       DECIMAL(6,2)  NOT NULL,
  nserie_item     TEXT DEFAULT '',
  ligado          BOOLEAN NOT NULL,
  origem          TEXT DEFAULT 'upload',
  UNIQUE (equipamento_id, registrado_em)
);

-- MySQL
CREATE TABLE telemetria_positions (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  equipamento_id  VARCHAR(36) NOT NULL,
  tenant_id       VARCHAR(36) NOT NULL,
  upload_id       VARCHAR(36) NOT NULL,
  registrado_em   DATETIME(0) NOT NULL,
  latitude        DECIMAL(10,7) NOT NULL,
  longitude       DECIMAL(10,7) NOT NULL,
  speed_kmh       DECIMAL(6,2)  NOT NULL,
  nserie_item     VARCHAR(60) DEFAULT '',
  ligado          TINYINT(1)  NOT NULL,
  origem          VARCHAR(20) DEFAULT 'upload',
  UNIQUE KEY uq_equip_ts (equipamento_id, registrado_em)
);
```

## Escalando workers

Cada instância de `worker.ts` processa `WORKER_CONCURRENCY` jobs em paralelo.
Para escalar, basta rodar mais processos — todos consomem da mesma fila Redis:

```bash
# Docker Compose — 3 workers
services:
  worker:
    build: .
    command: node dist/worker.js
    scale: 3
    env_file: .env
```

## Monitoramento

Instale o Bull Board para visualizar a fila no browser:

```bash
npm install @bull-board/express @bull-board/api
```
