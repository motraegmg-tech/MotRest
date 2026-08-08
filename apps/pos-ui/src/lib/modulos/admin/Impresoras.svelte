<script lang="ts">
  /**
   * M9 · Impresoras: ruteo por área, cola y vista previa.
   *
   * Imprimir nunca bloquea la venta: un trabajo que falla se reintenta y, si se
   * rinde, queda a la vista para reimprimirlo a mano. Lo que jamás se pierde es
   * el evento de venta, que ya está en el registro.
   */
  import { impresion, enLaCaja } from "../../impresion.svelte";
  import { menu } from "../../menu.svelte";
  import { hora } from "../../formato";
  import { sesion } from "../../sesion/sesion.svelte";

  let nueva = $state("");

  // La lista de impresoras del sistema solo existe en la caja, y solo hace
  // falta aquí: se pide al abrir la pantalla, no en el arranque del POS.
  const esCaja = enLaCaja();
  $effect(() => {
    void impresion.cargarImpresorasSistema();
  });

  const puedeEditar = $derived(sesion.puedeOperar("admin.dispositivo.aprobar"));
  const areas = $derived([
    { id: "caja", nombre: "Caja (tickets y cortes)" },
    ...menu.estaciones.map((e) => ({ id: e.id, nombre: e.nombre })),
  ]);

  function alternarArea(impresoraId: string, areaId: string) {
    const imp = impresion.impresoras.find((i) => i.id === impresoraId);
    if (!imp) return;
    const areas = imp.areas.includes(areaId)
      ? imp.areas.filter((a) => a !== areaId)
      : [...imp.areas, areaId];
    impresion.actualizar(impresoraId, { areas });
  }
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Impresoras</h1>
      <p class="sub">
        A qué impresora va cada área. Un área sin impresora asignada cae a caja:
        una comanda mal ubicada se lleva caminando, una que no se imprime no se
        prepara.
      </p>
    </div>
    {#if puedeEditar}
      <div class="alta">
        <input bind:value={nueva} placeholder="Nombre de la impresora" />
        <button
          class="principal"
          onclick={() => { impresion.agregar(nueva); nueva = ""; }}
          disabled={nueva.trim().length < 2}
        >
          Agregar
        </button>
      </div>
    {/if}
  </div>

  {#if esCaja}
    <p class="nota">
      Esta es la caja: desde aquí sí sale papel. Una impresora <b>de red</b>
      necesita su dirección IP; una <b>USB</b> necesita estar instalada en
      Windows y elegirse en la lista. Las demás terminales solo previsualizan.
    </p>
  {:else}
    <p class="nota aviso">
      Esta terminal <b>no puede imprimir en papel</b>: solo la caja —el equipo
      donde corre MotRest— habla con las impresoras. Aquí los trabajos se
      generan y se previsualizan, y quedan marcados como «sin papel».
    </p>
  {/if}

  {#each impresion.impresoras as imp (imp.id)}
    <section class="tarjeta" class:inactiva={!imp.activa}>
      <div class="cab">
        <b>{imp.nombre}</b>
        <span class="tipo">{imp.conexion} · {imp.ancho} col</span>
        <span class="sp"></span>
        {#if puedeEditar}
          <button onclick={() => impresion.prueba(imp.id)}>Página de prueba</button>
          <button onclick={() => impresion.actualizar(imp.id, { activa: !imp.activa })}>
            {imp.activa ? "Desactivar" : "Activar"}
          </button>
          <button class="peligro" onclick={() => impresion.eliminar(imp.id)}>Eliminar</button>
        {/if}
      </div>

      {#if puedeEditar}
        <div class="campos">
          <label>
            <span>Nombre</span>
            <input
              value={imp.nombre}
              oninput={(e) => impresion.actualizar(imp.id, { nombre: e.currentTarget.value })}
            />
          </label>
          <label>
            <span>Conexión</span>
            <select
              value={imp.conexion}
              onchange={(e) =>
                impresion.actualizar(imp.id, { conexion: e.currentTarget.value as never })}
            >
              <option value="red">Red (9100)</option>
              <option value="usb">USB</option>
              <option value="bluetooth">Bluetooth</option>
            </select>
          </label>
          {#if imp.conexion === "red"}
            <label>
              <span>Dirección</span>
              <input
                value={imp.host ?? ""}
                oninput={(e) => impresion.actualizar(imp.id, { host: e.currentTarget.value })}
                placeholder="192.168.1.60"
              />
            </label>
            <label class="angosto">
              <span>Puerto</span>
              <input
                type="number"
                value={imp.puerto ?? 9100}
                oninput={(e) => impresion.actualizar(imp.id, { puerto: Number(e.currentTarget.value) })}
              />
            </label>
          {:else if imp.conexion === "usb"}
            <!--
              El nombre tiene que coincidir letra por letra con el de Windows,
              así que se elige de una lista en vez de teclearse. Si el Hub no
              pudo dar la lista, queda el campo libre como salida.
            -->
            <label class="ancho">
              <span>Impresora de Windows</span>
              {#if impresion.impresorasSistema.length > 0}
                <select
                  value={imp.dispositivo ?? ""}
                  onchange={(e) =>
                    impresion.actualizar(imp.id, { dispositivo: e.currentTarget.value })}
                >
                  <option value="">— Elige una —</option>
                  {#each impresion.impresorasSistema as sis (sis.nombre)}
                    <option value={sis.nombre}>
                      {sis.nombre}{sis.puerto ? ` · ${sis.puerto}` : ""}
                    </option>
                  {/each}
                </select>
              {:else}
                <input
                  value={imp.dispositivo ?? ""}
                  oninput={(e) => impresion.actualizar(imp.id, { dispositivo: e.currentTarget.value })}
                  placeholder="BIXOLON SRP-350plus"
                />
              {/if}
            </label>
          {:else}
            <p class="pendiente">
              La conexión Bluetooth todavía no está implementada: los trabajos se
              previsualizan pero no salen en papel. Usa red o USB.
            </p>
          {/if}
          <label class="angosto">
            <span>Ancho</span>
            <select
              value={String(imp.ancho)}
              onchange={(e) =>
                impresion.actualizar(imp.id, { ancho: Number(e.currentTarget.value) as 32 | 42 })}
            >
              <option value="32">58 mm (32)</option>
              <option value="42">80 mm (42)</option>
            </select>
          </label>
        </div>
      {/if}

      <div class="areas">
        <span class="etiqueta">Imprime para:</span>
        {#each areas as area (area.id)}
          <button
            class="area"
            class:on={imp.areas.includes(area.id)}
            onclick={() => puedeEditar && alternarArea(imp.id, area.id)}
            disabled={!puedeEditar}
          >
            {area.nombre}
          </button>
        {/each}
      </div>
    </section>
  {/each}

  <!-- Cola -->
  <section class="tarjeta">
    <h2>Cola de impresión</h2>
    {#if impresion.trabajos.length === 0}
      <p class="vacio">Sin trabajos. Aparecen al enviar a cocina o al cobrar.</p>
    {:else}
      <div class="cola">
        {#each impresion.trabajos.slice(-15).reverse() as t (t.id)}
          <div class="trabajo {t.estado}" class:simulado={t.simulado}>
            <span class="h">{hora(t.creado_ts)}</span>
            <span class="doc">{t.documento}</span>
            <span class="imp">
              {impresion.impresoras.find((i) => i.id === t.impresora_id)?.nombre ?? t.impresora_id}
            </span>
            <!--
              Un trabajo simulado NO se anuncia como impreso. Decir «impreso» de
              algo que nunca salió es el peor fallo posible aquí: la cocina no
              recibe la comanda y nadie se entera hasta que reclama la mesa.
            -->
            <span class="est">{t.simulado && t.estado === "impreso" ? "sin papel" : t.estado}</span>
            {#if t.simulado && t.estado === "impreso"}
              <span class="err">Solo vista previa: esta terminal no imprime</span>
            {/if}
            {#if t.ultimo_error}<span class="err">{t.ultimo_error}</span>{/if}
            <span class="sp"></span>
            <button onclick={() => (impresion.vistaPrevia = { titulo: t.documento, texto: t.vista })}>
              Ver
            </button>
            {#if t.estado === "fallido"}
              <button onclick={() => impresion.reintentar(t.id)}>Reintentar</button>
              <button class="peligro" onclick={() => impresion.descartar(t.id)}>Descartar</button>
            {/if}
          </div>
        {/each}
      </div>
      <button class="limpiar" onclick={() => impresion.limpiar()}>Limpiar los impresos</button>
    {/if}
  </section>
</div>

<!-- Vista previa: el papel que no se gastó -->
{#if impresion.vistaPrevia}
  <div class="velo" role="presentation" onclick={() => impresion.cerrarVista()}></div>
  <div class="previa" role="dialog" aria-label="Vista previa de impresión">
    <header>
      <b>{impresion.vistaPrevia.titulo}</b>
      <button onclick={() => impresion.cerrarVista()} aria-label="Cerrar">✕</button>
    </header>
    <pre>{impresion.vistaPrevia.texto}</pre>
  </div>
{/if}

<style>
  .seccion {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 2.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    max-width: 64rem;
  }
  .encabezado {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .encabezado > div:first-child {
    flex: 1;
    min-width: 16rem;
  }
  h1 {
    font-size: 1.7rem;
    font-weight: 600;
  }
  .sub {
    margin-top: 0.25rem;
    font-size: 0.88rem;
    color: var(--gris);
    max-width: 36rem;
    line-height: 1.5;
  }
  .alta {
    display: flex;
    gap: 0.4rem;
  }
  .nota {
    background: var(--fondo);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.7rem 1rem;
    font-size: 0.84rem;
    color: var(--gris);
    line-height: 1.55;
  }
  /* Que esta terminal no imprima es una limitación real, no una nota al pie. */
  .nota.aviso {
    background: #fdf0e6;
    border-color: var(--acento);
    color: #7a4a1e;
  }
  .tarjeta {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1rem 1.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .tarjeta.inactiva {
    opacity: 0.55;
  }
  .cab {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .cab b {
    font-family: var(--font-titulo);
    font-size: 1.05rem;
  }
  .tipo {
    font-size: 0.76rem;
    color: var(--gris);
    background: var(--fondo);
    border-radius: var(--r-pill);
    padding: 0.1rem 0.6rem;
  }
  .sp {
    flex: 1;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 600;
  }
  button {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.3rem 0.7rem;
    font-size: 0.79rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  button:hover:not(:disabled) {
    border-color: var(--acento);
    color: var(--acento);
  }
  button.peligro:hover:not(:disabled) {
    border-color: var(--peligro);
    color: var(--peligro);
  }
  button:disabled {
    opacity: 0.5;
  }
  .campos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  .campos label {
    flex: 1;
    min-width: 9rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .campos label.angosto {
    flex: 0 0 8rem;
  }
  /* El nombre de una impresora de Windows es largo y no debe recortarse. */
  .campos label.ancho {
    flex: 1 0 18rem;
  }
  .pendiente {
    flex: 1 0 100%;
    font-size: 0.8rem;
    color: var(--peligro);
    line-height: 1.5;
  }
  .campos span {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--gris);
  }
  input,
  select {
    padding: 0.45rem 0.6rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.86rem;
    font-family: var(--font-cuerpo);
    background: #fff;
    width: 100%;
  }
  input:focus,
  select:focus {
    outline: none;
    border-color: var(--acento);
  }
  .areas {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }
  .etiqueta {
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--gris);
    margin-right: 0.3rem;
  }
  .area {
    border-radius: var(--r-pill);
    padding: 0.25rem 0.75rem;
  }
  .area.on {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .area.on:hover:not(:disabled) {
    color: #fff;
  }
  .cola {
    display: flex;
    flex-direction: column;
  }
  .trabajo {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--borde);
    font-size: 0.82rem;
    flex-wrap: wrap;
  }
  .trabajo .h {
    font-family: var(--font-titulo);
    font-size: 0.76rem;
    color: var(--gris);
    width: 3rem;
  }
  .trabajo .doc {
    font-weight: 600;
    min-width: 5rem;
  }
  .trabajo .imp {
    color: var(--gris);
    min-width: 5rem;
  }
  .trabajo .est {
    font-size: 0.74rem;
    font-weight: 600;
    border-radius: var(--r-pill);
    padding: 0.05rem 0.55rem;
    background: var(--fondo);
    color: var(--gris);
  }
  .trabajo.impreso .est {
    color: #3f5c31;
  }
  /*
   * Simulado gana al verde de «impreso»: si el papel no salió, la fila no puede
   * leerse como un éxito de un vistazo.
   */
  .trabajo.simulado .est {
    background: #fdf0e6;
    color: var(--acento);
  }
  .trabajo.simulado .err {
    color: var(--acento);
  }
  .trabajo.fallido .est {
    background: #fdeae8;
    color: var(--peligro);
  }
  .trabajo .err {
    font-size: 0.76rem;
    color: var(--peligro);
  }
  .limpiar {
    align-self: flex-start;
    margin-top: 0.5rem;
  }
  .vacio {
    font-size: 0.86rem;
    color: var(--gris);
    font-style: italic;
  }
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.5);
    z-index: 48;
  }
  .previa {
    position: fixed;
    z-index: 49;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #fff;
    border-radius: var(--r-lg);
    box-shadow: var(--sombra-lg);
    max-height: 85vh;
    display: flex;
    flex-direction: column;
  }
  .previa header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.85rem 1.1rem;
    border-bottom: 1px solid var(--borde);
  }
  .previa header b {
    flex: 1;
    font-family: var(--font-titulo);
  }
  /* Monoespaciada y con el papel simulado: así se ve la alineación real. */
  .previa pre {
    overflow: auto;
    padding: 1.25rem;
    font-family: "Consolas", "Courier New", monospace;
    font-size: 0.78rem;
    line-height: 1.45;
    white-space: pre;
    background: #faf9f7;
  }
  .principal {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
    padding: 0.45rem 1rem;
  }
  .principal:hover:not(:disabled) {
    color: #fff;
  }
</style>
