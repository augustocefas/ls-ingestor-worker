// src/api/board.ts
// Painel visual de monitoramento das filas BullMQ.
// Acesse em: http://localhost:3000/board  (usuário/senha definidos no .env)
import { createBullBoard }        from '@bull-board/api'
import { BullMQAdapter }          from '@bull-board/api/bullMQAdapter'
import { ExpressAdapter }         from '@bull-board/express'
import { Router, Request, Response, NextFunction } from 'express'
import { telemetryQueue }         from '../jobs/telemetryQueue'
import { config }                 from '../config'

export function createBoardRouter(): Router {
  // ── Adapter Express ──────────────────────────────────────────
  const serverAdapter = new ExpressAdapter()
  serverAdapter.setBasePath(config.board.path)

  // ── Registra as filas no painel ───────────────────────────────
  // BullMQAdapter pode ter incompatibilidade de tipo com versões mais novas
  // do bullmq — o cast para any garante a build sem afetar o comportamento.
  createBullBoard({
    queues:        [new BullMQAdapter(telemetryQueue) as any],
    serverAdapter,
  })

  const router = Router()

  // ── Autenticação básica (Basic Auth) ─────────────────────────
  // Simples e suficiente para uso interno/VPN.
  // Substitua por JWT/OAuth se expor publicamente.
  const basicAuth = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers['authorization']

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.set('WWW-Authenticate', 'Basic realm="Bull Board"')
      res.status(401).send('Autenticação necessária.')
      return
    }

    const base64 = authHeader.slice(6)
    const decoded = Buffer.from(base64, 'base64').toString('utf-8')
    const [user, pass] = decoded.split(':')

    if (user !== config.board.user || pass !== config.board.pass) {
      res.set('WWW-Authenticate', 'Basic realm="Bull Board"')
      res.status(401).send('Credenciais inválidas.')
      return
    }

    next()
  }

  // Aplica auth em todas as rotas do board
  router.use(basicAuth)
  router.use(serverAdapter.getRouter())

  return router
}
