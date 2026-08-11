<script lang="ts">
  /**
   * M6 · Rol de mesas: quién atiende qué, cada día de la semana.
   *
   * ## Por qué la tabla se lee por persona y no por mesa
   *
   * El encargado arma el rol pensando «¿qué le toca hoy a Lucía?», no «¿de quién
   * es la mesa 7?». Con las personas en las filas y los siete días en las
   * columnas, la pantalla es la misma hoja que ya tiene pegada en la cocina, y
   * un hueco vacío salta a la vista: es alguien sin mesas ese día.
   *
   * La consulta contraria —de quién es esta mesa— también hace falta, pero ocurre
   * en otro sitio y en otro momento: durante el servicio, al pie del panel de la
   * mesa en Venta.
   *
   * ## Qué decide esto y qué no
   *
   * No es una cerradura: cualquiera puede atender cualquier mesa, porque en un
   * viernes lo contrario sería insufrible. Decide **a quién se le avisa** cuando
   * cocina deja un platillo listo, que es donde el rol se paga solo.
   */
  import { DIAS_DEL_ROL, nombreDia, type DiaSemana } from "@motrest/dominio";
  import { asignaciones } from "../../asignaciones.svelte";
  import { plano } from "../../plano.svelte";
  import { sesion } from "../../sesion/sesion.svelte";

  const puedeEditar = $derived(sesion.puedeOperar("rrhh.empleado.editar"));
  const hoy = $derived(asignaciones.hoy);

  /**
   * Quién puede llevar mesas.
   *
   * Todo el personal del local menos los perfiles que no pisan el salón. No se
   * filtra por rol «mesero» a secas: en un local chico el gerente y el cajero
   * atienden mesas, y dejarlos fuera obligaría a inventarles un rol falso.
   */
  const personal = $derived(
    sesion.usuariosDelLocal.filter((u) => u.rol_id !== "chef" && u.rol_id !== "comensal"),
  );

  const mesas = $derived(
    [...plano.todasLasMesas].sort((a, b) =>
      a.nombre.localeCompare(b.nombre, "es", { numeric: true }),
    ),
  );

  /** Celda abierta para editar: una persona en un día concreto. */
  let editando = $state<{ meseroId: string; dia: DiaSemana } | null>(null);
  let copiando = $state<DiaSemana | null>(null);

  const mesasDeLaCelda = $derived(
    editando ? asignaciones.mesasDe(editando.meseroId, editando.dia) : [],
  );

  function abrir(meseroId: string, dia: DiaSemana) {
    if (!puedeEditar) return;
    editando =
      editando?.meseroId === meseroId && editando?.dia === dia ? null : { meseroId, dia };
  }

  function nombresDeMesas(meseroId: string, dia: DiaSemana): string[] {
    return asignaciones
      .mesasDe(meseroId, dia)
      .map((id) => plano.nombreMesa(id))
      .sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  }
</script>

<section class="tarjeta">
  <div class="cab">
    <div>
      <h2>Rol de mesas</h2>
      <p class="pista">
        Qué mesas atiende cada quien, día por día. Sirve para que el aviso de
        «platillo listo» le llegue a quien atiende esa mesa, y para que en el
        salón se vea de quién es cada una. <b>No bloquea nada</b>: cualquiera
        puede atender cualquier mesa cuando hace falta.
      </p>
    </div>
  </div>

  {#if mesas.length === 0}
    <p class="vacio">
      Este local todavía no tiene mesas dibujadas. Créalas en
      <b>Administración → Salones</b> y vuelve aquí.
    </p>
  {:else if personal.length === 0}
    <p class="vacio">Todavía no hay personal dado de alta al que asignarle mesas.</p>
  {:else}
    <div class="marco-tabla">
      <table>
        <thead>
          <tr>
            <th class="quien">Persona</th>
            {#each DIAS_DEL_ROL as d (d.valor)}
              <th class="dia" class:hoy={d.valor === hoy}>
                {d.corto}
                {#if d.valor === hoy}<small>hoy</small>{/if}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each personal as persona (persona.id)}
            <tr>
              <td class="quien">
                <b>{persona.nombre}</b>
                <small>{persona.puesto}</small>
              </td>
              {#each DIAS_DEL_ROL as d (d.valor)}
                {@const suyas = nombresDeMesas(persona.id, d.valor)}
                <td class="celda" class:hoy={d.valor === hoy}>
                  <button
                    class="btn-celda"
                    class:activa={editando?.meseroId === persona.id && editando?.dia === d.valor}
                    class:sin={suyas.length === 0}
                    disabled={!puedeEditar}
                    title={puedeEditar
                      ? `Mesas de ${persona.nombre} el ${nombreDia(d.valor).toLowerCase()}`
                      : undefined}
                    onclick={() => abrir(persona.id, d.valor)}
                  >
                    {#if suyas.length === 0}
                      <span class="guion">—</span>
                    {:else}
                      <span class="mesas">{suyas.join(" · ")}</span>
                    {/if}
                  </button>
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if !puedeEditar}
      <p class="pista">
        Tu perfil consulta el rol pero no lo modifica. Lo cambia quien administra
        al personal.
      </p>
    {/if}

    <!-- Editor de una celda: todas las mesas del local, como interruptores. -->
    {#if editando}
      {@const quien = sesion.nombreDe(editando.meseroId)}
      <div class="editor">
        <div class="cab-editor">
          <h3>{quien} · {nombreDia(editando.dia)}</h3>
          <span class="cuantas">
            {mesasDeLaCelda.length}
            {mesasDeLaCelda.length === 1 ? "mesa" : "mesas"}
          </span>
          <button class="cerrar" onclick={() => (editando = null)} aria-label="Cerrar">✕</button>
        </div>

        {#each plano.areas as area (area.id)}
          {@const deArea = mesas.filter((m) => m.area_id === area.id)}
          {#if deArea.length > 0}
            <div class="area">
              <span class="nombre-area">{area.nombre}</span>
              <div class="mesas-toggle">
                {#each deArea as mesa (mesa.id)}
                  {@const otros = asignaciones
                    .meserosDe(mesa.id, editando.dia)
                    .filter((id) => id !== editando?.meseroId)}
                  <button
                    class="toggle"
                    class:on={mesasDeLaCelda.includes(mesa.id)}
                    class:compartida={otros.length > 0}
                    title={otros.length > 0
                      ? `También la atiende: ${otros.map((id) => sesion.nombreDe(id)).join(", ")}`
                      : undefined}
                    onclick={() => asignaciones.alternar(mesa.id, editando!.dia, editando!.meseroId)}
                  >
                    {mesa.nombre}
                    <!--
                      Un punto cuando la mesa ya tiene a alguien más. Dos meseros
                      en la misma mesa es legítimo —un turno partido, una mesa
                      grande—, pero conviene verlo antes de asignarla, no después.
                    -->
                    {#if otros.length > 0}<span class="punto" aria-hidden="true"></span>{/if}
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        {/each}

        <div class="acciones-editor">
          <button class="mini" onclick={() => (copiando = editando!.dia)}>
            Copiar el {nombreDia(editando.dia).toLowerCase()} a otro día…
          </button>
        </div>
      </div>
    {/if}

    <!--
      Copiar un día entero. Es lo que convierte esta tabla en algo que se llena
      en un minuto: se captura el lunes y se replica, ajustando el fin de semana.
      El aviso de que PISA lo que hubiera va antes de tocar nada.
    -->
    {#if copiando !== null && puedeEditar}
      <div class="copiar">
        <p class="titulo-copiar">Copiar el rol del {nombreDia(copiando).toLowerCase()}</p>
        <p class="pista">
          El día de destino se <b>reemplaza por completo</b> con las asignaciones
          del {nombreDia(copiando).toLowerCase()}.
        </p>
        <div class="destinos">
          {#each DIAS_DEL_ROL.filter((d) => d.valor !== copiando) as d (d.valor)}
            <button
              class="mini"
              onclick={() => { asignaciones.copiar(copiando!, d.valor); copiando = null; }}
            >
              {d.nombre}
            </button>
          {/each}
          <button
            class="mini fuerte"
            onclick={() => { asignaciones.copiarATodos(copiando!); copiando = null; }}
          >
            A toda la semana
          </button>
        </div>
        <button class="mini" onclick={() => (copiando = null)}>Cancelar</button>
      </div>
    {/if}

    {#if puedeEditar}
      <div class="pie">
        <button class="mini" onclick={() => (copiando = hoy)}>
          Copiar el rol de hoy a otros días
        </button>
        <button class="mini peligro" onclick={() => asignaciones.vaciar(hoy)}>
          Vaciar el {nombreDia(hoy).toLowerCase()}
        </button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .tarjeta {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .cab h2 {
    font-size: 1.15rem;
    font-weight: 600;
  }
  .pista {
    font-size: 0.82rem;
    color: var(--gris);
    line-height: 1.55;
    max-width: 46rem;
  }
  .vacio {
    padding: 1.5rem 0;
    text-align: center;
    color: var(--gris);
    font-size: 0.9rem;
    line-height: 1.5;
  }
  /* La tabla desborda a lo ancho en una tablet: se desplaza ella, no la página. */
  .marco-tabla {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    min-width: 46rem;
  }
  th,
  td {
    border-bottom: 1px solid var(--borde);
    padding: 0.4rem 0.35rem;
    text-align: left;
    vertical-align: top;
  }
  th {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
  }
  th.dia,
  td.celda {
    text-align: center;
    width: 11%;
  }
  /* La columna de hoy se marca: es la que se consulta el 95 % de las veces. */
  th.dia.hoy,
  td.celda.hoy {
    background: color-mix(in srgb, var(--acento) 7%, transparent);
  }
  th.dia small {
    display: block;
    font-size: 0.6rem;
    font-weight: 700;
    color: var(--acento);
  }
  td.quien b {
    display: block;
    font-size: 0.9rem;
    color: var(--pizarra);
  }
  td.quien small {
    font-size: 0.72rem;
    color: var(--gris);
  }
  .btn-celda {
    width: 100%;
    min-height: 2.1rem;
    border: 1.5px solid transparent;
    border-radius: var(--r-sm);
    padding: 0.25rem 0.3rem;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
    background: transparent;
    cursor: pointer;
  }
  .btn-celda:hover:not(:disabled) {
    border-color: var(--acento);
  }
  .btn-celda:disabled {
    cursor: default;
  }
  .btn-celda.activa {
    border-color: var(--acento);
    background: var(--claro);
    color: var(--acento);
  }
  .btn-celda .mesas {
    display: block;
    line-height: 1.3;
    word-break: break-word;
  }
  .btn-celda .guion {
    color: var(--borde);
  }

  /* --- Editor de la celda --- */
  .editor {
    border: 1.5px solid var(--acento);
    border-radius: var(--r-md);
    padding: 0.9rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    background: var(--fondo);
  }
  .cab-editor {
    display: flex;
    align-items: baseline;
    gap: 0.7rem;
  }
  .cab-editor h3 {
    flex: 1;
    font-size: 1rem;
    font-weight: 700;
    color: var(--pizarra);
  }
  .cuantas {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--acento);
  }
  .cerrar {
    font-size: 0.95rem;
    color: var(--gris);
    padding: 0.1rem 0.4rem;
  }
  .area {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .nombre-area {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--gris);
  }
  .mesas-toggle {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .toggle {
    position: relative;
    min-width: 2.6rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.35rem 0.6rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
  }
  .toggle:hover {
    border-color: var(--acento);
  }
  .toggle.on {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .punto {
    position: absolute;
    top: 0.15rem;
    right: 0.15rem;
    width: 0.35rem;
    height: 0.35rem;
    border-radius: 50%;
    background: var(--acento-2);
  }
  .toggle.on .punto {
    background: #fff;
  }
  .acciones-editor,
  .pie,
  .destinos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .pie {
    padding-top: 0.3rem;
  }
  .copiar {
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.85rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: flex-start;
  }
  .titulo-copiar {
    font-weight: 700;
    color: var(--pizarra);
    font-size: 0.92rem;
  }
  .mini {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.35rem 0.7rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
  }
  .mini:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .mini.fuerte {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .mini.peligro:hover {
    border-color: var(--peligro);
    color: var(--peligro);
  }
</style>
