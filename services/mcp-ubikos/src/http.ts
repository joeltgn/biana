import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { verificarSoloLectura } from './db.js';

const PORT = Number(process.env.PORT ?? 3101);
const TOKEN = process.env.BEARER_TOKEN ?? '';

function constanteIgual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL.');
  if (!TOKEN) throw new Error('Falta BEARER_TOKEN.');

  // Se comprueba UNA VEZ, al arrancar, que el rol de conexión no puede
  // escribir. Si esto falla, el servicio no arranca — mejor caído que
  // arrancado creyendo ser de solo lectura sin serlo.
  await verificarSoloLectura();
  console.log('comprobado: el rol de conexión no puede escribir en la fuente.');

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, servicio: 'biana-mcp-ubikos' }));

  const guard: express.RequestHandler = (req, res, next) => {
    const cab = req.headers.authorization ?? '';
    const recibido = cab.startsWith('Bearer ') ? cab.slice(7) : '';
    if (!recibido || !constanteIgual(recibido, TOKEN)) {
      res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'unauthorized' });
      return;
    }
    next();
  };

  app.all('/mcp', guard, async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).set('Allow', 'POST').json({ error: 'method not allowed' });
      return;
    }
    // Sin estado: un server+transport nuevo por petición, para que
    // cualquier réplica detrás de un balanceador pueda contestar.
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('fallo en la petición MCP', err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null });
      }
    }
  });

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`biana-mcp-ubikos escuchando en 127.0.0.1:${PORT}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
