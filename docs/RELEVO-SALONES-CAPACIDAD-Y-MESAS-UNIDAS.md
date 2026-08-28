# Relevo · Salones, capacidad de mesa y mesas unidas (1.3.5)

Qué entró en la 1.3.5, qué se rechazó de la revisión externa y por qué, y qué
queda pendiente. Léelo antes de tocar el plano de piso, las reservas o el estado
de una mesa.

**Agosto de 2026 · MotRest 1.3.5**

---

## 1 · De dónde viene esto

Un programador externo entregó una revisión del salón (un commit, 30 archivos,
+2 709 líneas) sobre `main` en la 1.3.0. Traía trabajo aprovechable y tres
defectos que impedían aceptarla tal cual:

| Qué traía | Qué se hizo |
|---|---|
| Puerta trasera en el acceso: `if (secreto === "1234" \|\| "0000" \|\| "admin") return true` en `verificarAlguna` | **Descartado.** Abría cualquier sesión, incluida la de soporte, y anulaba el bloqueo por intentos. La suite lo detectaba: `credenciales.test.ts` falla con ese código dentro |
| «(PIN de acceso: 1234)» impreso bajo el campo de la pantalla de acceso | **Descartado** |
| Recuadro en Administración → Hub que activaba una licencia pegada, con `licencia.fusionar({ licencia, verificada: true })` | **Descartado.** La firma se verifica en el Hub, nunca en la terminal (ver el encabezado de `licencia.svelte.ts`). Además ignoraba la respuesta del Hub y decía «activada con éxito» aunque la rechazara. Ese flujo ya existe bien hecho en `PantallaBloqueada.svelte` |
| Cajón lateral con hamburguesa a 767 px | **Descartado por duplicado.** La 1.3.4 ya lo tiene en `nav/orientacion.svelte.ts`, con Escape, `aria-expanded` y pruebas |
| Bloque global de `!important` en `packages/ui/src/base.css` | **Descartado.** Pisaba a la fuerza lo que cada módulo decide, y chocaba con `.seccion > * { flex-shrink: 0 }` de la 1.3.4 |
| Vista de tarjetas como pantalla por defecto del salón | **Descartado.** El plano es la vista: el mesero no busca «la mesa 12», busca la del ventanal |
| Capacidad de mesa y juntar mesas | **Rehechos desde el dominio** (§2 y §3) |
| Modales propios en vez de `window.prompt`, sombra de destino al arrastrar, buscador, filtros por estado, zoom y plano ampliado, pestaña de Personal sincronizada con la URL | **Adaptados y conservados** |

La revisión se reconstruyó sobre la 1.3.4, no se mezcló: el commit original
juntaba seis temas y una puerta trasera, y en Git eso queda escrito para siempre
aunque se borre después.

---

## 2 · Capacidad de mesa

`Mesa.capacidad?: number` en `packages/dominio/src/catalogo/areas.ts`.

**Es opcional a propósito.** Los planos que ya operan en los restaurantes no la
traen, y una migración obligatoria dejaría el salón inservible el día de la
actualización. Cuando falta se estima.

> **Nunca leas `mesa.capacidad` directo. Pide `capacidadDe(mesa)`.**

`capacidadDe` es la **única fórmula del sistema**, y ese es su motivo de ser: la
versión externa calculaba la capacidad en dos sitios con dos fórmulas distintas,
así que la misma mesa decía «4 comensales» en el salón y «6» en administración,
y las dos parecían ciertas. La estimación es **una plaza por celda de la
retícula** —una celda ≈ 60 cm, o sea un cubierto— con un mínimo de dos.

Se fija a mano en Administración → Salones, en el inspector de la mesa. El
rótulo dice cuándo el número es estimado, para que nadie lo confunda con algo
que alguien midió. «Volver a automático» borra el dato en vez de dejar pegado un
número viejo.

Límites en `LIMITES_MESA`: de 1 a 20. El techo no es capricho — una «mesa» de
treinta plazas es un salón, y tratarla como mesa rompe el reparto de propinas y
el rol de meseros.

---

## 3 · Mesas unidas: una cuenta, varias mesas

### El modelo

`orden_creada.mesas_unidas?: ID[]` — las mesas ADICIONALES a `mesa_id`.

Se eligió campo opcional en un evento existente y no un evento nuevo porque ya
hay precedente en el mismo `orden_creada` (`canal`, `folio_externo`), y porque
los eventos viejos siguen siendo válidos sin tocar nada: ausente = una sola
mesa.

**Una unión es UNA cuenta que ocupa varias mesas, no varias cuentas que se
cobran juntas.** El log sigue viviendo en el stream de la mesa principal, que es
lo que mantiene intactos el ticket, la cocina, el corte y los reportes. Las
demás mesas quedan ocupadas *por referencia*.

Cómo se aprovecha eso en el POS (`pos.svelte.ts`):

- `unionesAbiertas` — índice derivado `mesa unida → mesa que lleva la cuenta`.
  Solo mira cuentas abiertas: al cerrarse, las mesas se sueltan solas.
- `mesaPrincipalDe(id)` / `estaUnida(id)` — lo que consultan las pantallas.
- `estadoMesa` resuelve la unión, así que la mesa 4 aparece ocupada sin tener
  log propio.
- `seleccionarMesa` redirige a la principal: tocar la 4 abre la cuenta de la
  3 + 4, que es la misma.
- `nombreMesaActiva` devuelve «3 + 4» vía `plano.etiquetaMesas`, y de ahí sale
  el rótulo del encabezado, el del ticket y el de cada aviso. Los tres dicen lo
  mismo porque salen del mismo sitio.

### Por dónde se juntan

- **Al vuelo**, en el panel de la mesa libre: «Son más de N · juntar mesas».
  Marca las otras mesas libres del área y abre una sola cuenta.
- **Al sentar una reserva o a alguien de la lista de espera**, con los acomodos
  que propone el dominio.

`reservas.sentar(reservaId, mesas)` y `sentarDeEspera(id, mesas)` reciben el
arreglo del acomodo y abren **una** orden. El evento `reserva_sentada` guarda
solo la principal: la unión ya está escrita en el `orden_creada`, y duplicarla
daría dos verdades que pueden contradecirse si el mesero mueve al grupo.

### Cómo se proponen las combinaciones

`acomodosParaGrupo(disponibles, personas, limite)`.

**Si alguna mesa sola alcanza, solo se ofrecen mesas solas.** Juntar mueve
muebles y molesta a quien está al lado; no se propone mientras haya una mesa que
resuelva. Las uniones aparecen cuando ninguna alcanza, que es cuando el mesero
las necesita.

Las uniones nunca cruzan de área y no pasan de `DISTANCIA_MAX_UNION` (6 celdas)
entre sí: la versión externa proponía juntar la terraza con el fondo del salón
—correcto en la aritmética, absurdo en el piso— y el mesero dejaba de creerle a
la sugerencia entera.

**El coste está acotado y eso importa.** La versión externa recorría tríos
anidados sobre todas las mesas, desde la plantilla, una vez por reserva y en
cada render: con cincuenta mesas y un grupo de ocho salían ~19 600 opciones por
desplegable. Aquí el conjunto candidato se limita a las 12 mesas de mayor
capacidad por área (`MESAS_A_CONSIDERAR`), así que el peor caso son 220 tríos.
`acomodo-de-grupos.test.ts` lo vigila con un tope de tiempo.

### Lo que NO hace

- **No se juntan mesas con la cuenta ya abierta.** Si el grupo crece a mitad del
  servicio hay que cobrar o traspasar. Es la limitación conocida más probable de
  encontrarse en el piso.
- **No se separan.** Se sueltan al cerrar la cuenta, no antes.

---

## 4 · Propinas: el bote del equipo

Decisión de Gonzalo: la cifra del panel es **siempre la del local**, para todo el
que tenga permiso de verla. La propina se reparte, así que el bote es el único
número del que sale lo que cada quien va a cobrar; la cifra individual no decide
nada durante el turno y solo invita a compararse. Quien la necesite la sigue
teniendo en la prenómina, renglón por trabajador.

`rrhh.propina.ver` y `rrhh.propina.ver_local` siguen decidiendo **quién ve el
panel**. Ya no cambian **qué cifra** se ve.

---

## 5 · Pendientes conocidos

- **`window.prompt` en `Reservas.svelte`**, en `cancelar()`, para el motivo de
  la cancelación. Es anterior a esta versión y sobrevivió al repaso. En el
  kiosco de la caja ese diálogo sale con tipografía ajena, sin teclado numérico,
  y a veces no sale. Sustituirlo por el modal propio que ya tiene Salones.
- **Juntar mesas después de abrir la cuenta** (§3).
- **`TicketKds.mesas`** ya viaja al KDS y el tablero lo pinta; el KDS de Android
  consume el mismo proyector, pero no se ha verificado en el aparato.
