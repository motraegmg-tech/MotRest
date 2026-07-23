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

### El 307, que es un éxito disfrazado de error

Ocurre cuando la conexión se corta después de que el PAC timbró pero antes de
que la respuesta llegara. Al reintentar, el PAC responde "CFDI previamente
timbrado" porque, en efecto, ese comprobante ya tiene UUID.

Tratarlo como fallo produce el peor desenlace posible: **una factura que existe
ante el SAT, que el restaurante no puede entregar, y un folio que se volvería a
usar.** La mayoría de los PAC devuelven el timbre existente junto al error;
cuando lo hacen, se toma y se da por timbrado. Cuando no, se marca para
recuperarlo del portal del PAC y se deja escrito que ese folio no se reutiliza.

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
  campo se cotejan contra la documentación del proveedor que se contrate.
- **Probar contra un entorno de pruebas real.** Todo lo de arriba está probado
  contra un PAC simulado y un servidor HTTP de verdad, pero el primer timbrado
  real es el que confirma el orden de la cadena original.
- **Emitir el evento de dominio** al timbrar, para que la factura quede en el
  registro del local y no solo en la cola.

## Alternativas descartadas

**Timbrar en el momento del cobro, y si falla, no facturar.** Es lo que hacen
varios sistemas y convierte cada caída de internet en un problema de mostrador.

**Que el PAC selle.** Menos código y entrega la firma fiscal del cliente a un
tercero. Disponible como respaldo, nunca por omisión.

**Cola en memoria con reintento en el proceso.** Más simple hasta el primer
apagón, que es justo el escenario que hay que soportar.
