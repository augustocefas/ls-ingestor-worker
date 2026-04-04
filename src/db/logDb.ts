// src/db/logDb.ts
// Cliente Prisma exclusivo para o banco MySQL de auditoria de jobs.
// Centralizado — todos os workers e a API usam o mesmo banco.
// IMPORTANTE: rode "npm run prisma:generate" antes de iniciar.
import { PrismaClient } from '../../node_modules/.prisma/log-client'

let _logDb: PrismaClient | null = null

export function getLogDb(): PrismaClient {
  if (!_logDb) {
    _logDb = new PrismaClient({
      datasources: { logDb: { url: process.env.LOG_DB_URL } },
      log: ['error'],
    })
  }
  return _logDb
}

export async function disconnectLogDb(): Promise<void> {
  if (_logDb) {
    await _logDb.$disconnect()
    _logDb = null
  }
}
