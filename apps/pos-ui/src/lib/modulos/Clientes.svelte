<script lang="ts">
  /**
   * M7 · Clientes: la ficha del comensal.
   *
   * En F1 es básica a propósito —lealtad, reservas y CRM 360° son F3—, pero
   * resuelve dos fricciones reales: facturar sin volver a dictar el RFC, y tener
   * a dónde mandar un domicilio. Los datos fiscales que se capturan aquí son los
   * mismos que pide el CFDI, así que prellenan el diálogo de factura tal cual.
   */
  import {
    REGIMENES_FISCALES,
    USOS_CFDI,
    problemaRfc,
    type Cliente,
    type DatosCliente,
    type DatosReceptor,
    type Domicilio,
  } from "@motrest/dominio";
  import { clientes } from "../clientes.svelte";
  import { sesion } from "../sesion/sesion.svelte";

  const puedeEditar = $derived(sesion.puedeOperar("crm.cliente.editar"));

  let termino = $state("");
  const lista = $derived(clientes.buscar(termino));

  let error = $state("");

  // --- Formulario (alta o edición) ---
  let editando = $state<Cliente | null>(null);
  let creando = $state(false);
  let conFiscal = $state(false);
  let conDomicilio = $state(false);

  let nombre = $state("");
  let telefono = $state("");
  let correo = $state("");
  let notas = $state("");
  let fiscal = $state<DatosReceptor>({
    rfc: "", nombre: "", regimen_fiscal: "612", codigo_postal: "", uso_cfdi: "G03",
  });
  let dom = $state<Domicilio>({ calle: "", numero: "", colonia: "", codigo_postal: "", ciudad: "", referencias: "" });

  const abierto = $derived(creando || editando !== null);

  function nuevo() {
    editando = null;
    creando = true;
    conFiscal = false;
    conDomicilio = false;
    nombre = ""; telefono = ""; correo = ""; notas = "";
    fiscal = { rfc: "", nombre: "", regimen_fiscal: "612", codigo_postal: "", uso_cfdi: "G03" };
    dom = { calle: "", numero: "", colonia: "", codigo_postal: "", ciudad: "", referencias: "" };
    error = "";
  }

  function abrirEdicion(c: Cliente) {
    creando = false;
    editando = c;
    conFiscal = !!c.fiscal;
    conDomicilio = !!c.domicilio;
    nombre = c.nombre;
    telefono = c.telefono ?? "";
    correo = c.correo ?? "";
    notas = c.notas ?? "";
    fiscal = c.fiscal
      ? { ...c.fiscal }
      : { rfc: "", nombre: "", regimen_fiscal: "612", codigo_postal: "", uso_cfdi: "G03" };
    dom = {
      calle: c.domicilio?.calle ?? "",
      numero: c.domicilio?.numero ?? "",
      colonia: c.domicilio?.colonia ?? "",
      codigo_postal: c.domicilio?.codigo_postal ?? "",
      ciudad: c.domicilio?.ciudad ?? "",
      referencias: c.domicilio?.referencias ?? "",
    };
    error = "";
  }

  function cerrar() {
    creando = false;
    editando = null;
    error = "";
  }

  function armar(): DatosCliente | null {
    error = "";
    if (nombre.trim().length < 2) { error = "Escribe el nombre del cliente"; return null; }

    let datosFiscal: DatosReceptor | undefined;
    if (conFiscal) {
      const malRfc = problemaRfc(fiscal.rfc);
      if (malRfc) { error = malRfc; return null; }
      if (fiscal.nombre.trim().length < 3) { error = "La razón social debe coincidir con la constancia"; return null; }
      if (!/^\d{5}$/.test(fiscal.codigo_postal.trim())) { error = "El código postal fiscal debe tener cinco dígitos"; return null; }
      datosFiscal = {
        ...fiscal,
        rfc: fiscal.rfc.trim().toUpperCase(),
        nombre: fiscal.nombre.trim(),
        codigo_postal: fiscal.codigo_postal.trim(),
      };
    }

    let domicilio: Domicilio | undefined;
    if (conDomicilio) {
      if (dom.calle.trim().length < 3) { error = "Escribe al menos la calle del domicilio"; return null; }
      domicilio = Object.fromEntries(
        Object.entries(dom).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== ""),
      ) as unknown as Domicilio;
    }

    return { nombre: nombre.trim(), telefono, correo, notas, fiscal: datosFiscal, domicilio };
  }

  function guardar() {
    const datos = armar();
    if (!datos) return;
    const r = editando
      ? clientes.actualizar(editando.cliente_id, {
          ...datos,
          // Si se apagó la sección, se manda undefined para limpiarla.
          fiscal: conFiscal ? datos.fiscal : undefined,
          domicilio: conDomicilio ? datos.domicilio : undefined,
        })
      : clientes.registrar(datos);
    if (!r.ok) { error = r.error ?? "No se pudo guardar"; return; }
    cerrar();
  }

  function darDeBaja(c: Cliente) {
    const motivo = prompt(`¿Dar de baja a ${c.nombre}? Se conserva su historial. Motivo (opcional):`);
    if (motivo === null) return;
    clientes.actuarComo(sesion.usuarioActual?.id ?? "sistema");
    clientes.desactivar(c.cliente_id, motivo || undefined);
  }

  function domicilioTexto(d: Domicilio): string {
    return [d.calle && `${d.calle}${d.numero ? " " + d.numero : ""}`, d.colonia, d.ciudad]
      .filter(Boolean)
      .join(", ");
  }

  $effect(() => {
    const u = sesion.usuarioActual;
    if (u) clientes.actuarComo(u.id);
  });
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Clientes</h1>
      <p class="sub">
        La ficha del comensal. Sus datos fiscales prellenan la factura y su
        domicilio sirve para las entregas. Se da de baja, no se borra.
      </p>
    </div>
    {#if puedeEditar}
      <button class="principal" onclick={nuevo}>Nuevo cliente</button>
    {/if}
  </div>

  <div class="indicadores">
    <div class="dato"><span class="etiqueta">Clientes</span><b>{clientes.activos.length}</b></div>
    <div class="dato"><span class="etiqueta">Con datos fiscales</span><b>{clientes.conFiscal.length}</b></div>
  </div>

  <div class="buscador">
    <input bind:value={termino} placeholder="Buscar por nombre, teléfono o RFC…" />
  </div>

  <section class="tarjeta">
    {#if lista.length === 0}
      <p class="vacio">
        {termino ? "Ningún cliente coincide con la búsqueda." : "Todavía no hay clientes registrados."}
      </p>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Nombre</th><th>Contacto</th><th>RFC</th><th>Domicilio</th><th></th>
          </tr>
        </thead>
        <tbody>
          {#each lista as c (c.cliente_id)}
            <tr>
              <td><b>{c.nombre}</b>{#if c.notas}<small>{c.notas}</small>{/if}</td>
              <td class="tenue">
                {c.telefono ?? "—"}
                {#if c.correo}<small>{c.correo}</small>{/if}
              </td>
              <td class="tenue">
                {#if c.fiscal}<span class="badge">{c.fiscal.rfc}</span>{:else}—{/if}
              </td>
              <td class="tenue">{c.domicilio ? domicilioTexto(c.domicilio) : "—"}</td>
              <td class="acciones">
                {#if puedeEditar}
                  <button class="mini" onclick={() => abrirEdicion(c)}>Editar</button>
                  <button class="mini" onclick={() => darDeBaja(c)}>Baja</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
</div>

{#if abierto && puedeEditar}
  <div class="velo" role="presentation" onclick={cerrar}></div>
  <div class="panel" role="dialog" aria-modal="true" aria-label="Ficha del cliente">
    <header>
      <h2>{editando ? "Editar cliente" : "Nuevo cliente"}</h2>
      <button class="cerrar" onclick={cerrar} aria-label="Cerrar">×</button>
    </header>

    <div class="campos">
      <label class="ancho">
        <span>Nombre o contacto</span>
        <input bind:value={nombre} placeholder="José Pérez" />
      </label>
      <label><span>Teléfono</span><input bind:value={telefono} placeholder="33-1122-3344" /></label>
      <label><span>Correo</span><input bind:value={correo} placeholder="jose@correo.mx" /></label>
      <label class="ancho">
        <span>Notas (alergias, preferencias)</span>
        <input bind:value={notas} placeholder="Sin cebolla, alérgico a la nuez" />
      </label>
    </div>

    <label class="switch">
      <input type="checkbox" bind:checked={conFiscal} />
      <span>Datos fiscales (para facturar)</span>
    </label>
    {#if conFiscal}
      <div class="campos sub-seccion">
        <label><span>RFC</span><input bind:value={fiscal.rfc} placeholder="GODE561231GR8" maxlength="13" /></label>
        <label class="ancho">
          <span>Razón social (exacta, como en la constancia)</span>
          <input bind:value={fiscal.nombre} placeholder="JOSE PEREZ LOPEZ" />
        </label>
        <label><span>Código postal</span><input bind:value={fiscal.codigo_postal} placeholder="44650" maxlength="5" /></label>
        <label>
          <span>Régimen fiscal</span>
          <select bind:value={fiscal.regimen_fiscal}>
            {#each REGIMENES_FISCALES as r (r.clave)}<option value={r.clave}>{r.clave} · {r.descripcion}</option>{/each}
          </select>
        </label>
        <label class="ancho">
          <span>Uso del CFDI</span>
          <select bind:value={fiscal.uso_cfdi}>
            {#each USOS_CFDI as u (u.clave)}<option value={u.clave}>{u.clave} · {u.descripcion}</option>{/each}
          </select>
        </label>
      </div>
    {/if}

    <label class="switch">
      <input type="checkbox" bind:checked={conDomicilio} />
      <span>Domicilio (para entregas)</span>
    </label>
    {#if conDomicilio}
      <div class="campos sub-seccion">
        <label class="ancho"><span>Calle y número</span>
          <div class="par">
            <input bind:value={dom.calle} placeholder="Av. Juárez" />
            <input class="corto" bind:value={dom.numero} placeholder="123" />
          </div>
        </label>
        <label><span>Colonia</span><input bind:value={dom.colonia} placeholder="Centro" /></label>
        <label><span>Ciudad</span><input bind:value={dom.ciudad} placeholder="Guadalajara" /></label>
        <label><span>Código postal</span><input bind:value={dom.codigo_postal} placeholder="44100" maxlength="5" /></label>
        <label class="ancho"><span>Referencias</span><input bind:value={dom.referencias} placeholder="Portón verde, entre Morelos y Hidalgo" /></label>
      </div>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <div class="botones">
      <button class="secundario" onclick={cerrar}>Cancelar</button>
      <button class="principal" onclick={guardar}>Guardar</button>
    </div>
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
    font-size: 0.9rem;
    color: var(--gris);
    max-width: 40rem;
  }
  .indicadores {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .dato {
    flex: 1;
    min-width: 10rem;
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
  }
  .etiqueta {
    font-size: 0.74rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
  }
  .dato b {
    font-family: var(--font-titulo);
    font-size: 1.3rem;
    margin-top: 0.2rem;
  }
  .buscador input {
    width: 100%;
    padding: 0.65rem 0.85rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    font: inherit;
    background: #fff;
  }
  .buscador input:focus {
    outline: none;
    border-color: var(--acento);
  }
  .tarjeta {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1.1rem 1.25rem;
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }
  th {
    text-align: left;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--borde);
  }
  td {
    padding: 0.55rem 0.6rem 0.55rem 0;
    border-bottom: 1px solid var(--borde);
    vertical-align: top;
  }
  td small {
    display: block;
    font-size: 0.74rem;
    color: var(--gris);
  }
  .tenue {
    color: var(--gris);
  }
  .badge {
    font-family: ui-monospace, Consolas, monospace;
    font-size: 0.78rem;
    background: var(--fondo);
    border-radius: 4px;
    padding: 0.1rem 0.4rem;
    color: var(--pizarra);
  }
  .acciones {
    display: flex;
    gap: 0.35rem;
    justify-content: flex-end;
  }
  .vacio {
    font-size: 0.88rem;
    color: var(--gris);
    font-style: italic;
  }
  .mini {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.3rem 0.6rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
  }
  .mini:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .principal {
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.6rem 1.15rem;
    font-family: var(--font-titulo);
    font-weight: 600;
    flex: none;
  }
  .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.6rem 1.15rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.55);
    z-index: 32;
  }
  .panel {
    position: fixed;
    z-index: 33;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #fff;
    border-radius: var(--r-xl);
    width: min(38rem, calc(100vw - 2rem));
    max-height: calc(100vh - 3rem);
    overflow-y: auto;
    padding: 1.25rem 1.4rem 1.4rem;
    box-shadow: var(--sombra-lg);
  }
  header {
    display: flex;
    align-items: center;
    margin-bottom: 0.85rem;
  }
  h2 {
    flex: 1;
    font-size: 1.2rem;
    font-weight: 600;
  }
  .cerrar {
    font-size: 1.5rem;
    color: var(--gris);
    line-height: 1;
  }
  .campos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
  }
  .campos label {
    flex: 1;
    min-width: 10rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .campos label.ancho {
    flex-basis: 100%;
  }
  .campos span {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--gris);
  }
  .campos input,
  .campos select {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.9rem;
    font-family: var(--font-cuerpo);
  }
  .campos input:focus,
  .campos select:focus {
    outline: none;
    border-color: var(--acento);
  }
  .par {
    display: flex;
    gap: 0.5rem;
  }
  .par .corto {
    max-width: 6rem;
  }
  .switch {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1rem;
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--pizarra);
    cursor: pointer;
  }
  .switch input {
    width: 1.05rem;
    height: 1.05rem;
    accent-color: var(--acento);
  }
  .sub-seccion {
    margin-top: 0.6rem;
    padding: 0.85rem;
    background: var(--fondo);
    border-radius: var(--r-md);
  }
  .error {
    margin-top: 0.7rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--peligro);
  }
  .botones {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 1.1rem;
  }
</style>
