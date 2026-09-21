# MotRest 1.5.6 — plan

> Escrito el 20-sep-2026 con las decisiones de Gonzalo ya tomadas. Tres cosas:
> la factura global pasa a ser SUYA, el consumo de socio deja de ser venta, y
> las reservas y la ficha del comensal dejan de vivir separadas.

---

## 1 · La factura global la decide el restaurantero

Hoy (1.5.5) el Hub la emite solo, con todo lo que nadie pidió a su nombre.
Gonzalo lo cambia: **«el restaurantero elige y es dueño de su tipo de
facturación»**.

### 1.1 · Dos modos, y el local escoge
- **«Yo elijo qué va»** (nuevo, por defecto): nadie emite nada sin que una
  persona lo revise y lo autorice.
- **«Automática»**: la de la 1.5.5, para quien la prefiera.

Vive en una configuración del local que se replica como el resto de catálogos
(`facturacion_config`, al estilo de `correo_config`): se cambia en la caja, el
Hub la aplica y Central la ve.

### 1.2 · El módulo: Finanzas → Facturación → «Factura global»
1. **Mes**, con el último cerrado propuesto.
2. **Resumen del mes**: cuentas cobradas, cuántas ya tienen factura a nombre,
   cuántas pueden entrar, cuánto suman, y lo que ya se emitió en globales.
3. **La lista, cuenta por cuenta**: día, hora, folio, mesa, total, cómo se
   cobró, y su estado —puede entrar / ya facturada a nombre / ya está en una
   global / no aplica ($0, cancelada, consumo de socio)—. Con casilla por
   renglón, «todas / ninguna», y filtros por día y por forma de pago.
4. **La cifra viva**: «se van a facturar N cuentas por $X», que cambia al marcar.
5. **Emitir**, con confirmación que dice en claro **cuántas cuentas quedan
   fuera** y qué significa eso ante el SAT. Queda registrado quién la autorizó.
6. **Historial**: las globales del mes con su folio fiscal, total, cuántas
   cuentas y de qué modo (pruebas o producción), y qué incluyó cada una.
7. **El reloj del SAT**: cuando el mes cierra, la pantalla avisa que corren las
   72 horas, y lo repite en el resumen de Finanzas.

### 1.3 · Lo que se queda fuera sigue vivo
Decisión de Gonzalo: mientras una cuenta **no esté en una global**, se puede
facturar a nombre del cliente o meterla en una global posterior. Se retira el
bloqueo por «mes cerrado» de la 1.5.5 y queda solo el que importa: **una venta
no puede ir en dos comprobantes**.

### 1.4 · Lo que NO cambia
La emisión sigue siendo del Hub —con su llave, su idempotencia y sus
reintentos—; la caja solo dice qué emitir. Un mes no se timbra dos veces.

---

## 2 · El consumo de socio deja de ser venta

Hoy se registra como una FORMA DE PAGO, así que la venta del día lo incluye
aunque no entre dinero. Gonzalo: eso infla la venta.

Desde la 1.5.6:
- **Sale de la venta**: del día, del mes, de las dos utilidades y del PDF.
- **Su costo sigue contando**: esos insumos se gastaron de verdad. Es la opción
  que eligió Gonzalo, y es la que no miente sobre lo que cuesta el acuerdo.
- **Aparece en su propio bloque, «Consumo de socios»**, con lo consumido y lo
  que costó, para que el acuerdo con cada socio se pueda mirar de frente.
- **Fuera de la facturación**: no entra en la global ni se factura a nombre de
  nadie. No fue una venta al público.
- El **inventario y el costo de las recetas** no cambian: el platillo salió.
- En una cuenta mixta (parte socio, parte efectivo), solo la parte del socio
  sale de la venta.

---

## 3 · Reservas y ficha del comensal, conectadas

Hoy una reserva por teléfono no queda atada a ninguna ficha, y desde la ficha no
se puede apartar mesa.

- **Apartar mesa reconoce al cliente.** En «A nombre de» aparece la lista de
  fichas —con buscador— más **«+ Nuevo cliente»**, que lleva al alta de comensal
  y, al guardar, **devuelve a Reservas donde estaba**, con el cliente puesto.
- **Si se teclea un teléfono que ya tiene ficha, se liga a esa** (decisión de
  Gonzalo), sin duplicar. Si el nombre no coincide, lo avisa y deja elegir.
- **Si no existe, se crea sola** con nombre y teléfono, y queda ligada.
- **Al revés también**: desde la ficha del comensal se aparta mesa, y la reserva
  nace ya ligada.
- La lista de espera se comporta igual.
- Las reservas que llegan del portal ya traen ficha: no cambian.

---

## 4 · Orden de trabajo

1. Dominio: el socio fuera de la venta (toca dinero: primero y con pruebas).
2. Dominio + Hub: emisión manual de la global y el modo del local.
3. Caja: el módulo «Factura global».
4. Caja: reservas y ficha conectadas.
5. Versión 1.5.6, instalador, verificación sobre el paquete y publicación.

---

## 5 · Lo que se sumó el 20-sep (tarde), con las decisiones de Gonzalo

1. **Portal de autofactura** (lo corrige Gemini; la integración con el Hub, el
   ticket y Central la hace Claude cuando Gemini entregue). Vive en la
   **dirección gratuita de Vercel** —por eso la dirección es un AJUSTE, no va
   escrita en el código—. La **clave de cada restaurante se propone sola** a
   partir del nombre y Gonzalo la corrige en Central.
2. **Correos editables y correos nuevos.** Los seis de ejemplo se quedan como
   punto de partida; cada uno lleva «Editar» para escribir el asunto y el texto a
   mano, dentro del mismo diseño. El restaurantero puede crear tipos nuevos, que
   nacen ya redactados como ejemplo. **Los correos nuevos solo llegan a quien
   aceptó promociones**, siempre con la baja (decisión de Gonzalo).
3. **Gastos**, una tarjeta propia en Finanzas: Hoy / 7 días / Este mes / Todo y
   el calendario para elegir un mes. «Gastos de hoy» y «Cuentas por pagar» se
   mudan ahí; «Registrar gasto» queda en los dos sitios.
4. **«Ver más»** en toda lista larga: 10 renglones al entrar, 15 más por clic.
   Herramienta común en `apps/pos-ui/src/lib/listas/`.
5. **Emitir CFDI con fichas:** buscador de comensales por nombre o RFC, con la
   lista corta que se va filtrando.
6. **«Hacer la Ficha de este Comensal»** desde la factura, con los datos que
   falten. **El correo del comensal pasa a ser obligatorio.**
7. **«Ordenar»** en toda lista que llena el usuario (fecha, A-Z, Z-A…). En casi
   todas solo cambia la vista; **en la carta cambia también el orden en que la
   ven los meseros** (decisión de Gonzalo), con confirmación.
8. **Datos fiscales del restaurante en MAYÚSCULAS** mientras se teclean.

---

## 6 · El portal de autofactura, lado Hub (21-sep, decisiones de Gonzalo)

Decisiones:
- **Si el SAT rechaza los datos del comensal:** lo ve en el portal al volver a
  abrir su QR (con el motivo, y corrige ahí) **y** le llega un correo con el
  motivo y el enlace si el restaurante tiene su correo configurado.
- **Serie de lo que sale solo:** la del local más el código del Hub
  (`serieDeTerminal(serie_base, HUB_ID)`), como cualquier otra caja.
- **Correos propios** en la ficha de quien no aceptó promociones: en gris, con
  su motivo (ya hecho).

Cómo funciona:
1. **El código del QR** es `firmarCuenta(orden_id, secreto)` con un secreto
   derivado de la clave del local (`derivarSecretoAutofactura`). La caja lo
   imprime y el Hub lo publica sin tener que hablarse.
2. **La caja** imprime el QR y, debajo, «Clave RODIZIO · Folio A1B2C3D4» para
   quien entra a mano. Lo sabe por el estado fiscal que le manda el Hub.
3. **El Hub** lee su fila de `claves_de_autofactura`. Si existe y hay FacturAPI:
   - publica cada cuenta cobrada facturable en `tickets_facturables`;
   - marca «facturado» lo que se factura en caja o entra en una global;
   - borra lo vencido;
   - recoge las solicitudes (Realtime + barrido al reconectar), abre el sobre,
     comprueba el ticket **contra su propio registro**, arma el comprobante y lo
     inyecta como `cfdi_generado` (actor `sistema`). La cola lo timbra;
   - marca el resultado en la nube. Si fue un rechazo, avisa al comensal por
     correo.
4. **Los datos fiscales del restaurante viajan al Hub** en
   `facturacion_config` (`emisor`, `serie_base`). Hasta hoy vivían solo en
   cada tableta.
5. **Defecto que se arregla de paso:** la cola ignoraba una segunda factura de
   la misma orden (`INSERT OR IGNORE`), así que un rechazo por datos del
   cliente no tenía arreglo. Ahora una orden **rechazada que nunca llegó a
   FacturAPI** se reemplaza con el comprobante corregido.
6. **Central** propone la clave a partir del nombre, deja cambiarla, y guarda la
   dirección del portal (la gratuita de Vercel por ahora).
