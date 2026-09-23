# MotRest en la web — «Entra a tu restaurante», modalidad nube / app / ambas

## Contexto

Sin la cuenta Apple Developer no hay app para iPad, iPhone ni Mac. Gonzalo pide que
MotRest también se use desde el navegador, publicado en **Vercel** con **Supabase**
detrás:

- Un primer candado **por restaurante**: la pantalla **«Entra a tu restaurante»**
  con **Clave del restaurante** y **Contraseña**. Nunca lista otros restaurantes.
  Después viene el «¿Quién eres?» + PIN de siempre.
- En **Central**, al dar de alta o editar un local, se elige su **modalidad**:
  - **App**: como hoy. Hub en la caja y sin acceso web.
  - **Ambas**: los datos siguen viviendo en el Hub del local. La web **llega al Hub
    por internet** mientras esté conectado, para monitorear desde cualquier parte o
    usar iPads en el salón.
  - **Nube**: sin computadora en el local. Los datos viven en **Supabase, cifrados**
    con una llave del restaurante que Supabase no puede leer (se respeta ADR-28).
- Desde la web se puede **hacer todo según el rol**, igual que en una tablet.
- La contraseña la cambian **Central y el propietario**, y Gonzalo **puede verla en
  Central**. Si la cambia el restaurante, le llega a Central en un sobre cifrado.
- **Todo en una sola entrega.** En modo nube, si el dispositivo tiene una impresora o
  un cajón conectado por USB o Bluetooth, **imprime y cobra como siempre**, después
  de darlos de alta en Administración.

## Decisiones de diseño

### Qué se reutiliza (verificado en el código)

- `ClienteSync` acepta un socket inyectable (`crearSocket` → `SocketLike`,
  `packages/protocolo-sync/src/cliente.ts:33-53`), que se pasa en
  `apps/pos-ui/src/lib/sync.svelte.ts:365`. **Toda la web cabe detrás de dos
  `SocketLike` nuevos** y el resto del POS no se entera.
- El Hub maneja terminales como `Conexion {id, enviar, cerrar}` mediante
  `hub.conectar(conexion, esLocal)` y `hub.recibir` (`apps/hub/src/servidor.ts:59-63, 353-403`;
  el cableado `ws` está en `main.ts:2412-2481`).
- El protocolo ya viaja **cifrado de extremo a extremo** (`cifrado.ts`, HKDF +
  AES-GCM): Supabase solo transporta texto cifrado.
- El Hub ya sostiene un socket con Supabase Realtime como
  `sucursal_id@hubs.motrae.mx` (`apps/hub/src/enlace-supabase.ts:178-291`).
- `pos-ui` ya es una app de navegador pura: no usa Tauri. Lo exclusivo de la caja
  se protege con `esLaCaja()` (`entorno.ts:32`).
- De la 1.5.6 ya existen:
  - el patrón de clave corta por restaurante («RODIZIO») y su propuesta automática
    en Central (`proponerClave`, `central.svelte.ts:3014-3116`);
  - el freno a la fuerza bruta (`intentos_factura` + `registrar_fallo_autofactura`);
  - el buzón de sobres X25519 (`secretos_pendientes`, `packages/dominio/src/comun/sobre.ts`).
- El diseño de `apps/pos-ui/src/lib/sesion/Acceso.svelte` (`.velo`, `.panel`,
  `.lado-marca`, `.lado-acceso`, logo) sirve de base para la nueva pantalla.

### Las llaves

- Por cada restaurante con web, **Central genera una `clave_remota`** de 32 bytes y
  una **contraseña**. Las dos quedan en `SecretosProtegidos` (DPAPI) y **nunca**
  entran en la cartera ni en `exportar()`.
- En Supabase se guarda la `clave_remota` **envuelta**:
  AES-GCM con PBKDF2(contraseña, sal, 600k).
- Al entrar, el navegador la desenvuelve con la contraseña que tecleó. De ella
  derivan, con HKDF:
  - las llaves del túnel (`derivarClaves(clave_remota, …)`, igual que hoy);
  - la llave de los datos en la nube.
- **La clave del local de la LAN no sale nunca a la web.** Si se filtra la
  contraseña web, la red del restaurante no queda abierta.
- En modo **ambas**, Central le manda la `clave_remota` al Hub en un sobre X25519,
  como nueva clase `acceso_web` del buzón de secretos.

### Identidad en Supabase

- Usuario Auth `web-<sucursal_id>@web.motrae.mx` con
  `app_metadata.sucursal_web`.
  - **No lleva `sucursal_id`**, para que las políticas actuales de los Hubs
    (`privado.sucursal_actual()`) no le den permisos de Hub.
  - Nueva función `privado.sucursal_web_actual()`.
- La entrada pasa por una Edge Function nueva, **`entrar-restaurante`**
  (`verify_jwt=false`):
  1. recibe clave + contraseña;
  2. frena por clave y por IP (tabla `intentos_entrada`);
  3. responde siempre «Clave o contraseña incorrecta»;
  4. hace `signInWithPassword` y devuelve la sesión y la fila envuelta.

### Túnel (modo ambas)

- Canal Realtime **Broadcast privado** `tunel:<sucursal_id>`, autorizado con RLS
  sobre `realtime.messages`. Solo pueden entrar el Hub de ese local y la sesión web
  de ese local.
- Módulo compartido `packages/protocolo-sync/src/tunel.ts` con el sobre del canal
  `{sesion, dir, msg, i, total, datos}`:
  - fragmenta a ~64 KB, porque Realtime limita el tamaño por mensaje y una página de
    `pull` puede pasar de 1 MB;
  - reensambla, y cierra la sesión si deja de latir.
- **Pos-ui:** `SocketTunel implements SocketLike`.
- **Hub:** `TunelRemoto` en `enlace-supabase.ts`.
  - Por cada sesión nueva crea una `Conexion` cifrada con las llaves remotas.
  - Llama a `hub.conectar(conexion, "remoto")`, **nunca** `esLocal`.
  - `saludar()` en `servidor.ts:680-790` gana el origen `"remoto"`: se aprueba
    solo, porque la credencial es la contraseña, pero queda **etiquetado «Web»** en
    Terminales y se puede revocar.
  - Máximo 10 sesiones remotas.
  - Cuando llega una `acceso_web` con versión nueva (contraseña cambiada), el Hub
    corta todas las sesiones remotas.
- **Fotos de producto:** hoy se piden al Hub por `fetch` del mismo origen. Se añade
  el mensaje `foto{pedir}` al protocolo, con caché en IndexedDB.
- Las comandas que salen de un iPad web **se imprimen en la caja**, como las de las
  tablets Android. Nada que cambiar.

### Modo nube (sin Hub)

- `SocketNube implements SocketLike` es un **«Hub» del lado del navegador**, en
  `apps/pos-ui/src/lib/web/nube/`. Contesta el mismo protocolo contra tablas de
  Supabase:
  - `hola` → `bienvenida`;
  - `push` → inserta en `eventos_nube` (dedup por `id`, `seq` lo asigna Postgres)
    y responde `acks`;
  - `pull` → responde `eventos` paginados;
  - los eventos en vivo llegan por Realtime `postgres_changes`;
  - `catalogo` → `catalogos_nube`, gana la versión mayor;
  - `credenciales` → `credenciales_nube`.
- Cada fila guarda en claro solo `sucursal_id`, `seq`, `id`, `device_id` y `ts`.
  **El evento completo va cifrado** con la llave de datos.
- **Licencia:**
  - el navegador lee su licencia firmada de `licencias_pendientes` (nueva política
    para el rol web) y la verifica con la pública Ed25519 de MOTRAE, integrada en
    el build;
  - aplica vencimiento y bloqueo con `situacionDe`;
  - da de alta al **responsable** y al **acceso de soporte** desde la licencia,
    igual que hace el Hub.
- Se reutiliza la validación de eventos del Hub (`servidor.ts:945-1010`), movida a
  `packages/dominio` si es pura. En la nube **no es frontera de seguridad**: la
  frontera es la contraseña del restaurante. Queda documentado.
- **Pulso a Central:** el dispositivo que cierra la caja sube el pulso del local
  (política nueva para el rol web). Así Central ve las cifras igual que con un Hub.
- **Sin Hub, no disponible al inicio:** FacturAPI/autofactura, WhatsApp y respaldo
  local. Se muestran con un aviso «No disponible en modo nube», no se ocultan en
  silencio.
- **Cambio de modalidad:**
  - app ↔ ambas: libre;
  - nube ↔ app/ambas: bloqueado en Central con el aviso «la mudanza de datos llega
    en una versión posterior».

### Impresoras y cajón del dispositivo (web, sobre todo en modo nube)

Nuevos `Transporte` en `apps/pos-ui/src/lib/impresion.svelte.ts`, junto a
`TransporteHub`:

| Transporte | Dónde funciona | Cubre |
|---|---|---|
| **Web Serial** | Chrome/Edge en computadora | USB-serie y Bluetooth emparejado como COM, como la MP210 |
| **WebUSB** | Chrome en computadora y Android | Impresoras USB sin driver que las acapare |
| **Web Bluetooth** | Chrome en Android y computadora | Impresoras BLE |
| **Navegador** (`window.print` con el ticket en HTML) | Cualquiera | Es lo único posible en **Safari de iPad/iPhone**, vía AirPrint |

- **Cajón de dinero:** pulso ESC/POS por la impresora, como hoy.
- **Administración → Impresoras:** nueva sección «Impresoras de este dispositivo».
  Pide permiso con un toque (el navegador lo exige) y queda guardada en el
  dispositivo.

### Contraseña: cambio y visibilidad

- **Central tiene su propio buzón X25519.** La privada va en DPAPI; la pública
  viaja **firmada en la licencia**, en el bloque nuevo `web`, así que Supabase no
  puede suplantarla.
- **Cambio desde Central:** genera la contraseña nueva, hace `PUT` al usuario Auth
  (ruta ya permitida por la lista blanca de Rust), vuelve a envolver la
  `clave_remota` y reenvía `acceso_web` con una versión nueva.
- **Cambio desde el restaurante:** Administración → «Acceso por internet», solo
  para el propietario.
  - En modo nube lo hace el navegador.
  - En modo ambas, desde la caja: mensaje `secreto` al Hub.
  - En los dos casos llama a la Edge Function **`cambiar-contrasena-web`**, que
    acepta el JWT web o el del Hub de esa sucursal. Esta actualiza la contraseña,
    guarda la envoltura nueva y deja `contrasena_para_central`: la contraseña
    sellada con la pública de Central.
- Central abre ese sobre al refrescar, actualiza su copia y muestra
  «Cambiada por el restaurante el …» junto al botón **Ver**.

### La licencia

- Campo nuevo opcional firmado:
  `web?: { modalidad: "nube" | "ambas"; buzon_central: string }`.
  Si no está, el local es «app».
- **No lleva secretos**, así que no importa que `paraTerminales` no lo filtre.
- Los Hubs viejos verifican la firma con campos desconocidos sin problema, pero
  **no abren túnel**: hace falta la 1.6.0.

## Cambios por área (archivos principales)

**Dominio y protocolo**
- `packages/dominio/src/organizacion/licencia.ts`: bloque `web`.
- `packages/dominio/src/organizacion/secretos.ts`: clase `acceso_web`.
- `packages/dominio` nuevo `acceso-web.ts`: envolver y desenvolver, derivar la
  llave de datos.
- `packages/protocolo-sync/src/tunel.ts`: sobre y fragmentación.
- `packages/protocolo-sync/src/protocolo.ts`: mensaje `foto`.

**Supabase** (migración nueva, y después renombrar el archivo a la marca que asigne
`apply_migration`)
- Tablas `accesos_web`, `intentos_entrada`, `eventos_nube`, `catalogos_nube`,
  `credenciales_nube`, y bucket `fotos_nube`.
- `privado.sucursal_web_actual()` y las políticas del rol web: su `accesos_web`,
  su licencia, su pulso, lo `*_nube` de su sucursal.
- Políticas de `realtime.messages` para `tunel:%`.
- Añadir `'acceso_web'` al `check` de `secretos_pendientes`.
- Edge Functions `entrar-restaurante` y `cambiar-contrasena-web`, registradas en
  `supabase/config.toml`.
- Revisar con `get_advisors` (seguridad) al terminar.

**Hub** (`apps/hub/src/`)
- `enlace-supabase.ts`: `TunelRemoto`.
- `servidor.ts`: origen `"remoto"`, etiqueta «Web», límite de sesiones.
- `secretos.ts`: `acceso_web`.
- `main.ts`: montar el túnel si la licencia dice `ambas`, más `foto`.

**POS** (`apps/pos-ui/src/`)
- `lib/entorno.ts`: `esWeb()`, a partir de `VITE_MOTREST_WEB`.
- `lib/web/`: `acceso-web.svelte.ts` (sesión con supabase-js), `socket-tunel.ts`
  y `nube/` (`SocketNube`).
- `lib/sesion/EntradaRestaurante.svelte`: «Entra a tu restaurante», con los tokens
  y la marca actuales (acento naranja).
- `sync.svelte.ts`: destino e inyección de `crearSocket` en modo web.
- `App.svelte`: la entrada va antes que todo.
- «Salir de este restaurante» en el encabezado: cierra la sesión y **borra el
  IndexedDB** del dispositivo.
- `impresion.svelte.ts`: los transportes nuevos.
- Admin: «Acceso por internet» (propietario) e «Impresoras de este dispositivo».
- Avisos de «No disponible en modo nube».
- La UI nueva usa `subirAlPrincipio` y `use:revelar` de `lib/subir.ts` (regla de
  Gonzalo).

**Vercel**
- `apps/pos-ui/vercel.json`:
  - build `vite build --mode web`;
  - reescritura SPA;
  - cabeceras `X-Robots-Tag: noindex`, CSP con `connect-src` solo a Supabase,
    `frame-ancestors 'none'` y `Referrer-Policy`.
- Variables `VITE_SUPABASE_URL` y la llave **publicable**. Nunca la de servicio.

**Central** (`apps/central/src/`)
- `lib/central.svelte.ts`:
  - buzón X25519 de Central;
  - `accesos_web` en protegidos;
  - `activarAccesoWeb`, `cambiarContrasenaWeb`, `verContrasenaWeb`,
    `recogerContrasenasDelRestaurante`;
  - `emitir()` incluye el bloque `web`;
  - dirección de la web como ajuste en Llaves, como `portal_url`.
- `paneles/Alta.svelte` y `paneles/EditarLocal.svelte`: sección «Acceso por
  internet» con modalidad, clave (propuesta desde el nombre o la de autofactura),
  contraseña con Ver / Copiar / Generar otra, y enlace de la web.
- `paneles/Restaurantes.svelte`: distintivo Nube / Ambas. Los locales en nube
  aparecen en «Hoy» con su pulso.
- Hay que **recompilar el .exe** de Central (frontend embebido).

**Documentación**
- `docs/adr/ADR-29-motrest-en-la-web.md`: revisa la regla de ADR-28 («la nube guarda
  datos del restaurante solo cifrados»).
- `docs/ACCESO-WEB.md`: guía de alta.
- Actualizar el `docs/RELEVO-*-PARA-GEMINI.md` en cada hito.

## Orden de trabajo (una sola entrega, 1.6.0, por etapas con pruebas)

Rama `feature/motrest-web`, creada desde la rama actual (la 1.5.7 aún no está en
`main`). Commits **por lista de archivos**, nunca `git add -A`.

1. Dominio: bloque `web`, `acceso-web.ts`, clase `acceso_web`, y pruebas (incluida
   la compatibilidad de firma con licencias viejas).
2. Supabase: migración, políticas, Edge Functions y advisors.
3. Central: buzón, alta y edición, ver y cambiar contraseña, emitir con `web`.
4. POS: pantalla «Entra a tu restaurante», sesión web y «Salir».
5. Túnel: `tunel.ts`, `SocketTunel` y `TunelRemoto` en el Hub, origen remoto, fotos.
6. Modo nube: `SocketNube`, licencia, responsable y soporte en el navegador, pulso.
7. Impresoras del dispositivo: Web Serial, WebUSB, Web Bluetooth y navegador.
8. Cambio de contraseña desde el restaurante y recogida en Central.
9. Vercel: `vercel.json` y despliegue de vista previa. Gonzalo enlaza el proyecto
   en su cuenta, la misma que el portal de autofactura.
10. Versión 1.6.0: instalador, verificación sobre la app **instalada** y relevo.

## Verificación

- **Pruebas unitarias:**
  - envolver y desenvolver con una contraseña errónea;
  - licencia con y sin `web` contra el verificador actual;
  - `tunel.ts` con fragmentos desordenados, perdidos y de más de 1 MB;
  - el Hub con una `Conexion` remota, que **no** obtiene nada de `esLocal` y se
    puede revocar;
  - `SocketNube` contra un Supabase falso: dos dispositivos que se ven entre sí,
    dedup, paginación y datos cifrados en la fila.
- **Ensayo contra la nube real** (ampliar `apps/hub/ensayo/nube.ts`): túnel de ida
  y vuelta y la política que impide a la sucursal A entrar a `tunel:B`.
- **Extremo a extremo con Hub instalado + vista previa de Vercel** (modo ambas):
  - iPhone con datos móviles: entrar, «¿Quién eres?», tomar una orden; la caja la
    recibe y la comanda se imprime en la BIXOLON;
  - cambiar la contraseña en Central corta la sesión.
- **Restaurante de prueba en modo nube:**
  - PC con Chrome + iPad con Safari: órdenes que se ven en vivo, cobro y corte;
  - impresión por Web Serial (MP210 por Bluetooth) y AirPrint en el iPad;
  - en la tabla, `eventos_nube` solo tiene texto cifrado.
- **Seguridad:**
  - 10 intentos fallidos bloquean la entrada;
  - la clave de otro restaurante no revela si existe;
  - el propietario cambia la contraseña y Central la ve con «Ver».
- **Rodizio no cambia:** su licencia sin `web` sigue en modo «app».

## Lo que Gonzalo tiene que saber o hacer

- **iPad/iPhone por la web solo imprimen con AirPrint** (el diálogo del sistema).
  Safari no permite USB ni Bluetooth: es una limitación de Apple, no nuestra.
- **Costos antes de producción:**
  - **Supabase Pro** (~25 USD/mes, ya pendiente). En modo nube guarda ~0.4 GB por
    restaurante al año, y la Free pausa el proyecto.
  - **Vercel Pro** (20 USD/mes). El plan Hobby prohíbe el uso comercial.
- **Enlazar el proyecto en su cuenta de Vercel.** Es un paso manual suyo.
- **Primera entrada en un dispositivo nuevo:** descarga toda la historia del local.
  Con meses de uso tarda; la compactación (ADR-21) queda para después.
