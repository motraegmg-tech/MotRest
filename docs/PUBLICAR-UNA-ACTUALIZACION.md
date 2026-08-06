# Publicar una actualización de MotRest

Cómo llega una versión nueva a todos los restaurantes.

> **Antes de nada:** una actualización se instala sola en **todos** los locales.
> Si sale rota, salen rotos todos a la vez, y no hay forma de deshacerlo — hay
> que publicar otra y esperar a que la bajen. Todo lo de esta guía existe por eso.

---

## Cómo funciona, en dos líneas

MOTRAE sube el instalador a un **release de GitHub** junto a un `motrest.json`
firmado. Cada Hub pregunta cada 12 horas, **comprueba la firma antes de descargar
nada**, y le avisa al restaurante. El restaurante decide cuándo se instala.

**Por qué GitHub Releases:** es gratis, sirve por HTTPS con la disponibilidad de
GitHub detrás, y no hay servidor de descargas que montar ni pagar.

**Por qué la firma:** el canal de actualización es la llave maestra de todas las
instalaciones. Con el manifiesto firmado, ni siquiera hace falta confiar en
GitHub — si alguien tomara la cuenta, sin el secreto de MOTRAE no cuela nada.

---

## Preparativos, una sola vez

1. Crear el repositorio (puede ser **privado**; entonces hace falta un token).
2. En **MOTRAE Central → Llaves**, generar el *secreto de publicación* y anotar
   el repositorio. Debe ser **distinto** del de licencias: si se filtrara uno, el
   otro sigue protegiendo lo suyo.
3. En cada Hub, en el instalador:
   ```
   MOTREST_ACTUALIZACIONES_REPO=motrae/motrest
   MOTREST_ACTUALIZACIONES_LLAVE=<secreto de publicación>
   MOTREST_ACTUALIZACIONES_TOKEN=<solo si el repositorio es privado>
   ```

Un local sin estas variables **no se actualiza solo**, y no es un error: se
actualiza a mano pasándole el `.exe`.

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
  "firma": "…"
}
```

**Las notas las lee el restaurantero.** "Se corrigió el reducer de propinas" no
le dice nada; "las propinas del corte ya cuadran con lo que declaró el cajero"
sí.

### 4 · Subir el release

Un release en GitHub con **dos archivos**: el instalador y `motrest.json`.
El nombre del manifiesto tiene que ser exactamente ese.

**Los borradores y las preliminares no llegan a nadie.** Sirven para probar el
circuito completo sin tocar a ningún restaurante.

### 5 · Desplegar por partes

No se publica a todos a la vez cuando es una versión mayor:

1. Se publica.
2. Se instala en **un** local y se ve el fin de semana completo.
3. Si aguantó el viernes, ya está en la calle para los demás.

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
Suele ser que se firmó con un secreto y el Hub tiene otro.

**La huella no coincide.** El instalador se tira y no se instala. Normalmente es
que se subió un `.exe` distinto del que se firmó.
