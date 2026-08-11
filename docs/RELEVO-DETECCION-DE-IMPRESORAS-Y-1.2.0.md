# Relevo · Detección de impresoras y versión 1.2.0

Documento para que otra persona —u otro asistente— retome este trabajo sin
tener que reconstruir el contexto. Escrito el **9 de agosto de 2026**.

Rama: `feature/impresion-usb`. **Nada está commiteado**: todo vive en el árbol
de trabajo — 55 archivos modificados y 11 nuevos, +3131 / −306 líneas. El estado
exacto se ve con `git status`.

> **Dos archivos del árbol NO son de este trabajo** y conviene no arrastrarlos
> sin preguntar: `inspect.cjs` (un script suelto de Gonzalo para leer la base del
> Hub) y `docs/motrest.json` (el manifiesto de la 1.1.2, que él modificó a mano).
> Además, parte de lo que hay en `menu.svelte.ts`, `plano.svelte.ts`,
> `sync.svelte.ts`, `catalogo/menu.ts` y `menu.test.ts` es trabajo suyo previo
> —el saneo de ids repetidos del catálogo y las guardas de puerto de impresora—
> que ya estaba sin commitear cuando empezó esta tanda.

### Archivos nuevos

```
packages/dominio/src/personal/asignaciones.ts          rol de mesas (dominio)
packages/dominio/src/__tests__/asignaciones.test.ts
apps/hub/src/impresion/buscador.ts                     detección de impresoras
apps/hub/src/__tests__/buscador-impresoras.test.ts
apps/pos-ui/src/lib/asignaciones.svelte.ts             rol de mesas (store)
apps/pos-ui/src/lib/vista-mesa.svelte.ts               el paso de CADA mesa
apps/pos-ui/src/lib/avisos-cocina.svelte.ts            «tu platillo está listo»
apps/pos-ui/src/lib/AvisosDeCocina.svelte
apps/pos-ui/src/lib/modulos/personal/RolDeMesas.svelte tabla semanal
apps/pos-ui/src/lib/modulos/finanzas/VentasPorDia.svelte
docs/RELEVO-DETECCION-DE-IMPRESORAS-Y-1.2.0.md         este archivo
```

---

## 1 · Qué se hizo en esta tanda

### Las 13 mejoras del POS (tanda anterior, ya terminada)

Dónde vive cada una:

| # | Qué pidió Gonzalo | Dónde quedó |
|---|---|---|
| 1 | Bienvenida solo la primera vez, con el nombre de Central | `identidad/responsable.ts` (`localYaEstrenado`), `sesion.svelte.ts`, `AltaResponsable.svelte` |
| 2 | Propina libre que sí se guarda + «Tarjeta y efectivo» | `PanelCuenta.svelte`, `pos.svelte.ts` (`cobrarMixto`, `registrarPagos`) |
| 3 | Cada mesa recuerda su paso | `vista-mesa.svelte.ts`, `PanelCuenta.svelte`, `Venta.svelte` |
| 4 | Mesero marca entregado + precios con IVA | acción `pos.item.entregar`, `PanelCuenta.svelte`, `CatalogoProductos.svelte`, `PanelMesa.svelte` |
| 5 | Rol de mesas por día | `personal/asignaciones.ts`, `asignaciones.svelte.ts`, `RolDeMesas.svelte`, pie de `PanelMesa.svelte` |
| 6 | Colores del KDS + aviso al mesero + animación | `cocina/Tablero.svelte`, `avisos-cocina.svelte.ts`, `AvisosDeCocina.svelte` |
| 7 | Estaciones desde Cocina + «Recall» explicado | `cocina/Menu.svelte`, `admin/Catalogo.svelte` (`?ver=estaciones`), `Tablero.svelte` |
| 8 | «Precio de carta» = precio final | `catalogo/productos.ts`, `comun/impuestos.ts`, `EditorProducto.svelte` |
| 9 | Ingredientes y gramaje → inventario | `catalogo/recetas.ts` (`costoDesdeInsumo`), `EditorReceta.svelte`, `Inventario.svelte` |
| 10 | Finanzas por día y retención | `finanzas/VentasPorDia.svelte`, `local.svelte.ts` |
| 11 | Prenómina con sueldo por día y faltas | `personal/prenomina.ts`, `prenomina.svelte.ts`, `Personal.svelte` |
| 12 | Inteligencia con IVA | `inteligencia/reportes.ts`, `Inteligencia.svelte` |
| 13 | Cada impresora imprime solo lo suyo | `packages/impresion/src/cola.ts` |

Las dos decisiones que hay que conocer antes de tocar nada:

1. **El precio de un platillo se guarda CON el impuesto dentro.** El producto
   lleva `precio_incluye_impuesto`; `perfilDelProducto()` en
   `packages/dominio/src/comun/impuestos.ts` lo aplica al leer y
   `construirRenglon` lo congela en el snapshot del renglón. Un producto sin la
   bandera conserva el significado viejo (el precio es la base gravable).
   Se descartó despejar la base hacia atrás porque con IVA del 16 % **276 de los
   2000 primeros precios redondos son inalcanzables** (7.00, 99.00, 128.00…).
   Margen y food cost se miden siempre contra `impuesto.base`.

2. **Cada impresora imprime SOLO sus áreas.** `impresoraPara()` en
   `packages/impresion/src/cola.ts` ya no cae a la impresora de «caja» cuando un
   área no tiene ninguna asignada. Eso era lo que hacía que apagar la de cocina
   mandara todas las comandas al rollo de la caja.

### La detección de impresoras (esta tanda)

**Qué resuelve.** Montar un local exigía saber la IP de cada impresora de red y
el nombre exacto con el que Windows dio de alta la de USB. Ahora se buscan
solas y lo único que queda por decidir es qué imprime cada una.

**Piezas nuevas:**

| Archivo | Qué hace |
|---|---|
| `apps/hub/src/impresion/buscador.ts` | El motor: lista las de Windows y barre la LAN en el puerto 9100 |
| `apps/hub/src/main.ts` → `/impresoras-detectadas` | El endpoint. `?red=1` activa el barrido |
| `apps/hub/src/seguridad-http.ts` | Cuota de 10 llamadas: el barrido abre cientos de sockets |
| `apps/pos-ui/src/lib/impresion.svelte.ts` | `buscar()`, `adoptar()`, `probarDetectada()`, `yaConfigurada()` |
| `apps/pos-ui/src/lib/modulos/admin/Impresoras.svelte` | El asistente: buscar → probar → elegir qué imprime → conectar |
| `apps/hub/src/__tests__/buscador-impresoras.test.ts` | 13 pruebas |

**Las reglas que NO hay que aflojar** (están comentadas en el código, se repiten
aquí porque son las que importan):

- El barrido **no acepta que le digan qué red mirar**. Sale de las interfaces
  del propio equipo y descarta todo lo que no sea IPv4 privada. Si eso se
  parametrizara, el endpoint se convertiría en un escáner de puertos a domicilio.
- Se limita a **/24 y solo al puerto 9100**. Un /16 son 65 000 sondeos.
- El sondeo **abre y cierra el socket sin escribir un byte**: descubrir una
  impresora no puede gastarle papel.
- Las impresoras virtuales (PDF, XPS, fax, AnyDesk) se **marcan**, no se
  esconden. Filtrar por lista de nombres acabaría ocultando la térmica de algún
  local que se llame raro.
- No se deja «conectar» una impresora sin marcarle al menos un área. Una
  impresora dada de alta que no imprime nada parece lista y no saca un papel.

**Verificado de verdad, no solo en tipos** (9-ago-2026, contra el binario
empaquetado, no contra `tsx`):

```
/impresoras-detectadas        → BIXOLON SRP-350plus | Conectada por cable USB
/impresoras-detectadas?red=1  → barrió 192.168.100.x en 3,3 s
```

### Un arreglo de paso

`apps/hub/src/__tests__/transporte-usb.test.ts` fallaba de forma intermitente.
No estaba roto el código: **el límite de vitest (5 s) era más corto que el del
propio transporte (10 s)**, así que bajo carga el corredor mataba la prueba
antes de que el spooler contestara. Ahora esas pruebas llevan
`ESPERA_SPOOLER_MS = 20_000`.

---

## 2 · El instalable 1.2.0

**Dónde está:**

```
entregables/MotRest_1.2.0_x64-setup.exe
apps/escritorio/src-tauri/target/release/bundle/nsis/MotRest_1.2.0_x64-setup.exe
```

| Dato | Valor |
|---|---|
| Versión | 1.2.0 |
| Tamaño | 25,3 MB |
| SHA-256 | `f96edc63eb24874ea6d443a69ed67a6a7cb3c23c67c348fbd3a003af389d0148` |

> `entregables/**/*.exe` está en `.gitignore`: el instalador **no** se commitea.

**Cómo se reconstruye** (los tres pasos, en orden; el segundo es el que se
olvida y produce un instalador con el Hub viejo en silencio):

```bash
corepack pnpm@9.15.0 --filter pos-ui build
corepack pnpm@9.15.0 --filter portal build

MOTREST_LICENCIA_PUBLICA="MCowBQYDK2VwAyEAC83o5lSMLQ7ciyKGFCXG1LDjqHqxdx2zFOqaU5/z82s=" \
MOTREST_ACTUALIZACIONES_PUBLICA="MCowBQYDK2VwAyEAayVws8Rn6eC1JRLNJFkfk3qO70wdS2VzvADWRwT1jBU=" \
MOTREST_ACTUALIZACIONES_REPO="motrae/motrest" \
corepack pnpm@9.15.0 --filter @motrest/hub empaquetar

corepack pnpm@9.15.0 --filter @motrest/escritorio build:solo-caja
```

**De dónde salieron esas llaves.** Son las **públicas** —no son secretos— y se
recuperaron del Hub empaquetado anterior (`apps/hub/dist-sea/hub.cjs`, build del
8-ago). Se confirmó cuál es cuál verificando la firma de `docs/motrest.json`
con `verificarVersion`: la segunda es la de actualizaciones. **Usar estas y no
otras es lo que mantiene vivo el canal**: un instalador con una pública distinta
de la privada que firma en Central rechaza cada actualización.

Comprobación de que quedaron dentro:

```bash
grep -c "motrae/motrest" apps/hub/dist-sea/hub.cjs   # → 1
```

### Estado del canal de actualizaciones

- **La mitad que sí está hecha:** el instalable lleva incrustados el repositorio
  y la llave pública, así que cada Hub preguntará a GitHub cada 12 horas,
  verificará la firma antes de descargar y le avisará al restaurante. Eso es lo
  que hace que este instalable «reciba las actualizaciones automáticamente».
- **La mitad que le toca a Gonzalo:** publicar el release. Requiere la llave
  **privada**, que vive en MotRest Central protegida con DPAPI en su máquina. No
  se puede —ni se debe— hacer desde aquí.

Pasos exactos en [`PUBLICAR-UNA-ACTUALIZACION.md`](PUBLICAR-UNA-ACTUALIZACION.md).
En resumen: Central → Versiones → pasar la lista de comprobación → firmar el
`motrest.json` con la versión, la URL del release y el SHA-256 de arriba → subir
a GitHub un release con **dos** archivos (`MotRest_1.2.0_x64-setup.exe` y
`motrest.json`, con ese nombre exacto).

### Lo que sigue pendiente y no es un descuido

- **El instalador va SIN FIRMAR.** El empaquetado avisa
  (`falta MOTREST_FIRMA_HUELLA`). Windows SmartScreen mostrará «editor
  desconocido» la primera vez. Es una decisión de compra pendiente, documentada
  en [`FIRMA-DEL-INSTALADOR.md`](FIRMA-DEL-INSTALADOR.md): certificado OV, token
  físico obligatorio desde 2023, Azure Trusted Signing todavía no llega a México.
- **No se probó instalar 1.2.0 encima de 1.1.2.** Es el renglón de la lista de
  comprobación que más caro sale saltarse (migración de datos de un local que ya
  opera). Hay que hacerlo antes de publicar.
- **La purga automática del historial** que pidió Gonzalo en el punto 10 de la
  tanda anterior sigue sin hacerse. El ajuste de retención (3/6/12/24 meses) y
  su advertencia están; borrar del event log toca el corte, el CFDI y la cadena
  fiscal, y además el Hub es la fuente de verdad —purgar en la terminal no sirve
  porque se resincroniza—.

---

## 3 · Cómo verificar que todo sigue sano

```bash
corepack pnpm@9.15.0 -r lint    # 0 errores en portal, central y pos-ui
corepack pnpm@9.15.0 -r test    # 1726 en verde, 2 saltadas
```

Recuento por paquete el 9-ago-2026, para detectar si algo dejó de correr:

| Paquete | En verde | Saltadas |
|---|---|---|
| `packages/dominio` | 1049 | — |
| `apps/hub` | 367 | 1 |
| `apps/pos-ui` | 116 | — |
| `apps/relay` | 61 | 1 |
| `packages/protocolo-sync` | 54 | — |
| `packages/impresion` | 54 | — |
| `apps/central` | 25 | — |

Las dos saltadas lo están **por el sistema operativo, no por estar rotas**:

- `apps/hub` salta la que imprime de verdad si no existe la impresora
  «OneNote (Desktop)» en el equipo.
- `apps/relay` salta en Windows la que comprueba que un archivo no sea legible
  por otros usuarios: son permisos POSIX y aquí no aplican.

Si aparecen más saltadas de la cuenta, algo del entorno cambió.

**`pnpm` solo por corepack.** En estas máquinas no está en el PATH; un `pnpm` a
secas rompe con «no se reconoce como un comando».

**Node tiene que ser exactamente el de `.nvmrc`** (24.16.0). El empaquetado
aborta si no coincide, y con razón: el ejecutable del Hub se fabrica copiando el
propio intérprete, así que la versión que acabe en la caja del restaurante es
literalmente la que tuviera quien empaquetó ese día.

---

## 4 · Contexto que no está en el código

- **Cliente ancla: Rodizio.** Su caja tiene una **BIXOLON SRP-350plus por USB**.
  Es el hardware contra el que hay que probar la impresión.
- **La carta de Rodizio no incluía IVA**; desde esta tanda, los precios nuevos
  se capturan ya con el impuesto dentro (ver punto 1).
- **Nada se da por bueno en desarrollo.** Lo que importa es la aplicación
  instalada: el POS que sirve el Hub, el Hub empaquetado y el instalador. Las
  tres trampas conocidas son empaquetar sin reconstruir el POS, empaquetar sin
  reconstruir el Hub, y probar contra `tsx` en vez de contra el binario.
- **Convenciones:** español, comentarios que explican el porqué y no el qué,
  ramas `feature/…`, nunca commitear a `main`, secretos jamás al repositorio.
