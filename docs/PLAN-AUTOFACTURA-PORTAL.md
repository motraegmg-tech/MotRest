# Portal de autofactura de MOTRAE — plan (para después de la 1.5.5)

> Escrito el 20-sep-2026. Gonzalo pidió dejarlo planeado, no construido: «me urge
> que salga esta actualización». Decisiones suyas ya tomadas: **en nuestro
> Vercel**, el comensal **entra con la clave del restaurante emisor**, y por ahí
> viajan sus datos fiscales. Vigencia del ticket: **72 horas**. La factura sale
> **sola**, sin que nadie del restaurante la apruebe.

---

## 1 · Qué resuelve

Hoy, si el comensal quiere factura, tiene que pedirla en el mostrador y dictar su
RFC. Si se acuerda en su casa, vuelve al día siguiente; y si el mes cerró, su
ticket ya entró en la factura global y no se puede facturar a su nombre. Mientras
tanto, el cajero teclea datos fiscales ajenos en hora pico, que es cuando más se
equivoca.

Con el portal, el ticket lleva un QR (y una dirección corta, para quien no puede
escanear). El comensal captura sus datos desde su propio teléfono, con sus datos
móviles, y su factura le llega por correo sin que nadie del restaurante haga nada.

## 2 · Por qué NO el portal de FacturAPI

FacturAPI lo ofrece, pero dentro de su producto **E-Receipts**: **$599 al mes por
restaurante, más $0.40 por cada ticket** que se registre, lo facture alguien o no
(ver `docs/PLAN-FACTURAPI-1.5.5.md` §3). En un local de mil cuentas al mes son
cerca de mil pesos mensuales. Con el portal propio solo se paga el timbre de
$0.60 de las facturas que de verdad se emiten.

## 3 · La decisión de fondo: la llave no sale del Hub

La llave de FacturAPI del restaurante vive en su Hub, en la caja, y ahí se queda:
es lo que decidimos en la 1.5.5 y no cambia por esto. **El portal no timbra.**
Recoge los datos del comensal y los deja en la nube; el Hub del local los recoge
—como ya recoge licencias y llaves—, comprueba el ticket y timbra él.

Consecuencias, dichas de frente:

- Si el restaurante se queda sin internet, la solicitud **espera**. Sale en cuanto
  vuelve, dentro de las 72 horas.
- Si el Hub está apagado toda la noche, la factura sale por la mañana.
- El comensal **no** necesita la red del restaurante: entra desde donde sea.

## 4 · Cómo entra el comensal

Dos caminos a la misma pantalla, los dos impresos en el ticket:

1. **QR**, que lleva la dirección con todo dentro:
   `https://factura.motrae.mx/r/<clave-del-local>/<folio>?t=<comprobación>`
2. **A mano**, para el ticket arrugado o el QR que no enfoca: se entra a
   `factura.motrae.mx`, se teclea la **clave del restaurante** (corta y legible,
   p. ej. `RODIZIO`), el **folio del ticket** y el **total**.

La clave del local no es un secreto —está impresa en cada ticket—; lo que prueba
que el ticket es suyo es la pareja **folio + total**, más el código `t` del QR.

### Lo que ve
1. «Rodizio Pizzas y Pasta · ticket A1B2C3D4 · $1,064.00 · 19 de septiembre».
2. Sus datos: RFC, razón social, régimen, código postal, uso del CFDI y correo.
   Todo en mayúsculas, como el SAT lo compara.
3. «Listo. Tu factura llegará a <correo> en unos minutos». Y el estado, por si
   tarda: recibida → timbrada → enviada, o el motivo si el SAT la rechazó.

## 5 · Las piezas

| Pieza | Dónde | Qué hace |
|---|---|---|
| **Portal** | Vercel (proyecto de MOTRAE), dominio `factura.motrae.mx` | Página pública. No guarda nada ni conoce ninguna llave de FacturAPI. |
| **Función del portal** | Vercel, del lado del servidor | Lo único que puede escribir en la nube. Comprueba el ticket, limita los intentos y deposita la solicitud. |
| **`solicitudes_de_factura`** | Supabase | El buzón, igual que `secretos_pendientes`: el Hub lee y marca las suyas. |
| **`tickets_facturables`** | Supabase | Lo MÍNIMO para reconocer un ticket: local, folio, total, fecha y el código del QR. Lo publica el Hub al cobrar. Sin platillos ni nombres: quien lea esa tabla no aprende qué cenó nadie. |
| **Hub** | En el local | Publica sus tickets facturables, recoge solicitudes, timbra con su llave y marca el resultado. |
| **Caja** | MotRest | Imprime el QR (`url_autofactura`, que la plantilla YA soporta) y enseña en Finanzas las facturas que salieron solas. |

## 6 · Seguridad, con los números

- El código `t` del QR son 16 caracteres al azar por ticket. Sin él hacen falta
  folio **y** total exactos.
- La función limita los intentos por clave de local y por dirección de internet;
  cinco fallos seguidos cierran ese folio por una hora.
- **Un ticket, una factura.** El Hub lo comprueba contra su propio registro, que
  es el que manda, no contra la nube.
- **72 horas** desde el cobro (decisión de Gonzalo). Después, ese consumo va en la
  factura global del mes, y el portal lo dice así en vez de fallar.
- Los datos fiscales del comensal viajan cifrados hasta el Hub con el mismo sobre
  X25519 de las llaves (`packages/dominio/src/comun/sobre.ts`): la nube tampoco
  lee el RFC de nadie.
- La tabla de tickets facturables guarda solo folio, total y fecha. El Hub la
  limpia sola pasadas las 72 horas.

## 7 · Trabajo, por orden

1. **Dominio:** `SolicitudDeFactura` (validación de RFC, régimen, uso y correo) y
   el código del ticket. Con sus pruebas.
2. **Nube:** las dos tablas, sus políticas y Realtime. Igual que la migración del
   buzón de secretos.
3. **Hub:** publicar tickets facturables al cobrar; recoger solicitudes, timbrar
   con FacturAPI (el camino de la 1.5.5 ya está), mandar la factura y marcar el
   resultado; limpiar lo viejo.
4. **Portal (Vercel):** la página y su función. Sin marco de trabajo pesado: una
   página que carga en un teléfono con mala señal.
5. **Caja:** el QR en el ticket, la dirección corta legible, y en Finanzas la
   lista de las facturas que salieron por el portal.
6. **Central:** encender o apagar el portal por restaurante y fijar su clave.

## 8 · Lo que hay que decidir antes de empezar

- **El dominio.** ¿`factura.motrae.mx`? Hay que apuntarlo a Vercel.
- **La clave de cada local.** ¿La eliges tú en Central, o se propone sola a partir
  del nombre (`RODIZIO`, `TORTASFC`)?
- **Qué pasa si el comensal se equivoca de RFC.** Lo normal es cancelar y volver a
  emitir (motivo 01, sustitución), y eso son dos timbres. ¿Se le deja corregir
  desde el portal mientras no pasen las 72 horas, o tiene que ir al restaurante?
- **El logotipo del restaurante** en el portal: sale del que ya se carga para el
  ticket, o se sube en Central.
