# FacturAPI en MotRest — investigación y plan (1.5.5)

> Escrito el 19-sep-2026 a partir de la especificación oficial de la API de
> FacturAPI (v2, OpenAPI), su página de precios y el código actual de MotRest.
> **Gonzalo contestó el 19-sep-2026 (las cuatro recomendadas):**
> 1. **Licencia de API** → camino A (factura desde la caja + global).
> 2. **Global mensual y automática** (el comensal puede pedir factura hasta fin de mes).
> 3. **Llave de usuario en Central + elegir la organización de una lista.**
> 4. **Solo el responsable** (rol propietario) y el soporte de MOTRAE, por ROL, no por
>    permiso asignable.

---

## 1 · Lo que cambia, en una frase

**Hoy MotRest arma el CFDI, lo sella en el Hub con el CSD y un PAC solo lo timbra.
FacturAPI no funciona así:** recibe los datos de la venta en JSON y él arma el
XML, lo sella con el CSD que se sube a su plataforma y lo timbra. No tiene una
ruta para timbrar un XML ya sellado por fuera.

Consecuencias:

- **El CSD deja de vivir en MotRest.** El restaurante ya no sube `.cer`, `.key` ni
  contraseña a la caja: eso se carga una vez en el panel de FacturAPI (Gonzalo
  dijo que lo hará él).
- **El Hub ya no sella.** Traduce el comprobante que ya genera la caja a la forma
  de FacturAPI y lo manda. El código de sellado se queda, pero deja de usarse.
- **El secreto que hay que proteger ahora es la llave de API** de la organización
  del restaurante, no el CSD.

## 2 · Cómo está organizado FacturAPI

| Pieza | Qué es | Dónde debe vivir |
|---|---|---|
| **Cuenta** (la de MOTRAE) | La que contrató Gonzalo. | — |
| **Llave de usuario** `sk_user_…` | Una por cuenta. Crea y configura organizaciones, lista todas y **saca las llaves de cualquiera**. | **Solo en Central**, cifrada con DPAPI. Nunca en un restaurante. |
| **Organización** | Una por RFC emisor = una por restaurante. Guarda razón social, régimen, CP, logotipo, **el CSD**, series y folios. | En FacturAPI. |
| **Llave Live** `sk_live_…` | Una o varias por organización. Timbra de verdad. Se pueden generar varias y revocar una sin afectar a las demás. | **Solo en el Hub de ese restaurante.** |
| **Llave Test** `sk_test_…` | Una por organización. Timbra de mentira (sin validez), para probar. | En el Hub, mientras se prueba. |

Datos útiles que da la API:

- `GET /organizations/me` dice si la organización **está lista para facturar**
  (`is_production_ready`), **qué le falta** (`pending_steps`) y **cuándo vence su
  CSD** (`certificate.expires_at`). Sirve para un semáforo en Central y en la caja.
- `POST /invoices` acepta **`idempotency_key`**: si se reintenta con la misma
  llave, no timbra dos veces. Resuelve de raíz el «CFDI previamente timbrado»
  que hoy manejamos a mano.
- `POST /invoices` con el campo **`global`** (periodicidad, mes, año) emite la
  **factura global** a PÚBLICO EN GENERAL. No hace falta el producto de recibos.
- Cancelación con motivo (01–04) y sustitución; FacturAPI la tramita.
- `POST /invoices/{id}/email` manda la factura (PDF + XML) al correo del
  comensal, **sin gastar nuestro Gmail**.
- Tiene webhooks, pero **el Hub está en la red del local y no los puede recibir**:
  se consulta el estado (cancelaciones) en lugar de esperar el aviso.

## 3 · Precios (página oficial, sep-2026, IVA incluido)

| Producto | Fijo | Por uso |
|---|---|---|
| **API de facturación** (multi-organización) | **$299 / mes por la cuenta** | **$0.60 por timbre** |
| E-Receipts y autofactura | $599 / mes **por organización** | $0.40 por recibo + $0.60 por timbre |
| Facturación web (panel) | $199 / mes por organización | $0.60 por timbre |

Para una cartera de restaurantes, la licencia de API sale mucho más barata: un solo
fijo para todos. Con E-Receipts, **cada ticket** costaría $0.40 aunque nadie lo
facture (Rodizio, con ~1 000 cuentas al mes, serían ~$1 000/mes solo de ese local).

## 4 · Dos caminos para el comensal que pide factura

**A · Factura desde la caja + factura global automática (recomendado).**
Es lo que MotRest ya sabe hacer: el cajero pide factura con los datos del cliente
(o los toma de su ficha) y el Hub la timbra con FacturAPI. Al cerrar el período, el
Hub emite solo la **factura global** con todo lo que no se facturó. Funciona con la
licencia de API ($299 fijo para toda la cartera).

**B · E-Receipts con autofactura por QR.** Cada ticket se registra en FacturAPI
como recibo e imprime un QR; el comensal se factura solo en un portal con la marca
del restaurante, y FacturAPI hace la global. Cómodo para el comensal, pero cuesta
$599 por local al mes más $0.40 por ticket, y cada cobro depende de internet para
sacar el QR.

Se puede empezar con A y añadir B más adelante a un local que lo quiera pagar.

## 5 · El flujo propuesto (camino A)

### 5.1 · En Central (Gonzalo)
Pestaña **Facturación** en cada restaurante:

1. Gonzalo pega **una sola vez** su llave de usuario de FacturAPI en «Llaves»
   (se guarda con DPAPI, como la de la nube).
2. En el restaurante, **elige su organización de una lista** (Central la pide a
   FacturAPI). Nada de copiar llaves a mano.
3. Central enseña el **semáforo**: ¿datos fiscales completos?, ¿CSD cargado?,
   ¿cuándo vence?, y qué falta, con lo que dice FacturAPI.
4. Elige **modo pruebas o producción**, la **periodicidad de la factura global** y
   la serie.
5. **«Enviar al restaurante»**: Central genera una llave Live **exclusiva de ese
   restaurante** (así se puede revocar sola si hace falta) y la manda.

### 5.2 · Cómo viaja un secreto de Central al Hub
Por la nube, como ya viaja la licencia, pero **cifrado para ese Hub en
particular**:

- Cada Hub genera su propio par de llaves (X25519) y publica la parte pública en
  su pulso.
- Central cifra el secreto con esa llave pública y lo deja en un buzón
  (`secretos_pendientes`) de la nube.
- **Solo el Hub de ese local puede abrirlo.** La nube es cartero: aunque alguien
  leyera la base de datos entera, no vería ninguna llave.
- El Hub lo abre, **prueba la llave contra FacturAPI** antes de guardarla, y
  contesta en su pulso si quedó bien. Central lo enseña en verde.

**El mismo mecanismo sirve para la contraseña de aplicación de Gmail**, que hoy no
tiene dónde capturarse. Se construyen los dos juntos.

### 5.3 · En MotRest (el restaurante)
Finanzas → **Facturación electrónica** (sustituye a la pantalla del CSD):

- **Todos los que facturan** ven el estado: «Facturando como RAZÓN SOCIAL · RFC ·
  CSD vigente hasta …», el modo (pruebas o producción) y la cola.
- **Solo el responsable del restaurante y el acceso de soporte de MOTRAE** pueden
  pegar o cambiar la llave, y cambiar la periodicidad de la global. Nadie más, ni
  aunque le den permisos a mano. La comprobación la hace **el Hub**, no la tableta.
- La llave **va directo al Hub y no se guarda en la tableta**. En pantalla solo se
  ve «configurada · termina en …4f2a».
- Lo que se configura en MotRest **aparece en Central** y viceversa: gana lo más
  reciente.

### 5.4 · Emitir, cancelar, global
- **Factura a un cliente:** igual que hoy en la caja. El Hub la manda a FacturAPI
  con `idempotency_key` = id del comprobante; recibe el XML timbrado (el ticket
  sigue imprimiendo su representación con QR) y **FacturAPI le manda la factura
  por correo** al comensal.
- **Sin internet:** la venta nunca se bloquea; la cola actual espera y reintenta.
  La idempotencia garantiza que un reintento no timbre dos veces.
- **Factura global automática:** al cerrar el período elegido, el Hub la emite con
  todas las cuentas cobradas que no se facturaron, dentro del plazo del SAT. Queda
  en el registro y en el estado financiero («Facturado y timbrado»).
- **Cancelar:** desde MotRest, con motivo; el Hub consulta hasta que el SAT
  resuelve.

### 5.5 · Lo que se retira
- Subir `.cer` / `.key` / contraseña a la caja.
- Las variables `MOTREST_PAC_*` del Hub.

## 6 · Riesgos y cómo se cubren

| Riesgo | Cobertura |
|---|---|
| Un restaurante filtra su llave Live | Es exclusiva de ese local: se revoca desde Central y se manda otra; los demás no se enteran. |
| La llave de usuario de MOTRAE se filtra | Nunca sale de Central (DPAPI), igual que la llave de servicio de la nube. |
| Timbrar dos veces al reintentar | `idempotency_key`. |
| Global fuera de plazo porque el Hub estuvo apagado | Al arrancar, el Hub emite las globales atrasadas y avisa en la caja. |
| Facturar un ticket que ya entró en la global | Se bloquea con un mensaje claro (regla del SAT); ver pregunta 2. |
| Probar sin gastar timbres reales | Modo pruebas con la llave Test. |

## 7 · Preguntas para Gonzalo (antes de construir)

1. **¿Qué producto contrataste?** ¿Licencia de API (camino A) o E-Receipts con
   autofactura (camino B)?
2. **¿Cada cuánto se emite la factura global, y sola o con botón?** (diaria,
   semanal, quincenal o mensual). También: ¿hasta cuándo puede un comensal pedir
   factura de su ticket? Una vez que el ticket entró en la global ya no se puede
   facturar a su nombre sin cancelar la global.
3. **¿Cómo se liga cada restaurante con su organización en Central?** Recomendado:
   pegar una vez tu llave de usuario y elegir la organización de una lista. La
   alternativa es pegar a mano la llave Live de cada restaurante.
4. **«Administrador predispuesto» = el responsable del restaurante** (la cuenta que
   Central deja preparada en la licencia, con rol de propietario). ¿O también
   debe poder el rol «Administración / Contabilidad»?
