import pg from 'pg';

/**
 * LA CONEXIÓN. Con una sola cosa que tiene que ser verdad siempre: el rol
 * con el que nos conectamos NO PUEDE ESCRIBIR. No es una promesa del
 * código —eso ya lo prometimos y no basta—: es un permiso que no existe en
 * la base. Lo comprueba `verificarSoloLectura()` al arrancar, y si alguna
 * vez alguien le diera permiso de escritura a este rol por error, el
 * servicio se niega a arrancar en vez de arrancar más permisivo de lo que
 * cree ser.
 */
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

export async function query<T extends pg.QueryResultRow = any>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const r = await pool.query<T>(sql, params);
  return r.rows;
}

export async function verificarSoloLectura(): Promise<void> {
  const r = await pool.query<{ puede_escribir: boolean }>(
    `SELECT has_schema_privilege(current_user, 'fuente_dae0d55c02ac410aa677ab14e41d5f13', 'CREATE')
            OR has_table_privilege(current_user, 'fuente_dae0d55c02ac410aa677ab14e41d5f13.reserva', 'INSERT')
            OR has_table_privilege(current_user, 'fuente_dae0d55c02ac410aa677ab14e41d5f13.reserva', 'UPDATE')
            OR has_table_privilege(current_user, 'fuente_dae0d55c02ac410aa677ab14e41d5f13.reserva', 'DELETE')
            AS puede_escribir`,
  );
  if (r.rows[0]?.puede_escribir) {
    throw new Error(
      `El rol de conexión (${process.env.DATABASE_URL?.split('@')[0].split('//')[1]?.split(':')[0]}) ` +
        'tiene permiso de escritura sobre la fuente. Esto no debería poder pasar nunca: arreglar el GRANT antes de arrancar.',
    );
  }
}

export async function cerrar(): Promise<void> {
  await pool.end();
}
