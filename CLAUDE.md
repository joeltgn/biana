# BiAna

## Qué es esto

El cliente entra por una dirección propia, con su usuario. Le habla al
programa en una frase —«buenos días, quiero saber…»— y BiAna cruza todo el
dato que ese cliente nos ha dado para contestar. Puede pedir un informe
(«compárame la agencia X este año contra el pasado») y convertirlo en
recurrente. El primer día elige qué quiere ver y con eso se le monta su
dashboard; a partir de ahí entra y lo tiene puesto, más la opción de seguir
preguntando en libre sobre todo lo publicado.

Joel, 04/09/2026, dictado de un tirón — es la fuente y no se resume más que
esto. Todo lo demás de este documento es la traducción a orden de
construcción, «de más grande a más pequeño», tal como lo pidió.

## El orden: primero el dato, los roles después

Dicho explícitamente por Joel: *«traigamos toda la información y después
determinaremos qué tipo de roles tenemos que hacer»*. Así que el orden de
construcción NO es capas de arriba abajo del producto — es esto:

1. **Un MCP a fondo por cada fuente.** Por cada API —Ubikos ya, Revo
   pronto— catalogar cada endpoint y cada dato que da, sin dejar nada
   fuera. Nunca se adivina qué puede dar una fuente: se mira.
2. **Histórico guardado + tiempo real, los dos, no uno u otro.** Lo ya
   guardado (ver abajo) sirve para lo histórico, rápido y sin gastar
   llamadas. Por encima, una vía en vivo: si el dato no ha llegado aún a la
   copia, o hace falta al segundo, se pregunta directo a la fuente, con el
   límite que la propia fuente imponga (si solo da el día cerrado, se da
   el día cerrado).
3. **Nunca se escribe.** Ni en la fuente, ni sobrescribiendo mal nuestra
   propia copia. Cada conector expone SOLO lectura — ni una herramienta de
   escritura, nunca, aunque la fuente lo permitiera.
4. El chat, los dashboards y los informes recurrentes, montados encima de
   (1)-(3).
5. Roles y reparto por perfil — al final, cuando (1)-(4) esté firme.

## Lo que se reutiliza de joel-bi-v2, y por qué

BiAna es un proyecto nuevo — repositorio propio, dominio propio, sin
código de joel-bi-v2 copiado ni pegado. Pero **no se vuelve a traer un dato
que ya tenemos verificado**:

- El esquema `fuente_dae0d55c02ac410aa677ab14e41d5f13` en el Postgres de
  `tpm.ciber.cat` ya tiene Ubikos completo, cuadrado al céntimo contra la
  copia del PC del cliente (ver joel-bi-v2, migraciones 0037-0039). BiAna
  LEE de ahí. Cero llamadas nuevas a la API de Ubikos para esto.
- El servidor es el mismo (`tpm.ciber.cat`, acceso por
  `~/.ssh/id_ed25519_joelbi`). Base de datos nueva y usuario de Postgres
  nuevo para BiAna — nunca las tablas de la aplicación de joel-bi-v2
  (usuarios, roles, empresas: eso es de ese producto, no de este).
- El patrón de infraestructura se copia porque funciona: systemd + nginx +
  certbot, un servicio por pieza, cada uno con su propio usuario de
  sistema. Es lo mismo que ya se ve en `joelbi-api`, `joelbi-web`,
  `joelbi-mcp` y en `ubikos-mcp` (JoeMCP, de David).

## JoeMCP: qué se copia de la idea, qué no

Joel estudió el conector de David (JoeMCP) antes de esto. Dos cosas
concretas de ahí:

- **Sí se copia:** la agilidad de un lenguaje de consulta libre —filtrar,
  agrupar, sumar, sin tener que declarar de antemano cada cruce posible—.
  Es lo que hace que "pregunta lo que quieras" sea de verdad.
- **No se copia:** JoeMCP puede escribir reservas reales y da acceso sin
  filtrar a datos de huésped (nombre, teléfono, fecha de nacimiento). Ni
  una cosa ni la otra pasan a BiAna. El acuerdo de escritura de Joel — «no
  debería poder escribir» — es una regla de este proyecto desde el primer
  commit, no una corrección posterior.

## Estructura del repositorio (según se va necesitando, no toda de golpe)

```
services/mcp-ubikos/   El primero. MCP en solo lectura sobre el esquema
                       fuente_* ya existente. Node + TypeScript +
                       @modelcontextprotocol/sdk (el mismo SDK oficial que
                       usa JoeMCP; visto funcionar en producción).
apps/api/              Cuando haga falta: el motor que junta MCPs, decide
                       histórico-vs-vivo, y sirve al chat.
apps/web/              Cuando haga falta: la pantalla del cliente.
```

## Servidor y despliegue

- Máquina: `tpm.ciber.cat` (Debian), la misma de joel-bi-v2.
- Cada servicio, su propio usuario de sistema, su propio `systemd`, su
  propia entrada de `nginx` con certificado propio — nunca compartiendo
  proceso con joel-bi-v2 ni con JoeMCP.
- Dominio de trabajo mientras no haya uno propio comprado: subdominios de
  `ciber.cat` (p. ej. `mcp-ubikos.biana.ciber.cat`), igual que `tpm.` y
  `joemcp.`. Es barato y reversible; se cambia el día que BiAna tenga su
  propio dominio.
- Nada de contraseñas ni claves en el repositorio. Van en `.env` en el
  servidor, fuera de git — igual que en joel-bi-v2.

## Lo que aún no está decidido (para no fingir que sí)

- Nombre de dominio propio de BiAna (hoy vive bajo `ciber.cat`).
- Qué modelo traduce la pregunta en libre a una consulta — el hilo de
  OpenRouter sigue abierto, aquí también.
- Cómo se reparte por rol — deliberadamente el último paso, no antes.
