# Relevo — tickets, propina posterior, QR y promociones

**Fecha:** 2026-08-15 · **Rama:** `feature/tickets-propina-y-qr`  
**Estado:** implementación terminada y verificada; falta probar físicamente los dos modos QR en la impresora de Rodizio y preparar el release.

## Qué se cambió

### 1. Pantallas y «Ver más»

- Se impidió que los hijos de `.seccion` se compriman hasta convertirse en barras.
- Se creó `VentanaAmplia.svelte` y se conectó a las listas recortadas de Inteligencia,
  Inventario, Personal y Ficha 360.

### 2. Dos papeles distintos

- **Imprimir cuenta** genera el ticket que recibe el cliente: ficha y RFC del local,
  textos configurables, renglones con impuesto incluido, rebajas, propina y hasta dos QR.
- Al terminar de cobrar se genera un **ticket interno** compacto: consumo, total, propina,
  formas de pago, cambio y línea de firma, sin mensajes comerciales ni QR.
- Reimprimir conserva el formato del cliente, lo marca como reimpresión y agrega pagos y
  cambio ya conocidos.
- Una cortesía total puede cerrar con $0, libera la mesa e imprime tanto el ticket del
  cliente como el interno, marcado `CORTESIA DE LA CASA`.

### 3. Propina después del cobro

- Si se cobra sin propina, la cuenta se cierra y la mesa se libera, pero el ticket interno
  espera una ventana obligatoria.
- La ventana permite registrar monto y forma de pago, o confirmar **No dejó propina**.
- Una propina posterior genera tanto el ajuste de propina como su pago, para que el corte
  siga cuadrando.
- La decisión pendiente se guarda en el estado local para sobrevivir a un reinicio.

### 4. QR impresos

- El QR de opinión vive en el ticket del cliente; ya no se enseña en una ventana al cobrar.
- Administración permite configurar un segundo QR libre con leyenda y URL, por ejemplo
  Google Maps, y muestra ambos códigos generados.
- Cada impresora puede usar QR nativo o QR dibujado como imagen raster.
- **Probar QR** imprime ambos modos en el mismo papel para elegir visualmente cuál lee el
  teléfono; no se intenta adivinar la capacidad del firmware.
- El portal admite abrir y calificar una cuenta desde el momento en que se imprime el
  ticket, aunque el cobro todavía no haya terminado. El enlace sigue firmado y caduca.

### 5. Promociones

- Una promoción puede mezclar varias categorías y productos específicos.
- Hay búsqueda de alimentos y bebidas, selección múltiple y vista previa del alcance.
- Las promociones existentes se pueden editar sin cambiar su identificador; también se
  conservan las acciones de encender, apagar y eliminar.

## Verificación ejecutada

- `corepack pnpm@9.15.0 --filter pos-ui lint` — 0 errores, 0 advertencias.
- `corepack pnpm@9.15.0 --filter pos-ui test` — 13 archivos, 123 pruebas aprobadas.
- `corepack pnpm@9.15.0 --filter @motrest/hub test` — 28 archivos, 374 aprobadas y 1 omitida.
- `corepack pnpm@9.15.0 --filter @motrest/impresion test` — 58 pruebas aprobadas.
- `corepack pnpm@9.15.0 --filter @motrest/impresion lint` — sin errores.
- `corepack pnpm@9.15.0 --filter @motrest/dominio test -- promociones` — 19 pruebas aprobadas.

## Antes de desplegar en Rodizio

1. En **Administración → Impresoras**, usar **Probar QR** en la BIXOLON.
2. Escanear los dos códigos del papel y guardar como modo de QR el que funcione.
3. Imprimir una cuenta real de prueba y confirmar datos, textos y los dos enlaces.
4. Cobrar una cuenta sin propina, otra con propina posterior y una cortesía total.
5. Verificar el corte de caja y después preparar un release completo de POS + Hub.

## Límite de este relevo

El árbol de trabajo ya contenía cambios ajenos de Relay, licencias y Central. No se
incluyeron ni se revirtieron; el commit de este relevo se limita a los archivos de las
cinco etapas descritas arriba.
