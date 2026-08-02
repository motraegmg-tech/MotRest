# ADR-23 — WhatsApp: de quién es el número, y por qué hay un relay

**Estado:** aceptado · **Fecha:** 2026-07-30

## Contexto

Hoy la encuesta de satisfacción la contesta el mesero: pregunta "¿qué tal
estuvo?" y la teclea él. Eso no es una encuesta, es la opinión del mesero sobre
su propio servicio. Para que la conteste quien comió hace falta llegarle al
comensal en su teléfono, y de ahí salen tres decisiones que se sostienen entre
sí.

MotRest no es un producto para Rodizio: es un producto que se le aplica a
Rodizio primero. Todo lo que sigue está decidido pensando en el restaurante
número cincuenta, no en el primero.

## Decisión 1 — El número es del RESTAURANTE, la integración es de MOTRAE

Cada restaurante tiene su propia WhatsApp Business Account con **su** número.
MOTRAE tiene **una** aplicación de Meta —como Proveedor de Tecnología— con la
que da de alta a todos sus clientes.

Por qué el número no puede ser de MOTRAE:

- **Confianza.** El comensal recibe "Rodizio", no "MOTRAE". Un mensaje de un
  remitente que no reconoce se reporta como spam, y los reportes tumban números.
- **Es del cliente.** Si un restaurante deja MotRest, se lleva su número y su
  historial. Retenerlo por la infraestructura no es un modelo de negocio, es un
  rehén — y contradice el principio de cobrar por resultado.
- **Aislamiento.** Un restaurante que abusa de las promociones se quema **su**
  número. Con un número compartido, se los llevaría a todos por delante.
- **Costo.** Meta cobra por conversación a quien es dueño de la cuenta. Que cada
  local pague lo suyo evita que MOTRAE cargue con un costo variable ajeno.

Por qué la aplicación sí es de MOTRAE: con el *Embedded Signup* de Meta, el
restaurante conecta su número en unos clics desde MotRest, sin tocar el panel de
Meta ni entender qué es un token. Es la diferencia entre vender software y
regalar una tarea de configuración.

**Lo que MOTRAE tiene que hacer una sola vez:** verificar la empresa en Meta
Business, crear la aplicación y pedir revisión de `whatsapp_business_management`
y `whatsapp_business_messaging`.

**Lo que cada restaurante hace después:** conectar su número desde MotRest.

## Decisión 2 — Un relay delgado, y el Hub sigue sin exponerse

WhatsApp necesita un webhook público con HTTPS. El Hub vive detrás del módem del
restaurante, sin IP fija ni puertos abiertos, y **así debe quedarse**: operar sin
internet es una ventaja del producto (TRD R3), no una limitación.

Entonces hay un servicio en la nube que solo hace de cable:

- comprueba que el webhook venga de verdad de Meta (HMAC del cuerpo crudo);
- averigua a qué restaurante le toca, por el `phone_number_id`;
- se lo empuja a **su** Hub;
- en sentido contrario, llama a la API de Meta con las credenciales de ese local.

**El relay no guarda comandas, ni ventas, ni clientes.** Deliberadamente: un
servicio que acumulara la operación de todos los locales sería el único punto
donde un robo lo compromete todo. Guarda credenciales de envío y una lista de
ids recientes para no procesar dos veces lo mismo.

**El Hub se conecta hacia afuera**, igual que una terminal se conecta al Hub,
solo que un escalón más arriba. Nadie abre un puerto en el restaurante.

## Decisión 3 — Dos canales, cada uno para lo que sirve

No es indecisión: cada canal es bueno en cosas distintas y malo en las del otro.

| | QR → portal web | WhatsApp |
|---|---|---|
| Funciona sin internet | **Sí**, lo sirve el Hub | No |
| Costo por mensaje | Ninguno | Por conversación |
| Captura el teléfono | No | **Sí** |
| Permite avisar después | No | **Sí** |
| Datos estructurados | **Sí** | Limitado a botones y listas |

Reparto:

- **Encuesta y reservas → portal.** Gratis, estructurado, sin pedir teléfono, y
  sigue funcionando el día que se cae el internet del local.
- **Avisos salientes → WhatsApp.** "Su mesa está lista", confirmación de reserva,
  promociones. Es lo único que el portal no puede hacer, porque requiere iniciar
  la conversación.

Y **es configurable por restaurante**: un local sin WhatsApp opera solo con el
portal, y uno que lo prefiera todo por WhatsApp puede apuntar ahí el QR del
ticket. La decisión es del restaurante, no del software.

## Las reglas de Meta viven en el dominio, no en el relay

Están en `clientes/mensajeria.ts` y con pruebas, porque romperlas se paga con el
número del restaurante limitado o bloqueado — y con él se caen la encuesta, los
avisos y las promociones a la vez. Un número quemado no se arregla con código.

1. **Ventana de 24 h.** Cuando el comensal escribe se abre una ventana en que se
   le puede contestar libremente. Fuera de ella, solo plantillas aprobadas.
2. **Consentimiento explícito para marketing**, guardado como evento porque hay
   que poder demostrarlo ante Meta y ante la ley de datos personales.
3. **La baja se honra siempre y de inmediato**, y se reconoce como la escribe la
   gente: "BAJA", "STOP", "cancelar", "salir".

Se añade un tope propio de 4 promociones al mes por contacto. No lo exige Meta:
lo exige no quemar el número.

## Consecuencias

- MOTRAE necesita la verificación de empresa y la revisión de la app **una vez**;
  después, dar de alta un restaurante es cuestión de minutos.
- Aparece un servicio en la nube que hay que pagar y vigilar. Es el único
  componente con costo recurrente y el único expuesto a internet.
- Si el relay se cae, el restaurante **sigue vendiendo**: se pierden los avisos
  de WhatsApp, no la operación. Es la misma postura de todo el sistema.

## Alternativas descartadas

- **Un número de MOTRAE para todos:** más simple de montar, y equivocado por las
  cuatro razones de la Decisión 1.
- **Exponer el Hub a internet:** gratis, y pone el corazón del restaurante en la
  red pública. No.
- **Solo WhatsApp, sin portal:** deja la encuesta a merced de la conexión y del
  costo por conversación, y obliga a pedir el teléfono para opinar.
- **Solo portal, sin WhatsApp:** no se puede avisar "su mesa está lista", que es
  justo donde la lista de espera deja de servir.
