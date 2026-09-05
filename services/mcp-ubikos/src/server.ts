import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { consultar } from './consulta.js';
import { query } from './db.js';
import { consultarEnVivo } from './ubikos-api.js';

/**
 * UNA HERRAMIENTA POR ENDPOINT, NO CUATRO GENÉRICAS.
 *
 * Joel, 05/09/2026: «una por endpoint, con lenguaje natural». Antes había
 * cuatro herramientas que llegaban a cualquier tabla con un parámetro
 * "tabla" — cubrían lo mismo, pero obligaban al modelo a acertar primero
 * CUÁL tabla y luego CÓMO se llama cada columna suya. Con una herramienta
 * por concepto real —reserva, ticket, capacidad…—, el modelo no adivina
 * nada de eso: el nombre de la herramienta ya lo dice, y sus campos van en
 * la propia descripción. Es más fácil de acertar y más rápido, sobre todo
 * para un modelo pequeño o barato de los que se eligen a través de
 * OpenRouter — que es justo lo que se busca para «al momento».
 *
 * NO SE PIERDE NADA DE LA VALIDACIÓN al hacer esto: cada herramienta sigue
 * llamando a `consultar()`, que sigue comprobando cada nombre de columna
 * contra el catálogo real antes de tocar una consulta. Los campos que se
 * listan aquí son una ayuda para el modelo, no una fuente de verdad — si
 * Ubikos cambiara una columna, `consultar()` lo notaría igual y lo diría
 * con el nombre real, no con el de esta lista.
 */

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

/** Los parámetros que comparten todas las herramientas de la copia guardada. */
const ParametrosComunes = {
  where: z
    .record(z.string(), ValorFiltro)
    .optional()
    .describe('Filtro: {columna: valor} o {columna: valor1,valor2} o {columna: {gte:.., lte:..}} para rangos.'),
  groupBy: z.array(z.string()).optional().describe('Columnas por las que agrupar. Vacío = filas sueltas.'),
  sum: z.array(z.string()).optional().describe('Columnas numéricas a sumar por grupo.'),
  contarDistintos: z.array(z.string()).optional().describe('Cuenta valores distintos por grupo, p.ej. reservas.'),
  orderBy: z.string().optional(),
  orderDesc: z.boolean().optional(),
  limite: z.number().min(1).max(5000).optional(),
};

type Registro = {
  tabla: string;
  nombre: string;
  descripcion: string;
  vistaViva?: 'reserva' | 'capacidad' | 'servicioreserva' | 'ticket' | 'mealplaninfo';
};

// Los campos reales de cada tabla se listan en la descripción a mano, pero
// solo como ayuda de lectura: la validación de verdad va contra
// information_schema dentro de consultar(), no contra este texto.
const TABLAS: Registro[] = [
  {
    tabla: 'reserva',
    nombre: 'reserva',
    vistaViva: 'reserva',
    descripcion:
      'Una fila por reserva y noche de estancia. La tabla madre: aquí están las noches vendidas, canceladas y ' +
      'el importe de habitación. Campos: ID_Reserva, Fecha (noche), ID_EstadoReserva, FechaVenta (cuándo se ' +
      'reservó), ID_Segmento, ID_Cliente, ID_Canal, ID_Agencia, Entrada, Salida, Modificada, Noches, ' +
      'SiOcupaHabitacion, ID_TipoHabitacion, ID_Regimen, ID_Habitacion, Adultos, Ninos, Cunas, ImporteNeto, ' +
      'ImporteComision, ImporteIVA, ImporteServicios, ImporteDescuento, TipoDeUso, ID_Tarifa, ID_Pais, ' +
      'Fecha_Cancelacion, esFicticia. Ejemplo — ingresos por agencia en agosto: {where:{Fecha:{gte:"2026-08-01",' +
      'lte:"2026-08-31"}}, groupBy:["ID_Agencia"], sum:["ImporteNeto"]}.',
  },
  {
    tabla: 'reserva_rms',
    nombre: 'reserva_rms',
    descripcion:
      'Lo mismo que "reserva" pero desde el RMS, que separa habitación y régimen en vez de mezclarlos — es la ' +
      'fuente buena para el ingreso real de cada uno. Campos propios: RoomGrossRevenue, RoomTaxes, ' +
      'BoardGrossRevenue, BoardTaxes, ExtrasGrossRevenue, FyBGrossRevenue, AgenciaNombre, SegmentoNombre, ' +
      'MercadoNombre, RegimenNombre, más ID_Reserva, Fecha, FechaEntrada, FechaSalida, EstadoReserva. Nombres ya ' +
      'traducidos (AgenciaNombre, no ID_Agencia): no hace falta cruzar con "maestro" para leer esta tabla.',
  },
  {
    tabla: 'capacidad',
    nombre: 'capacidad',
    vistaViva: 'capacidad',
    descripcion:
      'Habitaciones disponibles para vender, por día y tipo de habitación. Campos: Fecha, ID_Tipo_Habitacion, ' +
      'Nro_Habitaciones. Se cruza con las noches ocupadas de "reserva" para calcular ocupación.',
  },
  {
    tabla: 'servicioreserva',
    nombre: 'servicioreserva',
    vistaViva: 'servicioreserva',
    descripcion:
      'Líneas de servicio cargadas a una reserva (parking, spa, cunas…), una por día y tipo de servicio. Campos: ' +
      'ID_Reserva, Fecha, ID_Tipo_Servicio, Unidades, PrecioUnitario, Descuento, IVA, Importe, ImporteNeto.',
  },
  {
    tabla: 'ticket',
    nombre: 'ticket',
    vistaViva: 'ticket',
    descripcion:
      'Tickets de los puntos de venta —cafetería, restaurante, eventos—. OJO: una línea por ticket Y por familia ' +
      'de producto, nunca una por ticket a secas. Campos: ID_Ticket, ID_Familia, FechaCreacion, ID_Reserva ' +
      '(0 = no cargado a habitación), ID_Pos (punto de venta), Desc_Familia, Tipo, TotalConIVA. Ejemplo — ventas ' +
      'por punto en agosto: {where:{FechaCreacion:{gte:"2026-08-01",lte:"2026-08-31"}}, groupBy:["ID_Pos"], ' +
      'sum:["TotalConIVA"]}.',
  },
  {
    tabla: 'mealplan',
    nombre: 'mealplan',
    vistaViva: 'mealplaninfo',
    descripcion:
      'Régimen alimenticio contratado por día: cuántos desayunos, comidas y cenas, y cuántas personas en cada ' +
      'plan (SA=solo alojamiento, AD=desayuno, MP=media pensión, PC=pensión completa, TI=todo incluido). Campos: ' +
      'Fecha, total_breakfast, total_lunch, total_dinner, sa_adults, sa_children, ad_adults, ad_children, ' +
      'mp_adults, mp_children, pc_adults, pc_children, ti_adults, ti_children.',
  },
  {
    tabla: 'maestro',
    nombre: 'maestro',
    descripcion:
      'Los nombres detrás de cada código: agencias, canales, países, regímenes, segmentos, tarifas, tipos de ' +
      'habitación, tipos de servicio. Campos: tipo (agencia|canal|pais|regimen|segmento|tarifa|tipohabitacion|' +
      'tiposervicio|estadoreserva|tipouso), codigo, descripcion. Úsala para traducir un ID_Agencia a un nombre, ' +
      'o busca por descripcion con where:{descripcion:{contains:"booking"}} para encontrar el código.',
  },
];

export function createServer() {
  const server = new McpServer({ name: 'biana-mcp-ubikos', version: '0.2.0' });

  for (const t of TABLAS) {
    server.registerTool(
      t.nombre,
      { description: t.descripcion, inputSchema: { columnas: z.array(z.string()).optional(), ...ParametrosComunes } },
      async (args) => {
        try {
          const r = await consultar({ tabla: t.tabla, ...(args as object) });
          return { content: [{ type: 'text', text: JSON.stringify(r.filas, null, 1) }] };
        } catch (e) {
          return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true };
        }
      },
    );

    if (t.vistaViva) {
      server.registerTool(
        `${t.nombre}_en_vivo`,
        {
          description:
            `Como "${t.nombre}" pero preguntando DIRECTO a Ubikos, sin pasar por la copia — para HOY y los ` +
            'últimos días (tope 31), donde la copia puede ir un paso por detrás. Sin agrupar ni sumar aquí: ' +
            'llega la fila cruda de Ubikos, tal cual, y el agrupado lo hace quien pregunta con lo que recibe. ' +
            `Para un rango más largo, o si no hace falta que sea del segundo, usa "${t.nombre}" en su lugar.`,
          inputSchema: {
            desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('AAAA-MM-DD'),
            hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('AAAA-MM-DD'),
          },
        },
        async ({ desde, hasta }) => {
          try {
            const r = await consultarEnVivo(t.vistaViva!, desde, hasta);
            const filas = Array.isArray(r.datos) ? r.datos.length : 0;
            return { content: [{ type: 'text', text: JSON.stringify({ deCache: r.deCache, filas, datos: r.datos }, null, 1) }] };
          } catch (e) {
            return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true };
          }
        },
      );
    }
  }

  server.registerTool(
    'catalogo',
    {
      description:
        'Cuántas filas tiene cada tabla y desde/hasta cuándo llega, leído en vivo de la base —por si hace falta ' +
        'comprobar que un dato está antes de preguntar por él.',
      inputSchema: {},
    },
    async () => {
      const resumen = await Promise.all(
        TABLAS.map(async (t) => {
          const [r] = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM "fuente_dae0d55c02ac410aa677ab14e41d5f13"."${t.tabla}"`);
          return { tabla: t.nombre, filas: Number(r.n) };
        }),
      );
      return { content: [{ type: 'text', text: JSON.stringify(resumen, null, 1) }] };
    },
  );

  return server;
}
