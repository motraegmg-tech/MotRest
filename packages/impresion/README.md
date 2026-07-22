# @motrest/impresion

ESC/POS: generación de bytes, plantillas versionadas, sello del corte y cola con
reintentos (TRD §8, ADR-08).

Lo de aquí es **isomorfo**: genera los bytes y administra la cola igual en el
navegador, en Tauri y en el Hub. El transporte real —abrir un socket al puerto
9100, hablar por USB— vive fuera, porque depende de la plataforma.

## Dos reglas que gobiernan el diseño

**Imprimir nunca bloquea la venta.** Encolar es instantáneo. Si no hay impresora
configurada, el POS sigue funcionando y lo dice: un local puede operar solo con
el KDS, sin papel (métrica F1 del PRD §9).

**La cola reintenta y no pierde trabajos.** Una impresora se queda sin papel, se
atasca o alguien la desconecta a media noche de viernes. Si un fallo perdiera la
comanda, el platillo no se prepararía. Tras cinco intentos el trabajo queda
*fallido y visible* para reimprimirlo a mano; lo que nunca se pierde es el
evento de venta, que ya está en el log.

## Codificación

**CP437**, no UTF-8. Es lo que traen de fábrica prácticamente todas las térmicas
del mercado mexicano. Mandarles UTF-8 produce basura donde van los acentos, y un
ticket que dice `Jamon serrano` o `Pi?a` es un ticket mal impreso.

Lo que no existe en CP437 se degrada a su letra sin acento antes de perderse
como un signo de interrogación: vale más `Cafe` que `Caf?`.

## Plantillas

| Documento | Qué lleva y qué no |
|---|---|
| **Comanda** | Tipografía grande, **sin precios** —a la cocina no le sirven— y las notas resaltadas: son alergias y "sin cebolla", lo que más caro cuesta pasar por alto. |
| **Ticket** | Datos fiscales del local, desglose de impuestos, descuentos aplicados (el comensal tiene derecho a verlos) y QR de autofactura. |
| **Corte** | Ventas por forma de pago, efectivo esperado contra declarado, y el **sello**. |

La versión de plantilla viaja en el documento: un ticket es un comprobante, y si
mañana cambia el formato hay que poder saber con cuál se imprimió el que un
comensal trae en la mano tres semanas después.

## El sello del corte

Una huella SHA-256 de las cifras del corte, en 16 caracteres agrupados de cuatro
en cuatro para que una persona pueda cotejarla a ojo entre el papel y la
pantalla.

Qué es y qué **no** es, para no venderlo como lo que no:

- **Sí** detecta que las cifras cambiaron después del cierre. Un corte impreso
  sin sello es una hoja que cualquiera puede rehacer con otros números.
- **No** impide que alguien con acceso al sistema genere un corte falso desde el
  principio. Para eso hace falta una firma con llave privada, que llega cuando
  el Hub tenga su propio par de llaves.

## Pendiente (etapa 12)

El transporte real. Hoy `TransporteSimulado` registra en vez de imprimir, y la
vista previa hace las veces de papel — en el navegador no se puede abrir un
socket TCP al puerto 9100. Con el empaquetado Tauri llega el acceso a la red y
al USB; la cola y las plantillas ya están listas para él.
