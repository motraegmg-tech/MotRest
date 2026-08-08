# ADR-26 · La actualización remota que de verdad actualiza

**Estado:** aceptado · **Fecha:** agosto 2026 · **Decide:** Gonzalo (MOTRAE)

---

## Contexto

MotRest tenía escrito casi entero su sistema de actualización remota —manifiesto
firmado Ed25519 (ADR-25), anti-reversión, diálogo de tres opciones en el POS,
firma desde Central— y aun así **ningún restaurante podía actualizarse**. La
revisión de agosto de 2026 encontró tres cortes, y los tres eran de cableado, no
de diseño:

1. **La decisión del restaurante no llegaba a ninguna parte.** `decidir()` en el
   POS guardaba la elección en el almacén local *de esa terminal*. No existía
   ruta que se la contara al Hub, y `descargar()` e `instalar()` no los llamaba
   nadie fuera de las pruebas. El restaurante pulsaba «Actualizar ahora» y no
   pasaba absolutamente nada.
2. **El canal venía apagado de fábrica.** `MOTREST_ACTUALIZACIONES_REPO` solo
   aparecía en la documentación y en la línea que la lee. El instalador no la
   escribe y Tauri lanza el Hub sin entorno propio, así que el MotRest instalado
   en Rodizio jamás iba a preguntar si había versión nueva.
3. **Nadie volvía a encender la caja.** `instalar()` lanzaba el `.exe` y se iba.
   Una actualización a las tres de la mañana dejaba al restaurante sin POS al
   llegar por la mañana.

A eso se suma que se publicaba **a ciegas y a todos a la vez**: no había forma de
probar en un local antes que en el resto, ni de saber qué versión tiene cada
restaurante instalada.

## Decisión

### 1. El Hub es quien instala, y el POS solo opina

La terminal manda su elección por `POST /actualizacion` —solo desde la propia
caja y con el origen del Hub, igual que `/licencia`— y ahí se acaba su papel.
Ninguna tablet del salón descarga ni ejecuta nada.

El Hub guarda el `EstadoActualizacion` completo, lo publica por el catálogo
reservado `actualizacion_estado` y **reevalúa cada minuto**. Esa evaluación
periódica es la que hace que «a las 23:00» signifique algo: nadie tiene que
estar delante de la pantalla a esa hora.

### 2. Dos guardias que el sistema no deja saltarse

`puedeInstalarse` se comprueba en el momento de instalar, no en el de elegir:

- **Turno de caja abierto.** El Hub lo proyecta del propio registro
  (`caja_abierta` sin su `caja_cerrada`). Reiniciar con la caja abierta deja un
  arqueo que no cuadra y nadie sabe por qué.
- **Horario de servicio.** Fuera de la ventana 23:00–06:59 no se instala aunque
  el restaurante haya dicho «ahora»: quien pulsa eso a las nueve de la noche del
  viernes no está pensando en las doce mesas abiertas.

Lo aplazado no se olvida: el aviso queda puesto en la barra lateral hasta que se
instala.

### 3. Se instala y se vuelve a encender

`instalar()` deja un guion de relevo en la misma carpeta temporal única de la
descarga, y lo lanza desacoplado. El guion espera a que MotRest cierre, corre el
instalador en silencio y **vuelve a abrir MotRest**. Sin eso, actualizarse de
madrugada equivale a apagar el restaurante.

El guion se escribe con las rutas ya resueltas y entrecomilladas, en el
directorio que creó `mkdtemp` para esa descarga. No se acepta ninguna ruta que no
haya verificado este mismo Hub.

### 4. El canal viaja dentro del binario

El repositorio se incrusta al empaquetar, junto a las llaves públicas, con
`MOTREST_ACTUALIZACIONES_REPO` como variable de compilación y `motrae/motrest`
por defecto. La variable de entorno sigue teniendo prioridad en tiempo de
ejecución, para poder apuntar un local a un repositorio de pruebas.

**Un canal que hay que acordarse de encender en cada instalación es un canal
apagado.**

### 5. Anillos: nunca a toda la flota a la vez

El manifiesto lleva `anillo`: el porcentaje de la flota al que se le ofrece esa
versión. Cada Hub calcula un hash estable de su `sucursal_id` (FNV-1a → 0–99) y
se aplica a sí mismo la regla. Sin `anillo`, van todos.

Dos propiedades que lo hacen utilizable:

- **Es estable por local y no depende de la versión.** El mismo restaurante
  ocupa siempre la misma posición, así que el canario es el mismo cada vez y se
  aprende de él. Si dependiera de la versión, cada release rifaría un grupo
  distinto.
- **Es monótono.** Subir de 10 % a 50 % nunca saca a nadie que ya estaba dentro.

No se publica ninguna lista de sucursales: el manifiesto es un archivo público en
GitHub y la cartera de MOTRAE no tiene por qué estar ahí. Central, que sí conoce
la cartera, calcula esa misma posición y enseña **quién entra con cada
porcentaje** antes de firmar.

Un Hub al que todavía no le toca no anota nada en su memoria del canal: cuando el
anillo se amplíe, verá el mismo manifiesto y esta vez sí le tocará.

### 6. El pulso: saber qué versión tiene cada restaurante

`PulsoCliente` ya existía en el dominio y Central ya lo pintaba; lo que faltaba
era que alguien lo emitiera. Ahora el Hub manda su pulso **al arrancar y cada 24
horas** por el relay, que es la única pieza de MOTRAE conectada a internet.

- El relay **no se cree** el `sucursal_id` que le digan: lo deduce de la
  credencial con la que ese Hub se autenticó, igual que ya hacía con los envíos.
  La hora también la pone el relay: el reloj de un local puede estar en
  cualquier año.
- Guarda **solo el último pulso de cada local** —no una serie temporal—, cifrado
  con la misma llave que el padrón, y lo sirve en `GET /pulsos` contra la clave
  de administración que ya protege `/salud/detalle`.
- El pulso entrante se **recorta campo a campo**. Un Hub autenticado no es un Hub
  de fiar: una versión con un fallo podría mandar megas de texto en bucle y
  llenar el disco del relay de todos los restaurantes.
- Central lo pide con `fetch` desde su propia interfaz, y la clave vive en DPAPI
  con el resto de secretos. Se consideró hacer la llamada desde Rust para que la
  clave no pasara por la webview, y **no se hizo**: las privadas Ed25519 con las
  que Central firma licencias y manifiestos ya viven en ese mismo proceso, así
  que la precaución no compraba nada real y sí una dependencia HTTP nativa en la
  app que menos superficie debe tener. El precio es abrir `connect-src` a
  `https:` en su CSP.

Si el relay se cae, los restaurantes siguen vendiendo y Central deja de ver. Es
el reparto correcto del riesgo.

## Consecuencias

**A favor**

- Una versión publicada llega sola a los restaurantes, sin que nadie pise el
  local ni conecte nada.
- Se puede probar en un local durante un fin de semana antes de exponer a los
  demás, sin infraestructura adicional.
- Central deja de operar a ciegas: qué versión tiene cada quién y cuándo reportó.
- La caja vuelve a encenderse sola después de actualizarse.

**Costo asumido**

- El pulso exige que el local tenga credencial de relay. Un local sin ella
  funciona igual, pero Central no lo ve y aparece como «nunca reportó».
- El carril de actualización sigue siendo el instalador NSIS completo: cada
  versión son ~100 MB de descarga porque el Hub lleva Node dentro. El carril
  ligero —paquete firmado de solo carga útil, sin instalador— queda para su
  propio ADR.
- El guion de relevo es específico de Windows. macOS y Linux no tienen carril de
  actualización, y hoy tampoco tienen instalador.

## Alternativas descartadas

**Instalar sin preguntar, de madrugada.** Es lo que hace casi todo el software de
consumo y aquí es inaceptable: un restaurante que reinicia solo en mitad de un
cierre de caja pierde dinero contado a medias. La decisión es del restaurante;
el sistema solo veta los momentos peligrosos.

**Publicar con lista de sucursales en el manifiesto.** Da control exacto sobre
quién recibe qué, a cambio de publicar la cartera de clientes de MOTRAE en un
archivo que cualquiera puede leer en GitHub. El porcentaje da el mismo control
operativo sin ese precio.

**Que el pulso viaje a un servicio propio de telemetría.** Otro servicio que
montar, pagar y proteger, con datos de restaurantes dentro. El relay ya existe,
ya está autenticado por local y ya está diseñado para no guardar operación.

**Dejar que la terminal instale.** Descentraliza la descarga y multiplica por el
número de tablets las oportunidades de ejecutar un binario bajado de internet.
El Hub es uno, está en la caja y es el único que ya tiene esa responsabilidad.
