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
| `MOTREST_HUB_DB` | `./datos/hub.sqlite` | Archivo del event log |
| `MOTREST_POS_DIST` | `../pos-ui/dist` | POS compilado que sirve el Hub |
| `MOTREST_HUB_ID` | `hub-local` | Identificador del Hub |
| `MOTREST_HUB_ABIERTO` | *(sin definir)* | `1` acepta cualquier terminal **que tenga la clave**, sin autorizar. Solo para pruebas. |

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

## Pendiente (etapa 12)

- **Descubrimiento mDNS** y **QR de emparejamiento**. Hoy el enlace se copia de
  la consola del Hub o de otra terminal ya enlazada.
- **Rotación de la clave del local** desde la interfaz, para cuando un enlace se
  filtre o salga una terminal del local.
- **Compilar a JavaScript** y empaquetar como servicio de Windows (ADR-07). En
  desarrollo corre con `tsx`; un servicio de producción no debería transpilar en
  cada arranque.
