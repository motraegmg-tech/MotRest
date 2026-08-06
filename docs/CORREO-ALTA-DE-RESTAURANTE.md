# Conectar el correo de un restaurante

Sustituye a WhatsApp para todo lo que no es urgente. Comparado con la vía de
Meta, esto es **otro mundo de simple**:

| | WhatsApp (Meta) | Correo |
|---|---|---|
| Verificación de empresa | 2 días – 3 semanas | **Ninguna** |
| Aprobación de plantillas | Horas – 48 h | **Ninguna** |
| Servicio en la nube (relay) | **Obligatorio** | **No hace falta** |
| Costo | Por conversación | **Gratis** |
| Alta de un restaurante | Días | **10 minutos** |

**Por qué desaparece el relay.** Mandar un correo es una llamada de salida: el
Hub la hace él mismo desde el restaurante. WhatsApp necesitaba un servicio
público porque Meta tiene que poder *alcanzarnos* para entregar lo que entra. El
correo no entra: si el comensal responde, le llega al buzón del restaurante.

**Dónde el correo no sirve, y hay que decirlo.** «Su mesa está lista» por correo
no funciona: nadie revisa el correo de pie en la puerta. Ese aviso —y solo ese—
sigue necesitando WhatsApp o SMS. Todo lo demás va por correo.

---

## Elegir el camino

| Modo | Cuándo | Costo | Trámite |
|---|---|---|---|
| **Gmail** ← *el de fábrica* | Casi siempre | **$0** | 5 min, ningún DNS |
| **MOTRAE** | Cuando pasa de ~500 correos/día | $0 para el local | Ninguno |
| **Dominio propio** | Cuando quiere su marca en el remitente | ~$200/año | Tocar su DNS |

**Empiece siempre por Gmail.** El restaurante ya lo tiene, no compra nada, y el
comensal ve la dirección que ya conoce. Cambiar de modo después es un formulario.

---

## Camino A · Su propia cuenta de Gmail (el normal)

Google entrega el correo desde su servidor, firmado con su DKIM. Entrega
perfecto y no hay dominio que verificar — **la verificación es entrar a la
cuenta**.

### A.1 · Activar la verificación en dos pasos

En la cuenta de Google del restaurante: **Cuenta → Seguridad → Verificación en 2
pasos**. Sin esto, el paso siguiente no existe en el menú.

### A.2 · Generar una contraseña de aplicación

**Cuenta → Seguridad → Contraseñas de aplicaciones**. Nombrarla «MotRest». Google
da **16 letras**; se copian una sola vez.

> **No es la contraseña del correo, y esa nunca se pide.** Una contraseña de
> aplicación solo sirve para mandar correo, se revoca sola desde el panel de
> Google y no da acceso a la bandeja de entrada ni a nada más de la cuenta.

Se pone como variable de entorno del Hub:

```
MOTREST_RESEND_KEY=abcd efgh ijkl mnop
```

*(La variable se llama así por historia; en modo Gmail lleva la contraseña de
aplicación. Los espacios se quitan solos.)*

### A.3 · Configurar en MotRest

En **Administración → Mensajes para el cliente**:

- **Modo**: Gmail
- **Cuenta**: `rodizio.gdl@gmail.com`
- **Remitente**: `Rodizio <rodizio.gdl@gmail.com>`

> **La cuenta y el remitente tienen que ser la misma dirección.** Google entrega
> siempre desde la cuenta con la que uno se autenticó: si el remitente dice otra
> cosa, la reescribe. El correo sale, nadie ve un error, y llega con una
> dirección que no es la que el restaurante puso. MotRest lo avisa al guardar.

### A.4 · Lo que hay que saber del tope

Una cuenta gratuita de Gmail admite **unos 500 destinatarios al día**. Para las
confirmaciones y encuestas de un restaurante sobra de largo. El día que una
campaña lo rebase, se cambia al modo MOTRAE — es un formulario, no una migración.

---

## Camino B · Dominio propio con Resend

Solo si el restaurante quiere su marca en el remitente
(`reservas@rodizio.mx`) y está dispuesto a tocar su DNS.

### B.1 · Crear la cuenta de Resend

En `resend.com`, con el correo del restaurante. El plan gratuito da **3 000
correos al mes y 100 al día**.

### B.2 · Verificar su dominio

Sin dominio verificado, Resend solo deja mandar a la dirección del dueño de la
cuenta.

1. En Resend, **Domains → Add Domain**, poner `rodizio.mx`.
2. Resend muestra tres registros DNS. Se copian tal cual en el panel de donde
   se compró el dominio (GoDaddy, Cloudflare, Namecheap…):
   - **MX** y **TXT (SPF)** — dicen que Resend puede mandar en su nombre.
   - **TXT (DKIM)** — la firma con la que se comprueba que el correo es suyo.
3. Esperar. Suele tardar minutos; el DNS puede tardar hasta 48 horas.
4. Cuando Resend lo marque **verificado**, listo.

> **Si el restaurante no tiene dominio propio**, no hace falta comprarle uno:
> use el **camino A (Gmail)**, que es el de fábrica y no cuesta nada.
>
> Añadir también un registro **DMARC** mejora mucho la entrega:
> `_dmarc.rodizio.mx` con valor `v=DMARC1; p=none; rua=mailto:dueño@rodizio.mx`.

### B.3 · Crear la llave de API

**API Keys → Create**, permiso de solo enviar. Se copia una vez y ya no se
vuelve a mostrar.

> La llave se guarda **en el Hub**, nunca en las terminales. Una credencial que
> puede mandar correo en nombre del restaurante no tiene por qué estar en el
> teléfono de un mesero.

Se pone como variable de entorno del Hub:

```
MOTREST_RESEND_KEY=re_...
```

### B.4 · Configurar en MotRest

En **Administración → Mensajes para el cliente**:

- **Modo**: dominio propio
- **Remitente**: `Rodizio <reservas@rodizio.mx>`. Con el nombre delante, el
  comensal ve el restaurante y no una dirección.
- **Nombre del local**, para los asuntos.
- **Responder a**: a dónde contesta si le da a «Responder».
- **Teléfono**: aparece como botón **Llamar al restaurante** en cada correo.
- Encender los correos que quiera mandar.

---

## Probar (los dos caminos)

Apartar una reserva a nombre propio, con el correo propio, y confirmarla.
Comprobar que llega, que no cae en spam y que el botón de llamar funciona.

---

## Los correos que MotRest trae escritos

**Avisos** — salen sin pedir permiso, porque el comensal los provocó:

| Correo | Cuándo |
|---|---|
| Confirmación de reserva | Cuando la casa confirma |
| Recordatorio de reserva | El día antes |
| Encuesta de su visita | Después de cobrarle |
| Gracias por su visita | Después de cobrarle |

**Promociones** — solo a quien dijo que sí, y siempre con enlace de baja:

| Correo | Cuándo |
|---|---|
| Cupones y promociones | Cuando el restaurante lance una campaña |
| Hace mucho que no viene | A quienes venían seguido y dejaron de venir |

La diferencia no es de estilo. Un correo de marketing sin consentimiento y sin
baja visible viola la Ley Federal de Protección de Datos Personales, y en la
práctica provoca reportes de spam. **Un reporte de spam mancha el dominio para
todo**: a partir de ahí dejan de llegar también las confirmaciones de reserva.
Por eso MotRest no deja mandarlos sin permiso, aunque el restaurantero encienda
el interruptor.

---

## Qué mirar después

- **Los rebotes.** Si suben, casi siempre es que se están capturando correos mal
  escritos en la ficha de reserva, no un problema de entrega.
- **El tope diario.** Gmail gratuito, ~500 destinatarios/día. Resend gratuito,
  100/día y 3 000/mes. El que se quede corto se pasa al modo MOTRAE.
- **Los correos en cola.** Si el restaurante se queda sin internet, MotRest los
  guarda y los manda al volver — y descarta los que ya no tienen sentido, como
  el recordatorio de una reserva que ya pasó.

---

## Si algo falla

| Síntoma | Casi siempre es |
|---|---|
| «Gmail no aceptó la contraseña de aplicación» | Se pegó la contraseña **del correo**, no la de aplicación; o se revocó desde Google |
| El correo llega desde otra dirección | La **cuenta** y el **remitente** no coinciden (modo Gmail) |
| No sale nada y no hay error | El tipo de correo está **apagado** en «Mensajes para el cliente» |
| Las promociones no salen | Esa persona **no aceptó** recibirlas. Es correcto y no se puede forzar |
| Todo cae en spam | En dominio propio, falta el **DMARC** |
