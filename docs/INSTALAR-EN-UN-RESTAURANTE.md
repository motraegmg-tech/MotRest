# Instalar MotRest en la computadora de un restaurante

Guía para el día de la instalación, y para lo que viene después: actualizaciones
y licencia.

---

## Parte A — El día de la instalación

### A.1 · Preparar la computadora

Es la máquina que se queda en la caja. Todo lo del restaurante vive ahí.

| | Mínimo | Recomendado |
|---|---|---|
| Sistema | Windows 10 64 bits | Windows 11 |
| RAM | 4 GB | 8 GB |
| Disco | 128 GB | **SSD**, 256 GB |
| Red | Wi-Fi | **Cable al módem** |

Tres ajustes de Windows que hay que dejar hechos, y que si se saltan se pagan
caro:

1. **Inicio de sesión automático.** El Hub arranca solo (ADR-22), pero necesita
   que alguien entre a la sesión. Sin esto, el día que se va la luz el
   restaurante enciende la máquina y se queda en la pantalla de contraseña.
   `netplwiz` → quitar la palomita de "los usuarios deben escribir su nombre y
   contraseña".
2. **Que no se suspenda.** Configuración → Sistema → Inicio/apagado → Suspender:
   **Nunca**. Una caja suspendida deja a las tablets sin Hub.
3. **Actualizaciones de Windows en horario de cierre.** Un reinicio a las nueve
   de la noche del viernes es exactamente lo que no puede pasar.

> **Un no-break (UPS) barato es la mejor inversión del despliegue.** No por la
> batería: por proteger el disco de los apagones. Un SSD que se corrompe a media
> operación es el único escenario del que un respaldo tarda horas en sacarte.

### A.2 · Instalar

1. Copiar `MotRest_x.y.z_x64-setup.exe` (USB o descarga).
2. Ejecutarlo. Instala en el usuario, **sin pedir administrador**.
3. Deja instalados: la aplicación de caja, el Hub y el portal del comensal.

Al primer arranque el Hub genera la **clave del local** y su certificado, y se
registra para arrancar con Windows.

### A.3 · Configurar las llaves del equipo

Van como variables de entorno del servicio, **nunca en un archivo del repositorio**:

| Variable | Para qué |
|---|---|
| `MOTREST_LICENCIA_LLAVE` | Comprobar la licencia. **Sin ella el equipo se comporta como si no tuviera.** |
| `MOTREST_ACTUALIZACIONES_REPO` | `motrae/motrest` |
| `MOTREST_ACTUALIZACIONES_LLAVE` | Comprobar la firma de las versiones |
| `MOTREST_RESPALDOS` | Carpeta de copias, mejor fuera del disco |

### A.4 · Activar la licencia

MotRest arranca **sin licencia** y opera con normalidad, avisando. Es a propósito:
arrancar bloqueado el día de la instalación —justo cuando MOTRAE está ahí
montándolo— no tiene ningún sentido.

1. En el Hub, ver el `sucursal_id` que se generó (**Administración → Hub**).
2. En **MOTRAE Central → Restaurantes**, dar de alta el local **con ese mismo
   identificador** y pulsar «Emitir licencia».
3. Copiar el `licencia.json` y pegarlo en **Administración → Licencia**.

> **El identificador tiene que coincidir exactamente.** Es el error más
> frustrante del alta porque no se descubre hasta que uno ya está en el
> restaurante con el archivo pegado y no pasa nada. Una licencia de otro local
> **no se guarda**: si ya había una buena, sigue en su sitio.

La licencia se comprueba **sin internet**: si MOTRAE se cae, los restaurantes al
corriente siguen abriendo. Y vive junto a la base de datos, así que las
actualizaciones no la borran.

### A.4 · Emparejar las tablets

En **Administración → Hub** sale el QR con la dirección y la clave. Cada tablet
lo escanea una vez.

**La primera terminal queda autorizada sola** (si no, nadie podría autorizar a
nadie); de ahí en adelante cada alta la firma una terminal ya autorizada.

### A.5 · Cargar el restaurante

Sin tocar código, desde la aplicación:

1. **Salones y mesas** — dibujar el plano real.
2. **Carta** — a mano o pegando la lista (`Pizzas / Margarita | 249 | 62`).
3. **Usuarios** — cada quien con su PIN y sus permisos.
4. **Impresoras** — cocina y caja.
5. **Mensajes para el cliente** — remitente y qué correos se mandan.

### A.6 · El ensayo antes de abrir

No se entrega sin esto:

```
corepack pnpm@9.15.0 --filter @motrest/hub ensayo
corepack pnpm@9.15.0 --filter @motrest/hub ensayo:portal
```

Y a mano: abrir una mesa, mandar a cocina, cobrar, cerrar el turno y comprobar
que el arqueo cuadra.

---

## Parte B — Actualizaciones

### Cómo funciona

La aplicación pregunta a MOTRAE si hay versión nueva, la descarga y la instala.
**Cada actualización va firmada con la llave privada de MOTRAE**: sin esa firma
la aplicación la rechaza, así que nadie puede empujarle a un restaurante un
MotRest falso aunque le intercepte la conexión.

### Cuándo se instala, y cuándo NO

Esto importa más que el mecanismo:

- **Nunca en horario de servicio.** La comprobación se hace de madrugada y la
  instalación pide confirmación al abrir, no a media cena.
- **Nunca con la caja abierta.** Un turno abierto significa dinero contado a
  medias.
- **Nunca en automático la primera vez de una versión mayor.** Se despliega
  primero en un local, se ve el fin de semana, y después a los demás.

### Qué elige el restaurante

Le aparece **«Hay una nueva actualización disponible»** con tres opciones:
**ahora**, **más tarde** (2 h) o **a una hora** concreta de cierre. Si la
pospone, el aviso se queda puesto en la barra lateral hasta que se instale.

### Publicar una versión

El procedimiento completo está en
[`PUBLICAR-UNA-ACTUALIZACION.md`](PUBLICAR-UNA-ACTUALIZACION.md). En corto: se
sube el instalador y un `motrest.json` firmado a un release de GitHub, desde
**MOTRAE Central → Versiones**.

> **Regla de oro:** una versión nueva se prueba con el ensayo del viernes
> completo **y se instala sobre una instalación anterior** antes de publicarla.
> Hay 1 400 pruebas y dos ensayos contra el binario instalado — la única forma de
> que sirvan es correrlos.

---

## Parte C — Qué pasa si dejan de pagar

| Estado | Cuándo | Qué pasa |
|---|---|---|
| **Activa** | Al corriente | Nada. Ni un aviso. |
| **Por vencer** | 10 días antes | Aviso discreto. Todo funciona. |
| **Gracia** | Vencida, **3 días** | Aviso visible. **Todo sigue funcionando.** |
| **Bloqueada** | Al cuarto día | Pantalla de MOTRAE. **Nada funciona.** |

Durante la gracia no estorba nada. Un aviso que bloquea a medias es lo peor de
los dos mundos: ni cobra ni deja trabajar.

### El bloqueo no cae con la caja abierta

Si al vencer la gracia hay un **turno de caja abierto**, se difiere hasta que
cierren, con un aviso rojo bien visible.

No es suavizar el cobro. Bloquear con doce mesas abiertas encierra ese dinero —el
restaurante no puede cobrarle ni a los que están sentados— y esa llamada de
auxilio le llega a MOTRAE, no al moroso. Difiriendo pierden igual el servicio
siguiente, que es a las pocas horas.

### Lo que hay que decirle al restaurante

- **Su información no se pierde.** Está toda ahí y vuelve intacta al reactivar.
  Es lo primero que teme y lo que menos cuesta aclarar; la propia pantalla de
  bloqueo lo dice.
- **Sus datos siguen siendo suyos.** Si los pide para el SAT, MOTRAE se los
  entrega desde Central. Retenerlos no sería una palanca de cobro, sería un
  problema legal.

### Reactivar

Emitir una licencia nueva en Central y pegarla. **Efecto inmediato**, sin
reinstalar y sin que nadie reinicie nada: las terminales se desbloquean al
momento.

---

## Parte C bis — El acceso de soporte

Cada instalación lleva el usuario **Gonz Motrae**, que no aparece en la lista de
personal del restaurante y sirve para que MOTRAE entre a resolver un problema sin
pedirle a nadie su contraseña. Es el único que puede entrar a un local bloqueado.

Su contraseña la fija Gonzalo en **Central → Llaves** y viaja **dentro de la
licencia firmada**. Consecuencias prácticas:

- Un local sin licencia **no tiene acceso de soporte**.
- Cambiar la contraseña exige **reemitir las licencias** de los locales.
- Todo lo que haga queda en la **bitácora del restaurante** con su nombre, y esa
  bitácora solo agrega.

**Va declarado en el contrato del cliente.** La cláusula está en
[`adr/ADR-24-licencia-y-soporte.md`](adr/ADR-24-licencia-y-soporte.md).

---

## Parte D — Lo que hay que vigilar

Desde **Administración → Hub**, en la caja:

- **Respaldo**: cuándo fue el último y cuántas copias hay. Un respaldo que nadie
  mira es el que falla.
- **Crecimiento del registro**: avisa a los 400 000 eventos (ADR-21).
- **Arranque automático**: encendido.
- **Licencia**: días restantes.

Y una recomendación que no es del software: **que los respaldos salgan de la
computadora**. Apuntar `MOTREST_RESPALDOS` a una carpeta de Google Drive o a un
disco externo. Las copias locales salvan de un borrado, no de que se muera el
disco.
