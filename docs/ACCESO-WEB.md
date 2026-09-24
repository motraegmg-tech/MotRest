# Acceso web de MotRest (1.6.0): guía técnica paso a paso

Para MOTRAE. Es el orden exacto para poner en marcha el acceso por internet y darlo a
un restaurante, con los comandos y la forma de comprobar cada paso antes de pasar al
siguiente.

- Decisión y diseño: [ADR-29](adr/ADR-29-motrest-en-la-web.md).
- Estado del desarrollo: [RELEVO-1.6.0-MOTREST-WEB-PARA-GEMINI.md](RELEVO-1.6.0-MOTREST-WEB-PARA-GEMINI.md).

Datos que se usan en toda la guía:

| Dato | Valor |
|---|---|
| Proyecto de Supabase | `ixttslqbbwqfcqjmttyg` (`https://ixttslqbbwqfcqjmttyg.supabase.co`) |
| Repositorio | `motraegmg-tech/MotRest` |
| Rama con el código | `feature/motrest-web` (creada desde `feature/pulso-actualizacion-pendiente`, que lleva la 1.5.7) |
| Carpeta de la web | `apps/pos-ui` → se compila con `pnpm run build:web` a `apps/pos-ui/dist-web/` |
| pnpm | Siempre `corepack pnpm@9.15.0` en esta máquina |

---

## Paso 0 · Qué ya está hecho y no hay que repetir

La nube de Supabase **ya tiene** todo lo del acceso web:

- **Migraciones aplicadas:** `acceso_web`, `documentos_nube_con_rls`,
  `eventos_nube_en_orden` y `eventos_nube_solo_por_la_funcion`.
- **Edge Functions desplegadas:** `entrar-restaurante` (sin JWT) y
  `cambiar-contrasena-web` (con JWT).

Para confirmarlo, en Supabase → **SQL Editor**:

```sql
-- Las cuatro migraciones de la web tienen que salir listadas.
select version, name from supabase_migrations.schema_migrations
 where name in ('acceso_web','documentos_nube_con_rls','eventos_nube_en_orden','eventos_nube_solo_por_la_funcion')
 order by version;

-- Las tablas nuevas existen (ninguna columna debe salir null).
select to_regclass('public.accesos_web')     as accesos,
       to_regclass('public.eventos_nube')    as eventos,
       to_regclass('public.documentos_nube') as documentos,
       to_regclass('public.intentos_entrada') as intentos;
```

Y en Supabase → **Edge Functions** tienen que aparecer `entrar-restaurante` y
`cambiar-contrasena-web` como *Active*.

---

## Paso 1 · Subir la rama a GitHub

Vercel compila desde GitHub, y hoy la rama solo existe en esta computadora. Desde la
raíz del repositorio:

```powershell
git status                      # no debe haber nada de la web sin commit
git push -u origin feature/motrest-web
```

**Ojo con `git add -A`:** hay archivos con secretos que el `.gitignore` no cubre
(`LLAVES.docx`, `apps/relay/padron`). Esta rama ya está completa en commits; no hace
falta añadir nada más.

**Todavía no se fusiona con `main`.** Primero se prueba con un despliegue de vista
previa (paso 2); la fusión se hace junto con la publicación de la 1.6.0 (paso 4).

---

## Paso 2 · Publicar la web en Vercel

### 2.1 Crear el proyecto

1. En [vercel.com](https://vercel.com) → **Add New… → Project** → **Import Git
   Repository** → `motraegmg-tech/MotRest`. Usa la misma cuenta del portal de
   autofactura.
2. En la pantalla **Configure Project**:

   | Campo | Valor |
   |---|---|
   | Project Name | `motrest` (de ahí sale `https://motrest.vercel.app`) |
   | Framework Preset | **Other** |
   | Root Directory | `apps/pos-ui`: pulsa *Edit* y elige esa carpeta |
   | Build / Output / Install Command | **déjalos vacíos**: los fija `apps/pos-ui/vercel.json` |

   Lo que aplica `vercel.json` es:
   - Install: `cd ../.. && corepack enable && pnpm install --frozen-lockfile`
   - Build: `pnpm run build:web`
   - Output: `dist-web`

3. **Environment Variables**: añade una sola, en *Production* y en *Preview*:

   | Nombre | Valor | Para qué |
   |---|---|---|
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1` | Que Vercel use el pnpm 9.15.0 fijado en `packageManager` y no el suyo |

   No hacen falta `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLICABLE` ni
   `VITE_MOTREST_LICENCIA_PUBLICA`: los tres son públicos y ya van por defecto en
   `apps/pos-ui/vite.config.ts`. Solo se ponen si algún día cambia el proyecto de
   Supabase o la llave de licencias.
4. **Deploy.**

### 2.2 Ajustes del proyecto después de crearlo

En **Settings** del proyecto:

- **Build and Deployment**:
  - **Node.js Version → 24.x.** El repositorio exige Node ≥ 24.16 (`engines` en el
    `package.json` raíz).
  - **Root Directory → Include files outside the root directory in the Build Step:
    activado.** Viene activado; si se apaga, la compilación falla porque la web usa
    `packages/*` y lee la versión de `apps/hub/package.json`.
- **Git → Production Branch → `feature/motrest-web`** mientras se prueba la 1.6.0
  (decisión del 23-sep-2026).
  - `main` **no tiene la web**. Si producción compila `main`, sale el POS de la
    caja, que abre en «Bienvenido» y pide crear el responsable de un restaurante que
    no existe.
  - Al fusionar la 1.6.0 con `main` (paso 4.4), se devuelve esta opción a `main`.
  - Desde el commit `2c9f5da`, si Vercel intenta compilar sin la web, el despliegue
    **falla** con el mensaje «En Vercel la web se compila con `pnpm run build:web`…»,
    en vez de publicar la pantalla equivocada.
- **Deployment Protection**:
  - La **Vercel Authentication** protege las vistas previas: un restaurante no podrá
    abrirlas. Para probar con un teléfono sin sesión de Vercel, usa la dirección de
    producción, o apaga la protección mientras pruebas.
  - Nunca actives *Password Protection* en producción: los restaurantes no tendrían la
    clave.

**Plan:** Hobby prohíbe el uso comercial. Antes de dar la web a un restaurante que paga,
sube el equipo a **Pro** (20 USD/mes).

### 2.3 Comprobar el despliegue

1. **Build Logs** en Vercel: deben terminar en `✓ built in …` y `Deployment completed`.
   El aviso «Some chunks are larger than 500 kB» es normal y no es un error.
2. Abre la dirección en el navegador: tiene que aparecer **«Entra a tu restaurante»**,
   con el logo a la izquierda (o arriba, en un teléfono).
3. Revisa las cabeceras de seguridad desde PowerShell:

   ```powershell
   curl.exe -sI https://motrest.vercel.app/ | Select-String "x-robots-tag|content-security-policy|permissions-policy"
   ```

   Tienen que salir:
   - `x-robots-tag: noindex, nofollow`: los buscadores no la indexan.
   - La CSP, con `connect-src` apuntando solo a `ixttslqbbwqfcqjmttyg.supabase.co`.
   - `permissions-policy` con `serial=(self), usb=(self), bluetooth=(self)`: sin esto,
     las impresoras del dispositivo no funcionan.
4. **Dominio propio:** ver 2.4. Ojo: `motrest.com` no es de MOTRAE.

### 2.4 Dominio propio

> **`motrest.com` NO es de MOTRAE** (confirmado por Gonzalo el 23-sep-2026). Lo
> registró un tercero en IONOS el 6-abr-2026, con DNS y reenvío de correo en una cuenta
> de Cloudflare ajena. `app.motrest.com` no se puede usar: Vercel se queda en
> «Verification Required» para siempre, porque solo el dueño puede crear el TXT. Si lo
> diste de alta, quítalo en Vercel → Settings → Domains → `app.motrest.com` → Remove.
> Tampoco es de MOTRAE `motrae.com` (Hostinger, 21-ago-2026, aparcado), salvo que
> Gonzalo lo haya comprado.

Mientras no haya dominio propio, la web vive en la dirección `.vercel.app` del
proyecto, que funciona igual.

**Con un dominio que sí sea de MOTRAE** (por ejemplo `app.<dominio>`):

1. **Copia los registros de Vercel.** En Vercel → Settings → Domains → *Add*, escribe
   `app.<dominio>` y anota los registros que pide:
   - un **CNAME** `app` → `cname.vercel-dns.com`, o el destino propio que muestre;
   - si además marca «Verification Required», un **TXT** `_vercel` →
     `vc-domain-verify=…`.
2. **Créalos donde estén los DNS del dominio**, sea el registrador o Cloudflare.
   **En Cloudflare, el CNAME va con la nube GRIS (DNS only):** con el proxy naranja,
   Vercel no puede emitir el certificado.
3. **Espera y verifica.** Tras 1 o 2 minutos, pulsa *Refresh* en Vercel, hasta que
   diga «Valid Configuration».
4. **Añade la dirección nueva en los otros dos sitios:** `MOTREST_WEB_ORIGENES` de
   Supabase (3.1) y Central → Llaves (3.3).

---

## Paso 3 · Ajustes de la nube y de Central

### 3.1 Limitar quién puede llamar a la entrada (Supabase)

Hoy la función `entrar-restaurante` contesta a cualquier origen. Fíjala a la dirección
de la web:

- **Tablero:** Supabase → **Edge Functions → Secrets** → *Add new secret*
  - Name: `MOTREST_WEB_ORIGENES`
  - Value: `https://motrest.vercel.app` (varios, separados por coma:
    `https://app.<dominio>,https://<proyecto>.vercel.app`)
- **O por consola**, si tienes la CLI de Supabase con sesión iniciada:

  ```powershell
  supabase secrets set --project-ref ixttslqbbwqfcqjmttyg MOTREST_WEB_ORIGENES=https://motrest.vercel.app
  ```

Compruébalo. Tiene que contestar `Access-Control-Allow-Origin: https://motrest.vercel.app`:

```powershell
curl.exe -si -X OPTIONS https://ixttslqbbwqfcqjmttyg.supabase.co/functions/v1/entrar-restaurante `
  -H "Origin: https://motrest.vercel.app" -H "Access-Control-Request-Method: POST" | Select-String "access-control-allow-origin"
```

### 3.2 Lo que NO hay que tocar en Supabase

- **Realtime → Settings → «Allow public access»: déjalo ENCENDIDO.**
  - El túnel de la web usa un canal *privado* y ya está protegido por las políticas de
    `realtime.messages`.
  - El canal con el que cada Hub escucha licencias y secretos (`hub-<sucursal>`) es
    público. Si lo apagas, toda la flota deja de recibir renovaciones.
- **Authentication:** los usuarios web se crean desde Central con el correo ya
  confirmado (`web-<sucursal>@web.motrae.mx`). No hay que tocar *Sign up* ni *Confirm
  email*.
- **Plan:** con restaurantes en modalidad nube conviene **Pro**.
  - Free pausa el proyecto por inactividad, y ese día nadie entra.
  - Free solo tiene 500 MB; un restaurante en nube guarda unos 0.4 GB al año.

### 3.3 Dirección de la web en Central

Abre **MotRest Central → Llaves → «MotRest en la web»**, pega `https://motrest.vercel.app`
y pulsa **Guardar**. Esa dirección es la que aparece en la ficha de cada restaurante
para dársela al cliente.

> Esta sección solo existe en la Central compilada con la 1.6.0 (paso 4.2). Si no la
> ves, tu Central es la anterior.

---

## Paso 4 · Versión 1.6.0: Central, Hub e instalador

Los restaurantes en **nube** solo necesitan la web y la Central nueva. Los de
**ambas** necesitan además el **Hub 1.6.0** instalado en su computadora: un Hub anterior
verifica la licencia pero no abre el túnel.

### 4.1 Subir la versión

En `apps/hub/package.json`, cambia `"version": "1.5.7"` por `"version": "1.6.0"`. Esa
versión es la que muestra el POS, la que reporta el Hub y la que lleva el instalador.
Haz commit en la rama y súbelo:

```powershell
git add apps/hub/package.json
git commit -m "chore: versión 1.6.0 (MotRest en la web)"
git push
```

### 4.2 Recompilar MotRest Central

El frontend de Central va **dentro** del `.exe`, así que no basta con copiar archivos.
Cierra Central y ejecuta:

```powershell
corepack pnpm@9.15.0 --filter @motrest/central build
cd apps/central-escritorio
$env:CARGO_TARGET_DIR = "C:/mc-build"     # OBLIGATORIO: con la ruta larga falla con LNK1104
corepack pnpm@9.15.0 exec tauri build --no-bundle
```

Tarda unos 3 minutos. Copia `C:\mc-build\release\motrae-central.exe` sobre el `.exe` de
tu instalación de Central, con el mismo nombre y la misma ruta. La cartera y las llaves
no se pierden: viven en `%LOCALAPPDATA%\mx.motrae.central`.

**Comprueba:** al abrir Central, en **Llaves** aparece «MotRest en la web», y en
**Restaurantes → Editar datos** aparece el bloque «Acceso por internet».

### 4.3 Instalador y publicación del Hub 1.6.0

Sigue [PUBLICAR-UNA-ACTUALIZACION.md](PUBLICAR-UNA-ACTUALIZACION.md). En resumen:

```powershell
$env:MOTREST_LICENCIA_PUBLICA       = "<Central → Llaves → pública de licencias>"
$env:MOTREST_ACTUALIZACIONES_PUBLICA = "<Central → Llaves → pública de publicación>"
$env:MOTREST_ACTUALIZACIONES_REPO    = "motraegmg-tech/MotRest"
corepack pnpm@9.15.0 --filter @motrest/escritorio build
```

Después se sigue la lista de comprobación, se firma el manifiesto en Central, se sube
el release y se despliega por anillos, como con cualquier versión.

**Recomendación:** instala primero la 1.6.0 **a mano** en una computadora de prueba y
haz ahí el paso 6 antes de abrir el anillo a los restaurantes. La regla del proyecto es
no dar nada por bueno hasta verlo en la app instalada.

### 4.4 Fusionar con main

Cuando la 1.6.0 esté probada:

1. Abre el pull request de `feature/motrest-web` hacia `main` y fusiónalo.
2. En Vercel → Settings → Git, devuelve **Production Branch** a `main`.

---

## Paso 5 · Dar acceso web a un restaurante

### 5.1 Restaurante nuevo en modalidad **nube** (sin computadora)

1. **Central → Restaurantes → + Alta.** Llena los datos como siempre, y en «Cómo va a
   trabajar» elige **Nube**.
   - La clave es opcional: si la dejas vacía, se propone a partir del nombre.
   - Guarda el **PIN del responsable** que aparece al terminar: con él entra el dueño
     al «¿Quién eres?».
2. Abre la ficha → **Editar datos → Acceso por internet**. Revisa que diga *Nube*, anota
   la **clave** y pulsa **Ver** para leer la contraseña.
3. **Emite la licencia.** Es obligatorio, y por dos motivos:
   - la modalidad viaja firmada dentro de la licencia;
   - la web lee la licencia de la nube (`licencias_pendientes`) para saber que el
     restaurante está al corriente y para crear al responsable.
4. Envía al cliente estos tres datos:
   - dirección: `https://motrest.vercel.app`;
   - clave: `RODIZIO` (la suya);
   - contraseña: la de **Ver**.

   Con **Copiar**, la contraseña no queda a la vista en la pantalla.

**La modalidad nube solo se puede elegir antes de emitir la primera licencia.** Después,
pasar de nube a computadora (o al revés) es una mudanza de datos que todavía no existe,
y Central lo impide.

### 5.2 Restaurante que ya tiene computadora: modalidad **ambas**

Requisitos:

- La computadora del restaurante tiene el **Hub 1.6.0**.
- El restaurante ya se ve en «Hoy» con pulso reciente. De ese pulso sale la llave
  pública del Hub, que hace falta para mandarle la llave del túnel.

Pasos:

1. En **Restaurantes**, abre la ficha del local y pulsa **Encender Local en la Nube**.
   Solo aparece si el local está activo, tiene licencia y está en modalidad «app».
   - Escribe la **clave** (o pulsa «Sugerir») y la **contraseña** dos veces (o pulsa
     «Generar una»). Luego pulsa **Encender en la nube**.
   - Central, en un solo paso:
     - crea el usuario web y deja la envoltura en `accesos_web`;
     - manda la **llave del túnel** al buzón del Hub;
     - **vuelve a emitir la licencia con el mismo vencimiento y bloqueo** que ya
       tenía, ahora con el bloque `web` en «ambas». La licencia llega sola a la caja.
   - Al terminar enseña la dirección, la clave y la contraseña, y el botón **Copiar
     mensaje para el cliente**.
   - Avisos posibles:
     - la caja nunca dio pulso;
     - la caja tiene una versión anterior a la 1.6.0;
     - la licencia hubo que pegarla a mano;
     - la llave del túnel no llegó. En este caso, en **Editar datos → Acceso por
       internet**, pulsa **Reenviar la llave del túnel al Hub** cuando el local tenga
       pulso.
   - Se niega si la licencia está vencida: primero hay que renovarla.
   - Después, el botón pasa a decir **Nube encendida** y abre la ficha, donde se ve y
     se cambia la contraseña.
   - Otra forma de hacerlo: **Editar datos → Acceso por internet → Ambas → Aplicar** y
     después **emitir la licencia** a mano.
2. **Los datos no se copian a ninguna parte.** La web lee y escribe en el Hub de la caja
   a través del túnel, así que lo que ve es la caja **en vivo** y lo que hace en la web
   lo recibe la caja. La otra cara es que, si la computadora está apagada o sin
   internet, la web dice que el restaurante no está conectado.
3. **Comprueba en la computadora del restaurante:** abre el registro del día,
   `%LOCALAPPDATA%\MotRest\datos\registro\hub-AAAA-MM-DD.log`. Deben aparecer estas
   dos líneas:
   - `INFO  Llegó de MOTRAE la llave del túnel de la web.`
   - `INFO  Túnel de la web abierto: este restaurante se puede usar desde internet.`

   Si en su lugar dice «falta la llave del túnel», reenvíala desde Central.
4. Envía al cliente la dirección, su clave y su contraseña, igual que en el 5.1.

### 5.3 Quitar el acceso web

Ve a **Editar datos → Acceso por internet → App → Apagar acceso por internet**.

- En la nube, la fila de `accesos_web` queda `activo = false`, el usuario web queda
  suspendido y se cierran sus sesiones.
- El Hub cierra el túnel en el acto.
- Emite la licencia para que la modalidad firmada vuelva a «app».

---

## Paso 6 · Prueba de aceptación, antes de darlo a un cliente

Haz las dos pruebas con restaurantes **de prueba**, no con Rodizio.

### 6.1 Modalidad nube

1. Crea «Prueba Nube» como en el 5.1 y emite su licencia.
2. **En una PC con Chrome:** abre la web → clave y contraseña → **Entrar**.
   - La página se recarga y aparece «¿Quién eres?» con el responsable.
   - Entra con el PIN del alta.
3. Toma una orden en una mesa.
4. **En un iPhone con Safari y datos móviles**, entra con la misma clave.
   - La mesa del paso 3 aparece ocupada en uno o dos segundos.
   - Toma otra orden desde el iPhone: la PC la ve.
5. **Comprueba que la nube guarda los datos cifrados** (SQL Editor):

   ```sql
   select a.clave, e.seq, e.device_id, left(e.sobre, 60) as sobre
     from eventos_nube e join accesos_web a using (sucursal_id)
    where a.clave = 'PRUEBANUBE'            -- la clave de prueba
    order by e.seq desc limit 5;
   ```

   `sobre` tiene que empezar con `{"ec":1,"n":"…","c":"…` y no contener ni una palabra
   legible: ni nombres de platillos ni importes.
6. **Impresión en la PC:** Administración → Impresoras → «Impresoras de este
   dispositivo» → *Impresora USB* (o *Puerto serie o Bluetooth emparejado* para la
   MP210) → elige el aparato → **Página de prueba**.
   - Si al elegir USB sale «Windows tiene tomada la impresora con su driver», usa
     *Puerto serie* o desinstala el driver de esa impresora.
7. **Impresión en el iPhone:** *Impresora del sistema (AirPrint)* → Página de prueba →
   se abre el cuadro de imprimir de iOS.
8. **Cierra la caja** en la PC. En Central, «Hoy» muestra a «Prueba Nube» con las
   ventas del corte (versión `1.6.0`, plataforma `web`).

### 6.2 Modalidad ambas

1. Usa una computadora de prueba con el Hub 1.6.0 instalado y dado de alta en Central.
   Ponla en **Ambas** y emite su licencia.
2. Confirma en el registro del Hub que el túnel quedó abierto (5.2, punto 3).
3. **Desde un teléfono con datos móviles**, fuera del wifi del local: entra con la clave.
   - Tienen que aparecer el personal y las mesas de esa computadora.
   - Toma una orden: sale en la pantalla de la caja, y la comanda sale en su impresora.
4. **En la caja**, Administración → Hub del local: el teléfono aparece en la lista de
   terminales con el nombre **«Web»**. Revócalo; el teléfono queda fuera aunque tenga
   la contraseña.
5. **Apaga la computadora** y recarga la página en el teléfono. Debe decir «Tu
   restaurante no está conectado ahora mismo…».

### 6.3 Contraseña y seguridad

1. **En Central, «Generar otra».** En el teléfono que estaba dentro, la sesión se
   cierra en menos de una hora (al renovarse el pase). En ambas, en el acto. Con la
   contraseña nueva entra; con la vieja, no.
2. **El propietario la cambia desde la web:** Administración → «Acceso por internet» →
   actual + nueva ×2.
   - La página vuelve a entrar sola con la nueva.
   - En Central, después de **Actualizar estado** en Restaurantes, **Ver** enseña la
     nueva con la nota «La cambió el propietario el …».
3. **Freno:** entra 10 veces seguidas con una contraseña mala. La undécima dice
   «Demasiados intentos… espera una hora», aunque la contraseña sea la buena.
   - Para desbloquear sin esperar:

     ```sql
     delete from intentos_entrada where llave = 'clave:PRUEBANUBE';
     ```

---

## Operación diaria: consultas útiles (SQL Editor)

```sql
-- Qué restaurantes tienen acceso web y cómo.
select clave, sucursal_id, modalidad, activo, version,
       cambiada_por_restaurante_ts, actualizado_ts
  from accesos_web order by clave;

-- Quién está siendo frenado por intentos fallidos (última hora).
select llave, fallos, ultimo_ts from intentos_entrada
 where ultimo_ts > now() - interval '1 hour' order by fallos desc;

-- Cuánto ocupa cada restaurante en nube.
select a.clave, count(*) as eventos,
       pg_size_pretty(sum(length(e.sobre))::bigint) as tamano
  from eventos_nube e join accesos_web a using (sucursal_id)
 group by a.clave order by count(*) desc;

-- Último pulso de los locales web.
select p.sucursal_id, p.version, p.plataforma, p.ts, p.ventas_dia, p.cuentas_dia
  from pulsos p join accesos_web a using (sucursal_id) order by p.ts desc;
```

**No borres filas de `eventos_nube`.** Es el libro de ventas del restaurante, y los
dispositivos cuentan con que solo crece.

---

## Si algo falla

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El build de Vercel falla en *Install* con un error de pnpm | Vercel usa su pnpm y no el 9.15.0 | Añade `ENABLE_EXPERIMENTAL_COREPACK=1` (2.1) y vuelve a desplegar |
| El build falla con «Cannot find module» de `@motrest/...` o de `apps/hub/package.json` | No se incluyen los archivos de fuera de `apps/pos-ui` | Activa *Include files outside the root directory* (2.2) |
| Sale «Bienvenido» y pide crear la cuenta del responsable, sin haber pedido clave del restaurante | Vercel publicó una rama sin la web (`main`) o compiló con `vite build` a secas | Production Branch → `feature/motrest-web` (2.2), sin Build Command sobrescrito, y **Redeploy** |
| El despliegue falla con «En Vercel la web se compila con `pnpm run build:web`» | El Root Directory no es `apps/pos-ui`, o hay un Build Command sobrescrito en el tablero | Corrígelo en Settings → Build and Deployment y vuelve a desplegar |
| Vercel marca «Verification Required» en un dominio propio | Falta el TXT `_vercel`, o el dominio es de otra persona (caso de `motrest.com`) | Paso 2.4 |
| El dominio propio abre pero la entrada dice «No hay conexión con la nube» | `MOTREST_WEB_ORIGENES` no incluye el dominio nuevo (CORS) | Añádelo en Supabase (3.1) |
| La web pide iniciar sesión en Vercel | Deployment Protection en una vista previa | Usa la dirección de producción o apaga la protección (2.2) |
| «Clave o contraseña incorrecta» con los datos buenos | Acceso apagado (modalidad «app») o contraseña cambiada por el propietario | Mira `accesos_web.activo` y usa **Ver** en Central |
| «Demasiados intentos» | 10 fallos en una hora con esa clave, o 30 desde esa red | Espera, o borra la fila en `intentos_entrada` |
| «…quedó a medio actualizar. Llama a MOTRAE» | La contraseña cambió en Auth pero no su envoltura | Central → **Generar otra**: reescribe las dos cosas a la vez |
| «Tu restaurante no está conectado ahora mismo» (ambas) | Computadora apagada o sin internet, Hub anterior a la 1.6.0, o falta la llave del túnel | Revisa «Hoy» y el registro del Hub (5.2) |
| En «ambas», el Hub registra «falta la llave del túnel» | El sobre no se pudo entregar | Central → **Reenviar la llave del túnel al Hub** |
| En «nube», el restaurante queda bloqueado nada más entrar | No se emitió la licencia, o está vencida | Emite la licencia en Central (5.1, punto 3) |
| El local en nube sale en «Hoy» sin señal | Nadie ha entrado todavía por la web | El pulso llega al entrar y al cerrar la caja |
| La impresora USB no imprime desde Chrome en Windows | El driver de Windows tiene tomada la impresora | Usa *Puerto serie* o quita el driver de esa impresora |
| En iPad no aparecen USB ni Bluetooth | Safari no los tiene | Solo AirPrint; para tickets con cajón hace falta una PC o un Android con Chrome |
