# ADR-28 · La nube en Supabase, y el relay se apaga

**Estado:** aceptado · **Fecha:** agosto 2026 · **Decide:** Gonzalo (MOTRAE)
**Revisa:** [ADR-27](ADR-27-donde-vive-el-relay.md)

---

## Contexto

[ADR-27](ADR-27-donde-vive-el-relay.md) puso el relay en Fly.io hace unas
semanas y funciona: Rodizio opera contra él, reporta su pulso y recibe
renovaciones. Esto no se decide por un fallo suyo.

Se decide porque faltaba una **base de datos**. El canal de actualizaciones
publicaba un `motrest.json` firmado en un release de GitHub, y de ahí salían dos
límites que no se arreglan con más código:

1. **No se podía apuntar a un local por su nombre.** El manifiesto es un archivo
   público, así que el reparto tenía que ser un porcentaje con un hash estable
   del `sucursal_id` ([ADR-26](ADR-26-actualizacion-remota.md) §5) — publicar la
   cartera de clientes de MOTRAE en GitHub no era una opción. El porcentaje da
   control operativo; no da «Rodizio a la 1.4.0 y el resto se queda».
2. **La adopción era un cruce a mano.** Qué versión ofrecí y cuál corre cada
   local vivían en dos sitios distintos: un release de GitHub y un archivo JSON
   servido con clave de administración.

Y el TRD ya decía Supabase desde el principio (§6 y §Distribución). La
implementación de F1 tomó otro camino por razones buenas de entonces.

## Lo que ADR-27 no llegó a mirar

ADR-27 descartó Supabase en una línea: *«Edge Functions … son ejecuciones
efímeras sin disco, y el relay necesita sostener un socket abierto por
restaurante y un padrón que no puede vivir en la base de datos de nadie más»*.

Las dos objeciones eran ciertas **sobre Edge Functions**. Lo que no se evaluó es
que Supabase trae además **Realtime** (un WebSocket gestionado, que es
exactamente el socket sostenido) y **Postgres** (que es exactamente el estado
durable). Con esas dos piezas la objeción se cae.

Al mirarlo de cerca aparece algo que tampoco estaba dicho: de los cuatro
trabajos del relay, **solo uno necesita de verdad un socket abierto**.

| Trabajo | ¿Socket? | Dónde vive ahora |
|---|---|---|
| Webhook de Meta | no | Edge Function `webhook-whatsapp` |
| Entregar el mensaje al Hub que toca | **sí, importan los segundos** | `INSERT` → **Realtime** |
| El Hub pide mandar por Meta | no | Edge Function `enviar-whatsapp` |
| Padrón, pulsos, licencias | no | Postgres + RLS |

La tercera objeción —el padrón en la base de datos de otro— **sigue en pie y se
respeta**: el token de Meta se guarda cifrado con AES-256-GCM y la llave vive
solo en el entorno de las Edge Functions. Supabase guarda un sobre que no puede
abrir, igual que el volumen de Fly guardaba un archivo que no podía leer.

## Decisión 1 — El motor sostiene lo que antes sostenía el código

El relay conseguía a mano que un local no pudiera hacerse pasar por otro:
derivaba la identidad de la credencial del saludo y se negaba a creerse el
`sucursal_id` que le dijeran. Aquí eso lo da Supabase Auth: la sucursal viaja en
`app_metadata`, firmada por el motor, y el Hub no puede escribirla. Las políticas
RLS filtran cada tabla por ella.

Dos cosas mejoran al mudarse, y no son adorno:

- **El índice de mensajes ya vistos sobrevive al reinicio.** Era un `Map` en
  memoria; cada despliegue lo vaciaba y los reintentos de Meta de ese rato
  entraban duplicados. Ahora es una restricción única sobre `externo_id`.
- **Un mensaje que llega con el local apagado ya no se pierde.** Queda en la
  tabla y su Hub lo recoge al encender, dentro de la ventana de 24 horas de
  Meta. El relay no podía: no tenía dónde guardarlo, y eso dejaba al Hub creyendo
  que no podía responder con texto libre a quien le había escrito de madrugada.

## Decisión 2 — El manifiesto se guarda TAL CUAL, no en columnas

Es la decisión menos obvia y la que más cerca estuvo de costar cara.

La firma Ed25519 no cubre una lista de campos: cubre el **JSON canónico del
manifiesto entero** menos la propia firma. Reconstruirlo desde columnas parecía
inofensivo y habría roto **todas** las verificaciones, por diferencias mínimas —
`obligatoria` guardada como `false` donde Central no la firmó, `canal` colado de
más, `publicado_ts` de vuelta desde `timestamptz`.

El síntoma habría sido «se publicó MotRest X con una firma que no es de MOTRAE»
en la bitácora de cada local, con el canal entero parado y sin causa evidente. Y
no lo habría destapado ninguna prueba del Hub, porque ahí el manifiesto se
construye y se firma en memoria.

Así que la columna `manifiesto` es la autoridad y las demás son copias, con
restricciones que impiden que se separen.

## Decisión 3 — Se conserva el carril de actualización del Hub

**No se migra a `tauri-plugin-updater`.** Lo que cambia es el origen del
manifiesto —de GitHub Releases a la tabla `versiones`— y nada más: la firma se
verifica igual, el SHA-256 se comprueba las mismas tres veces, y las dos guardias
de ADR-26 siguen donde estaban.

Contra el updater oficial pesaban dos cosas. Firma con **minisign**, que sería un
segundo sistema de llaves en paralelo al Ed25519 que Central ya administra; y las
guardias que importan —nunca con la caja abierta, nunca en horario de servicio—
viven en el Hub porque es donde está el estado de la caja, mientras que el
updater se dispara desde la cáscara Tauri.

## Decisión 4 — Los dos transportes conviven durante la migración

La dirección del relay viaja **firmada dentro de la licencia** de cada Hub
instalado, y `EnlaceRelayWs` no se puede repuntar: Realtime habla Phoenix, no el
saludo `{tipo:"hola"}`. No es la misma conversación con otra URL.

Así que el Hub aprende los dos idiomas y elige por la forma de la dirección
—`wss://` el relay, `https://` la nube—. **Esa versión tiene que llegar a toda la
flota antes de mover a nadie**, y el orden del corte no es negociable:

1. Publicar el Hub que habla los dos, por el carril de GitHub.
2. Esperar adopción. **Los pulsos dicen cuándo**, que es justo para lo que
   ADR-26 §6 los inventó.
3. Reemitir las licencias apuntando a la nube, **entregadas por el relay de
   Fly**: lo último que hace es darle a cada restaurante su boleto de salida.
4. Confirmar que los pulsos llegan por Supabase. Un local que no reportó, no ha
   migrado.
5. Cambiar el webhook en el panel de Meta. **Atómico y de una sola dirección**:
   hay una URL por app.
6. Fly encendido dos semanas más, callado, por si aparece un rezagado.

## Consecuencias

**A favor**

- Se puede subir a un local por su nombre y congelar a otro que no puede
  reiniciarse esta semana. El anillo por porcentaje se retira.
- La adopción es una consulta, no un cruce a mano.
- Un local ve **una sola fila** de `versiones`: la suya. Antes el manifiesto era
  público y el anillo lo aplicaba el propio Hub sobre sí mismo, por honradez.
- Dar de alta un restaurante deja de exigir **entrar por SSH** a la máquina del
  relay.
- Desaparece la restricción de una sola máquina: el estado que la imponía
  —enlaces en memoria, padrón en un archivo, índice de vistos— ya no está en
  memoria de nadie.

**Costo asumido**

- **La factura pasa de ~3.50 a ~25 USD al mes.** Free no sirve para producción:
  no trae PITR ni respaldos. Se construye en Free y se sube a Pro antes de mover
  el webhook de Meta.
- **Se pierde la simplicidad de «un proceso y un archivo».** El relay se leía
  entero en una tarde. Supabase son RLS, Auth, Realtime y Edge Functions, cada
  uno con sus modos de fallar.
- **Más proveedor, no menos.** Se acota igual que antes: lo que corre ahí es
  Postgres y Deno corriente, y las migraciones están en el repositorio.
- La región empeora ligeramente: `us-east-1` en vez de Dallas. Ninguno de los dos
  tiene región en México.

## Alternativas descartadas

**Quedarse en Fly y añadir Supabase solo para el canal.** Era la opción de menor
riesgo y entregaba lo que se pidió primero. Se descartó porque dejaba dos nubes
que mantener y pagar, con la cartera partida en dos sitios.

**Vercel para algo operativo.** Vercel no sostiene WebSockets y no hace falta que
lo haga: eso es Realtime. Se queda con el sitio público, la documentación y el
estado del servicio.

**Los Hubs en la nube.** Se preguntó y no se puede. El Hub manda impresoras USB y
Bluetooth, sostiene el WebSocket de LAN contra cada tableta, es dueño del SQLite
del local y **sigue vendiendo cuando se cae internet**. En serverless no imprime,
no ve la LAN, y el restaurante se muere con el enlace. Es lo contrario del diseño
LAN-first del TRD y de la promesa del producto. Lo que sí se construye es
*administrarlos* en remoto, que es lo que compran `pulsos` y `asignaciones`.
