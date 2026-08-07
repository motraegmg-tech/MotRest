# ADR-25 · Qué es F5, y por qué existe

**Estado:** aceptado · **Fecha:** agosto 2026 · **Decide:** Gonzalo (MOTRAE)

---

## Contexto

El roadmap del PRD y del TRD termina en **F4**. No hay F5 definida.

Al cerrar F4 se dio por completa con tres piezas —consolidado multisucursal, API
pública y kiosco— pero el **Anexo A del PRD marca como F4** cuatro cosas más que
no se habían construido:

| Función | Prioridad en el PRD |
|---|---|
| Pagos integrados (terminal conectada al POS) | **Alta** |
| Multiempresa / multi-razón social | Media |
| Gestión de franquicias | Media |
| Benchmarking de mercado | Media |
| Failover automático v2 | — (TRD §roadmap) |

**F5 = esas cinco.** No es una fase nueva de producto: es cerrar de verdad lo que
F4 prometía, agrupado bajo un nombre porque se pidió así.

Lo que el PRD llama **post-F4** —marketplace de comensales, funciones de red—
sigue fuera: requiere masa crítica de restaurantes y no se construye antes.

---

## Decisión 1 · Pagos integrados sin atarse a un proveedor

MotRest **no sabe** si el restaurante usa Clip, Mercado Pago, Getnet, NetPay o la
terminal de su banco, y no debe saberlo. Cada restaurante ya tiene contrato con
alguien; pedirle que lo cambie para usar el POS es pedirle que renegocie sus
comisiones.

El dominio define **qué significa cobrar con terminal**; un adaptador por
proveedor implementa el cómo.

### El estado que casi todos olvidan

`desconocido` — la terminal no contestó. **No es un fallo: es no saber.**

- Tratarlo como rechazo → se le cobra dos veces a quien ya pagó.
- Tratarlo como aprobado → se regala la comida.

Lo único correcto es **consultar** con la misma referencia. Por eso cada intento
lleva una `referencia` única, y `desconocido` **nunca se ofrece como
reintentable** — el cajero pulsaría "reintentar" porque el cliente está delante
esperando.

Cuando tras tres consultas sigue sin saberse, el sistema **lo dice** y le pide al
cajero que mire el aparato. Fingir un veredicto es lo que produce el doble cargo.

### Otras dos reglas

- **Una aprobación sin número de autorización no es una aprobación.** Se rechaza.
- **La terminal nunca bloquea la venta.** Si se cae, se cobra a mano como
  siempre. La integración es una comodidad; la venta no.

---

## Decisión 2 · Multiempresa: el consolidado es de gestión, NUNCA fiscal

Varias razones sociales es lo normal en México: se abre una por local para acotar
riesgos, repartir con socios distintos, o porque el local nuevo entró con otro
RFC. Cada una **factura por su cuenta, con su propio CSD**.

Sumar sus ventas para que el dueño vea su negocio está bien y es lo que quiere.
Presentarlo como si fuera una sola empresa ante el SAT es otra cosa.

**Todo consolidado con más de un RFC sale con advertencia explícita.** No es una
nota legal de relleno: un dueño que ve "$1 200 000 del mes" y se lo pasa a su
contador sin decir que son tres empresas provoca una declaración mal armada, y
eso se paga con multas.

Un local **sin razón social asignada se ignora**, no cae en un cajón de "otros"
que alguien acabará sumando.

---

## Decisión 3 · Franquicias: la regalía se calcula sobre la venta SIN IVA

El IVA no es del restaurante: es del SAT pasando por su caja. Cobrar regalías
sobre él sería cobrarle al franquiciatario un porcentaje de un dinero que nunca
fue suyo — y es **la discusión que rompe contratos de franquicia**.

Con 5 % sobre $500 000, pasar la venta con IVA en vez de sin él cobra **$4 000 de
más al mes**.

Dos reglas más:

- **Mínimo y porcentaje no se suman: se toma el mayor.** El mínimo existe para
  que el franquiciante no dependa de que el local venda, no para cobrar dos veces.
- **La disponibilidad siempre es del local**, aunque el producto sea del catálogo
  estándar. Si se quedaron sin producto tienen que poder agotarlo; obligarles a
  seguir vendiéndolo produce comandas que la cocina no puede sacar.

---

## Decisión 4 · Benchmarking: la privacidad manda sobre la utilidad

Un restaurante que comparte sus números para compararse **no está aceptando que
su competencia de enfrente los lea**. Si con el comparativo se puede deducir
cuánto vende el vecino, MOTRAE dejó de ser proveedor y pasó a ser una fuga.

| Regla | Por qué |
|---|---|
| Nunca un dato individual | Solo medianas y percentiles |
| **Mínimo 5 participantes** | Con 4 y sabiendo el propio, se despeja el resto con una resta |
| Nunca el máximo ni el mínimo | El máximo de un grupo **es** el dato de un local concreto |
| Solo participa quien acepta | Quien no aporta no recibe. Es lo que hace sostenible la muestra |

Se compara contra el mismo **tipo, tamaño y estado**. Una taquería y un
restaurante de mantel largo no se comparan aunque estén en la misma calle.

El cuartil se calcula **"1 = el mejor" siempre**, invirtiendo en los costos. Sin
eso, un food cost bajo saldría como cuartil 4 y el dueño leería que está mal
justo cuando está mejor que todos.

---

## Decisión 5 · Failover: dos Hubs a la vez es peor que ninguno

Si la caja muere, las tablets siguen vendiendo en modo isla —eso ya existía— pero
cada una con su copia: dos meseros pueden abrir la misma mesa sin verse.

Una tablet suplente puede tomar el relevo. **Resolverlo mal es peor que no
hacerlo**: con dos Hubs asignando secuencia, el registro se parte en dos
historias que no se vuelven a unir — los mismos números apuntando a ventas
distintas, dos folios 1043, dos cortes.

Tres defensas:

1. **Mayoría estricta.** Con cuatro terminales hacen falta tres. Si la red se
   parte en dos mitades, **ninguna** alcanza mayoría y ninguna se proclama: las
   dos siguen en isla, que es incómodo pero recuperable.
2. **Dos umbrales.** A los 30 s se avisa al personal; a los 90 s se releva. Con
   un umbral solo, el sistema pasaría de la normalidad al cambio de mando sin
   avisar a nadie — y `esperando` sería un estado inalcanzable. *(Lo detectó una
   prueba, no una revisión.)*
3. **El titular siempre gana.** Cuando la caja vuelve, el suplente se retira sin
   discutir. Una negociación entre dos que se creen Hub es la forma más rápida de
   acabar con dos Hubs de verdad.

### Vender sí, cerrar el día no

El corte cuadra el dinero **físico** del cajón contra lo vendido, y el cajón está
en la computadora que no responde. Un corte desde una tablet suplente cuadraría
contra un efectivo que nadie contó.

---

## Consecuencias

**A favor**

- MotRest se puede vender a **grupos y franquicias**, no solo a locales sueltos.
- El cobro con tarjeta deja de depender de teclear bien un monto.
- El comparativo es un diferenciador que ningún competidor local tiene.
- Un apagón de la caja deja de partir la operación en cuatro copias.

**En contra, y asumido**

- **Los adaptadores de proveedor no están escritos.** La costura está probada;
  conectar Clip o Mercado Pago exige sus credenciales y su documentación.
- **El benchmarking no sirve todavía.** Con tres restaurantes no significa nada;
  el mínimo de cinco por grupo comparable tardará en alcanzarse.
- **El relevo no está cableado al protocolo de sincronización.** El dominio
  decide y el POS avisa, pero proclamarse Hub es trabajo del `protocolo-sync` y
  queda pendiente.

---

## Lo que sigue fuera de alcance

Marketplace de comensales y funciones de red (PRD, "post-F4"). Requieren masa
crítica de restaurantes MotRest y no se construyen antes de tenerla.
