# Publicar el relay de MotRest

Guía operativa del paso A.4 de [WHATSAPP-ALTA-DE-RESTAURANTE.md](WHATSAPP-ALTA-DE-RESTAURANTE.md).
Se hace **una vez**. Después, dar de alta un restaurante son dos minutos.

> **El relay sirve aunque WhatsApp todavía no esté aprobado por Meta.** Su otro
> trabajo es recibir el **pulso** de cada local: qué versión de MotRest corre y
> cuándo dio señales por última vez. Eso es lo que hace que MOTRAE deje de
> publicar actualizaciones a ciegas (ADR-26), y no depende de Meta para nada.
> Si la revisión de Meta va lenta, este despliegue no espera.

**Qué es lo que se publica.** Un proceso de Node y un archivo cifrado. Ni
comandas, ni ventas, ni clientes: eso vive en el restaurante y ahí se queda
(ADR-23). Lo que hay en el servidor es el padrón —quién es cliente y con qué
credenciales manda WhatsApp— y por eso el resto de esta guía trata ese archivo
como lo que es: lo más valioso que MOTRAE tiene en internet.

---

## Los comandos son de PowerShell

Están escritos para la terminal de Windows que ya usas. Dos avisos que ahorran
media hora de confusión:

- **Usa `curl.exe`, con la extensión.** En PowerShell, `curl` a secas es un
  alias de `Invoke-WebRequest`, que no entiende `-H` ni devuelve el cuerpo igual.
  Escribiendo `curl.exe` se usa el de verdad, que viene con Windows.
- **Nada de `\` para partir líneas.** Eso es de bash. Aquí cada comando va en una
  línea, aunque quede larga.

## El mapa, y cuánto tarda cada cosa

| Paso | Trabajo tuyo | Espera de terceros |
|---|---|---|
| 0 · Preparar la máquina | 10 min | — |
| 1 · El dominio | 20 min | **de 15 min a 24 h** (nameservers) |
| 2 · App y volumen | 5 min | — |
| 3 · Los secretos | 10 min | — |
| 4 · Desplegar | 5 min | 5–10 min el primer build |

**Empieza por el paso 1 aunque no vayas a seguir hoy**: la delegación del DNS es
lo único que no depende de ti. Los pasos 2 a 4 se pueden hacer mientras tanto
contra la dirección provisional que regala Fly, y el dominio se enchufa al final
sin volver a desplegar.

---

## 0 · Preparar tu máquina

### 0.1 · Instalar flyctl

En PowerShell:

```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

**Cierra la terminal y abre una nueva.** El instalador añade `~\.fly` al PATH y
la ventana abierta sigue con el PATH viejo — si no, el siguiente comando dirá
que `fly` no existe y parecerá que la instalación falló.

```powershell
fly version
```

### 0.2 · La cuenta y la tarjeta

```powershell
fly auth signup    # o `fly auth login` si ya tienes cuenta
```

Se abre el navegador. Al terminar:

```powershell
fly auth whoami
```

Tiene que responder con el correo de MOTRAE.

> **La tarjeta hace falta antes del paso 2.** Fly no deja crear volúmenes en
> cuentas sin método de pago; el error que da no lo dice claro. Se añade en
> `fly.io/dashboard` → **Billing**. El gasto real es de unos 3.50 USD al mes (el
> desglose está al final). Al guardarla suele hacer un cargo de verificación
> pequeño que se revierte solo.

> **La pantalla de bienvenida de Fly no sirve para esto.** Al entrar te ofrece
> *Launch from GitHub* y *Launch from your machine*: las dos son el asistente
> `fly launch`, que detecta el proyecto a su manera, **reescribe el `fly.toml`**
> y **no crea el volumen** — el relay arrancaría sin disco y el padrón se
> borraría en cada despliegue.
>
> De esa pantalla solo se usa **Add a credit card**. Lo demás se hace con los
> comandos de los pasos 2 a 4, que respetan el `fly.toml` del repositorio.

---

## 1 · El dominio

El relay necesita un nombre propio porque va a estar escrito en dos sitios que
duelen de cambiar: el panel de Meta y la configuración de **cada Hub instalado**.
Mudarlo después obliga a tocar restaurante por restaurante.

### 1.1 · Qué registrar

El dominio de MOTRAE, y el relay como subdominio:

```
relay.motrae.mx        ← el relay
```

Si MOTRAE ya tiene dominio, aquí no se registra nada: pasa directo a 1.3.

| | A favor | En contra |
|---|---|---|
| **`.mx`** | Es una empresa mexicana y sus clientes son de aquí | Más caro (del orden de 600–900 MXN al año) |
| **`.com`** | Barato (200–400 MXN al año) y se registra en cualquier parte | Menos "de aquí" para la marca |

Al relay lo teclean Meta y los Hubs, no los comensales, así que para **esta**
decisión da igual. Elígelo por la marca de MOTRAE, no por el relay: el mismo
dominio va a llevar después el correo de la empresa y su sitio.

> Los precios son de referencia, no una cotización. Mira el de **renovación**,
> que suele ser mayor que el de alta.

Para ver si un dominio está tomado antes de ir al registrador:

```powershell
Resolve-DnsName -Name motrae.mx -Type NS -Server 8.8.8.8
```

Si no responde nada, casi seguro está libre. Si contesta nameservers, es de
alguien. **No es prueba definitiva** —un dominio puede estar registrado y sin
delegar—: lo único que lo confirma es el buscador del registrador.

### 1.2 · Dónde registrarlo

`.mx` no lo vende cualquiera: **Akky**, **Neubox** o **GoDaddy México** sí. Para
`.com` sirve cualquiera.

Al registrarlo:

- **El correo de contacto tiene que ser uno que leas siempre.** Ahí llegan los
  avisos de renovación, y un dominio vencido apaga el relay de toda la cartera.
- **Activa la renovación automática** en el momento del alta.
- **Activa la privacidad de WHOIS** si el registrador la ofrece gratis: evita
  que el domicilio quede en un directorio público.

### 1.3 · Delegar el DNS a Cloudflare

Esto es lo que de verdad importa del paso 1. Los paneles de DNS de los
registradores mexicanos son lentos e incómodos, y vas a estar ahí justo el día
que algo falle.

1. Crea cuenta en `dash.cloudflare.com`.
2. **Add a site** → escribe `motrae.mx` → plan **Free**.
3. Cloudflare escanea y te da **dos nameservers**, del estilo
   `dana.ns.cloudflare.com` y `rick.ns.cloudflare.com`. Cópialos.
4. En el panel del registrador, busca *DNS* o *Servidores de nombres* y cambia a
   **DNS personalizado / Custom nameservers**. Pega los dos de Cloudflare y
   borra los que traía.

Y ahora se espera. Comprueba cada tanto:

```powershell
nslookup -type=NS motrae.mx 8.8.8.8
```

Cuando responda los de Cloudflare, ya está. En Cloudflare el sitio pasa a
**Active** y te llega un correo. Suele tardar menos de una hora, aunque el
registrador prometa 24–48.

**Todavía no crees ningún registro para el relay.** El valor al que apunta sale
en el paso 4.5, cuando la app ya exista.

---

## 2 · Crear la aplicación y el volumen

### 2.1 · La app

```powershell
fly apps create motrest-relay
```

> **El nombre es global en todo Fly.io**, no solo en tu cuenta. Si responde que
> ya está tomado, elige otro —`motrae-relay`, `motrest-relay-mx`— y **cambia la
> primera línea de [apps/relay/fly.toml](../apps/relay/fly.toml)** para que diga
> el mismo. Si el `app =` del archivo y la app de Fly no coinciden, el despliegue
> del paso 4 se va a otra parte o falla.

Comprobar:

```powershell
fly apps list
```

### 2.2 · El volumen

Es el único disco que sobrevive a un despliegue. Ahí van el padrón y los pulsos:

```powershell
fly volumes create datos_relay --app motrest-relay --region dfw --size 1
```

> **La región tiene que ser una de las que Fly tiene hoy**, y **no hay ninguna
> en México**: `qro` y Guadalajara no existen, y el error que da es un escueto
> `region qro not found`. Compruébalo tú mismo con `fly platform regions`. De la
> lista, la más cercana a México es **Dallas (`dfw`)**; la alternativa sería
> `lax`. Si cambias de región, cámbiala también en el `primary_region` del
> `fly.toml`.

Avisa de que un volumen único no tiene redundancia y pide confirmación: responde
que sí. Es justo lo que queremos —una sola máquina, un solo padrón (ADR-27)— y
la copia de seguridad la lleva MOTRAE aparte (paso 8).

> **El nombre `datos_relay` no es decorativo.** Tiene que ser idéntico al
> `source` de la sección `[[mounts]]` del `fly.toml`. Si no coinciden, la
> máquina arranca sin disco y el padrón se borra en cada despliegue, en silencio.

Comprobar:

```powershell
fly volumes list --app motrest-relay
```

Tiene que salir `datos_relay`, región `dfw`, 1 GB.

- **1 GB sobra**: el padrón de cincuenta restaurantes no llega a un megabyte.
  Crecer se puede después; encoger, no.
- **Región `dfw` (Dallas)**: lo más cerca de México que llega Fly. El enlace con
  cada Hub es un WebSocket abierto todo el día, así que cada salto de más son
  milisegundos en cada aviso de "su mesa está lista" y un tramo más que se puede
  cortar.
- **El volumen y el `fly.toml` tienen que decir la misma región.** Si no, Fly
  intentaría levantar la máquina donde no está el disco.

---

## 3 · Los secretos

Cuatro. Los tres primeros son obligatorios: **sin ellos el relay se niega a
arrancar**, y eso es deliberado — un relay sin `APP_SECRET` aceptaría cualquier
webhook, y eso es peor que no tener relay.

### 3.1 · Generarlos

En la **raíz del repositorio**, la llave con la que se cifra el padrón:

```powershell
corepack pnpm@9.15.0 --filter @motrest/relay padron llave
```

> **La llave es la ÚLTIMA línea de la salida.** pnpm imprime antes dos líneas
> con el nombre del paquete y el comando que ejecuta. Lo que sirve es la línea
> final, la que parece ruido y termina en `=`.

El token de verificación de Meta y la clave de administración, que te los
inventas tú:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Córrelo **dos veces**: uno para `MOTREST_META_VERIFY_TOKEN` y otro para
`MOTREST_RELAY_CLAVE_ADMIN`. No reutilices el mismo valor: el primero lo vas a
teclear en un panel de Meta y el segundo abre la cartera de clientes de MOTRAE.

### 3.2 · ⚠ Guardar la llave del padrón ANTES de seguir

Sin ella, el archivo con los tokens de WhatsApp de todos los restaurantes **no
se puede leer**, y hay que volver a conectar el número de cada local uno por
uno. Fly la guarda cifrada y **no te la vuelve a enseñar nunca**.

Guárdala donde ya están las llaves de firma de MOTRAE, con el mismo cuidado.
Esto no es higiene: es la diferencia entre restaurar un respaldo y llamar a
cincuenta restaurantes.

### 3.3 · Ponerlos en Fly

**Primero muévete a `apps/relay`.** Ahí está el `fly.toml`, y flyctl saca de él
el nombre de la app: los comandos quedan cortos y sin `--app`.

```powershell
cd apps\relay
```

Y ahora uno por uno, **pegando y ejecutando de línea en línea**:

```powershell
fly secrets set MOTREST_RELAY_LLAVE_PADRON='la-llave-del-padron'
fly secrets set MOTREST_META_VERIFY_TOKEN='el-primero-que-generaste'
fly secrets set MOTREST_RELAY_CLAVE_ADMIN='el-segundo-que-generaste'
fly secrets set MOTREST_META_APP_SECRET='el-app-secret-de-meta'
```

> **No pegues el bloque entero de golpe.** Si la consola parte una línea larga
> por la mitad, PowerShell lee el resto como un comando nuevo y responde *"Falta
> una expresión después del operador unario `--`"* — que no tiene nada que ver
> con lo que pasó. Por eso los comandos van sin `--app`: cuanto más cortos,
> menos hay que partir.

> **Comillas simples, no dobles.** En PowerShell, lo que va entre comillas dobles
> se interpreta: un `$` dentro del valor se lo come y el secreto llega
> incompleto. Entre comillas simples viaja tal cual.

Como todavía no hay ninguna máquina, flyctl responde que los secretos quedan
*staged* —guardados, a la espera del primer despliegue—. Es lo correcto.

Si aún no tienes el App Secret de Meta porque la app no está creada, pon un valor
cualquiera para poder desplegar y cámbialo después con el mismo comando. **Hasta
que sea el bueno, el relay descartará todos los webhooks** — que es exactamente
lo que debe hacer.

Comprobar:

```powershell
fly secrets list --app motrest-relay
```

Enseña los nombres y una huella, nunca los valores. Tienen que estar los cuatro.

`MOTREST_RELAY_CLAVE_ADMIN` es "opcional" solo en el sentido de que el relay
arranca sin ella; sin ella, `/salud/detalle` y `/pulsos` quedan cerrados del
todo — y `/pulsos` es justo lo que Central viene a leer.

> **Cada `fly secrets set` reinicia las máquinas.** Ahora no hay ninguna y da
> igual. Más adelante sí importa: cambiar un secreto con locales conectados les
> corta el enlace y vuelven solos en unos segundos.

---

## 4 · Desplegar

### 4.1 · El comando

Desde la **raíz del repositorio** (el contexto de la imagen es el monorepo
entero, porque el relay usa `@motrest/dominio`):

```powershell
fly deploy --config apps/relay/fly.toml --dockerfile apps/relay/Dockerfile .
```

El punto final es el directorio de contexto y **no sobra**: sin él, Docker no ve
el `pnpm-lock.yaml` ni `packages/dominio`, y el build falla al instalar.

> **Nunca `fly launch`.** Reescribe el `fly.toml` con lo que él supone, y ahí
> dentro hay tres decisiones que no se pueden perder: el volumen montado en
> `/datos`, `auto_stop_machines = 'off'` y el health check. Con el auto-stop
> encendido, Fly apagaría la máquina por "ociosa" con los cincuenta Hubs
> conectados: un WebSocket callado no le parece tráfico.

**La primera vez tarda 5–10 minutos.** La imagen se construye en la
infraestructura de Fly —no necesitas Docker— e instala pnpm y las dependencias
desde cero. Los despliegues siguientes son mucho más rápidos.

### 4.2 · Comprobar que está vivo

```powershell
fly status --app motrest-relay
fly logs --app motrest-relay
```

En el registro tienen que salir estas dos líneas:

```
INFO Relay escuchando en :8080
INFO 0 restaurante(s) en el padrón
```

Si en vez de eso aparece `ERROR Faltan variables de entorno: …`, el relay hizo
exactamente su trabajo: falta un secreto del paso 3 y te dice cuál.

### 4.3 · Probarlo antes de tener dominio

Fly ya le dio a la app una dirección propia y una IP compartida:

```powershell
curl.exe https://motrest-relay.fly.dev/salud
```

Responde `{"relay":"motrest","ts":…}`. Con eso **el relay ya funciona**: podrías
dar de alta un restaurante hoy contra esa dirección. El dominio propio es para no
tener que cambiarla nunca más.

Y la puerta con clave:

```powershell
curl.exe -H "authorization: Bearer LA-CLAVE-ADMIN" https://motrest-relay.fly.dev/salud/detalle
```

`/salud` es público y no dice nada a propósito: cuántos restaurantes tiene MOTRAE
y cuáles están abiertos ahora mismo se pregunta con clave.

### 4.4 · Fijar el número de máquinas

```powershell
fly scale count 1 --app motrest-relay
fly status --app motrest-relay
```

**Una, y solo una.** No es una limitación de Fly: los enlaces de los Hubs viven
en memoria, el padrón es un archivo en ese volumen y el índice de mensajes ya
vistos también. Dos máquinas serían dos padrones divergiendo y la mitad de los
avisos llegando a un relay donde el Hub de ese local no está conectado (ADR-27).

### 4.5 · El dominio propio y el certificado

Cuando Cloudflare diga **Active** (paso 1.3):

```powershell
fly certs add relay.motrae.mx --app motrest-relay
```

El comando responde con lo que hay que crear. Para un subdominio, lo que toca es
un **CNAME**:

| Tipo | Nombre | Contenido | Proxy |
|---|---|---|---|
| CNAME | `relay` | `motrest-relay.fly.dev` | **DNS only** (nube **gris**) |

> **La trampa de Cloudflare.** Si el registro queda con el proxy encendido (nube
> naranja), Fly no puede validar el dominio y el certificado se queda para
> siempre en `Awaiting configuration`. Además, el `wss://` de los Hubs pasaría a
> depender de un intermediario más que puede cortar sockets largos. **Gris.**

Fly emite el certificado en un par de minutos:

```powershell
fly certs check relay.motrae.mx --app motrest-relay
```

Cuando diga que está listo, la prueba de verdad:

```powershell
curl.exe https://relay.motrae.mx/salud
```

Si responde el mismo JSON, **el relay está publicado** y ya tienes las dos
direcciones que hacen falta en los pasos siguientes:

```
Webhook para Meta:   https://relay.motrae.mx/webhook/whatsapp
URL para los Hubs:   wss://relay.motrae.mx/hub
```

---

## 5 · El webhook en Meta

En el panel de la app (producto **WhatsApp → Configuración**):

| Campo | Valor |
|---|---|
| URL de devolución de llamada | `https://relay.motrae.mx/webhook/whatsapp` |
| Token de verificación | el `MOTREST_META_VERIFY_TOKEN` del paso 3 |
| Campo suscrito | **`messages`** |

Meta hace en el acto una llamada `GET` de comprobación. Si el token coincide,
queda verificado y en los registros aparece `INFO Meta verificó el webhook.`

Si responde 403, el token no coincide: el relay contesta 403 también a una URL
que existe, para no confirmarle nada a quien esté probando.

---

## 6 · Dar de alta el primer restaurante

El id de sucursal **no te lo inventas**: lo genera el Hub al instalarse y lo
escribe en `<datos>/sucursal.txt` del restaurante. Cópialo de ahí.

```powershell
fly ssh console --app motrest-relay
```

Y ya dentro de la máquina:

```sh
padron alta suc-a1b2c3d4 "Rodizio"
```

Devuelve una credencial que **se enseña una sola vez** — el padrón solo guarda su
huella. Se pega en el Hub del local, en **Administración → Hub del local →
WhatsApp**:

```
URL del relay:  wss://relay.motrae.mx/hub
Credencial:     la que devolvió el alta
```

De la credencial sale la identidad del local ante el relay, así que **una por
restaurante y nunca compartida**: quien la tiene, es el local.

El resto del padrón:

| Orden | Para qué |
|---|---|
| `padron lista` | Quién está de alta y quién ya conectó su número |
| `padron rotar <sucursal>` | Credencial nueva. Corta el enlace vivo del local |
| `padron baja <sucursal>` | Lo saca y olvida su token de Meta de inmediato |

> **Usa siempre `padron`, no `node /app/padron.cjs`.** `fly ssh console` entra
> como root, y el CLI a pelo escribiría el padrón con dueño root: el relay, que
> corre como `node`, dejaría de poder leerlo en el siguiente reinicio. El
> envoltorio `padron` baja al usuario correcto. Es un fallo que no se nota hasta
> el reinicio siguiente, que es la peor hora para notarlo.

Cuando el Hub conecte, en los registros sale `INFO Hub conectado: suc-a1b2c3d4`.

---

## 7 · Enlazar Central con los pulsos

Central lee `https://relay.motrae.mx/pulsos` con la **misma**
`MOTREST_RELAY_CLAVE_ADMIN` en la cabecera `authorization: Bearer …`. Ahí está,
por restaurante, la versión instalada y la última señal de vida.

No es un token aparte a propósito: eso es la cartera de MOTRAE —quién es cliente
y cuánto facturó ayer cada local— y no puede quedar en abierto ni por descuido.

---

## 8 · El respaldo

Dos cosas, y las dos hacen falta para restaurar. Por separado no valen nada, y
esa es justo la idea:

1. **La llave** (`MOTREST_RELAY_LLAVE_PADRON`), que ya guardaste en el paso 3.2.
2. **El padrón cifrado**, que se baja así:

```powershell
fly ssh sftp get /datos/restaurantes.json ./respaldo-padron.json --app motrest-relay
```

El archivo que baja está cifrado (AES-256-GCM), así que se puede guardar como
cualquier otro respaldo. **Guárdalo en un sitio distinto de la llave**: juntos
son el padrón en claro.

Conviene bajarlo después de cada alta o baja de restaurante — que son los únicos
momentos en que cambia algo que no se puede regenerar.

---

## Operar el relay

| Qué | Cómo |
|---|---|
| Ver qué está pasando | `fly logs --app motrest-relay` |
| Publicar una versión nueva | El mismo `fly deploy` del paso 4.1 |
| Reiniciar | `fly apps restart motrest-relay` |
| Entrar a la máquina | `fly ssh console --app motrest-relay` |
| Cuántos Hubs hay conectados | `curl.exe -H "authorization: Bearer …" …/salud/detalle` |

**Al desplegar se cortan los enlaces.** La máquina se reemplaza, los Hubs
pierden el socket y vuelven solos con reconexión progresiva (2 s y subiendo
hasta 5 min). No hace falta tocar nada en los restaurantes; sí conviene no
desplegar un viernes a las nueve de la noche.

### Qué se rompe si el relay se cae

Poco, y a propósito. **El restaurante sigue vendiendo**: el POS, el KDS, las
impresoras, el portal del comensal y el corte de caja viven en el Hub del local y
no pasan por aquí. Lo que se pierde mientras está caído:

- los avisos de WhatsApp que se quisieran mandar (mesa lista, confirmaciones);
- los mensajes entrantes de ese rato — **no se encolan**: cuando el local
  encienda, el comensal ya habrá seguido con su vida;
- los pulsos, así que Central verá los locales "sin señal" hasta que vuelva.

Es la misma postura de todo el sistema: la nube ayuda, el local opera.

### Lo que cuesta

A precios publicados por Fly en agosto de 2026, que los cambia él:

| Concepto | Al mes |
|---|---|
| Máquina `shared-cpu-1x` 512 MB, encendida siempre | 3.19 USD |
| Volumen de 1 GB | 0.15 USD |
| IPv4 compartida | gratis (una dedicada son ~2 USD) |

Unos **3.50 USD al mes** para toda la cartera, más el dominio una vez al año. Es
el único componente de MotRest con costo recurrente y el único expuesto a
internet.

---

## Si algo no sale

| Síntoma | Casi siempre es |
|---|---|
| `fly` no se reconoce como comando | La terminal es la de antes de instalar. Ciérrala y abre otra |
| El nombre de la app está tomado | Es global en Fly. Elige otro y cámbialo también en `fly.toml` |
| No deja crear el volumen | Falta la tarjeta en la cuenta de Fly |
| `curl` se queja de `-H` | Es el alias de PowerShell. Escribe `curl.exe` |
| `Falta una expresión después del operador unario '--'` | La consola partió el comando y leyó `--app …` como línea nueva. Ejecuta de línea en línea, o ponte en `apps\relay` y quita el `--app` |
| `region qro not found` | Fly no tiene región en México. Usa `dfw` (Dallas) y compruébalo con `fly platform regions` |
| El build falla al instalar dependencias | Faltó el `.` final del `fly deploy` |
| `Faltan variables de entorno` en el arranque | Un secreto sin poner. El registro dice cuál |
| El padrón se borra en cada despliegue | El `source` del `[[mounts]]` no coincide con el nombre del volumen |
| `No se pudo descifrar el padrón` | `MOTREST_RELAY_LLAVE_PADRON` no es la misma con la que se escribió |
| El certificado se queda en `Awaiting configuration` | El registro en Cloudflare está con la nube **naranja**. Ponlo en DNS only |
| Meta responde 403 al verificar | El `VERIFY_TOKEN` del panel no es el del secreto |
| Un Hub no conecta: `credencial no reconocida` | Se dio de alta otro id de sucursal. Compruébalo con `padron lista` |
| El Hub dice que la dirección tiene que ser `wss://` | Se configuró `ws://`. El Hub lo rechaza él solo, antes de abrir el socket |
| `ya tiene un Hub conectado` | Hay otro Hub vivo con esa credencial, o el anterior aún no se ha caído. El latido lo destapa en un minuto |

---

## Documentos relacionados

- [ADR-23 · WhatsApp: de quién es el número, y por qué hay un relay](adr/ADR-23-whatsapp-y-el-relay.md)
- [ADR-27 · Dónde vive el relay](adr/ADR-27-donde-vive-el-relay.md)
- [ADR-26 · La actualización remota que de verdad actualiza](adr/ADR-26-actualizacion-remota.md) — de dónde salen los pulsos
- [Conectar el WhatsApp de un restaurante](WHATSAPP-ALTA-DE-RESTAURANTE.md)
