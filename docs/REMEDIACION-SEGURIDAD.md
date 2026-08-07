# Remediación de seguridad — estado y plan

> **Para quien retome este trabajo (persona o IA).** Este documento es la fuente
> de verdad del operativo. Al terminar cada etapa, **actualízalo**: marca la
> etapa, anota lo que se desvió del plan y por qué. Un plan que no refleja lo
> hecho es peor que no tenerlo.

**Origen:** auditoría `/cyber-neo` del 6-ago-2026 — 46 hallazgos (1 crítico, 10
altos, 20 medios, 12 bajos, 4 info) sobre 345 archivos fuente.
**Reporte completo:** `Escritorio/cyber-neo-report-Software_para_Restaurantes_ERP-2026-08-06.md`
**Rama:** `feature/e1-cimientos` · **Un commit por etapa.**

---

## Estado

| Etapa | Qué cubre | Estado |
|---|---|---|
| **1** | Herramientas y red de seguridad | ✅ `ce11047` |
| **2** | Identidad del Hub y registro a archivo | ✅ `2b59b55` |
| **3** | Credenciales del local | ✅ `c5b9fa2` |
| **4** | Cimientos criptográficos (Ed25519) | ✅ `aba41ec` |
| **5** | El Hub como autoridad | ✅ `cf6b677` |
| **6** | Superficie HTTP del Hub | ✅ `07361d9` |
| **7** | El relay | ✅ `f38f36a` |
| **8** | Correo (CRLF) | ✅ `19b70f6` |
| **9** | Tauri, certificados y empaquetado | ✅ *(este commit)* |
| **10** | Proceso y despliegue (CI, guías) | ✅ *(este commit)* |
| **11** | Detalles finos | ✅ *(este commit)* |
| **12** | Capacitor 8 *(aislada)* | ⚠️ *(este commit)* — APK actual compilado y verificado; **falta instalarlo y probarlo en tablet física** |

**Pruebas al cierre de la etapa 12:** 1 574 verdes (1 omitida) · lint 0 errores ·
`pnpm audit` **completo** limpio · `cargo check --release` limpio en las dos apps
de escritorio.

> La omitida es a propósito: comprueba que el padrón queda en `0600`, y en
> Windows `chmod` solo mueve el atributo de solo lectura. Los permisos de verdad
> ahí son ACL de NTFS, que `statSync` no refleja. Corre en Linux, que es donde el
> relay se despliega.

---

## Cómo está ordenado, y por qué importa

No es por severidad. Es un orden donde **ningún arreglo obliga a rehacer otro**,
derivado de restricciones verificadas en el código:

1. **Las herramientas primero.** Subir `vitest` cambia el corredor de pruebas →
   etapa 1, para que las once siguientes se validen sobre el toolchain final.
2. **`registrar()` es el cuello de botella único del Hub**: 46 llamadas directas
   + 10 puntos de inyección + 24 indirectas. Cambiar su firma se hace **antes que
   nada o nunca** → etapa 2.
3. **`sucursalDelLocal()` alimenta** el `hola` del relay, la atribución del
   portal y el stream de identidad → identidad estable antes de las etapas 5, 6 y 7.
4. **Lo que cambia la firma va junto.** Ed25519 + firmar `notas` + anti-reversión
   tocan los tres el contenido firmable → una etapa atómica. Separarlas
   cambiaría el formato 3 veces y reescribiría 6 archivos de prueba 3 veces.
5. **Lo arriesgado, aislado y al final** → Capacitor 8, etapa 12.

---

## ✅ Etapa 1 · Herramientas y red de seguridad

**Hallazgos:** CN-002, CN-010, CN-012, CN-029, CN-030, CN-038, CN-040, CN-041, CN-042

- `vitest` 2.1.9 → 3.2.7 en los 7 `package.json`. Cerró el crítico **y** los tres
  avisos de `vite@5.4.21`, que entraba solo como dependencia interna de vitest 2.
- `pnpm.overrides` += `postcss ^8.5.26`, `brace-expansion ^2.1.4`.
- **`pnpm audit` completo limpio**, no solo `--prod`.
- `.npmrc` con registro explícito y `frozen-lockfile`; script `auditoria`.
- `.gitignore` por **extensión** además de por ruta (`*.cer`, `*.p12`, `*.pass`…).
- **CN-002:** `atender()` envuelto en `try/catch` → 400; `decodificar()` defensiva;
  la URL se construye con base fija en vez del `Host` del cliente;
  `uncaughtException` y `unhandledRejection` que **anotan y no matan**;
  supervisión del sidecar en `lib.rs` con espera creciente.

**Decisión de diseño registrada:** el Hub **no muere** ante una excepción no
capturada. Para casi cualquier programa eso sería incorrecto, pero aquí el
proceso es el registro de ventas de un restaurante lleno: un fallo aislado en una
petición no justifica dejar de cobrar. El event log está en disco y cada petición
es independiente.

---

## ✅ Etapa 2 · Que el Hub sepa quién es y deje rastro

**Hallazgos:** CN-019, CN-031, CN-036 · **más un fallo hallado al explorar**

- **Identidad estable.** `sucursalDelLocal()` aprendía de los últimos 5 eventos
  con caída al literal `"suc-local"` → **dos Hubs recién instalados colisionaban**
  y el segundo desplazaba el enlace del primero en el relay. Ahora se resuelve una
  vez (archivo → entorno → registro) y se persiste en `<datos>/sucursal.txt`.
  Sin ninguna de las tres se genera uno **único**, no un literal compartido.
- **CN-019.** `registrar()` escribe a `<datos>/registro/hub-AAAA-MM-DD.log`,
  `mode 0600`, rotación por tamaño, retención 30 días. Los `error` a **stderr**.
  Nunca tumba el Hub: si el disco está lleno se pierde el renglón, no la venta.
- **CN-031.** La clave del local va enmascarada en la consola.
  `MOTREST_MOSTRAR_CLAVE=1` para verla.
- **CN-036.** El modo abierto se publica como catálogo `modo_abierto` y el POS
  pinta una banda roja permanente.

**Por qué CN-019 y CN-031 iban juntos:** al darle destino en disco al registro,
la clave del local habría quedado escrita sin caducidad.

---

## ✅ Etapa 3 · Credenciales del local

**Hallazgos:** CN-007, CN-008

- **Nada del repositorio abre ningún restaurante.** El propietario se siembra
  **sin credenciales** en producción; el primer arranque genera una contraseña
  (`7KX9-MQ2P-4VN8`, ~58 bits) y un PIN de **8 dígitos**, únicos de ese local, y
  los enseña **una sola vez** (`CredencialesIniciales.svelte`).
- Las credenciales de demostración viven dentro de `credencialesDeDemostracion()`
  —una **función**, no constantes de módulo— para que el empaquetador las
  elimine. Es la misma técnica que ya protegía a Marco y Lucía.
- Alfabeto sin `0/O`, `1/I/L` ni `U`: esto se apunta en papel y se dicta por
  teléfono.

### ⚠ Desviación deliberada del plan

El plan decía **«subir el mínimo a 6 dígitos en `validarSecreto()`»**. **No se
hizo, y es intencional.**

La vulnerabilidad real era **el hash publicado en el instalador**: con 10 000
combinaciones se rompe offline en segundos. Quitado el hash del paquete, un PIN
de 4 dígitos solo se puede atacar **en línea**, donde aplica el tope de 7
intentos — el mismo modelo que una tarjeta bancaria.

Subir a 6 para todos costaría dos dígitos más × cien tecleos por turno × cada
mesero, a cambio de defensa contra un atacante que ya tiene el dispositivo
—escenario que cubren BitLocker (etapa 10) y el bloqueo—.

**Lo que sí se hizo:** el PIN **generado** del propietario es de 8 dígitos. Es el
que firma cancelaciones, descuentos y retiros, y nadie lo teclea a diario.

*Si se prefiere el mínimo de 6 para todos, o un mínimo por rol (4 para piso, 6+
para quien puede autorizar), es un cambio de una línea en `validarSecreto` más el
ajuste de las pruebas que usan PIN de 4.*

---

## ✅ Etapa 4 · Los cimientos criptográficos

**Hallazgos cerrados:** CN-001 *(crítico)*, CN-005, CN-023, CN-024, CN-025,
CN-039.

- **Firmas asimétricas reutilizables.** `packages/dominio/src/comun/firma.ts`
  implementa Ed25519 con WebCrypto nativo. Licencias y manifiestos usan un JSON
  canónico de todo el objeto salvo `firma`, con claves ordenadas: `notas`,
  `version_minima_soportada` y cualquier campo anidado quedan cubiertos por la
  firma.
- **Separación de autoridad.** Hay un par para licencias y otro para
  publicaciones. Central conserva las privadas protegidas por DPAPI; Hub recibe
  solamente las públicas, incrustadas por `empaquetar.mjs`. El empaquetado exige
  `MOTREST_LICENCIA_PUBLICA` y `MOTREST_ACTUALIZACIONES_PUBLICA`, por lo que no
  puede producirse accidentalmente un binario de producción sin sus verificadores.
- **Central y migración.** La UI ya no muestra ni persiste privadas en
  `localStorage`; enseña y permite copiar solo las públicas. Los comandos Tauri
  protegen secretos y sus respaldos cifrados con DPAPI. Si encuentra la
  configuración HMAC heredada, conserva la configuración no sensible y ofrece
  regenerar los pares, sin impedir que Central abra. Se implementaron también
  respaldo y restauración de secretos cifrados.
- **Operación de licencias.** El CLI recibe la privada desde el almacén seguro de
  MOTRAE, deriva su pública y auto-verifica antes de emitir. Ya no hay una llave
  simétrica instalada en cada restaurante que permita firmar.
- **Canal de actualizaciones.** Central genera `publicado_ts` estrictamente
  monótono; Hub rechaza manifiestos vencidos, futuros, regresivos o con una
  versión mínima inválida y persiste la última marca aceptada. El token de GitHub
  solo se entrega por HTTPS a hosts de GitHub permitidos, incluidos los saltos de
  redirección. Las descargas usan directorio temporal único, validan SHA-256
  desde el archivo ya escrito y lo recalculan inmediatamente antes de lanzar el
  instalador.
- **Cobertura.** Las pruebas dejaron de usar cadenas que simulaban llaves:
  generan pares Ed25519 y comprueban firmas inválidas, reversión, frescura,
  mínimos, fuga de token, URL arbitraria y sustitución del instalador en disco.

### Decisión de despliegue obligatoria

Cambiar HMAC por Ed25519 invalida las licencias antiguas. Antes de actualizar un
Hub en un restaurante ya instalado hay que: **(1)** generar y resguardar los
pares, **(2)** compilar el Hub con las públicas, **(3)** reemitir y confirmar la
licencia nueva mientras el Hub anterior sigue activo y **solo entonces (4)**
actualizar el Hub. Hacerlo al revés puede dejar el local bloqueado sin soporte
remoto. La decisión y la secuencia están registradas en
[`ADR-25`](adr/ADR-25-firmas-ed25519-y-migracion.md).

---

## ✅ Etapa 5 · El Hub como autoridad

**Hallazgos:** CN-003, CN-013 · más las tres trampas de integración detectadas
al explorar.

- **La identidad ya se carga antes de abrir el canal.** `arrancar()` lee una sola
  vez `leerStream(streamIdentidad(sucursal))` y entrega la proyección al Hub.
  Éste rechaza una acción sensible si no tiene una autoridad de identidad, usa esa
  proyección también para el CSD y no acepta un `hola` de otra sucursal.
- **Semilla y migración idempotentes.** El POS anexa `usuario_creado` para cada
  usuario sembrado, con el propietario primero y como emisor. También lo hace al
  abrir una instalación con operación anterior que aún no tiene altas de usuarios;
  una terminal nueva que espera datos del Hub no inventa una semilla local.
- **Sin hueco circular.** `usuario_creado`, `usuario_actualizado` y
  `usuario_desbloqueado` ahora exigen los permisos de administración en el Hub.
  Además se revalidan jerarquía, roles asignables, permisos delegables, el firmante
  del desbloqueo y se rechaza una autorización delegada para cambios de usuarios.
  El único bootstrap permitido es el primer `usuario_creado` de propietario, que se
  declara a sí mismo sobre una proyección vacía.
- **Proyección segura y atómica por lote.** Se valida en ejecución la forma de los
  11 eventos de identidad antes de reducirlos, tanto en Hub como al rehidratar el
  POS. Dentro de un push, el estado provisional incorpora cada alta aceptada; solo
  se vuelve real después de que SQLite confirma el lote. Así la semilla completa
  puede viajar junta sin permitir que una alta posterior se autoeleve.
- **CN-013 cerrado.** `licencia_estado`, `actualizacion_estado` y `modo_abierto`
  son claves reservadas: el Hub no las acepta, difunde ni persiste si provienen
  de una terminal.
  El estado interno del Hub se guarda separado de los catálogos de terminales; al
  publicar una clave reservada usa una versión anclada al reloj del Hub para que un
  `999999` heredado no gane después de la actualización.
- **Cobertura.** Las pruebas ejercitan rechazo con proyección real, bootstrap en
  lote, intento de un gerente de crear un propietario, fallo cerrado sin proyección,
  aislamiento de catálogos reservados y persistencia de la semilla del POS.

---

## ✅ Etapa 6 · Superficie HTTP del Hub

**Hallazgos cerrados:** CN-012, CN-014, CN-017, CN-032, CN-047, CN-048.

- **Host y origen acotados al Hub real.** Antes de servir cualquier ruta se
  acepta únicamente el nombre mDNS anunciado o una IP LAN propia; `localhost`,
  `127.0.0.1` y `::1` solo valen si el socket ya viene del loopback. Así un DNS
  rebind no puede pedir el POS bajo el origen de un tercero y extraer la clave
  inyectada en la caja. Las acciones locales (`/imprimir`, `/licencia` y
  `/arranque-automatico`) además rechazan un `Origin` declarado que no sea el
  suyo.
- **CORS cerrado, no reflejado.** El POS actual ya se sirve desde el Hub y no
  necesita CORS. Se eliminó la excepción que aceptaba cualquier puerto de
  localhost. El portal solo emite cabeceras CORS para su origen exacto; dejó de
  emitir `Access-Control-Allow-Origin: *`.
- **Cabeceras de navegador y tiempos del servidor.** Toda respuesta válida del
  Hub recibe CSP, `nosniff`, anti-marco, `Referrer-Policy: no-referrer`, COOP y
  política de permisos; HTTPS añade HSTS. El script que inyecta el enlace de la
  caja usa un nonce por respuesta, sin `unsafe-inline` para scripts. Las dos
  escuchas limitan cabeceras, cuerpo y keep-alive para que conexiones incompletas
  no ocupen la caja.
- **Ritmo limitado y memoria acotada.** Las ocho rutas tienen cuota global por
  IP y una cuota propia por acción (más estricta para reserva, opinión y pedido
  del kiosco). Un exceso recibe 429 con `Retry-After`; el mapa de ventanas se
  limpia y tiene máximo de entradas para que el limitador no sea otra vía de
  consumo de memoria.
- **Rutas sin ambigüedad.** `/kiosco` y `/kiosco/` redirigen a
  `/portal/#/kiosco` en vez de caer al fallback del POS. Los estáticos de POS y
  portal ahora comparan rutas con `relative()` y el separador de directorio, no
  con un prefijo textual: un hermano como `poscopia` ya no puede pasar por hijo.
- **Cobertura.** Siete pruebas nuevas ejercitan Host, Origin/CORS, CSP, ruta
  estática, límite, las ocho clasificaciones y la normalización IPv4-mapeada.

### Decisión de compatibilidad

La CSP permite atributos de estilo inline porque el UI los calcula para el mapa
de mesas y gráficas; los scripts inline no están permitidos salvo el nonce de
emparejamiento de la caja. Así no se rompe la operación visual a cambio de abrir
ejecución de JavaScript.

---

## ✅ Etapa 7 · El relay

**Commit:** *(este commit)* — CN-004, CN-006, CN-034, CN-049.

Más trabajo del que decía la auditoría, y por una razón que solo se ve leyendo:
**no existía ningún flujo de alta**. `darDeBaja()` no tenía un solo llamador y el
padrón se poblaba por auto-registro —el Hub mandaba `credenciales` al conectar y
quedaba dado de alta—. No había estado previo contra el que autenticar, así que
antes de poner una credencial por inquilino hubo que **inventar el alta**.

**7.1 · El alta la hace MOTRAE.** `padron-cli.ts` con cinco órdenes (`llave`,
`alta`, `lista`, `rotar`, `baja`). El alta devuelve una credencial de 32 bytes
que **se enseña una sola vez**: el padrón guarda su huella SHA-256, nunca la
credencial. `darDeBaja()` ya tiene llamador, y la baja olvida el token de Meta.

**7.2 · La identidad sale de la credencial** (CN-004). El `sucursal_id` **ya no
viaja en el saludo**: se deriva del índice por huella. Era justo lo que el Hub no
debía poder elegir — con la clave compartida, cualquier local podía declararse
otro y quedarse con sus mensajes. Además:

- `sucursalId` **era reasignable en la misma conexión**: se podía saludar como un
  local, mandar, y volver a saludar como otro sin reconectar. Un segundo `hola`
  cierra el socket.
- `conectar()` sobrescribía sin cerrar el anterior, y al caerse el impostor
  **borraba el enlace del legítimo**, que se quedaba mudo. Ahora se rechaza el
  segundo y `desconectar()` solo suelta si el enlace vivo es el mismo.
- `publicarWhatsApp()` rechaza un `phone_number_id` que ya sea de otro local:
  reclamarlo era quedarse con sus mensajes entrantes.
- Cerrojo por IP (5 fallos → 15 min) y `verifyClient` en el apretón de manos, que
  antes no existía: **cualquiera podía abrir el WebSocket**.

**7.3 · El padrón** (CN-006). `0600`, **cifrado con AES-256-GCM** (dentro hay
tokens de Meta de todos los restaurantes) y **escritura atómica** temp+rename —
un corte a media escritura dejaba el padrón de todos en un JSON truncado. Y ya no
se escribe una vez por mensaje: si nada cambió, no se toca el disco.

**7.4 · Solo `wss://`** (CN-034), comprobado en el Hub antes de abrir el socket.
Se deja pasar el bucle local, para el ensayo.

**7.5 · `/salud`** (CN-049) ya no dice cuántos restaurantes tiene MOTRAE ni
cuántos están abiertos ahora mismo. Eso es la cartera de clientes de la empresa;
pasó a `/salud/detalle`, con `MOTREST_RELAY_CLAVE_ADMIN`.

**7.6 ·** Las variables reales, documentadas en `WHATSAPP-ALTA-DE-RESTAURANTE.md`
§A.4 y en la cabecera de `main.ts`, con el paso **B.0** nuevo para el alta.

### Decisiones que conviene no revertir sin leer esto

**SHA-256 y no un KDF lento para la credencial.** Un KDF lento protege un padrón
robado contra diccionario; aquí la credencial la genera el relay con 256 bits de
azar, así que no hay diccionario. Lo que sí costaría es derivar con scrypt en
cada saludo: convierte un `hola` con basura en 100 ms de CPU y 64 MB regalados a
quien quiera tumbar el relay de todos. **Vale solo mientras la credencial la
genere `generarCredencial()`**; si algún día la elige un humano, KDF lento el
mismo día.

**Latido de 30 s.** No es cosmético: lo exige la regla de "un solo enlace por
sucursal". Si se cae el módem del restaurante, el TCP puede tardar horas en
morir y el Hub que vuelve se encuentra su sitio ocupado por un fantasma.

**`arrancar()` exportado.** El relay se separa del arranque para que la prueba lo
encienda de verdad y le mienta por un WebSocket real. Es la lección de «Gonz
Motrae»: que el padrón sepa identificar por credencial no demuestra nada si el
saludo sigue creyéndose el mensaje.

**Migración.** Un padrón viejo en claro se lee una vez y se reescribe cifrado; sus
inquilinos **siguen recibiendo** mensajes pero **no autentican a nadie** hasta que
MOTRAE los dé de alta de verdad. Reventar al arrancar habría dejado a todos los
restaurantes sin WhatsApp por un formato de archivo.

---

## ✅ Etapa 8 · Correo

**Commit:** *(este commit)* — CN-011.

En el correo, **un salto de línea es una cabecera nueva**. El `nombre` de una
reserva viene del portal público —cualquiera con el QR de la mesa— y solo se le
medía la longitud; de ahí pasa al asunto de la confirmación. `Juan\r\nBcc: …` no
era un nombre raro: era un `Bcc:` de verdad, y el restaurante mandaba copia de su
correo a quien lo escribió.

**El agujero estaba en el orden.** `cabecera()` solo codificaba en base64 si había
caracteres fuera de ASCII, y `\r` y `\n` están **dentro** de `\x00-\x7F`. Un
asunto en español sin acentos salía tal cual; uno con acentos se salvaba de
rebote porque el base64 se traga el salto. Esa es la clase de protección
accidental que un día desaparece sola.

Arreglado en tres capas, y ninguna sobra por existir las otras:

| Capa | Qué hace | Por qué no basta con las otras |
|---|---|---|
| `portal.ts` | Aplana el nombre **antes de medirlo** | El nombre también se imprime en el ticket y se guarda en el log de eventos, donde ya no se quita |
| `correo.ts` (dominio) | `enUnaLinea()` en todo lo que interpola `rellenar()` | Protege también el camino de **Resend**, que no pasa por `smtp.ts` |
| `smtp.ts` | `sinSaltos()` **antes** de decidir si codifica | Protege aunque un día alguien arme un asunto sin pasar por el dominio |

### Lo que la auditoría no vio: inyección de comandos, no de cabeceras

`soloDireccion()` alimenta `MAIL FROM:<…>` y `RCPT TO:<…>`, que **no son
cabeceras: son comandos SMTP**. Un salto ahí no añade un `Bcc:`, añade un comando
entero. Y hay algo peor, que solo salió al escribir la prueba:

```
soloDireccion("cliente@correo.mx\r\nRCPT TO:<otro@ejemplo.com>")  →  "otro@ejemplo.com"
```

`<([^>]+)>` casa **en cualquier parte de la cadena**. Validar después de extraer
no habría dado ningún error: habría entregado el correo del comensal a quien
escribió el ataque, en silencio. Por eso el rechazo va sobre el valor **crudo**.

Aquí se **falla en seco** y no se aplana, al contrario que en las cabeceras:
una dirección aplanada es otra dirección, y mandar el correo a otra parte es peor
que no mandarlo. Sale por el camino de siempre (`ErrorSmtp` 550, no reintentable)
para que no llene la cola ni escape como excepción sin recoger — por eso
`soloDireccion` se movió **dentro** del `try` en `porGmail`.

---

## ✅ Etapas 9 y 10 · Tauri, certificados, empaquetado y proceso

**Commit:** *(este commit)* — CN-015, CN-016, CN-018, CN-026, CN-033, CN-035,
CN-037 (etapa 9, hechas por Claude) y CN-009, CN-021, CN-022, CN-028 (etapa 10,
hechas por Codex en paralelo).

> **Cómo se repartieron.** CN-009 se movió de la etapa 10 a la 9 porque toca los
> dos `tauri.conf.json`, igual que CN-015 y CN-016: dejarlo donde estaba habría
> hecho que las dos ramas escribieran el mismo archivo a la vez. Con ese cambio,
> el reparto queda sin un solo archivo en común.

**CN-015 · `shell:default`, y por qué era peor de lo que parecía.** El permiso no
estaba concedido a la aplicación empaquetada sino a un `remote`: la capability
lista `http://localhost:8788/*`, que es **lo que el Hub sirve**. Traducido:
cualquier cosa que acabara ejecutándose dentro del POS podía lanzar procesos en
la caja. No hacía falta para nada —`pos-ui` no depende de `@tauri-apps/api` y no
hay un solo `invoke`—, y el sidecar se lanza desde Rust con
`app.shell().sidecar()`, que **no pasa por las capabilities**. Verificado con
`cargo check --release`: compila igual sin el permiso.

**CN-016 · El certificado del Hub era una autoridad certificadora**, con
`keyCertSign` y diez años de vigencia. Cada terminal lo acepta al emparejarse, y
en algunos sistemas aceptarlo es confiar en él *como autoridad*: quien copiara la
llave privada —que vive en el disco de una computadora detrás de la barra— podría
emitir certificados válidos para cualquier sitio, y esa tablet se los creería.
Sin revocación posible, durante una década. Ahora `cA: false`, sin `keyCertSign`,
con `serverAuth` y 397 días.

> ⚠ **La trampa: bajar la vigencia sin renovación era peor que el problema.** El
> certificado solo se regeneraba si cambiaban las direcciones del equipo — nunca
> por vencimiento. Con 397 días, el local se habría quedado a los trece meses sin
> poder abrir el POS, y **sin poder saltárselo**: un certificado caducado no se
> acepta ni pulsando «continuar». Se añadió renovación 30 días antes, con prueba
> propia (`certificado.test.ts`).

**CN-018 · El `<script>` de la pantalla de arranque** obligaba a poner
`script-src 'unsafe-inline'` en la CSP — y esa CSP no cubre solo esa pantalla,
cubre también el POS que se carga desde el Hub. Doce líneas en línea permitían
*cualquier* script en línea en toda la aplicación. Sacado a `arranque.js`;
`script-src 'self'` en las dos apps. Comprobado sobre el HTML compilado: cero
scripts en línea.

**CN-026 · La versión de Node.** `.nvmrc` decía `24`, `engines.node` decía
`>=20`, y esbuild apuntaba a `node22`. Lo que hace que importe está en
`empaquetar.mjs`: `copyFileSync(process.execPath, exe)` — **el ejecutable del Hub
es una copia del Node que corrió el empaquetado**. La versión que acaba en la caja
de Rodizio es la que tuviera en el PATH quien empaquetó ese día. Ahora `.nvmrc` es
exacta (`24.16.0`), `engines` está alineado, y el empaquetado **aborta** si no
coinciden.

**Regresión de empaquetado detectada al validar el instalador.** Un ejecutable SEA
no lleva `apps/hub/package.json`; leerlo con `createRequire(...)("../package.json")`
hacía que el Hub terminara antes de escuchar en `localhost:8788`. La versión se
incrusta ahora durante `empaquetar.mjs`, igual que las públicas Ed25519, y el
empaquetador aborta si el bundle conserva esa ruta. Antes de entregar un instalador
se arranca el sidecar resultante sobre una base y puerto temporales y se exige
`GET /salud` con `200`.

**CN-033 · El `0o600` no protegía nada en Windows.** `fs.chmod` ahí solo mueve el
atributo de solo lectura; las ACL de NTFS quedan como estuvieran. Y Windows es la
única plataforma donde MotRest se instala, así que la protección existía en el
comentario y no en el disco — el propio `SEGURIDAD.md` la publicaba como un
hecho. Nuevo `permisos.ts` (`icacls`, SID en vez de nombres para que funcione en
Windows en español) sobre la carpeta del CSD y la del certificado TLS.

**CN-035 · Desviación deliberada: el `frame-src` se queda.** El plan pedía
quitarlo del build de producción. No se hizo, porque no es configuración de
desarrollo olvidada: es **la vista previa que Gonzalo pidió** para revisar MotRest
antes de publicar una actualización, y en la Central instalada apunta al servidor
de desarrollo de su propia máquina. Quitarlo habría roto la función. En su lugar
se acotó a bucle local (ya lo estaba) y se añadió `sandbox` al `iframe`, que
contiene lo que una versión sin revisar puede hacer dentro de Central.

**CN-009 · Hay DOS cosas que firmar, no una.** El instalador lo firma Tauri; el
**sidecar del Hub** hay que firmarlo aparte, y es el que se ejecuta cada mañana en
la caja. Además tiene que firmarse **después** de la inyección SEA, que cambia los
bytes e invalida cualquier firma previa — por eso el script quita primero la de
Node. Cableado a `MOTREST_FIRMA_HUELLA`: el día que llegue el certificado se
enciende sin tocar código, y sin la variable el empaquetado avisa en pantalla.

**CN-021 · El checklist estaba en el orden que anula BitLocker.** Activar primero
el inicio de sesión automático y después el cifrado deja que la máquina arranque
sola hasta el escritorio. Reordenado, más bloqueo de pantalla y cuenta estándar.

**CN-022 · El `.cmd` del servicio SYSTEM** vivía en una ruta escribible por
usuarios normales: quien pudiera reescribirlo ejecutaba como SYSTEM. Movido a
`%ProgramFiles%\MotRest\Hub` con herencia cortada y ACL por SID. Se conserva
SYSTEM a propósito: el Hub debe levantar antes de que nadie inicie sesión.

**CN-028 · CI**, con acciones fijadas por SHA, `permissions: contents: read`,
`--frozen-lockfile`, Node desde `.nvmrc`, y auditoría semanal.

> **Corregido sobre lo que entregó Codex:** faltaba
> `COREPACK_ENABLE_DOWNLOAD_PROMPT: "0"`. Sin eso, Corepack se para a pedir
> confirmación para descargar pnpm y en un runner no hay terminal donde
> contestar: el flujo se cuelga en el primer comando y el fallo no dice por qué.

---

## ✅ Etapa 11 · Detalles finos

**CN-043 · Sesgo de módulo en el enlace del ticket. ✅ Hecho.**
`aBase32()` hacía `byte % 30`, y 256 no es múltiplo de 30: los valores 0..15
salían nueve veces de cada 256 y los 16..29 solo ocho — media alfabeto aparecía
un 12 % más a menudo. Ahora se **descartan** los bytes ≥ 240 en vez de doblarlos.

Se puede descartar aunque esto tenga que ser determinista (el Hub y el enlace del
comensal deben coincidir) porque el descarte depende solo de los bytes del HMAC,
iguales en los dos lados. Hay respaldo por si el HMAC trajera una racha de bytes
altos: una firma corta rompería el enlace de esa cuenta para siempre.

Corregido también el comentario: decía «16 × 5 bits = 80 bits» y no sale —cinco
bits serían 32 símbolos y el alfabeto tiene 30—. Son **78,5 bits**. Si algún día
se quieren 80 de verdad son 17 caracteres (83,4 bits) y una línea.

**CN-044 · Contrastar los crates de Rust. ✅ Hecho.**

Se instaló `cargo-audit` y se corrió sobre los dos `src-tauri/`. **Resultado: cero
vulnerabilidades** en 441 crates (MotRest) y 419 (MOTRAE Central), contra 1 190
avisos de RustSec.

Sí salen **17 avisos de mantenimiento** en cada uno —`glib` (unsound),
`unic-ucd-ident`, `unic-ucd-version` (sin mantenimiento) y otros— y **ninguno es
una dependencia de MOTRAE**: entran por debajo de Tauri y de GTK. No se pueden
cerrar desde aquí; se cierran cuando Tauri los suba. No se silencian con un
`ignore` a propósito: el día que uno de ellos pase de «sin mantenimiento» a
«vulnerable», tiene que verse.

Automatizado en `.github/workflows/auditoria-semanal.yml`, que hasta ahora solo
auditaba npm. **npm y cargo son dos árboles distintos**: auditar uno no dice nada
del otro, y el que acaba corriendo en la caja del restaurante es el de cargo.

### ⚠ Una prueba que hubo que rehacer

La primera versión de la prueba del sesgo firmaba mil enlaces y comprobaba que el
reparto saliera plano. Pasaba —y **fallaba de vez en cuando** al correr toda la
suite en paralelo, por tiempo, no por el sesgo—. Una prueba que falla a veces es
peor que no tenerla: enseña a ignorar los fallos rojos.

Se rehízo por **enumeración completa**: los bytes posibles son 256, caben todos,
y con el descarte cada letra sale exactamente ocho veces (240 ÷ 30). Sin
márgenes, sin azar y en 27 ms. Para eso se exportó `aBase32`.

---

## ⚠️ Etapa 12 · Capacitor 8 *(APK compilado; falta la comprobación en tablet)*

**Hallazgo:** CN-027.

### Hecho en el árbol de trabajo

- `apps/kds-android/package.json` sube las tres juntas a `^8.4.2`, que el
  lockfile regenerado resuelve a **8.5.0**. Las tres deben avanzar a la vez.
- El proyecto Android generado quedó configurado localmente con los mínimos de
  Capacitor 8: `minSdkVersion = 24`, `compileSdkVersion = 36`,
  `targetSdkVersion = 36`, AGP 8.13.0, Gradle 8.14.3, Java 21 y los AndroidX/
  Cordova de la plantilla 8. La compilación real confirmó esos mínimos en el
  APK resultante.
- Se añadió `apps/kds-android/ajustar-android.mjs`. `android/` se ignora porque
  es generado: dejar estos cambios solo ahí habría hecho un APK correcto hoy y
  uno viejo al siguiente `cap add`. Ahora `sincronizar` y `apk` ejecutan el
  ajuste **después** de `cap sync`, que es cuando Capacitor reescribe el puente.
  Conserva además el modo cocina: horizontal, pantalla encendida, arranque al
  recibir `BOOT_COMPLETED` y los permisos de red/estado/arranque/wake lock.
- Se revisaron los dos saltos mayores. El KDS no importa APIs JavaScript de
  Capacitor ni plugins adicionales; tampoco configura los campos retirados
  `bundledWebRuntime`, `cordova.staticPlugins` ni
  `android.adjustMarginsForEdgeToEdge`. `MainActivity` solo extiende
  `BridgeActivity`, por lo que no referencia el recurso Android renombrado en
  8. Se añadieron `navigation` (cambio 7) y `density` (cambio 8) a
  `configChanges`: evitan que teclado/redimensionado recarguen el WebView.
- Se retiraron los overrides de `tar` y `brace-expansion`. La decisión está
  explicada también junto al override restante en `package.json`: la CLI 8.4.2
  ya declara `tar ^7.5.3`; su cadena actual de `rimraf`/`glob`/`minimatch`
  resuelve `brace-expansion ^5.0.8`. Conservar los techos antiguos `^7.4.3` y
  `^2.1.4` no añadía una defensa y el segundo retenía una línea vulnerable. Solo
  queda el override de `postcss`, que es ajeno al KDS.
- El script `apk` usa `cd android && .\\gradlew.bat assembleDebug`. En Windows
  el prefijo `.\\` es necesario: sin él, `cmd` no encontraba el wrapper aunque
  estuviera en el directorio generado.

### Desviación necesaria del plan

El plan pedía regenerar con `npx cap sync android`. Codex **no pudo escribir el
`pnpm-lock.yaml`** —su sandbox bloquea el registro de npm— y lo dijo en vez de
falsificarlo, que es lo correcto: un lock inventado habría dado un árbol que
parece 8 y sigue apuntando a 6.

**Eso se completó después, fuera de la sandbox**, y solo entonces se pudo
verificar lo que hasta ese momento era una suposición:

| Se afirmaba | Se verificó contra el lockfile |
|---|---|
| Capacitor `8.4.2` | resuelve **8.5.0** |
| `tar ^7.5.3` | **7.5.21** |
| `brace-expansion ^5.0.8` | **5.0.9** |

Con eso confirmado, retirar los overrides de `tar` y `brace-expansion` es
correcto: el de `^2.1.4` estaba **reteniendo una rama más antigua** que la que la
cadena resuelve por sí sola. Sin regenerar el lock, la retirada habría sido un
acto de fe — y con `frozen-lockfile=true` en `.npmrc`, un `package.json` que pide
8 contra un lock que dice 6 **rompe CI y no actualiza nada**.

### Una regresión que abrió esta etapa

`corepack pnpm@9.15.0 audit` completo dejó de estar limpio: Capacitor 8 arrastra
`@capacitor/cli@8.5.0 > xcode@3.0.1 > uuid@7.0.3` (GHSA-w5hq-g745-h8pq).

Se cerró con un override a `uuid ^11.1.1`. Es seguro: el único consumidor es
`xcode`, la herramienta de proyectos de iOS, que aquí **no se ejecuta jamás**
—el KDS es solo Android—. Se cierra en vez de anotarse porque la etapa 1 dejó la
auditoría **completa** limpia, y esa es la línea base: un aviso nuevo tiene que
doler, no acumularse.

El script de ajuste es la desviación deliberada que hace persistente la parte
nativa que Capacitor no migra solo. Debe viajar en el commit aislado junto con
el lock regenerado; no se mezcla con ninguna de las once etapas anteriores.

### Compilación real en esta máquina · 7 de agosto de 2026

Los bloqueos iniciales de sandbox se resolvieron con una sesión que puede leer
los ancestros del repositorio y consultar las fuentes oficiales de Android:

1. Se instalaron `platforms;android-36` y `build-tools;36.0.0` sobre el SDK ya
   existente. Se usó el JBR 21 de Android Studio y un `GRADLE_USER_HOME`
   aislado.
2. `corepack pnpm@9.15.0 --filter pos-ui build` y
   `corepack pnpm@9.15.0 --filter @motrest/kds-android apk` terminaron bien.
   El segundo comando sincronizó Capacitor 8, ejecutó el ajuste persistente y
   completó `assembleDebug` con Gradle 8.14.3.
3. El APK actual es
   `apps/kds-android/android/app/build/outputs/apk/debug/app-debug.apk`:
   5 502 480 bytes, SHA-256
   `DB4BBFC3FB70BAB60BC2724F2219A0E541F7989B77CCC3289CFFD9DBCF45C1C9`.
   `aapt` confirmó `mx.motrae.motrest.kds`, `minSdkVersion 24`,
   `targetSdkVersion 36`, orientación horizontal y los permisos esperados;
   `apksigner verify` confirmó la firma de depuración v2.
4. `corepack pnpm@9.15.0 -r lint` terminó sin errores y
   `corepack pnpm@9.15.0 -r test` terminó con **1 574 verdes y 1 omitida**.
5. No había una tablet autorizada por USB durante esta compilación (`adb devices`
   no mostró ningún dispositivo), por lo que ningún resultado automatizado
   reemplaza la prueba física pendiente.

### Antes de instalar en Rodizio: pendiente obligatorio en tablet física

Nada de lo siguiente está verificado todavía y no debe asumirse por tener el
código o las pruebas Node en verde:

- Que el APK 8 compile, instale y arranque en la tablet real; que el puente de
  Capacitor/WebView cargue el POS, conserve navegación y responda al tacto.
- Que el cambio de borde a borde de Android 15/16 no tape tickets, que el KDS
  siga horizontal y que `navigation`/`density` eviten una recarga al conectar un
  teclado o redimensionar una tablet grande.
- Que la conexión HTTPS al Hub y el tratamiento del certificado autofirmado se
  comporten como espera el restaurante en la red real.
- Que los permisos declarados, `keepScreenOn` y el receptor
  `RECEIVE_BOOT_COMPLETED` funcionen después de instalar, reiniciar y volver a
  abrir la tablet. No hay un permiso peligroso nuevo que deba mostrar diálogo,
  pero el comportamiento del sistema y del arranque sí requiere dispositivo.
- Que no aparezca una regresión de plugins nativos o del WebView aunque hoy no
  haya plugins adicionales declarados: la verificación debe ejercitar el puente
  que realmente empaca el APK, no solo sus archivos fuente.

### Continuación exacta en una máquina con red y Android SDK

```powershell
# Una vez, con Android Studio/JDK 21 y SDK 36 instalados.
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_SDK_ROOT = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_HOME = $env:ANDROID_SDK_ROOT
$env:GRADLE_USER_HOME = "$env:LOCALAPPDATA\MotRest\gradle"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_SDK_ROOT\platform-tools;$env:ANDROID_SDK_ROOT\cmdline-tools\latest\bin;$env:Path"
& "$env:ANDROID_SDK_ROOT\cmdline-tools\latest\bin\sdkmanager.bat" --licenses
& "$env:ANDROID_SDK_ROOT\cmdline-tools\latest\bin\sdkmanager.bat" "platforms;android-36" "build-tools;36.0.0"

# Desde la raíz: compila el POS que viaja dentro del KDS y genera el APK.
corepack pnpm@9.15.0 --filter pos-ui build
corepack pnpm@9.15.0 --filter @motrest/kds-android apk

# Repetir siempre después de regenerar dependencias.
corepack pnpm@9.15.0 -r lint
corepack pnpm@9.15.0 -r test
```

Después se instala `android/app/build/outputs/apk/debug/app-debug.apk` en la
tablet y se recorre la lista anterior antes de llevarlo al cliente.

---

## Verificación

Al terminar **cada** etapa:
```bash
corepack pnpm@9.15.0 -r test
corepack pnpm@9.15.0 -r lint
```

**Y la que de verdad cuenta — sobre el paquete compilado, no sobre el código.**
Es la que atrapó que «Gonz Motrae» no existía en producción con doce pruebas
verdes: el empaquetador elimina lo que nadie llama, y ninguna prueba lo detecta.

```bash
corepack pnpm@9.15.0 --filter pos-ui build
grep -a "MotRest.Inicio" apps/pos-ui/dist/assets/*.js    # etapa 3: debe estar ausente
grep -a "usr-marco"      apps/pos-ui/dist/assets/*.js    # demo: debe estar ausente

# Lo que entra al instalador es el installer.nsi, NO el árbol de compilación:
grep -oE 'oname=pos.assets.index-[A-Za-z0-9_-]+\.js' \
  $CARGO_TARGET_DIR/release/nsis/x64/installer.nsi        # exactamente uno
```

> `$CARGO_TARGET_DIR/release/pos` puede acumular bundles viejos de compilaciones
> antiguas y **engañar**. Tauri 2 lee directo de `apps/pos-ui/dist`.

---

## Notas de entorno

- **pnpm no está en el PATH.** Siempre `corepack pnpm@9.15.0`.
- **Compilar Rust fuera de `Documents`**: `CARGO_TARGET_DIR=C:/motrest-build`.
  Defender bloquea los objetos y falla con `os error 32`.
- No hay `semgrep`, `trivy`, `gitleaks` ni `cargo-audit` instalados.

---

## Fuera de alcance

| Punto | Motivo |
|---|---|
| Compra del certificado Authenticode | Trámite comercial. Todo lo demás cableado |
| Reserva del scope `@motrest` en npm | Requiere cuenta. El `.npmrc` ya está |
| Marketplace de comensales / funciones de red | PRD, «post-F4»: requiere masa crítica |
