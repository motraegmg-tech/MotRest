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

### A.3 · Activar la licencia

MotRest arranca **sin licencia** y lo dice. Para activarlo:

1. En el Hub, ver el `sucursal_id` que se generó (**Administración → Hub**).
2. Desde MOTRAE, emitir la licencia para ese `sucursal_id` con su vigencia.
3. Pegarla en **Administración → Licencia**, o dejar el archivo
   `licencia.json` junto a la base de datos.

La licencia es un documento **firmado** y se comprueba **sin internet**: si
MOTRAE se cae, los restaurantes siguen abriendo.

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

### Publicar una versión

1. Subir la versión y firmar el instalador.
2. Publicar el manifiesto con la versión, las notas y la firma.
3. Los Hubs la ven en su siguiente comprobación.

> **Regla de oro:** una versión nueva se prueba con el ensayo del viernes
> completo antes de publicarla. Ya hay 1 200 pruebas y dos ensayos contra el
> binario instalado — la única forma de que sirvan es correrlos.

---

## Parte C — Qué pasa si dejan de pagar

Diseñado con una regla por encima de todas: **nunca dejar al restaurante sin
vender**. Un POS que se apaga a media cena es una catástrofe, y sería culpa de
MOTRAE.

| Estado | Cuándo | Qué pasa |
|---|---|---|
| **Activa** | Al corriente | Nada. Ni un aviso. |
| **Por vencer** | 10 días antes | Aviso discreto. Todo funciona. |
| **Gracia** | Vencida, dentro de los días pactados | Aviso visible. **Todo sigue funcionando.** |
| **Restringida** | Pasada la gracia | Puede vender, cobrar, cerrar caja e imprimir cortes. **No** puede abrir turnos nuevos ni dar de alta terminales. |

**Lo que NUNCA se bloquea, ni debiendo tres meses:**

- **Vender y cobrar.** Hay comensales esperando su cuenta.
- **Cerrar la caja e imprimir el corte.**
- **Exportar toda su información.** Sus ventas son suyas y las necesita para el
  SAT. Retenerlas no es una palanca de cobro: es un problema legal.

La gracia existe para que un pago atrasado dos días no le cueste un viernes al
restaurante. Restringir de más convierte un cobro pendiente en un local parado,
y eso destruye la relación mucho más rápido de lo que la falta de pago la
merece.

### Reactivar

Emitir una licencia nueva y pegarla. Efecto inmediato, sin reinstalar y sin
perder nada.

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
