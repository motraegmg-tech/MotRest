# Publicar una actualización de MotRest

Cómo llega una versión nueva a todos los restaurantes.

> **Antes de nada:** una actualización llega como aviso a todos los locales; cada
> restaurante la confirma fuera de servicio. Si sale rota, hay que publicar otra
> versión y esperar a que los Hubs la vean. Todo lo de esta guía existe por eso.

---

## Cómo funciona, en dos líneas

MOTRAE sube el instalador desde **MotRest Central**, que lo guarda en la nube y
firma un manifiesto. Cada Hub pregunta cada 12 horas, **comprueba la firma antes
de descargar nada**, y le avisa al restaurante. El restaurante decide cuándo se
instala. Al llegar la hora, el Hub prepara un guion de relevo, cierra la caja,
instala en silencio y la vuelve a abrir.

### Dónde vive el canal: la nube primero, GitHub de respaldo

> **Esto cambió con la migración a Supabase y el resto de esta guía tardó en
> enterarse.** Si algo de más abajo habla de subir archivos a mano a un release
> de GitHub, manda lo de aquí.

- **El camino normal es la nube.** Central sube el `.exe` a
  `storage/v1/object/instaladores/<version>.exe` y publica el manifiesto
  firmado. El Hub de un local que ya habla con la nube lo lee de ahí
  (`origen.nube` en `apps/hub/src/actualizaciones.ts`).
- **GitHub Releases queda de respaldo**, para un local que todavía no está
  enlazado a la nube. Ese Hub cae a
  `api.github.com/repos/<dueño>/<repo>/releases/latest`, que es el canal
  incrustado en el binario.

Los dos caminos verifican **la misma firma**, así que no hay uno «más seguro»:
lo que decide si un instalador corre es el manifiesto firmado, no de dónde vino.

> ### NO SON DOS CANALES QUE SE COMPLEMENTAN. Son dos públicos distintos.
>
> `traerManifiesto()` es explícito: **si el local tiene enlace con la nube, mira
> la nube y solo la nube.** GitHub no es su respaldo — es la vía de los locales
> que aún no están enlazados. Publicar únicamente en GitHub deja fuera a toda la
> flota enlazada, sin un solo error en ninguna parte.
>
> Medido el 13-sep-2026: la nube tenía **una** versión, la 1.4.1. Las 1.5.0,
> 1.5.1 y 1.5.2 se habían publicado solo en GitHub. Tres versiones que no le
> llegaron a nadie, con el panel en verde. Antes de publicar, mira quién lee de
> dónde: en el paso de elegir locales, cada uno lo dice al lado de su casilla.

**Por qué la firma:** el canal de actualización es la llave maestra de todas las
instalaciones. Con el manifiesto firmado, ni siquiera hace falta confiar en el
sitio que sirve el archivo — sin la **llave privada** de MOTRAE no cuela nada.
Las públicas que verifican van en los Hubs y no permiten firmar.

> **Central tiene que estar al día para publicar.** El panel sube el instalador
> a la nube, y esa capacidad se arregló el 3 de septiembre de 2026. Un Central
> anterior firma el manifiesto pero no sube el archivo, y los Hubs se quedan
> buscando algo que no existe. Antes de publicar, comprueba la versión de tu
> Central — y recuerda que Central **no se actualiza sola**: hay que recompilar
> el `.exe` (ver `ACTUALIZAR-CENTRAL.md` si existe, o `pnpm run build` en
> `apps/central-escritorio`).

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
   $env:MOTREST_ACTUALIZACIONES_REPO="motraegmg-tech/MotRest"
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
corepack pnpm@9.15.0 --filter @motrest/escritorio build
```

Ese único comando encadena los tres pasos que hacen falta —compilar el POS,
empaquetar el Hub y armar el instalador—, y en ese orden: `tauri build` a secas
**no reconstruye lo que empaqueta** y saca un instalador con código viejo sin
avisar. Antes hay que exportar las llaves públicas y el repositorio (ver
«Preparativos»), o el empaquetado aborta.

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
  "url": "https://github.com/motraegmg-tech/MotRest/releases/download/v1.5.0/MotRest_setup.exe",
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

**La etiqueta es la versión desnuda: `1.5.3`, sin `v`.** Se cambió en la 1.3.6 y
sigue costando disgustos, porque la URL del manifiesto se compone con ella: el
manifiesto de la **1.5.2** salió firmado apuntando a `…/download/v1.5.2/…` con el
archivo colgando de `…/download/1.5.2/…`. La firma verificaba, así que cada local
sin enlace veía el aviso, lo aceptaba y fallaba al descargar con un 404.

Desde entonces hay dos candados en Central: el botón **«Componer la de GitHub»**,
para no teclearla, y una comprobación al firmar que **rechaza** una URL cuya
etiqueta no sea la versión que se publica.

**Los borradores y las preliminares no llegan a nadie.** Sirven para probar el
circuito completo sin tocar a ningún restaurante — y también para **retirar de la
circulación un release defectuoso**: marcarlo como preliminar lo saca de
`releases/latest` en el acto, sin borrar nada y sin tocar su etiqueta.

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

Aparece **«Hay una nueva actualización disponible»** con la versión y la lista
de mejoras, y dos opciones:

| Opción | Qué hace |
|---|---|
| **Actualizar ahora** | Abre la confirmación |
| **Más tarde** | Vuelve a preguntar en 2 horas |

Si lo pospone, **el aviso se queda puesto** en la barra lateral hasta que se
instale, y se puede tocar para reabrirlo. Un aviso que desaparece al posponerlo
es una versión que nunca se instala.

### La confirmación

«Actualizar ahora» no instala: abre una segunda pantalla que dice
**«¿Actualizar ahora a MotRest X.Y.Z?»**, repite las mejoras, y —lo importante—
enseña **qué hay abierto en ese momento**: el turno de caja y las mesas con
cuenta. Con eso delante, el restaurante decide.

Es la única pregunta doble del producto. Se gana el sitio porque es lo único que
apaga la caja.

### Ya no hay horario prohibido

**Se instala cuando el restaurante lo diga, a cualquier hora.** Antes había una
ventana de 23:00 a 06:00 y el sistema se negaba fuera de ella incluso si habían
pulsado «ahora».

Se quitó porque la ventana era una suposición: MotRest no conoce el horario de
ningún local —uno da desayunos, otro abre solo de noche—, así que un lunes a las
once de la mañana, con la persiana abajo y nadie dentro, tampoco dejaba
actualizar. La versión se quedaba esperando una madrugada.

Lo que no se perdió es la advertencia. Un turno de caja abierto en mitad de un
reinicio sigue dejando un arqueo que no cuadra; lo que cambió es **quién
decide**. El Hub anota en su bitácora cuando instala con un turno abierto: el
día que un arqueo no cuadre, esa línea explica por qué.

### `obligatoria`

Quita el "más tarde". **Resérvelo para un fallo de seguridad o un cambio del SAT
con fecha.** Si todo es obligatorio, nada lo es, y el restaurante deja de
distinguir cuál lo era de verdad.

---

## Comprobar el canal antes y después (tres consultas)

El panel enseña lo que Central hizo; esto enseña lo que la nube tiene. Son
lecturas, no escriben nada:

```sql
select version, canal, url, publicado_ts from versiones order by publicado_ts desc;
select * from asignaciones;
select sucursal_id, version, ts from pulsos order by ts desc;
```

- `versiones` tiene que traer la recién publicada. Si no está, se firmó pero no
  se publicó en la nube.
- `asignaciones` decide a quién se le ofrece. **Ojo con `version_fijada`:**
  manda por encima de todo, así que un local clavado en una versión vieja no
  recibe nada, ni siquiera lo más nuevo del canal. Se clava al marcarlo en el
  paso de publicar —y se vuelve a mover marcándolo otra vez—. Pasó: el local de
  pruebas quedó fijado en 1.4.1 con el Hub corriendo 1.5.0, o sea mudo para
  siempre.
- `pulsos` dice qué corre cada local de verdad. Un local que no aparece **no
  está enlazado**: va por GitHub, y su licencia necesita el bloque `nube`.

## Si algo sale mal

**Una versión rota ya publicada.** Publicar la siguiente con el arreglo, subiendo
el número. No se puede "despublicar": los Hubs que ya la bajaron la tienen. Lo
que sí se puede es **dejar de ofrecérsela a quien todavía no la tiene**:

- *En GitHub:* márcala como preliminar y sale de `releases/latest` al instante.
  ```
  gh release edit 1.5.2 --prerelease
  ```
- *En la nube:* `retirada_ts` en su fila de `versiones` la saca del reparto
  (`privado.version_ofrecida` la ignora).

**La firma no cuadra.** El Hub la ignora y lo anota como **error** en su bitácora.
Suele ser que el instalador lleva una pública distinta de la privada con la que
se firmó; recompila el Hub con la pública correspondiente.

**La huella no coincide.** El instalador se tira y no se instala. Normalmente es
que se subió un `.exe` distinto del que se firmó.
