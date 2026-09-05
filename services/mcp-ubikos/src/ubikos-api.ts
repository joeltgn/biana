/**
 * LA MITAD QUE FALTABA: PREGUNTAR A UBIKOS EN VIVO.
 *
 * Joel, 05/09/2026: «al final lo que queremos es trabajar contra las APIs
 * directamente, diferenciando solo que los históricos no hagan falta
 * cargarlos contra la DB». Esto es esa mitad.
 *
 * Las llamadas son las mismas que ya probamos y verificamos en
 * `traer_ubikos.py` de joel-bi-v2 —mismos endpoints, misma clave por
 * parámetro, mismo trato de "sin respuesta ≠ vacío"—. No se reinventa la
 * forma de hablar con Ubikos, se reutiliza la que ya sabemos que funciona.
 *
 * ESTO ES SOLO PARA HOY Y LOS ÚLTIMOS DÍAS. Un rango de años pedido en vivo
 * sería lento y gastaría llamadas contra el servidor de un tercero para
 * nada —esos datos ya no cambian y ya están en la copia—. Por eso hay un
 * tope de días (`RANGO_MAXIMO_DIAS`): pedir más se rechaza con el motivo,
 * no se sirve a medias ni se calla.
 */
const BASE = process.env.UBIKOS_BASE_URL ?? 'https://api.ubikos.es/';
const KEY = process.env.UBIKOS_API_KEY ?? '';
const HOTEL = process.env.UBIKOS_HOTEL_ID ?? '';
const RANGO_MAXIMO_DIAS = 31;

type Vista = 'reserva' | 'capacidad' | 'servicioreserva' | 'ticket' | 'mealplaninfo';

const RUTA: Record<Vista, string> = {
  reserva: 'bi/reserva',
  capacidad: 'bi/capacidad',
  servicioreserva: 'bi/servicioreserva',
  ticket: 'bi/ticket',
  mealplaninfo: 'bi/mealplaninfo',
};

async function llamar(ruta: string): Promise<unknown[] | null> {
  const url = `${BASE}${ruta}?${new URLSearchParams({ 'ubikos-api-key': KEY })}`;
  for (let intento = 0; intento < 3; intento++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as unknown[];
    } catch (e) {
      if (intento === 2) return null; // sin respuesta ≠ vacío: se dice, no se inventa un [].
      await new Promise((res) => setTimeout(res, 1000));
    }
  }
  return null;
}

function dias(desde: string, hasta: string): number {
  const a = new Date(desde).getTime();
  const b = new Date(hasta).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

// Caché de segundos, no de minutos: evita que la misma pregunta hecha dos
// veces seguidas llame dos veces a Ubikos, sin esconder un dato que cambió.
const CACHE_MS = 30_000;
const cache = new Map<string, { en: number; datos: unknown }>();

export async function consultarEnVivo(vista: Vista, desde: string, hasta: string) {
  if (!KEY || !HOTEL) throw new Error('Faltan UBIKOS_API_KEY o UBIKOS_HOTEL_ID: sin ellos no se puede ir en vivo.');
  const n = dias(desde, hasta);
  if (n > RANGO_MAXIMO_DIAS) {
    throw new Error(
      `${n} días es demasiado para preguntar en vivo (tope: ${RANGO_MAXIMO_DIAS}). ` +
        'Eso ya es histórico: usa la herramienta "consultar" sobre la copia, que lo tiene y es más rápida.',
    );
  }

  const clave = `${vista}:${desde}:${hasta}`;
  const enCache = cache.get(clave);
  if (enCache && Date.now() - enCache.en < CACHE_MS) return { datos: enCache.datos, deCache: true };

  let ruta: string;
  if (vista === 'mealplaninfo') {
    ruta = `${RUTA[vista]}/${HOTEL}/_/${desde}/${hasta}`;
  } else {
    ruta = `${RUTA[vista]}/${HOTEL}/${desde}/${hasta}`;
  }
  const datos = await llamar(ruta);
  if (datos === null) {
    throw new Error(`Ubikos no ha contestado tras tres intentos para "${vista}". No se inventa un vacío: es un fallo real, se reintenta luego.`);
  }
  cache.set(clave, { en: Date.now(), datos });
  return { datos, deCache: false };
}
