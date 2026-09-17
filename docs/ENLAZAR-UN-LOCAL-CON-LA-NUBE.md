# Enlazar un local con la nube — el viaje que solo se hace una vez

Para qué sirve: a partir de que un restaurante queda enlazado, **cortarle el
servicio y renovárselo se hace desde Central y llega solo**. Hasta entonces, cada
cosa exige ir a su caja.

> ## Para un restaurante nuevo, esto ya no hace falta
>
> Desde Central 1.4.3, **dar de alta un restaurante lo enlaza solo**: el panel
> crea su identidad en la nube y guarda su credencial en el mismo gesto, así que
> su primera licencia ya sale con el enlace dentro. Ya no hay que ejecutar
> `alta-nube` ni pegar credenciales a mano.
>
> Si el alta no pudo hablar con la nube —internet caído mientras tenías al
> cliente delante— el restaurante se crea igual y su ficha lo dice, con un botón
> **«Enlazar con la nube»** para reintentarlo. Pulsarlo dos veces es seguro.
>
> Lo que sigue en este documento aplica a los locales **anteriores** a ese
> cambio, que son los que tienen licencia sin bloque `nube`.

---

## Por qué hay que ir una vez, y una sola

El enlace con la nube —la dirección y la credencial de ese local— **viaja dentro
de la licencia firmada**. No está en el instalador ni se configura en una
pantalla: es parte del documento que MOTRAE firma para ese restaurante.

De ahí sale el huevo y la gallina: un local cuya licencia instalada es **anterior
al 28 de agosto de 2026** no lleva ese bloque, así que no puede hablar con la
nube; y como no puede hablar con la nube, no puede recibir la licencia nueva que
sí lo llevaría. Alguien tiene que llevarle esa primera licencia a mano.

Después de eso, ya no hace falta volver.

## Cómo saber si un local está enlazado

En Central, la señal es **si ha reportado alguna vez**. Un local enlazado manda
su parte al arrancar y una vez al día. Uno que nunca ha reportado aparece sin
señal, y eso NO es un problema de red: es que estructuralmente no puede
reportar.

Medido el 17 de septiembre de 2026, de tres locales solo uno había reportado
alguna vez. Los otros dos llevaban meses con licencias esperándolos en la nube
que nunca iban a recoger, y nada en el panel lo decía.

> Desde la 1.5.4, la ventana de **Cortar el servicio** avisa antes de que
> confirmes: si ese local nunca ha reportado, te dice que el corte no le va a
> llegar y que hay que pegarle el archivo.

---

## El procedimiento

### 1 · Primero instala la 1.5.4, después pega la licencia

**El orden importa y es la parte que se puede hacer mal sin enterarse.**

Hasta la 1.5.3, el Hub montaba el enlace **solo al arrancar**. Así que pegar la
licencia en un local con versión anterior la instala, contesta que todo bien… y
el enlace no se monta hasta que alguien reinicie el Hub. El local sigue mudo y
parece que la licencia no sirvió.

Desde la 1.5.4 el Hub **monta el enlace en caliente**, en cuanto se instala una
licencia que lo trae. Por eso conviene este orden:

1. Instalar `MotRest_1.5.4_x64-setup.exe` sobre lo que tenga.
2. Ya con la 1.5.4 corriendo, pegar la licencia.

Si por lo que sea pegas la licencia en una versión anterior, no está perdido:
basta con **reiniciar el Hub** (o el equipo) para que el enlace suba.

### 2 · Emite la licencia en Central

En **Central → Restaurantes**, elige el local y pulsa **Renovar licencia**.
Central la deposita en la nube y además te enseña el JSON para copiarlo, que es
justo lo que necesitas cuando el local todavía no puede recogerlo solo.

Comprueba que el texto que vas a copiar trae un bloque `nube` con `url` y
`clave`. Si no lo trae, **no sirve para enlazar** y hay que resolver eso antes:
faltan `nube_url` (Central → Llaves) o la credencial de ese local
(Central → Editar local → «Credencial de la nube de este local»).

### 3 · Pégala en el local

En la caja del restaurante, entra a MotRest con la **cuenta de soporte de
MOTRAE** — la sección no existe para nadie más — y ve a:

**Administración → Licencia del local**

Pega el JSON y guarda.

### 4 · Comprueba que quedó, en la bitácora del local

No te fíes del «ok» de la pantalla. En la bitácora del Hub tienen que aparecer
**dos renglones seguidos**, y son dos a propósito:

```
Enlace con MOTRAE establecido desde la licencia nueva, sin reiniciar nada
Enlace con la nube de MotRest establecido
```

El primero dice que el Hub decidió montarlo; el segundo, que la conexión se
abrió de verdad. Si solo sale el primero, el enlace no llegó a establecerse
—revisa la salida a internet del local— y ahí todavía no está enlazado.

### 5 · Confírmalo desde tu lado

En Central, el local tiene que pasar a **reportar**. Si en unos minutos sigue sin
señal, no quedó.

---

## Después de enlazarlo, qué cambia

| Acción en Central | Antes | Ahora |
|---|---|---|
| Renovar licencia | Ir a la caja | Llega sola en segundos; si está apagado, al encender |
| Cortar el servicio | Ir a la caja | Llega solo, y bloquea al cerrar la caja |
| Ver qué versión corre | Preguntar por teléfono | En el panel |
| Saber si opera | Preguntar por teléfono | En el panel |

### Cuándo cae un corte

No corta a media cena. El local **termina la jornada que esté trabajando** y
queda bloqueado **al cerrar la caja**: a la mañana siguiente se encuentra la
pantalla de MOTRAE con el teléfono para regularizar.

Si no cierra la caja, el bloqueo cae igual **a las 36 horas**. Ese techo va
dentro de la licencia firmada, así que el local no puede empujarlo, y existe
porque una caja que no se cierra —por defecto o a propósito— dejaba el corte
esperando indefinidamente.

**Renovar lo devuelve a trabajar en el acto**, con toda su información intacta y
sin que nadie reinicie nada. Es lo que convierte el corte en una palanca de
cobro en vez de un castigo.

---

## Lo que hay pendiente ahora mismo (17-sep-2026)

- **Rodizio** (`suc-rodizio-centro`) tiene una licencia buena depositada desde el
  11 de septiembre, válida hasta noviembre de 2027 y con su bloque `nube`. Solo
  hay que pegársela. No hace falta emitir otra.
- **`suc-prub-alej`** tiene depositado un **corte**, no una licencia de trabajo, y
  encima firmado con las reglas viejas: **bloquea en el acto**, sin esperar al
  cierre de caja. Si lo que quieres es dejar ese local trabajando, emítele una
  licencia nueva desde Central antes de pegar nada. Si lo que quieres es
  cortarlo, vuelve a pulsar «Cortar el servicio» con la Central 1.4.3 para que
  salga con las reglas nuevas.

Ver también [`INSTALAR-EN-UN-RESTAURANTE.md`](INSTALAR-EN-UN-RESTAURANTE.md) y
[`ALTA-DE-LICENCIA.md`](ALTA-DE-LICENCIA.md).
