import { query } from './db.js';
import { catalogoCacheado, columnaValida, tablaValida, ESQUEMA_SQL, type Tabla } from './catalogo.js';

/**
 * EL LENGUAJE DE CONSULTA LIBRE.
 *
 * Esto es lo que Joel pidió copiar de JoeMCP: preguntar cualquier cruce sin
 * tener que declararlo de antemano. La diferencia es dónde apunta —a
 * nuestra propia copia ya verificada, no a Ubikos en vivo— y que cada
 * nombre que llega de fuera se valida contra el catálogo real antes de
 * tocar una consulta. Nunca se pega a mano un texto que no se haya
 * comprobado así: es la única regla que de verdad evita una inyección.
 *
 * Y es SOLO SELECT. No hay una sola rama de este fichero que pueda
 * construir un INSERT, un UPDATE o un DELETE, aunque alguien lo pidiera.
 */

type Operador = { gt?: unknown; gte?: unknown; lt?: unknown; lte?: unknown; ne?: unknown; contains?: string; in?: unknown[] };
type Filtro = Record<string, unknown | unknown[] | Operador>;

export type ArgsConsultar = {
  tabla: string;
  columnas?: string[];
  where?: Filtro;
  groupBy?: string[];
  sum?: string[];
  contarDistintos?: string[];
  orderBy?: string;
  orderDesc?: boolean;
  limite?: number;
};

const LIMITE_MAXIMO = 5000;
const LIMITE_DEFECTO = 200;

function condicion(tabla: Tabla, columna: string, valor: unknown, params: unknown[]): string {
  const col = columnaValida(tabla, columna);
  const ident = `"${col.nombre}"`;
  const esOperador = (v: unknown): v is Operador =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

  if (Array.isArray(valor)) {
    params.push(valor);
    return `${ident} = ANY($${params.length})`;
  }
  if (esOperador(valor)) {
    const partes: string[] = [];
    if ('gt' in valor) { params.push(valor.gt); partes.push(`${ident} > $${params.length}`); }
    if ('gte' in valor) { params.push(valor.gte); partes.push(`${ident} >= $${params.length}`); }
    if ('lt' in valor) { params.push(valor.lt); partes.push(`${ident} < $${params.length}`); }
    if ('lte' in valor) { params.push(valor.lte); partes.push(`${ident} <= $${params.length}`); }
    if ('ne' in valor) { params.push(valor.ne); partes.push(`${ident} <> $${params.length}`); }
    if ('contains' in valor && valor.contains != null) {
      params.push(`%${valor.contains}%`);
      partes.push(`${ident}::text ILIKE $${params.length}`);
    }
    if ('in' in valor && valor.in) { params.push(valor.in); partes.push(`${ident} = ANY($${params.length})`); }
    if (!partes.length) throw new Error(`Filtro vacío para "${columna}".`);
    return partes.join(' AND ');
  }
  params.push(valor);
  return `${ident} = $${params.length}`;
}

export async function consultar(args: ArgsConsultar) {
  const tablas = await catalogoCacheado();
  const tabla = tablaValida(tablas, args.tabla);
  const params: unknown[] = [];
  const partesWhere: string[] = [];

  for (const [col, valor] of Object.entries(args.where ?? {})) {
    partesWhere.push(condicion(tabla, col, valor, params));
  }
  const whereSQL = partesWhere.length ? `WHERE ${partesWhere.join(' AND ')}` : '';

  if (args.groupBy?.length || args.sum?.length || args.contarDistintos?.length) {
    const grupos = (args.groupBy ?? []).map((c) => `"${columnaValida(tabla, c).nombre}"`);
    const selects = [
      ...grupos,
      ...(args.sum ?? []).map((c) => `SUM("${columnaValida(tabla, c).nombre}") AS "suma_${c}"`),
      ...(args.contarDistintos ?? []).map(
        (c) => `COUNT(DISTINCT "${columnaValida(tabla, c).nombre}") AS "distintos_${c}"`,
      ),
      'COUNT(*) AS "filas"',
    ];
    const sql = `SELECT ${selects.join(', ')} FROM "${ESQUEMA_SQL}"."${tabla.nombre}" ${whereSQL}
                 ${grupos.length ? `GROUP BY ${grupos.join(', ')}` : ''}
                 ORDER BY ${grupos.length ? grupos.join(', ') : "1"}
                 LIMIT ${Math.min(args.limite ?? LIMITE_DEFECTO, LIMITE_MAXIMO)}`;
    return { filas: await query(sql, params), sql: sql.replace(/\s+/g, ' ').trim() };
  }

  const proyeccion = (args.columnas ?? []).length
    ? args.columnas!.map((c) => `"${columnaValida(tabla, c).nombre}"`).join(', ')
    : '*';
  const orden = args.orderBy ? `ORDER BY "${columnaValida(tabla, args.orderBy).nombre}" ${args.orderDesc ? 'DESC' : 'ASC'}` : '';
  const sql = `SELECT ${proyeccion} FROM "${ESQUEMA_SQL}"."${tabla.nombre}" ${whereSQL} ${orden}
               LIMIT ${Math.min(args.limite ?? LIMITE_DEFECTO, LIMITE_MAXIMO)}`;
  return { filas: await query(sql, params), sql: sql.replace(/\s+/g, ' ').trim() };
}
