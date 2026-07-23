# ADR-20 — Timbrado: sellar aquí, timbrar allá, y una cola en medio

**Estado:** aceptado · **Fecha:** 2026-07-23 · **Fase:** F2

## Contexto

Una factura mexicana necesita dos firmas: el **sello** del contribuyente, con su
CSD, y el **timbre** de un PAC, que es el único autorizado a certificarla ante
el SAT.

Eso choca de frente con el requisito que manda en este producto: el restaurante
tiene que poder vender sin internet. Timbrar exige conexión; cobrar, no.

Hay un dato que salva la situación: **el SAT da 72 horas** para timbrar un
comprobante desde su fecha de emisión. Ese margen es el que hace posible todo lo
que sigue.

## Decisión

**Sellar es local e inmediato. Timbrar es diferido y reintentable.**

Al cobrar, la caja sella el comprobante con el CSD del restaurante —eso no
necesita red— y lo mete en una cola. El timbrado ocurre cuando haya conexión.
El comensal se lleva su ticket; la factura llega cuando llega.

### El CSD no sale del restaurante

Se sella localmente y el PAC solo timbra. La alternativa —mandarle el CSD al PAC
para que él selle— es más cómoda de programar y significa entregarle a un
tercero la firma fiscal del cliente. Se rechaza como opción por omisión.

Queda disponible como respaldo configurable, que fue lo que se decidió: *local,
con el PAC como respaldo*.

### El PAC es un contrato, no una integración

Hay una docena de PAC en México y el restaurante puede cambiar por precio o por
servicio. Atar el sistema a uno sería atar al cliente.

Todo lo que decide si se factura o no —la cola, los reintentos, la clasificación
de errores— es independiente del proveedor. Lo específico vive en un solo objeto
de mapeo. Cambiar de PAC es reescribir ese objeto, no migrar.

## Lo que de verdad importa: entender la respuesta

Enviar la petición es lo fácil. Un error del PAC puede significar tres cosas muy
distintas y confundirlas cuesta caro:

| Clase | Qué es | Qué se hace |
|---|---|---|
| **Reintentable** | Sin internet, PAC caído, tiempo agotado, código desconocido | Se guarda y se reintenta con espera creciente |
| **Rechazado** | Sello inválido, CSD revocado, RFC no registrado | Se detiene y se avisa: hace falta una persona |
| **Ya timbrado** | El 307 | Ver abajo |

Reintentar un rechazo definitivo no lo arregla y además **quema saldo de
timbres**, que se compran por paquete. Descartar un error pasajero, en cambio,
pierde una factura. Ante la duda se reintenta: una factura que tarda se entrega
tarde; una descartada por error, nunca.

### El 307: la factura existe, hay que ir por ella

Ocurre cuando la conexión se corta después de que el PAC timbró pero antes de
que la respuesta llegara. Al reintentar, el PAC responde "CFDI previamente
timbrado" porque, en efecto, ese comprobante ya tiene UUID.

Tratarlo como fallo produce el peor desenlace posible: **una factura que existe
ante el SAT, que el restaurante no puede entregar, y un folio que se volvería a
usar.**

Es su propio estado —ni éxito, ni reintento, ni rechazo— porque exige una
respuesta distinta de las tres: **no hay que timbrarla, hay que traerla.**

El sistema lo resuelve solo, en tres escalones:

1. **El timbre viene con el error.** La mayoría de los PAC lo devuelven junto al
   307. Se toma y se acabó, sin una llamada de más.
2. **No viene: la factura cambia de modo.** Deja de estar "por timbrar" y pasa a
   "por recuperar". A partir de ahí el sistema ya no pide timbrado —solo daría
   más 307 y gastaría saldo— sino que le pide al PAC el CFDI que ya emitió,
   buscándolo por serie, folio, RFC y total, que es lo único identificable
   cuando el UUID es justo lo que falta.
3. **El PAC tarda en verlo.** Su índice de búsqueda suele demorar unos segundos
   sobre lo recién timbrado, así que "no lo encuentro" se trata como pasajero y
   se reintenta con la misma espera creciente. Tras diez intentos —varias horas—
   se deja de insistir y se llama a una persona, con instrucciones concretas.

El resultado práctico: el caso que antes acababa en "búscala en el portal de tu
PAC" ahora se resuelve sin que nadie se entere, y la pantalla lo muestra como
**Recuperando**, no como problema. Solo escala a una persona cuando el PAC no
ofrece consulta o cuando de verdad no la devuelve.

Un detalle que parece menor y no lo es: **el reintento manual conserva el modo
de recuperación**. Volver a mandarla a timbrar sería pedirle al PAC que timbre
algo que ya timbró.

## Cómo llega una venta a la cola

La caja **no le pide al Hub que selle**. Emite el hecho —«se generó este
comprobante»— y el Hub reacciona a él. La dirección importa:

- El comprobante entra al event log **antes** de sellarse, así que sobrevive a
  que el Hub se apague en medio.
- Una tablet que factura desde el piso no necesita saber que existe un CSD ni
  dónde está.
- Reproducir el log reconstruye exactamente las mismas facturas, que es la
  premisa de todo el sistema (ADR-02).

El Hub **barre** en vez de atender una notificación, porque el orden real no es
el ideal: un restaurante puede operar semanas antes de cargar su CSD. Esos
comprobantes se acumulan y hay que sellarlos todos el día que llegue el
certificado. Un barrido que **avanza su marca solo cuando consigue sellar**
resuelve ese caso y el normal con el mismo código — y si no hay CSD, la marca no
se mueve, de modo que nada queda saltado.

Se dispara al arrancar el Hub, cada vez que llega un comprobante nuevo, y justo
después de instalar un CSD.

Un detalle deliberado: **si falla el sellado de uno, el barrido se corta ahí**.
Seguir adelante dejaría un hueco silencioso —una venta cobrada sin factura y sin
nadie enterado—, que es peor que detenerse y avisar.

## Detalles que sostienen todo esto

- **La cola vive en SQLite, no en memoria.** El caso a resolver es el corte de
  luz; una cola en memoria se pierde exactamente en ese momento.
- **Se reintenta el MISMO XML**, con el mismo sello y el mismo folio. Generar
  uno nuevo produciría dos comprobantes para una venta.
- **`INSERT OR IGNORE` al encolar.** Reencolar una orden sobrescribiría el XML
  de una factura que quizá ya se timbró.
- **Espera creciente con tope**, de un minuto a media hora. Sin crecimiento, un
  PAC caído recibiría un intento por minuto por factura durante todo el turno;
  sin tope, la cola se dormiría cuando el servicio vuelva.
- **Aviso a las 24 horas.** El SAT da 72; avisar a las 24 deja margen para
  resolverlo en horario hábil, cuando se puede llamar al PAC o al contador.
- **El timbre se lee del XML**, no de los campos sueltos que cada PAC devuelve a
  su manera. El XML timbrado *es* el documento fiscal.
- **Reencolar un rechazo es manual.** Automatizarlo dejaría al sistema
  reintentando en círculo el error que una persona tiene que resolver.

## Lo que falta

- **Elegir PAC.** Es una decisión comercial, no técnica: precio por timbre,
  saldo mínimo y calidad del soporte. El adaptador está listo; sus nombres de
  campo se cotejan contra la documentación del proveedor que se contrate. Al
  elegir, **exigir que ofrezca consulta de CFDI ya timbrados**: es lo que hace
  automática la recuperación descrita arriba.
- **Probar contra un entorno de pruebas real.** Todo lo anterior está probado
  contra un PAC simulado y un servidor HTTP de verdad, incluida la verificación
  de que el sello corresponde a la cadena original del comprobante. Lo que solo
  el primer timbrado real confirma es que el **orden** de esa cadena coincide
  con el que recalcula el PAC.
## El desenlace vuelve a la caja

El folio fiscal no sirve encerrado en la base del Hub: la caja necesita saber
que la factura salió para entregársela al comensal, y necesita enterarse de un
rechazo sin que alguien abra la pantalla de facturación a buscarlo.

Por eso, al resolverse una factura, el Hub anexa `cfdi_timbrado` o
`cfdi_rechazado` **al event log**. De ahí se replica a todas las terminales y
queda en la bitácora, igual que cualquier otro hecho del negocio.

Tres detalles que lo sostienen:

- **`publicado` en disco.** Un Hub que se apaga entre timbrar y publicar, al
  volver, anota el hecho una sola vez. Sin esa marca, cada ciclo anexaría el
  mismo hecho con otro id y la factura aparecería repetida.
- **Lo firma el sistema, no una persona.** Timbrar ocurre solo, minutos u horas
  después del cobro y quizá con el local cerrado. Atribuirlo a quien facturó
  sería escribir en la bitácora algo que esa persona no hizo.
- **Vuelve a la sucursal de origen.** El Hub no tiene una propia —la declaran
  los dispositivos—, así que la del comprobante viaja con él en la cola.

## Alternativas descartadas

**Timbrar en el momento del cobro, y si falla, no facturar.** Es lo que hacen
varios sistemas y convierte cada caída de internet en un problema de mostrador.

**Que el PAC selle.** Menos código y entrega la firma fiscal del cliente a un
tercero. Disponible como respaldo, nunca por omisión.

**Cola en memoria con reintento en el proceso.** Más simple hasta el primer
apagón, que es justo el escenario que hay que soportar.
