import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { catalogoCacheado } from './catalogo.js';
import { consultar } from './consulta.js';
import { query } from './db.js';
import { consultarEnVivo } from './ubikos-api.js';

const OperadorZ = z
  .object({
    gt: z.unknown().optional(),
    gte: z.unknown().optional(),
    lt: z.unknown().optional(),
    lte: z.unknown().optional(),
    ne: z.unknown().optional(),
    contains: z.string().optional(),
    in: z.array(z.unknown()).optional(),
  })
  .partial();

const ValorFiltro = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.unknown()), OperadorZ]);

export function createServer() {
  const server = new McpServer({ name: 'biana-mcp-ubikos', version: '0.1.0' });

  server.registerTool(
    'listar_tablas',
    {
      description:
        'El catálogo entero de lo que hay de Ubikos, leído en vivo de la base —no una lista escrita a mano—. ' +
        'Para cada tabla: cuántas filas tiene y, si tiene una columna de fecha obvia, desde y hasta cuándo llega. ' +
        'Úsalo antes de "consultar" si no conoces ya el nombre exacto de una tabla o columna.',
      inputSchema: {},
    },
    async () => {
      const tablas = await catalogoCacheado();
      const resumen = await Promise.all(
        tablas.map(async (t) => {
          const colFecha = t.columnas.find((c) => /fecha|entrada|creacion/i.test(c.nombre) && c.tipo.includes('date'));
          const [r] = await query<{ n: string; min: string | null; max: string | null }>(
            `SELECT COUNT(*)::text AS n
                    ${colFecha ? `, MIN("${colFecha.nombre}")::text AS min, MAX("${colFecha.nombre}")::text AS max` : ', NULL AS min, NULL AS max'}
               FROM "fuente_dae0d55c02ac410aa677ab14e41d5f13"."${t.nombre}"`,
          );
          return {
            tabla: t.nombre,
            filas: Number(r.n),
            desde: r.min,
            hasta: r.max,
            columnas: t.columnas.map((c) => c.nombre),
          };
        }),
      );
      return { content: [{ type: 'text', text: JSON.stringify(resumen, null, 1) }] };
    },
  );

  server.registerTool(
    'describir_tabla',
    {
      description: 'Las columnas de una tabla, con su tipo real, leídas en vivo. A fondo, campo a campo.',
      inputSchema: { tabla: z.string() },
    },
    async ({ tabla }) => {
      const tablas = await catalogoCacheado();
      const t = tablas.find((x) => x.nombre === tabla);
      if (!t) {
        return {
          content: [
            { type: 'text', text: `No existe "${tabla}". Las tablas son: ${tablas.map((x) => x.nombre).join(', ')}` },
          ],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(t, null, 1) }] };
    },
  );

  server.registerTool(
    'consultar',
    {
      description:
        'Consulta libre de solo lectura sobre una tabla de Ubikos ya cargada. Filtra (where), agrupa y suma ' +
        '(groupBy/sum/contarDistintos) o lista filas sueltas si no agrupas. Nunca escribe nada: no existe ' +
        'ninguna vía en este servidor para insertar, actualizar ni borrar. Ejemplo — ingresos por agencia en ' +
        'agosto: {tabla:"reserva", where:{Fecha:{gte:"2026-08-01",lte:"2026-08-31"}}, groupBy:["ID_Agencia"], sum:["ImporteNeto"]}',
      inputSchema: {
        tabla: z.string(),
        columnas: z.array(z.string()).optional(),
        where: z.record(z.string(), ValorFiltro).optional(),
        groupBy: z.array(z.string()).optional(),
        sum: z.array(z.string()).optional(),
        contarDistintos: z.array(z.string()).optional(),
        orderBy: z.string().optional(),
        orderDesc: z.boolean().optional(),
        limite: z.number().min(1).max(5000).optional(),
      },
    },
    async (args) => {
      try {
        const r = await consultar(args as any);
        return { content: [{ type: 'text', text: JSON.stringify(r.filas, null, 1) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    'consultar_en_vivo',
    {
      description:
        'Pregunta DIRECTO a la API de Ubikos, sin pasar por la copia — para HOY y los últimos días, ' +
        'donde la copia puede ir un paso por detrás de la carga de la noche. Tope de 31 días: un rango ' +
        'más largo ya es histórico y se rechaza, con el motivo, para usar "consultar" en su lugar, que ' +
        'lo tiene guardado y es más rápida. Vistas: reserva, capacidad, servicioreserva, ticket, ' +
        'mealplaninfo. Sin agrupar ni sumar en el servidor —eso lo hace quien pregunta con lo que llega—: ' +
        'es la llamada cruda de Ubikos, con sus nombres tal cual.',
      inputSchema: {
        vista: z.enum(['reserva', 'capacidad', 'servicioreserva', 'ticket', 'mealplaninfo']),
        desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      },
    },
    async ({ vista, desde, hasta }) => {
      try {
        const r = await consultarEnVivo(vista, desde, hasta);
        const filas = Array.isArray(r.datos) ? r.datos.length : 0;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ deCache: r.deCache, filas, datos: r.datos }, null, 1),
            },
          ],
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  return server;
}
