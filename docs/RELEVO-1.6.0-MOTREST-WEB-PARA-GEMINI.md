# Relevo 1.6.0 — MotRest en la web (para Gemini)

> Documento vivo. Se actualiza en cada hito, por si el trabajo pasa a otra IA sin aviso.
> Plan completo y decisiones: [`PLAN-MOTREST-WEB.md`](PLAN-MOTREST-WEB.md).
> Rama: `feature/motrest-web`, creada desde `feature/pulso-actualizacion-pendiente`
> (la 1.5.7 todavía no está en `main`).

## Qué se está construyendo

Sin cuenta de Apple no hay app para iPad ni iPhone. Gonzalo decidió publicar el mismo
POS en la web (Vercel + Supabase), con un candado previo **por restaurante**: la
pantalla «Entra a tu restaurante», con clave y contraseña. Después viene el
«¿Quién eres?» + PIN de siempre.

Cada local tiene una **modalidad**, que se elige en Central y viaja firmada en la licencia:

| Modalidad | Dónde viven los datos | Cómo entra la web |
|---|---|---|
| `app` | Hub (SQLite de la caja) | No entra. Es lo de siempre y lo que tiene toda licencia vieja. |
| `ambas` | Hub | Túnel cifrado por un canal broadcast **privado** de Realtime, `tunel:<sucursal>` |
| `nube` | Supabase, **cifrados** (`eventos_nube`, `documentos_nube`) | El navegador hace de «Hub» contra esas tablas |

## Las reglas que no se deben romper

1. **La clave de la LAN nunca sale a la web.** La web usa una `clave_remota` distinta
   (32 bytes, base64url), que genera Central. En la nube se guarda **envuelta** con la
   contraseña: un cofre PBKDF2-600k + AES-GCM (`envolverClaveRemota`).
2. **El usuario web de Supabase lleva `app_metadata.sucursal_web`, nunca `sucursal_id`.**
   Con `sucursal_id` heredaría todas las políticas del Hub.
   - Su función es `privado.sucursal_web_actual()`.
   - La modalidad se comprueba con `privado.web_en_modalidad('ambas'|'nube')`.
3. **Una conexión del túnel entra al Hub como `"remoto"`, nunca como `esLocal`.**
   `esLocal` aprueba en automático y abre las rutas exclusivas de la caja.
4. **La contraseña web se guarda en Central (DPAPI)** para que Gonzalo la vea.
   - Si la cambia el propietario, llega a Central sellada con la pública X25519 del
     buzón de Central, que viaja firmada en `licencia.web.buzon_central`.
5. En `nube`, **Supabase no puede leer nada del negocio.** En claro solo quedan
   `sucursal_id`, `seq`, `id`, `device_id` y `ts`.

## Hecho

| Etapa | Commit | Qué |
|---|---|---|
| 1 · Dominio | `62d1a86` | `acceso-web.ts` (modalidad, clave, contraseña, clave remota envuelta), bloque `web` en `Licencia`, `SecretoAccesoWeb` (aparte de FacturAPI y Gmail), `derivarLlaveDatosNube`, `protocolo-sync/src/tunel.ts` (fragmenta a 60 KB, ordena, late, cierra ante un hueco) |
| 2 · Supabase | `4c33e1c` | Migraciones `20260923191018_acceso_web` y `…191035_documentos_nube_con_rls`, **ya aplicadas** en `ixttslqbbwqfcqjmttyg`. Edge Functions `entrar-restaurante` (sin JWT, frena por clave y por red, respuesta única) y `cambiar-contrasena-web`, **ya desplegadas**. Se renombraron 4 migraciones viejas a la versión que registró la base. |
| 4+6 · POS web | `b8186c3` | `EntradaRestaurante.svelte`, `lib/web/acceso-web.svelte.ts` (entrar → desenvolver clave remota → `setSession` → **recargar**), `SocketTunel`, `lib/web/nube/` (`ServidorNube` = el protocolo del Hub en el navegador, `AlmacenSupabase`, `SocketNube`), «Salir de <restaurante>» en el menú del avatar, `sesion.usarFuenteDeLicencia`, `sync.usarDestinoWeb`. `vite build --mode web` → `dist-web/` (valores públicos por defecto en `vite.config.ts`). `apps/pos-ui/vercel.json`. Migraciones `…192600` y `…192611`: los eventos en nube SOLO entran por `empujar_eventos_nube` (SECURITY DEFINER) con `pg_advisory_xact_lock` por restaurante, para que `seq` no tenga huecos visibles |
| 5 · Hub | `4e25f8e` | `tunel-remoto.ts`, `servidor.conectar(c, esLocal, remoto)` (web aprobada sola la 1.ª vez, nombre «Web», revocable), `secretos` desvía `acceso_web`, `GestorLicencia.abreTunelWeb`, `EnlaceSupabase.abrirCanalTunel`, `montarTunelWeb()` en main (al conectar, al instalar licencia, al llegar la llave) |
| 3 · Central | `16e5797` | `configurarAccesoWeb`, `regenerarContrasenaWeb`, `fijarContrasenaWeb`, `verContrasenaWeb`, `enviarAccesoWebAlHub`, `recogerContrasenasDelRestaurante`; panel `AccesoWeb.svelte` en la ficha, modalidad en el Alta, distintivo Nube/Web, dirección de la web en Llaves |

## Falta (en este orden) — actualizado tras `4e25f8e`

4. ~~POS: «Entra a tu restaurante»~~ HECHO.
   - `esWeb()` a partir de `VITE_MOTREST_WEB`.
   - `EntradaRestaurante.svelte`, con el diseño de `Acceso.svelte`.
   - Sesión con supabase-js a partir de lo que devuelve `entrar-restaurante`.
   - «Salir de este restaurante» borra el IndexedDB.
5. ~~Túnel~~ HECHO, salvo:
   - `SocketTunel implements SocketLike` en el POS.
   - `TunelRemoto` en `apps/hub/src/enlace-supabase.ts`: canal privado,
     `hub.conectar(conexion, "remoto")`, etiqueta «Web», como mucho 10 sesiones.
   - El Hub escucha `accesos_web` (versión y activo) para cortar sesiones.
   - Clase `acceso_web` en `secretos.ts` del Hub (desviar antes de `esSecreto`).
   - **PENDIENTE:** mensaje `foto` en el protocolo (hoy la web en «ambas» no ve fotos de producto: se piden al Hub por `fetch` del mismo origen).
6. ~~Modo nube~~ HECHO, salvo:
   - `SocketNube` en `apps/pos-ui/src/lib/web/nube/`.
   - Responde `hola`/`push`/`pull`/`catalogo`/`credenciales` contra
     `empujar_eventos_nube`, `eventos_nube`, `publicar_documento_nube` y
     `documentos_nube`.
   - Licencia leída de `licencias_pendientes` y verificada en el navegador.
   - **PENDIENTE:** pulso al cerrar caja (política ya existe en la base).
   - **PENDIENTE:** fotos en el bucket `fotos_nube`.
7. **Impresoras del dispositivo:** Web Serial, WebUSB, Web Bluetooth y `window.print`
   (AirPrint en iOS).
8. **Cambio de contraseña desde el restaurante** (Admin → «Acceso por internet»,
   solo el propietario).
9. **Vercel:** `apps/pos-ui/vercel.json`. Gonzalo enlaza el proyecto en su cuenta.
10. **1.6.0:** instalador, verificación sobre la app **instalada**, y este relevo.

## Trampas encontradas

- **Las migraciones se renombran al aplicarlas.** `apply_migration` pone su propia
  marca de tiempo; hay que renombrar el archivo del repo para que coincidan.
- **`Modalidad` ya existía** en `ventas/kiosco.ts`. La del acceso web se llama
  `ModalidadLocal`.
- **La pública de licencias** para la web está en `apps/pos-ui/vite.config.ts`. Es la primera literal `MCowBQYDK2VwAyEA…` de `apps/hub/dist-sea/hub.cjs`; la segunda verifica `docs/motrest.json` y por eso es la de actualizaciones. Sin ella, un restaurante en nube saldría con la licencia «sin verificar» y BLOQUEADO.
- **Error ya corregido que no debe repetirse:** la migración `…192600` le quitó a `authenticated` el INSERT sobre `eventos_nube` mientras la función seguía siendo SECURITY INVOKER. Estuvo roto 11 s antes de `…192611`, sin clientes. Quien toque ese GRANT tiene que mirar la función.
- **`cat > archivo` sin heredoc cuelga el Bash** (espera la entrada estándar). Pon `< /dev/null` en vitest y compañía.
- **Los `.svelte` de Central tienen CRLF.** Un `replace` de varias líneas con `\n`
  no encuentra nada: usa el editor o normaliza los finales de línea antes.
- **En esta máquina no hay Python.** Para ediciones con script, usa `node -e`.
- **pnpm solo funciona como `corepack pnpm@9.15.0`.**
- **Prueba de humo de la entrada:**
  `curl -X POST https://ixttslqbbwqfcqjmttyg.supabase.co/functions/v1/entrar-restaurante -H "apikey: <publicable>" -d '{"clave":"X","contrasena":"y"}'`
  debe responder `{"error":"Clave o contraseña incorrecta"}`.
  - Luego borra los contadores que deja: tabla `intentos_entrada`.
