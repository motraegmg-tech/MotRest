# Conectar el WhatsApp de un restaurante a MotRest

Guía operativa. Se divide en dos partes muy distintas:

- **Parte A — MOTRAE, una sola vez en la vida de la empresa.** Es lenta y tiene
  esperas de terceros. Hasta que no esté, ningún restaurante puede conectarse.
- **Parte B — cada restaurante.** Una vez hecha la parte A, dar de alta un local
  toma minutos.

> **Antes de empezar, lo más importante:** existen dos productos distintos con
> nombres casi iguales.
>
> | Producto | Sirve para esto |
> |---|---|
> | **WhatsApp Business** (la app del teléfono) | Chatear a mano. **No se integra con software.** |
> | **WhatsApp Business Platform / Cloud API** | Lo que MotRest necesita. |
>
> Si el restaurante ya usa la app en un número, ese número **hay que migrarlo** y
> **se pierde el historial de conversaciones de la app**. Conviene decidirlo
> antes: casi siempre es mejor contratar un número nuevo y dejar el de siempre
> para el trato personal.

---

## Parte A — Lo que MOTRAE hace una sola vez

> **MOTRAE no necesita un número de WhatsApp.** El número es siempre del
> restaurante. MOTRAE aporta la aplicación que los conecta. Para desarrollar y
> probar basta el número de pruebas que Meta regala con cada app.

### A.0 · Si MOTRAE todavía no está constituida

Se puede empezar. Meta acepta **persona física con actividad empresarial**:

- Se verifica con la **Constancia de Situación Fiscal** (RESICO sirve).
- El **nombre legal del portafolio es el de la persona**, y tiene que coincidir
  **carácter por carácter** con la constancia. "MOTRAE" va como nombre comercial.
- La **aplicación se puede crear hoy**, sin ninguna verificación, y se desarrolla
  contra el número de pruebas gratuito. La verificación solo hace falta para
  salir a producción con números reales.

**El costo de adelantarse.** Cuando MOTRAE se constituya como sociedad, pasar la
verificación de persona física a persona moral **no es un cambio de datos**: en
la práctica se crea un portafolio nuevo, se vuelve a verificar y se vuelve a
pedir la revisión de la app. Los números ya conectados se migran uno por uno.

Regla práctica:

| Si la sociedad se constituye… | Conviene |
|---|---|
| En semanas | **Esperar** y verificar directo como persona moral |
| En meses, o no hay fecha | **Arrancar** como persona física: estar bloqueado meses cuesta más |

En ambos casos, crear la app y desarrollar **desde hoy**.

### A.1 · Verificar la empresa en Meta Business (lo que más tarda)

1. Entrar a `business.facebook.com` y crear el portafolio de MOTRAE.
2. Ir a **Configuración → Centro de seguridad → Verificación de empresa**.
3. Subir los documentos de MOTRAE: acta constitutiva o constancia de situación
   fiscal, comprobante de domicilio y un medio de contacto verificable.

**Tiempo: de 2 días a 3 semanas.** Es una revisión humana de Meta y no se puede
acelerar. **Empezar por aquí**, aunque lo demás no esté listo.

Errores que rebotan la solicitud:
- El nombre en los documentos no coincide **exactamente** con el del portafolio.
- El domicilio del comprobante no coincide con el declarado.
- Un sitio web sin aviso de privacidad publicado y accesible.

### A.2 · Crear la aplicación de MOTRAE

1. En `developers.facebook.com`, crear una app de tipo **Business**.
2. Asociarla al portafolio verificado en A.1.
3. Agregar el producto **WhatsApp**.
4. Guardar el **App ID** y el **App Secret**.

> El **App Secret** es con lo que se comprueba que un webhook viene de verdad de
> Meta. Va en una variable de entorno del relay y **nunca al repositorio**.

### A.3 · Pedir los permisos como Proveedor de Tecnología

En **Revisión de la app**, solicitar:

| Permiso | Para qué |
|---|---|
| `whatsapp_business_messaging` | Enviar y recibir mensajes |
| `whatsapp_business_management` | Administrar el número y las plantillas del cliente |

Meta pide un **video** mostrando el flujo completo: cómo un restaurante conecta
su número desde MotRest y cómo se manda un mensaje. Grabarlo con la pantalla real
de MotRest, no con diapositivas — con diapositivas lo rechazan.

**Tiempo: de 3 a 10 días hábiles.**

### A.4 · Publicar el relay

El relay es la única parte de MotRest conectada a internet. Necesita:

1. **Un dominio con HTTPS válido.** Meta no acepta webhooks sin certificado, y
   los Hubs solo se conectan por `wss://` — un `ws://` lo rechaza el propio Hub.
2. **Las variables de entorno.** Estas seis son **todas** las que el relay lee.
   Las tres primeras son obligatorias y sin ellas no arranca:

   ```
   MOTREST_META_APP_SECRET     el App Secret de A.2
   MOTREST_META_VERIFY_TOKEN   una cadena larga que inventas tú, la misma que
                               pondrás en el panel de Meta
   MOTREST_RELAY_LLAVE_PADRON  32 bytes en base64: cifra el padrón en reposo
   MOTREST_RELAY_CLAVE_ADMIN   para consultar /salud/detalle (opcional)
   MOTREST_RELAY_PUERTO        puerto de escucha (por defecto 8080)
   MOTREST_RELAY_PADRON        dónde se guarda el padrón (./datos/…)
   ```

   La llave del padrón se genera una vez y **no se pierde**: sin ella, el archivo
   con los tokens de todos los restaurantes no se puede leer y hay que volver a
   conectar cada número.

   ```bash
   pnpm --filter @motrest/relay padron llave
   ```

   > **`MOTREST_RELAY_CLAVE_HUB` ya no existe.** Era una sola clave para todos
   > los Hubs: con ella, cualquier restaurante podía decir que era otro y
   > quedarse con sus mensajes. Ahora cada local tiene la suya (paso B.0).

3. **Registrar el webhook** en el panel de Meta:
   - URL: `https://<tu-dominio>/webhook/whatsapp`
   - Token de verificación: el mismo `MOTREST_META_VERIFY_TOKEN`
   - Suscribirse al campo **`messages`**

Meta hace de inmediato una llamada `GET` de comprobación. Si el token coincide,
queda verificado.

### A.5 · Crear las plantillas

Fuera de la ventana de 24 horas solo se pueden mandar **plantillas aprobadas**.
Se dan de alta una vez por restaurante (o se copian de un catálogo de MOTRAE).

Las tres que MotRest usa:

| Nombre | Categoría | Texto |
|---|---|---|
| `mesa_lista` | Utilidad | `{{1}}, su mesa está lista en {{2}}. Lo esperamos.` |
| `reserva_confirmada` | Utilidad | `{{1}}, su reserva quedó para el {{2}} a las {{3}}.` |
| `encuesta_visita` | Utilidad | `{{1}}, gracias por su visita. ¿Nos ayuda con una pregunta rápida?` |

**Categoría importa y cuesta dinero.** *Utilidad* es más barata que *Marketing* y
se aprueba más fácil. Una plantilla de utilidad que en realidad vende, Meta la
reclasifica a marketing y cobra más. Las promociones van como *Marketing* y
**exigen consentimiento previo**.

**Tiempo: minutos a 48 horas por plantilla.**

---

## Parte B — Dar de alta un restaurante (minutos)

### B.0 · Darlo de alta en el padrón del relay

**Primero esto, antes que nada.** Un restaurante que no está en el padrón no
existe para el relay: su Hub se conecta y lo echan.

En el servidor del relay, con la llave del padrón en el entorno:

```bash
# El id de sucursal NO te lo inventas: lo genera el Hub al instalarse y lo
# escribe en su registro y en <datos>/sucursal.txt. Cópialo de ahí.
pnpm --filter @motrest/relay padron alta suc-a1b2c3d4 "Rodizio"
```

Devuelve una **credencial que se enseña una sola vez**. El padrón solo guarda su
huella, así que no se puede volver a consultar — si se pierde, se genera otra con
`padron rotar <sucursal>`.

Esa credencial se pega en el Hub del restaurante (Administración → Hub del local
→ WhatsApp), junto con la dirección del relay:

```
URL del relay:  wss://<tu-dominio>/hub
Credencial:     la que devolvió el alta
```

De la credencial sale la identidad del local ante el relay. Por eso **una
credencial por restaurante y nunca compartida**: quien la tiene, es el local.

Las demás órdenes del padrón:

| Orden | Para qué |
|---|---|
| `padron lista` | Ver quién está de alta y quién ya conectó su número |
| `padron rotar <sucursal>` | Credencial nueva. Corta el enlace vivo del local |
| `padron baja <sucursal>` | Lo saca y **olvida su token de Meta** de inmediato |

### B.1 · El número

El restaurante necesita un número que:

- **no esté activo en la app de WhatsApp Business ni en WhatsApp personal**;
- pueda recibir una llamada o un SMS para el código de verificación;
- vaya a ser el que el comensal ve. Idealmente el mismo que ya está en su
  Google Maps y en sus volantes.

Si el número ya está en la app, primero **eliminar la cuenta desde la app**
(Ajustes → Cuenta → Eliminar mi cuenta). Después de eso el número queda libre en
unos minutos. **El historial de la app se pierde: avisarlo antes, por escrito.**

### B.2 · Conectar desde MotRest

En **Administración → Hub del local → WhatsApp**, el dueño pulsa *Conectar
WhatsApp*. Se abre el flujo de Meta (*Embedded Signup*) dentro de MotRest y ahí:

1. Inicia sesión con su Facebook.
2. Crea o elige su cuenta de WhatsApp Business.
3. Registra el número y teclea el código de verificación.
4. Acepta que MotRest administre ese número.

Al terminar, Meta devuelve el **`phone_number_id`** y un **token** del
restaurante. El relay los guarda y a partir de ese momento sabe enrutar.

> El número y la cuenta son **del restaurante**. Si algún día deja MotRest, se
> lleva su número: solo hay que quitarle el permiso a la app de MOTRAE.

### B.3 · Configurar qué hace WhatsApp en ese local

En la misma pantalla se decide, por restaurante:

- **A dónde apunta el QR del ticket:** al portal web, o a WhatsApp.
- **Qué avisos salen:** mesa lista, confirmación de reserva, encuesta.
- **Si se permiten promociones** y cuántas al mes (tope de fábrica: 4).

### B.4 · Probar antes de soltarlo

1. Desde un teléfono cualquiera, mandar "hola" al número del restaurante.
2. Comprobar en **Administración → Hub → WhatsApp** que el mensaje llegó.
3. Anotar a alguien en la lista de espera y mandarle el aviso de mesa lista.
4. Cobrar una cuenta de prueba y comprobar que el QR del ticket abre lo que debe.

---

## El reparto de trabajo entre el Hub y WhatsApp

Esta es la regla que evita gastar de más y depender de internet sin necesidad.

**El Hub hace todo lo que puede hacer solo.** Vive en el restaurante, funciona
sin internet y no cuesta por uso:

- servir el portal del comensal (encuesta, reservas, carta, sus puntos);
- guardar la operación completa;
- imprimir, sincronizar terminales, calcular el corte.

**WhatsApp hace solo lo que el Hub no puede**, que es una cosa: **empezar una
conversación**. El Hub no puede tocarle el hombro a un cliente que ya se fue.

| Necesidad | Quién |
|---|---|
| Encuesta de satisfacción | **Hub** (portal por QR) |
| Reservar mesa | **Hub** (portal) |
| Ver la carta, sus puntos | **Hub** (portal) |
| "Su mesa está lista" | **WhatsApp** |
| "Su reserva quedó confirmada" | **WhatsApp** |
| Promoción a quien dio su consentimiento | **WhatsApp** |

Consecuencia práctica: **si se cae el internet, el restaurante sigue operando y
el portal sigue funcionando.** Solo se encolan los avisos de WhatsApp, y salen al
reconectar.

---

## Costos que hay que tener presentes

- **Meta cobra por conversación de 24 horas, no por mensaje**, y le cobra al
  restaurante, no a MOTRAE.
- Las conversaciones que **inicia el comensal** son gratuitas (hay una bolsa
  mensual gratis por número).
- Las que **inicia el negocio** se cobran, y *Marketing* cuesta más que
  *Utilidad*.
- Por eso la encuesta va por el portal: mandarla por WhatsApp sería pagar por
  cada comensal que come.

---

## Lo que hay que vigilar después

- **Calidad del número.** Meta la califica en su panel. Si baja a roja, limita
  los envíos. Baja por bloqueos y reportes de los usuarios, que casi siempre
  vienen de mandar promociones a quien no las pidió.
- **El tope de 4 promociones al mes por contacto** que MotRest aplica solo: no lo
  exige Meta, lo exige no quemar el número.
- **Las bajas.** MotRest reconoce "BAJA", "STOP", "cancelar" y "salir", y corta
  el marketing de inmediato. Nunca hay que reactivar a alguien a mano.
