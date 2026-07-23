# MotRest Hub

Servicio de fondo del local. Su responsabilidad irrenunciable es **asignar la
secuencia total** del event log: los dispositivos sellan con su propio reloj
(ADR-17), que puede ir desfasado, y quién ocurrió antes lo decide un solo
árbitro. Topología hub-and-spoke (TRD §4.1, ADR-01).

## Lo que el Hub NO hace, a propósito

- **No es requisito para vender.** Si se apaga, las terminales siguen operando
  contra su registro local y se reconcilian al volver (TRD R3). El modo isla es
  el estado normal, no una degradación.
- **No reescribe eventos.** Un hecho recibido dos veces conserva la secuencia
  que ya tenía. El log es la bitácora de auditoría del sistema; no se corrige,
  se anexa.

## Arrancar

```bash
corepack pnpm@9.15.0 --filter pos-ui build     # una vez, y tras cada cambio
corepack pnpm@9.15.0 --filter @motrest/hub start
```

El Hub **sirve también el POS** desde su mismo puerto, por HTTPS. Al arrancar
imprime el enlace para abrir en cada terminal del local, con la IP del equipo.
Ese enlace lleva la clave: es una credencial.

| Variable | Por omisión | Para qué |
|---|---|---|
| `MOTREST_HUB_PUERTO` | `8787` | Puerto HTTPS y WSS |
| `MOTREST_HUB_PUERTO_LOCAL` | `8788` | Acceso sin certificado, solo desde el propio equipo |
| `MOTREST_HUB_DB` | `./datos/hub.sqlite` | Archivo del event log |
| `MOTREST_POS_DIST` | `../pos-ui/dist` | POS compilado que sirve el Hub |
| `MOTREST_HUB_ID` | `hub-local` | Identificador del Hub |
| `MOTREST_HUB_NOMBRE` | `motrest` | Nombre en la red: `<nombre>.local` |
| `MOTREST_HUB_ABIERTO` | *(sin definir)* | `1` acepta cualquier terminal **que tenga la clave**, sin autorizar. Solo para pruebas. |

## Cómo se abre cada terminal

**El equipo del Hub (la caja)** usa `http://localhost:8788/…`. Sin avisos: el
navegador confía en `localhost` por definición, y esa escucha está atada al
loopback —desde la red no existe—.

**Las demás terminales** escanean el **QR** desde *Administración → Hub del
local → Mostrar código*. Aceptan el aviso del certificado una vez y quedan
enlazadas. También sirve pegar el enlace a mano.

## Descubrimiento en la red

El Hub se anuncia por mDNS como **`motrest.local`**, y ese nombre va primero en
los enlaces de emparejamiento. Importa porque el router reparte las IP por DHCP
y puede cambiar la del equipo: el día que pase, un enlace con IP dejaría a todas
las terminales sin Hub a la vez.

Está implementado a mano sobre UDP (son unas decenas de líneas) en vez de traer
una biblioteca de descubrimiento completa que este caso no usaría.

*Límite:* Windows y macOS resuelven `.local` de fábrica; Android desde la
versión 12. Para lo demás, el enlace con IP se mantiene.

## Por qué el Hub sirve el POS

No es comodidad: es lo que hace que **cada terminal acepte el aviso del
certificado una sola vez**. La aplicación y el canal de sincronización comparten
origen y certificado, así que aceptarlo al abrir la app habilita también el
WebSocket. Servirlos por separado obligaría a aceptar dos.

Y hay algo que sin HTTPS simplemente no funciona: los navegadores solo exponen
`crypto.subtle` en contextos seguros. Sin él, una terminal **no puede verificar
contraseñas, ni cifrar el canal, ni sellar el corte** — y el único síntoma es
"no me deja entrar". El certificado es autofirmado (un equipo de LAN no tiene
dominio) y se guarda para no obligar a aceptarlo cada mañana.

## Seguridad del canal

**Todo lo que viaja va cifrado** con la clave del local (AES-256-GCM): ventas,
precios, importes de caja y datos del personal. Quien esté en el wifi del
restaurante no puede leerlo ni inyectar comandas falsas — sin la clave no puede
ni formular un mensaje que el Hub entienda.

No se usa TLS porque un Hub de LAN no tiene nombre de dominio: un certificado
autofirmado obligaría a cada terminal a saltarse la advertencia roja del
navegador, y ese es justo el hábito que no queremos crear. Ver `cifrado.ts` para
el razonamiento completo.

**Qué no cubre:** no hay secreto hacia atrás, y la clave es compartida —una
terminal enlazada podría hacerse pasar por otra—. Quién hizo qué se apoya en el
`empleado_id` del evento y en la revalidación de permisos, no en el cifrado.

**Autorización de terminales.** La primera terminal de un Hub recién instalado
se autoriza sola: si no, nadie podría autorizar a nadie, porque la pantalla que
autoriza vive dentro de una terminal sin autorizar. Queda anotado en la bitácora.
De ahí en adelante toda alta exige la firma de una terminal ya autorizada.

## Endpoints

| Ruta | Método | Qué hace |
|---|---|---|
| `/salud` | GET | Secuencia, conexiones, cifrado y huella del certificado |
| `/sync` | WebSocket | El canal de sincronización, **cifrado** |
| `/*` | GET | El POS compilado |

Listar y autorizar terminales viaja por el canal cifrado, no por HTTP: por una
ruta en claro cualquiera en la red podría leer los identificadores de las
terminales y usar uno autorizado para colarse.

## Cómo está partido

- **`servidor.ts`** — la lógica del protocolo, sin red. Habla con "conexiones"
  abstractas, así que las pruebas ejercen el protocolo completo sin levantar un
  servidor ni abrir un socket.
- **`main.ts`** — solo el arranque: HTTP, WebSocket y SQLite.

Esa separación es la que permite que el criterio de aceptación de la etapa 10
—*dos dispositivos, apagar el hub, seguir vendiendo, reconectar sin
duplicados*— sea una prueba automática y no un procedimiento manual.

## Almacenamiento

`node:sqlite`, integrado en Node 22+, en vez de `better-sqlite3`: evita una
dependencia nativa que haya que compilar en cada máquina donde se instale. Un
restaurante no debería necesitar herramientas de compilación para operar su
caja. SQLite en modo WAL, como pide el TRD.

El `id` del evento es la llave primaria: ahí vive la deduplicación de la que
depende toda la sincronización.

### El acuse significa "está en el disco"

El log abre con `synchronous = FULL`, y esa es la pieza que sostiene la promesa
del acuse: la terminal descarta su copia pendiente cuando el Hub confirma, así
que el Hub no puede confirmar antes de escribir. Con `NORMAL` un apagón puede
deshacer transacciones ya confirmadas —la base queda íntegra, pero sin las
últimas ventas— y nadie las vuelve a mandar, porque nadie sabe que faltan.
Detalle en [ADR-19](../../docs/adr/ADR-19-durabilidad.md).

## Que arranque solo con el equipo

```powershell
# PowerShell COMO ADMINISTRADOR
.\instalar-servicio.ps1
```

Registra una tarea programada que levanta el Hub al encender la computadora,
antes de que nadie inicie sesión: el restaurante abre sin que alguien tenga que
acordarse de arrancar nada. Se quita con `-Desinstalar`.

Es una tarea programada y no un servicio de Windows porque un servicio exige un
ejecutable que hable ese protocolo, lo que obliga a un envoltorio nativo. La
tarea consigue lo mismo —arranca sin sesión, se reinicia si falla— sin una pieza
más que mantener. El instalador nativo registrará un servicio de verdad.

## Pendiente

- **Instalador nativo (Tauri)**: un `.exe` que un tercero instala solo, con el
  certificado ya en el almacén de confianza de Windows —así desaparece el aviso
  incluso en las tablets—.
- **APK del KDS** (Capacitor) para la pantalla de cocina en modo kiosco.
- **Compilar a JavaScript**: en desarrollo corre con `tsx`; un servicio de
  producción no debería transpilar en cada arranque.
- **Rotar la clave del local** desde la interfaz, para cuando un enlace se
  filtre o salga una terminal del local.
