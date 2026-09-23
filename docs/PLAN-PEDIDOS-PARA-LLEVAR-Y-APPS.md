# Plan — Pedidos para llevar y de apps de reparto

**Estado:** propuesta, **pospuesta** · **Fecha:** 2026-09-23 · **Pidió:** Gonzalo (MOTRAE)

> Decisión del 23-sep-2026: «lo de las apps de delivery lo vamos a dejar para más
> adelante». Este documento guarda el plan y las preguntas que hay que contestar
> antes de construir, para retomarlo sin empezar de cero.

## Lo que se pidió

En **Venta**, poder abrir «mesas» que en realidad no son mesas: pedidos **para
llevar** (mostrador), y pedidos de **apps de reparto** (Rappi, DiDi, Uber Eats),
como un submódulo completo.

## Lo que ya existe (y nunca se conectó)

El dominio ya tiene casi todo el modelo. Lo que falta es la caja.

| Pieza | Dónde | Estado |
|---|---|---|
| Canal de una cuenta: `salon`, `para_llevar`, `domicilio_propio`, `rappi`, `uber_eats`, `didi` | `packages/dominio/src/ventas/canales.ts` | Hecho |
| El canal y la comisión congelada viajan en `orden_creada` (`canal`, `comision_canal`) | `packages/dominio/src/comanda/eventos.ts` | Hecho, **nadie lo llena** |
| Ventas por canal, bruto / comisión / neto | `ventasPorCanal()` | Hecho |
| Lo que deben las apps, y lo vencido según los días pactados | `porCobrarDeAgregadores()` | Hecho |
| «Ya depositó» | campo `depositado` en `EstadoComanda` | **Sin evento que lo marque** |
| Configuración de comisiones y días de depósito por app | Finanzas → «Canales y apps» (`finanzas/Canales.svelte`) | Hecho |
| Nombre y teléfono de quien pide | evento `orden_identificada` | Hecho, se imprime en los tres papeles |
| Kiosco de autoservicio (pedir y pagar antes de cocina) | `packages/dominio/src/ventas/kiosco.ts` | Dominio hecho |

**Consecuencia hoy:** como la caja nunca le pone canal a una cuenta, todo cuenta
como salón y el reporte de «Canales y apps» sale vacío.

## Cómo se armaría

Una pestaña **«Pedidos»** en Venta, junto a «Salón». Cada pedido es una **mesa
virtual**: una cuenta con `mesa_id` propio que no está en el plano. Así hereda
todo lo que ya funciona en las mesas —capturar, mandar a cocina, descuentos,
cortesías, cobro, impresión— sin reescribirlo.

### Funciones

1. **Alta de pedido («+ Pedido»).** Tipo: Para llevar · A domicilio (reparto
   propio) · Rappi · Uber Eats · DiDi (solo las apps activadas en Finanzas).
   Datos: nombre, teléfono, notas. En apps: **folio de la plataforma** y hora de
   recolección. En domicilio: dirección, referencias y costo de envío.
2. **Tablero de pedidos.** Tarjetas por estado: Nuevo → En cocina → Listo →
   Entregado / Recogido. Color y logo por canal, reloj desde que entró y aviso si
   se pasa de la hora prometida. Filtro por canal.
3. **Cocina (KDS).** La comanda muestra el canal y el folio en grande
   («RAPPI #4821 · Juan»). Al marcarse lista avisa en la caja.
4. **Cobro según el canal.**
   - Para llevar y domicilio propio: cobro normal, también por adelantado.
   - Apps: lo cobra la plataforma. **No entra al cajón** (el corte cuadra), nace
     como «por cobrar» con la comisión congelada, y descuenta inventario igual.
5. **Conciliación de depósitos.** Marcar lo que depositó cada app y ver la
   diferencia contra lo esperado. Falta el evento (p. ej. `deposito_de_agregador`).
6. **Reparto propio.** Asignar repartidor, salida y regreso, el cambio que lleva,
   y corte por repartidor.
7. **Cancelaciones de la app** después de preparar: se registran como merma con
   motivo.
8. **Cliente frecuente por teléfono.** Historial y direcciones guardadas, sobre el
   módulo de Clientes que ya existe.
9. **Etiqueta para la bolsa** con nombre, folio y canal.
10. **Reportes por canal:** ventas, neto después de comisión, tiempos de
    preparación y cancelaciones.

### Fases propuestas

| Fase | Qué entra |
|---|---|
| 1 | Pestaña «Pedidos», alta con canal, tablero, cocina con canal/folio, cobro por canal (agregador fuera del cajón), reportes que ya existen empiezan a llenarse |
| 2 | Conciliación de depósitos, cancelaciones como merma, etiqueta de bolsa |
| 3 | Reparto propio completo (repartidores, corte), cliente frecuente por teléfono |
| 4 | Integración directa con las APIs de las plataformas (requiere convenio con cada una) |

## Preguntas que hay que contestar antes de construir

1. **Precios en apps.** ¿Misma carta o precios más altos (normalmente +20–30 %)?
   Si son distintos: ¿un porcentaje por app o precio por producto?
2. **Captura.** ¿A mano en la caja (fase 1) o, a futuro, que los pedidos entren
   solos desde Rappi/DiDi? Lo segundo requiere convenio con cada plataforma.
3. **Reparto propio.** ¿Hay repartidores propios? ¿Se cobra envío? ¿Corte por
   repartidor?
4. **Pedidos de app pagados en efectivo** (el repartidor paga en el local):
   ¿existen en la operación?
5. **Empaques.** ¿Se cobra empaque? ¿Se descuentan del inventario contenedores y
   bolsas?
6. **Para llevar:** ¿se cobra antes de mandar a cocina o al entregar?
7. **Etiqueta de la bolsa:** ¿se quiere? ¿Sale por la impresora de caja?
8. **Pedidos programados** («para las 3:00»): ¿hacen falta?
9. **Facturación de pedidos de app:** ¿quién factura hoy al cliente, el
   restaurante o la plataforma?

## Riesgos conocidos

- **El dinero de una app no es efectivo del día.** Meterlo al corte como si lo
  fuera deja un sobrante falso al cajero. Por eso nace «por cobrar»
  (ver el comentario de cabecera de `ventas/canales.ts`).
- **La comisión se congela al abrir la cuenta.** Si se renegocia, el histórico
  tiene que seguir contando lo que se cobró entonces.
- **Mesas virtuales y el plano.** Todo lo que recorre el plano (unir mesas,
  mover cuenta, rol de mesas) tiene que ignorar los pedidos o tratarlos aparte.
