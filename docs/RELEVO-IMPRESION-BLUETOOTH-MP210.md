# Relevo — La MP210 de Rodizio y la impresión por Bluetooth

**Fecha:** 21-ago-2026 · **Estado:** código corregido y verificado; **falta aplicarlo en Rodizio**.

Este documento cierra el diagnóstico de por qué la impresora de cocina de Rodizio
«no conecta ni funciona bien», recoge lo que quedó implementado y deja escrito lo
que todavía hay que hacer **en sitio**, que no se pudo hacer porque la sesión se
quedó sin acceso a la caja.

---

## 1. Qué le pasa a la MP210

La impresora es una **YAEN MPT-II** (nombre comercial MP210), térmica de
**Bluetooth**, emparejada con la caja de Rodizio (`GONZALITO`, `192.168.100.21`)
en la dirección `DC0D5112F2DC`. Windows le asignó el puerto serie **COM5**.

No era un fallo de la impresora. Eran tres cosas encadenadas.

### 1.1 El enlace funciona

Comprobado en vivo el 20-ago-2026 contra la caja:

| Prueba | Resultado |
|---|---|
| Abrir `COM5` | **abre en 451 ms** |
| Escribir 56 bytes ESC/POS directos | **sin error, búfer vacío** |
| Emparejamiento Bluetooth | correcto, COM5 apunta a `DC0D5112F2DC` |

O sea: la impresora estaba encendida, al alcance y aceptando datos. El problema
estaba del lado de Windows y de MotRest.

### 1.2 La cola de Windows estaba atascada, y tapada

Había una cola de impresión `MP210 Cocina` sobre `COM5` con el controlador
genérico de texto. Su estado era **`Error`**, y dentro:

```
20 trabajos detenidos
  · el más viejo: 16-ago-2026 18:43
  · el de cabeza: «Error, Printing, Retained» desde el 20-ago 15:30
  · el más nuevo: 20-ago-2026 21:47
```

Un trabajo en cabeza que se queda en «Imprimiendo» **tapa la cola entera**. Desde
al menos el 16 de agosto no salió un solo papel por esa impresora.

Causa raíz: **una térmica Bluetooth de batería se duerme.** Cuando el monitor de
puerto del spooler intenta abrir el COM y la impresora está dormida, el trabajo
entra en error — y el spooler **no se recupera solo** de eso. Enrutar una
impresora Bluetooth por una cola de Windows es frágil por diseño.

### 1.3 Y MotRest decía que sí había impreso

Esto es lo grave, y es un defecto nuestro.

`apps/hub/src/impresion/transporte-usb.ts` comprobaba el estado de la impresora
antes de entregar el trabajo — precisamente para no cantar «impreso» sobre una
comanda que nadie va a recoger. Pero solo rechazaba un estado:

```powershell
if ($info.PrinterStatus -eq "Offline") { throw "La impresora esta fuera de linea" }
```

La cola de la MP210 estaba en **`Error`**, no en `Offline`. No coincidía, así que
el trabajo se entregaba, el spooler lo aceptaba, y el POS lo marcaba como
impreso. **20 comandas perdidas en silencio durante cuatro días.** Es exactamente
el fallo que ese bloque existía para evitar, colándose por el único hueco que le
quedaba.

---

## 2. Qué había hecho Gemini

Gemini trabajó el 20-ago entre las 22:13 y las 22:22 y dejó, sin commitear:

| Archivo | Qué hizo |
|---|---|
| `apps/hub/src/impresion/transporte-bluetooth.ts` | Transporte nuevo: escribe al COM directo, sin spooler |
| `apps/hub/src/main.ts` | Rama `modo: "bluetooth"` en `/imprimir` |
| `apps/pos-ui/src/lib/impresion.svelte.ts` | `puede()` acepta `conexion === "bluetooth"` |
| `apps/pos-ui/src/lib/modulos/admin/Impresoras.svelte` | Opción «Bluetooth» y campo de puerto COM |
| `apps/hub/dist-sea/` + `escritorio/src-tauri/binarios/` | Recompiló el binario del Hub |

**La decisión de fondo era correcta:** saltarse el spooler y hablarle al puerto
COM directamente es justo lo que las mediciones de arriba respaldan. Estaba
cableado de punta a punta, pasaba `tsc` y no rompía ninguna prueba.

Lo que le faltaba está en la sección siguiente.

---

## 3. Qué se corrigió

### 3.1 La comanda partida a la mitad — `transporte-bluetooth.ts`

El transporte cerraba el puerto justo después de escribir:

```powershell
$serial.Write($bytes, 0, $bytes.Length)
} finally { $serial.Close() }
```

`Write` solo deja los bytes en el búfer de salida; quien los saca por el aire es
el enlace RFCOMM, **después**. Cerrar ahí descarta lo que no salió, y el síntoma
es una comanda con encabezado y sin platillos — que en la cocina parece un pedido
completo. Ahora se espera a que el búfer se vacíe (tope de 8 s), se comprueba, y
se da un margen de 300 ms antes de cerrar. Si la impresora se apagó a media
comanda, **lo dice** en vez de fingir.

También se fija `Handshake = 'None'` explícitamente: un control de flujo heredado
deja la escritura esperando un CTS que una impresora Bluetooth nunca levanta.

### 3.2 El fallo silencioso — `transporte-usb.ts`

La comprobación de estado ya no mira un solo valor. Hay una lista de los estados
en los que **no va a salir papel** (`ESTADOS_DETENIDOS`), y el mensaje de error
nombra el estado real para poder actuar sin adivinar.

Es lista negra y no blanca a propósito: una impresora ocupada, calentando o a
media página **sí** va a imprimir, y rechazarla por un estado pasajero dejaría a
la cocina sin comanda por nada.

> **Trampa:** una clave mal escrita no da error, simplemente no coincide — y
> devuelve el fallo silencioso. Por eso la lista es una constante de TypeScript,
> y una prueba la contrasta contra `[Enum]::GetNames` del Windows que corre la
> prueba. `UserIntervention` **no** se llama `UserInterventionRequired`; se
> escribió mal en el primer intento y la prueba lo cazó.

### 3.3 Elegir el puerto a ciegas — detección de puertos Bluetooth

La pantalla obligaba a teclear `COM4`. En la caja de Rodizio hay **cuatro**
puertos COM de Bluetooth (COM3–COM6) y solo uno es la impresora: dos son puertos
de entrada que Windows crea solos y otro es de otro aparato. En el administrador
de dispositivos los cuatro se llaman igual, «Serie estándar sobre el vínculo
Bluetooth (COMn)», sin decir a qué aparato va cada uno.

Se añadió `puertosBluetooth()`, que cruza el `PortName` del registro con el
aparato emparejado y devuelve **puerto + nombre**. Salen en la misma lista de
«Detectar y conectar», y la ficha ofrece un desplegable en vez de un campo libre.

Dos detalles que costaron:

- Buscar 12 dígitos hexadecimales en la ruta del registro **no sirve**: el GUID
  del servicio SPP termina en `00805F9B34FB` y gana siempre. La dirección hay que
  sacarla del segmento anterior a `Device Parameters`.
- Unos audífonos Bluetooth **también** exponen puerto serie. Sin filtro, la lista
  de impresoras de cocina ofrecía «JBL Flip 5». Se usa la clase de dispositivo
  Bluetooth (clase mayor 6 = Imagen, con el bit `0x20` de impresora) para ponerlas
  primero y agrupar el resto al final. La MP210 declara `0x040680`, así que sale
  identificada como impresora.

### 3.4 Un defecto preexistente, de paso — `buscador.ts`

El `return` final de `buscarImpresoras` **omitía `sinCola`**. Con el barrido de
red activado —que es como entra la pantalla de «Detectar y conectar»— una
impresora enchufada a la que Windows no le creó la cola **desaparecía de la
lista**. Es decir, el caso para el que se escribió `puertosSinCola` (la BIXOLON
de Rodizio, ago-2026) solo se veía por el camino que la pantalla no usa. Corregido.

### 3.5 Otros

- **Pruebas:** el transporte Bluetooth no tenía ninguna. Ahora tiene
  `transporte-bluetooth.test.ts`, y `transporte-usb.test.ts` cubre la lista de
  estados. Total: **1955 pruebas en verde**, 0 fallos.
- **Validación del puerto:** `startsWith("COM")` daba por bueno «COMANDA».
  Ahora es `esPuertoValido`, con el rango real de Windows (COM1–COM256).
- **Identidad en la pantalla:** `claveDe()` mandaba toda impresora no-USB a la
  rama de red, así que **todas** las Bluetooth compartían la clave
  `red:undefined:undefined` — marcar áreas en una las marcaba en todas.
- **Binario del Hub:** el que dejó Gemini ya no correspondía al código. Se
  reempaquetó (`dist-sea` y `escritorio/src-tauri/binarios` con el mismo SHA-256),
  conservando las dos llaves públicas y `motraegmg-tech/MotRest`.

---

## 4. Lo que FALTA hacer en la caja de Rodizio

> Nada de esto está aplicado. Rodizio sigue con **MotRest 1.3.3** y con la cola
> atascada. Requiere volver a entrar por SSH — ver
> [`SOPORTE-Y-ACCESO-REMOTO.md`](SOPORTE-Y-ACCESO-REMOTO.md).

### 4.0 El acceso está cerrado (21-ago-2026)

La caja cambió de red: ahora está en **LeoNet**, `10.0.230.69`, en un `/19`
compartido con muchos equipos. Se confirma que es ella porque el link-local
`fe80::6170:f57e:6f79:357b` coincide con el de la sesión anterior — se deriva de
la MAC, así que es huella de hardware (`20-0B-74-64-EB-0A`).

**Responde al ping y tiene TODOS los puertos cerrados** (22, 135, 139, 445, 3389,
5985, 80, 443, 8787). Son las dos cosas de siempre juntas: `sshd` quedó apagado
al cerrar el soporte anterior, y Windows clasificó la red nueva como «Pública»,
que bloquea todo lo entrante — incluido el 8787 del propio Hub, así que las
tabletas del local tampoco lo alcanzan desde el wifi.

Se resuelve **en la caja**, con `entregables/ABRIR-ACCESO-RODIZIO.ps1` en
PowerShell como administrador (sirve por AnyDesk, que está instalado). Reinstala
la llave de soporte, enciende `sshd` y abre 22 y 8787 en todos los perfiles.

### 4.1 Vaciar y retirar la cola `MP210 Cocina`

Las 20 comandas encoladas son de entre el 16 y el 20 de agosto: imprimirlas ahora
sería sacar decenas de pedidos viejos por la impresora de cocina. Hay que
**purgarlas**, no liberarlas.

```powershell
Remove-PrintJob -PrinterName 'MP210 Cocina' -ErrorAction SilentlyContinue
# y si sigue trabada, reiniciar el spooler antes de purgar:
#   Stop-Service Spooler; Start-Service Spooler
Remove-Printer -Name 'MP210 Cocina'
```

Se **retira** la cola a propósito: con el transporte nuevo MotRest le habla al
COM5 directamente y la cola solo puede volver a atascarse. Que ya no exista evita
además que alguien la reconfigure sin querer.

### 4.2 Actualizar a 1.3.4 y reconfigurar la impresora

1. Construir el instalador con `pnpm --filter escritorio build` — **nunca**
   `build:solo-caja`, que no reconstruye lo que empaqueta.
2. Instalar en la caja siguiendo
   [`INSTALAR-EN-UN-RESTAURANTE.md`](INSTALAR-EN-UN-RESTAURANTE.md): respaldo **fuera** de
   `C:\Users\ironm\AppData\Local\MotRest\`, y arrancar el Hub desacoplado con
   `Invoke-CimMethod Win32_Process Create` — un `Start-Process` por SSH muere al
   cerrar la sesión y deja el local sin servicio, sin ningún error en el log.
3. En Administración → Impresoras: **borrar** la ficha `MP210 Cocina` (conexión
   USB) y volver a darla de alta con **Detectar y conectar**. Debe aparecer como
   «MP210 · Impresora emparejada por Bluetooth (COM5)».
4. **Marcarle sus áreas.** Una impresora sin área no imprime nada.
5. Imprimir una prueba y **mirar que salga el papel**.

### 4.2 bis Lo que va DENTRO de esa 1.3.4 (nuevo, 21-ago-2026)

Además de la impresión Bluetooth, la versión que hay que instalar lleva:

- **Corte de caja por fechas** (Finanzas → «Corte por fechas»). Vuelve a sacar el
  corte de un día pasado o junta varios días en un papel: fondo inicial, ingresos
  por forma de pago —efectivo y transferencia separados—, venta del negocio,
  gastos por categoría, transacciones, esperado contra declarado y el resumen de
  cada turno con su folio. Atajos de hoy / ayer / hace 2 días / últimos 3 / últimos 7.
  Se ve en pantalla antes de gastar papel.
  - No sella: el sello es del arqueo del turno. El papel lo dice.
  - Si dentro del rango hay un turno sin cerrar, sale marcado como **provisional**
    y ese turno **no** aporta al arqueo — contarlo como declarado cero convertiría
    todo el efectivo del turno en curso en un faltante, o sea en una acusación.
- **Orientación viva y menú plegable** (`lib/nav/orientacion.svelte.ts`). El POS
  detecta si se trabaja de pie o acostado y **reacciona al giro en pleno
  servicio**. En vertical el menú de módulos deja de ocupar sitio: se convierte en
  un cajón que entra por la izquierda, con el botón de tres rayas arriba a la
  izquierda. Se cierra al navegar, con Escape o tocando fuera.
  - Se dispara por `orientation: portrait` **o** por ancho < 900 px, para cubrir
    también una ventana angosta en un monitor apaisado.

### 4.2 ter Por qué las tabletas no mostraban a todo el personal (RESUELTO)

Diagnosticado en la caja el 21-ago-2026, con el registro del Hub en la mano.

**El Hub de Rodizio conocía UN solo usuario: Gonzalo Sanchez.** Todo lo demás
rebotaba. Del log de un solo día:

```
3672  Empleado desconocido: usr-019ff411-e6aa-7aac-bb99-c701f36a479f
 108  Empleado desconocido: usr-019ff413-05bc-7923-b924-0d647e0e0d9e
 108  Empleado desconocido: sistema
 108  Gonzalo Sanchez intentó otorgar permisos que no posee
```

El cuarto renglón es la causa; los tres primeros son la consecuencia. Las
tabletas se sincronizan **del Hub**, así que mostraban lo único que el Hub tenía.

**El candado, cerrado sobre sí mismo:**

1. `usuario_creado` materializa la lista de permisos dentro del propio evento.
   El usuario de Gonzalo se dio de alta con las acciones que existían entonces.
2. Versiones posteriores añadieron acciones al catálogo. Él siguió con las suyas.
3. Al dar de alta a alguien, la plantilla del rol trae las de **hoy**.
4. El Hub compara y rechaza: «intentó otorgar permisos que no posee».
5. Y no se puede salir desde dentro — nadie puede concederse lo que no tiene,
   ni el dueño. Cada alta de personal llevaba semanas rebotando en silencio.

**El arreglo** (decidido por Gonzalo el 21-ago-2026, va en la 1.3.4): el
**propietario** otorga según la plantilla de su ROL, no según la lista congelada
al crearlo — `permisoParaOtorgar` en
[`packages/dominio/src/identidad/matriz.ts`](../packages/dominio/src/identidad/matriz.ts).

Acotado al rango más alto a propósito. Para cualquier otro rol, una diferencia
entre lo guardado y la plantilla **sí** puede ser una decisión deliberada de su
superior —a este gerente no le doy cancelaciones— y respetarla es justo el
sentido de la lista guardada. No abre ninguna escalada: `rolesAsignablesPor`
sigue impidiendo crear a un igual o a un superior, y el propietario ya podía
otorgar todo lo que su plantilla concede. Hay seis pruebas que lo fijan, tres de
ellas dedicadas a comprobar lo que **no** debe pasar.

**Tras instalar:** volver a dar de alta al personal que no llegó, o dejar que las
terminales reenvíen sus eventos. Comprobar que el log deja de acumular
«Empleado desconocido».

### 4.3 Comprobar dos cosas que se vieron de paso

- **Dos `motrest-hub.exe` corriendo.** RESUELTO el 21-ago: no es un empate, es
  un redundante. El que **sirve el 8787** es el que lanza el VBS de arranque
  (`HKCU\…\Run\MOTRESTHUB`) al encender la máquina; su padre ya no existe, que es
  lo normal en un proceso desacoplado. El segundo es el sidecar que abre
  `motrest.exe` al arrancar la ventana, y **no consigue el puerto** porque ya está
  tomado: se queda dando vueltas sin servir a nadie. Al desplegar hay que parar
  los dos y dejar uno.
- **`Permiso denegado … Empleado desconocido`.** RESUELTO: era el candado de
  permisos de §4.2 ter, no un problema de sincronización.

### 4.4 La red del local aísla clientes en IPv4

La caja está en **LeoNet** (`10.0.230.69`, un `/19` compartido). Desde otro
equipo de la misma red:

```
ping            -> responde
22, 8787 IPv4   -> cerrados
22, 8787 IPv6   -> ABIERTOS
```

No es el firewall de Windows: es **aislamiento de clientes en IPv4** del propio
punto de acceso. El Hub escucha en `::` (doble pila), así que por IPv6 sí se
alcanza — y por ahí se hizo todo el soporte de ese día.

**Importa para el local, no solo para el soporte:** si las tabletas hablan al Hub
por IPv4, en esta red no lo alcanzan por mucho que MotRest esté bien. Antes de
culpar al software en un sitio nuevo, comprobar si el punto de acceso aísla.

---

## 5. Lo que sigue sin resolver

- **`ok` no significa «salió el papel».** Por Bluetooth ahora significa «el
  enlace aceptó los bytes y el búfer se vació», que es bastante más de lo que
  daba el spooler, pero sigue sin ser un acuse de la impresora. Cerrarlo del todo
  exigiría leer el estado por ESC/POS (`DLE EOT`), que no todas las térmicas
  baratas contestan.
- **Nada está commiteado.** Los cambios de Gemini y estas correcciones están en
  el árbol de trabajo, sobre `feature/video-promocional-motrest`, mezclados con
  trabajo anterior sin commitear. Antes de publicar la 1.3.4 hay que separarlos
  en su propia rama.
- **El Hub sale sin firmar** (falta `MOTREST_FIRMA_HUELLA`). Es lo normal hoy:
  MOTRAE aún no compró el certificado.
