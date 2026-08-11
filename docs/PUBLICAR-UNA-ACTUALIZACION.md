# Publicar una actualización de MotRest

Cómo llega una versión nueva a todos los restaurantes.

> **Antes de nada:** una actualización llega como aviso a todos los locales; cada
> restaurante la confirma fuera de servicio. Si sale rota, hay que publicar otra
> versión y esperar a que los Hubs la vean. Todo lo de esta guía existe por eso.

---

## Cómo funciona, en dos líneas

MOTRAE sube el instalador a un **release de GitHub** junto a un `motrest.json`
firmado. Cada Hub pregunta cada 12 horas, **comprueba la firma antes de descargar
nada**, y le avisa al restaurante. El restaurante decide cuándo se instala. Al
llegar la hora, el Hub prepara un guion de relevo, cierra la caja, instala en
silencio y la vuelve a abrir.

**Por qué GitHub Releases:** es gratis, sirve por HTTPS con la disponibilidad de
GitHub detrás, y no hay servidor de descargas que montar ni pagar.

**Por qué la firma:** el canal de actualización es la llave maestra de todas las
instalaciones. Con el manifiesto firmado, ni siquiera hace falta confiar en
GitHub — si alguien tomara la cuenta, sin la **llave privada** de MOTRAE no
cuela nada. Las públicas que verifican van en los Hubs y no permiten firmar.

---

## Preparativos, una sola vez

1. Crear el repositorio (puede ser **privado**; entonces hace falta un token).
2. En **MotRest Central → Llaves**, generar los dos pares Ed25519 y anotar el
   repositorio. La pública de publicación debe ser distinta de la pública de
   licencias.
3. Antes de crear el instalador, incrustar las públicas y el repositorio en el Hub:
   ```
   $env:MOTREST_LICENCIA_PUBLICA=<Central → pública de licencias>
   $env:MOTREST_ACTUALIZACIONES_PUBLICA=<Central → pública de publicación>
   $env:MOTREST_ACTUALIZACIONES_REPO="motrae/motrest"
   corepack pnpm@9.15.0 --filter @motrest/hub empaquetar
   ```
4. En cada Hub, si el repositorio es privado, se configura
   `MOTREST_ACTUALIZACIONES_TOKEN`. El token se envía únicamente a HTTPS de
   GitHub, nunca a la URL que traiga un manifiesto. El repositorio ya va incrustado
   en el binario.

Un local con el canal incrustado se actualizará solo. El primer salto desde una
instalación que no lo tiene requiere llevarle el instalador a mano una vez.

---

## Publicar una versión

### 1 · Compilar y firmar el instalador

```
corepack pnpm@9.15.0 -r build
corepack pnpm@9.15.0 --filter motrest-escritorio tauri build
```

Firmar el `.exe` (ver [`FIRMA-DEL-INSTALADOR.md`](FIRMA-DEL-INSTALADOR.md)) y
sacar su huella:

```
Get-FileHash .\MotRest_1.5.0_x64-setup.exe
```

### 2 · Pasar la lista de comprobación

En **Central → Versiones**. Hasta que no está completa, el botón de firmar no se
enciende. No es burocracia — cada renglón corresponde a algo que ya salió mal en
algún despliegue de alguien:

- [ ] Toda la suite pasa (dominio, hub, pos-ui)
- [ ] El ensayo del viernes corre completo **contra el binario instalado**
- [ ] Vi la aplicación funcionando con esta versión (la vista previa está ahí)
- [ ] Instalé el `.exe` **sobre una instalación anterior**, sin perder datos
- [ ] Las notas están escritas para el restaurantero, no para mí

> **Lo de instalar sobre una instalación anterior es lo que más se salta y lo que
> más caro sale.** Una versión que funciona perfecta en limpio puede romper la
> migración de datos de quien ya tenía operación.

### 3 · Firmar el manifiesto

Central genera el `motrest.json`:

```json
{
  "version": "1.5.0",
  "notas": "Los cortes salen más rápido y se arregló el ticket de cocina.",
  "url": "https://github.com/motrae/motrest/releases/download/v1.5.0/MotRest_setup.exe",
  "sha256": "…",
  "publicado_ts": 1786048000000,
  "version_minima_soportada": "1.4.2",
  "firma": "…"
}
```

**Las notas las lee el restaurantero.** "Se corrigió el reducer de propinas" no
le dice nada; "las propinas del corte ya cuadran con lo que declaró el cajero"
sí.

`version_minima_soportada` es opcional. Úsala al retirar una versión vulnerable;
el Hub avisará que la instalada está por debajo del piso de seguridad. Central
genera un `publicado_ts` estrictamente creciente para que un release firmado
viejo no pueda revertir el canal.

### 4 · Subir el release

Un release en GitHub con **dos archivos**: el instalador y `motrest.json`.
El nombre del manifiesto tiene que ser exactamente ese.

**Los borradores y las preliminares no llegan a nadie.** Sirven para probar el
circuito completo sin tocar a ningún restaurante.

### 5 · Desplegar por anillos

No se publica a todos a la vez cuando es una versión mayor:

1. Se publica especificando un porcentaje en el campo **Anillo** de Central.
2. El Hub solo recuerda el manifiesto si su local cae dentro de ese porcentaje
   (calculado de forma determinista para que siempre entren los mismos primero).
3. Se ve el fin de semana completo en esa fracción de la flota.
4. Si aguantó el viernes, se publica un nuevo manifiesto subiendo el anillo a
   vacío (todos) para llegar a los demás.

---

## Qué ve el restaurante

Aparece **«Hay una nueva actualización disponible»** con la versión, las notas y
tres opciones:

| Opción | Qué hace |
|---|---|
| **Actualizar ahora** | Se instala en cuanto sea seguro |
| **Más tarde** | Vuelve a preguntar en 2 horas |
| **A una hora…** | 23:00, 00:00, 01:00… solo horarios de cierre |

Si lo pospone, **el aviso se queda puesto** en la barra lateral hasta que se
instale, y se puede tocar para reabrirlo. Un aviso que desaparece al posponerlo
es una versión que nunca se instala.

### Lo que el sistema no deja hacer, aunque lo pidan

- **Nunca con la caja abierta.** Un turno abierto es dinero contado a medias:
  reiniciar ahí deja un arqueo que no cuadra y nadie sabe por qué.
- **Nunca en horario de servicio.** Se comprueba aunque el restaurante haya
  dicho "instala ahora": quien elige eso a las nueve de la noche no está pensando
  en las doce mesas abiertas.

### `obligatoria`

Quita el "más tarde". **Resérvelo para un fallo de seguridad o un cambio del SAT
con fecha.** Si todo es obligatorio, nada lo es, y el restaurante deja de
distinguir cuál lo era de verdad.

---

## Si algo sale mal

**Una versión rota ya publicada.** Publicar la siguiente con el arreglo, subiendo
el número. No se puede "despublicar": los Hubs que ya la bajaron la tienen.

**La firma no cuadra.** El Hub la ignora y lo anota como **error** en su bitácora.
Suele ser que el instalador lleva una pública distinta de la privada con la que
se firmó; recompila el Hub con la pública correspondiente.

**La huella no coincide.** El instalador se tira y no se instala. Normalmente es
que se subió un `.exe` distinto del que se firmó.
