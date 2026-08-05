# Conectar el correo de un restaurante (Resend)

Sustituye a WhatsApp para todo lo que no es urgente. Comparado con la vía de
Meta, esto es **otro mundo de simple**:

| | WhatsApp (Meta) | Correo (Resend) |
|---|---|---|
| Verificación de empresa | 2 días – 3 semanas | **Ninguna** |
| Aprobación de plantillas | Horas – 48 h | **Ninguna** |
| Servicio en la nube (relay) | **Obligatorio** | **No hace falta** |
| Costo | Por conversación | 3 000 correos/mes gratis |
| Alta de un restaurante | Días | **15 minutos** |

**Por qué desaparece el relay.** Mandar un correo es una llamada de salida: el
Hub la hace él mismo desde el restaurante. WhatsApp necesitaba un servicio
público porque Meta tiene que poder *alcanzarnos* para entregar lo que entra. El
correo no entra: si el comensal responde, le llega al buzón del restaurante.

**Dónde el correo no sirve, y hay que decirlo.** «Su mesa está lista» por correo
no funciona: nadie revisa el correo de pie en la puerta. Ese aviso —y solo ese—
sigue necesitando WhatsApp o SMS. Todo lo demás va por correo.

---

## Los pasos, por restaurante

### 1 · Crear la cuenta de Resend

En `resend.com`, con el correo del restaurante. El plan gratuito da **3 000
correos al mes y 100 al día**, que para un restaurante de un local sobra: son
unas 30 confirmaciones de reserva diarias.

### 2 · Verificar su dominio

Esto es lo único que tiene algo de técnica, y es obligatorio: sin dominio
verificado, Resend solo deja mandar a la dirección del dueño de la cuenta.

1. En Resend, **Domains → Add Domain**, poner `rodizio.mx`.
2. Resend muestra tres registros DNS. Se copian tal cual en el panel de donde
   se compró el dominio (GoDaddy, Cloudflare, Namecheap…):
   - **MX** y **TXT (SPF)** — dicen que Resend puede mandar en su nombre.
   - **TXT (DKIM)** — la firma con la que se comprueba que el correo es suyo.
3. Esperar. Suele tardar minutos; el DNS puede tardar hasta 48 horas.
4. Cuando Resend lo marque **verificado**, listo.

> **Si el restaurante no tiene dominio propio**, hay que comprarle uno (unos
> $200 al año). No se puede mandar desde `@gmail.com`: Gmail lo prohíbe
> expresamente y los correos acabarían rechazados o en spam.
>
> Añadir también un registro **DMARC** mejora mucho la entrega:
> `_dmarc.rodizio.mx` con valor `v=DMARC1; p=none; rua=mailto:dueño@rodizio.mx`.

### 3 · Crear la llave de API

**API Keys → Create**, permiso de solo enviar. Se copia una vez y ya no se
vuelve a mostrar.

> La llave se guarda **en el Hub**, nunca en las terminales. Una credencial que
> puede mandar correo en nombre del restaurante no tiene por qué estar en el
> teléfono de un mesero.

Se pone como variable de entorno del Hub:

```
MOTREST_RESEND_KEY=re_...
```

### 4 · Configurar en MotRest

En **Administración → Mensajes para el cliente**:

- **Remitente**: `Rodizio <reservas@rodizio.mx>`. Con el nombre delante, el
  comensal ve el restaurante y no una dirección.
- **Nombre del local**, para los asuntos.
- **Responder a**: a dónde contesta si le da a «Responder».
- **Teléfono**: aparece como botón **Llamar al restaurante** en cada correo.
- Encender los correos que quiera mandar.

### 5 · Probar

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

- **La reputación del dominio.** Resend muestra entregas, rebotes y quejas. Si
  los rebotes suben, casi siempre es que se están capturando correos mal
  escritos en la ficha de reserva.
- **El tope diario del plan gratuito** (100/día). Un local con mucha reserva
  puede necesitar el plan de pago (~$20 USD/mes por 50 000).
- **Los correos en cola.** Si el restaurante se queda sin internet, MotRest los
  guarda y los manda al volver — y descarta los que ya no tienen sentido, como
  el recordatorio de una reserva que ya pasó.
