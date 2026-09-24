# ADR-29 · MotRest en la web: túnel al Hub y restaurantes en la nube

**Estado:** aceptado · **Fecha:** septiembre 2026 · **Decide:** Gonzalo (MOTRAE)
**Revisa:** [ADR-28](ADR-28-la-nube-en-supabase.md) (la regla «la nube no guarda
datos del restaurante») y [ADR-23](ADR-23-whatsapp-y-el-relay.md) §2 (el Hub no se
expone).

---

## Contexto

Sin cuenta de Apple Developer no hay app para iPad, iPhone ni Mac. Además, los dueños
quieren ver su restaurante desde fuera. Gonzalo pidió publicar MotRest en la web, con
un candado previo por restaurante, y poder elegir en Central, local por local, dónde
viven los datos.

## Decisión

**Tres modalidades por local.** Se eligen en Central y viajan firmadas en la licencia
(`licencia.web`):

- **app**: como siempre. Si la licencia no trae bloque `web`, el local es `app`.
- **ambas**: los datos siguen en el Hub. La web llega a él por un canal broadcast
  **privado** de Supabase Realtime (`tunel:<sucursal>`).
  - Se respeta ADR-23 §2: el Hub no abre ningún puerto, solo sale.
- **nube**: no hay Hub. El navegador habla el protocolo del Hub consigo mismo
  (`ServidorNube`) y guarda en `eventos_nube` y `documentos_nube`.

**Entrada.** «Entra a tu restaurante» pide clave y contraseña.

- Pasa por la Edge Function `entrar-restaurante`, que frena por clave y por red y
  responde siempre lo mismo ante cualquier fallo.
- Después viene el «¿Quién eres?» + PIN de siempre.

**Llaves.**

- La web **nunca** conoce la clave del local de la LAN. Usa una **clave remota**
  propia, que genera Central y que en la nube se guarda envuelta con la contraseña
  (PBKDF2 600k + AES-GCM).
- De la clave remota salen, con HKDF, las llaves del túnel y la llave de los datos
  en la nube.
- El usuario de Supabase Auth de la web lleva `app_metadata.sucursal_web` y **no**
  `sucursal_id`, para no heredar las políticas del Hub.

## Lo que cambia de ADR-28

ADR-28 decía que la nube no guarda órdenes, ventas ni clientes. Con la modalidad
**nube** sí los guarda, pero **solo cifrados**, con una llave que Supabase no tiene.
En claro quedan `sucursal_id`, `seq`, `id`, `device_id` y la fecha de inserción. El
principio que protegía la regla, «Supabase no es parte de confianza», se mantiene.

## Consecuencias

- **La validación de permisos del Hub no es una frontera en modo nube.** Corre en el
  mismo navegador que genera el evento. La frontera es la contraseña del restaurante.
- **El orden de `seq` en la nube lo garantiza un candado por restaurante.**
  `empujar_eventos_nube` usa `pg_advisory_xact_lock` y es la **única** puerta de
  escritura.
- **En modo nube no hay FacturAPI, autofactura, WhatsApp ni respaldo local.** Se dice
  en pantalla.
- **Impresión desde el navegador:** Web Serial, WebUSB o Web Bluetooth en Chrome y
  Edge; en Safari de iPad o iPhone, solo AirPrint y sin cajón.
- **Pasar de nube a app, o de app a nube, es una mudanza de datos que todavía no
  existe.** Central la bloquea en cuanto el local tiene licencia emitida.
- **Pendiente de endurecer:**
  - El canal `hub-<sucursal>` del Hub sigue siendo público, y por eso no se puede
    apagar el acceso público de Realtime. El tráfico del túnel va cifrado de extremo
    a extremo igualmente.
  - Primera entrada en un dispositivo nuevo: se descarga toda la historia (ver ADR-21).
