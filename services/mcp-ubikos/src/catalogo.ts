import { query } from './db.js';

/**
 * «BUSCAR A FONDO CUÁLES SON TODOS LOS DATOS QUE ME PUEDE DAR» — Joel,
 * 04/09/2026.
 *
 * Esto se cumple leyendo `information_schema` en vez de escribir la lista
 * de columnas a mano. Dos motivos, los dos vividos ya en joel-bi-v2:
 *
 *   1. Escrita a mano, la lista se queda corta el día que la fuente añade
 *      una columna, y nadie se entera: el dato está ahí y no se ofrece.
 *   2. Escrita a mano, puede nombrar una columna que ya no existe —pasó
 *      con "Total" en el ticket de Ubikos— y eso rompe en producción en
 *      vez de fallar en el sitio donde se puede arreglar tranquilo.
 *
 * Se recalcula cada vez que se pide (no se cachea a largo plazo): si la
 * fuente cambia de forma, este catálogo lo nota solo, sin desplegar nada.
 */
const ESQUEMA = 'fuente_dae0d55c02ac410aa677ab14e41d5f13';
// Sin comillas, sin punto y coma, sin nada que no sea un nombre de tabla o
// columna real: esto es lo único que se deja construir una consulta SQL
// pegando texto, y solo después de comprobarlo contra esta lista.
const IDENT_VALIDO = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export type Columna = { nombre: string; tipo: string; nulable: boolean };
export type Tabla = { nombre: string; columnas: Columna[] };

export async function catalogo(): Promise<Tabla[]> {
  const filas = await query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
    `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name <> 'traida'
      ORDER BY table_name, ordinal_position`,
    [ESQUEMA],
  );
  const porTabla = new Map<string, Columna[]>();
  for (const f of filas) {
    if (!porTabla.has(f.table_name)) porTabla.set(f.table_name, []);
    porTabla.get(f.table_name)!.push({
      nombre: f.column_name,
      tipo: f.data_type,
      nulable: f.is_nullable === 'YES',
    });
  }
  return [...porTabla.entries()].map(([nombre, columnas]) => ({ nombre, columnas }));
}

let cache: { en: number; datos: Tabla[] } | null = null;

/** El catálogo, refrescado como mucho cada minuto: a fondo, pero sin
 * golpear information_schema en cada llamada de una ráfaga de preguntas. */
export async function catalogoCacheado(): Promise<Tabla[]> {
  if (cache && Date.now() - cache.en < 60_000) return cache.datos;
  const datos = await catalogo();
  cache = { en: Date.now(), datos };
  return datos;
}

export function tablaValida(tablas: Tabla[], nombre: string): Tabla {
  if (!IDENT_VALIDO.test(nombre)) throw new Error(`Nombre de tabla no válido: ${nombre}`);
  const t = tablas.find((t) => t.nombre === nombre);
  if (!t) {
    throw new Error(
      `No existe la tabla "${nombre}". Las que hay: ${tablas.map((t) => t.nombre).join(', ')}. ` +
        'Usa listar_tablas para verlas con sus columnas.',
    );
  }
  return t;
}

export function columnaValida(tabla: Tabla, nombre: string): Columna {
  if (!IDENT_VALIDO.test(nombre)) throw new Error(`Nombre de columna no válido: ${nombre}`);
  const c = tabla.columnas.find((c) => c.nombre === nombre);
  if (!c) {
    throw new Error(
      `La tabla "${tabla.nombre}" no tiene la columna "${nombre}". Las que hay: ` +
        tabla.columnas.map((c) => c.nombre).join(', '),
    );
  }
  return c;
}

export const ESQUEMA_SQL = ESQUEMA;
