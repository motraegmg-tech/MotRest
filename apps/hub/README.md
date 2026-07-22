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
corepack pnpm@9.15.0 --filter @motrest/hub start
```

| Variable | Por omisión | Para qué |
|---|---|---|
| `MOTREST_HUB_PUERTO` | `8787` | Puerto HTTP y WebSocket |
| `MOTREST_HUB_DB` | `./datos/hub.sqlite` | Archivo del event log |
| `MOTREST_HUB_ID` | `hub-local` | Identificador del Hub |
| `MOTREST_HUB_ABIERTO` | *(sin definir)* | `1` acepta cualquier dispositivo de la red. **Solo para pruebas.** |

Por omisión se **exige aprobación**: alcanzar la red del local no da derecho a
escribir en el log de ventas. Un dispositivo nuevo queda registrado sin aprobar
hasta que un responsable lo autorice.

## Endpoints

| Ruta | Método | Qué hace |
|---|---|---|
| `/salud` | GET | Secuencia actual, conexiones abiertas, si exige aprobación |
| `/dispositivos` | GET | Terminales conocidas y hasta dónde tiene cada una |
| `/aprobar?device_id=…` | POST | Autoriza una terminal |
| `/sync` | WebSocket | El canal de sincronización |

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

- **TLS con certificado fijado.** Hoy el canal viaja en claro por la LAN. Esto
  sirve para una red de local controlada, no para exponerse a internet.
- **Descubrimiento mDNS** y emparejamiento por QR. Hoy la dirección se captura
  a mano desde Administración → Hub del local.
- **Compilar a JavaScript** y empaquetar como servicio de Windows (ADR-07). En
  desarrollo corre con `tsx`; un servicio de producción no debería transpilar en
  cada arranque.
