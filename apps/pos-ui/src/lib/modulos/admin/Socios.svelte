<script lang="ts">
  /**
   * M9 · Socios e inversionistas del restaurante.
   *
   * Quién puso dinero en el negocio y qué tiene pactado a cambio. Es información
   * societaria —cuánto puede consumir cada dueño, qué parte del negocio le
   * toca—, así que vive en Administración y bajo su propio permiso, no en la
   * ficha del comensal que ve cualquiera que atienda mesas.
   *
   * ## Lo que este panel deja claro de un vistazo
   *
   * La bolsa del mes NO es un saldo guardado: se calcula sumando lo que se le ha
   * cargado en cuentas cerradas de este mes. Por eso la cifra de «le quedan»
   * cuadra siempre con la operación, aunque una terminal haya cobrado en isla y
   * sincronizado tres horas después.
   */
  import {
    BENEFICIOS_SOCIO,
    pesos,
    type BeneficioSocio,
    type DatosSocio,
    type Socio,
    type TipoBeneficio,
  } from "@motrest/dominio";
  import { mxn } from "../../formato";
  import { sesion } from "../../sesion/sesion.svelte";
  import { socios } from "../../socios.svelte";

  const puedeEditar = $derived(sesion.puedeOperar("admin.socio.editar"));

  // --- Alta y edición ------------------------------------------------------------

  /** Socio en edición: su id, o "nuevo" mientras se da de alta. */
  let editando = $state<string | null>(null);
  let nombre = $state("");
  let telefono = $state("");
  let correo = $state("");
  let participacion = $state("");
  let cumpleanos = $state("");
  let notas = $state("");
  /** Lo tecleado por beneficio, en la unidad que se escribe (pesos, %, personas). */
  let valores = $state<Record<string, string>>({});
  let notasBeneficio = $state<Record<string, string>>({});
  let error = $state("");

  function abrirNuevo() {
    editando = "nuevo";
    nombre = "";
    telefono = "";
    correo = "";
    participacion = "";
    cumpleanos = "";
    notas = "";
    valores = {};
    notasBeneficio = {};
    error = "";
  }

  function abrirEdicion(socio: Socio) {
    editando = socio.socio_id;
    nombre = socio.nombre;
    telefono = socio.telefono ?? "";
    correo = socio.correo ?? "";
    participacion = socio.participacion ? (socio.participacion * 100).toFixed(2) : "";
    cumpleanos = socio.cumpleanos ?? "";
    notas = socio.notas ?? "";
    error = "";

    const v: Record<string, string> = {};
    const n: Record<string, string> = {};
    for (const b of socio.beneficios) {
      v[b.tipo] = aTexto(b);
      if (b.nota) n[b.tipo] = b.nota;
    }
    valores = v;
    notasBeneficio = n;
  }

  /** El valor guardado, en la unidad en la que se teclea. */
  function aTexto(b: BeneficioSocio): string {
    const def = BENEFICIOS_SOCIO.find((d) => d.tipo === b.tipo);
    if (def?.unidad === "dinero") return (b.valor / 100).toFixed(2);
    if (def?.unidad === "porcentaje") return (b.valor * 100).toFixed(0);
    if (def?.unidad === "bandera") return b.valor > 0 ? "1" : "";
    return String(b.valor);
  }

  /**
   * Lo tecleado, convertido a lo que guarda el dominio.
   *
   * Un beneficio vacío o en cero NO se guarda: «bolsa de 0 pesos» y «sin bolsa
   * pactada» son la misma cosa, y guardar el cero haría que el POS ofreciera
   * cargarle consumo a alguien que no tiene derecho a ninguno.
   */
  function beneficiosCapturados(): BeneficioSocio[] {
    const salida: BeneficioSocio[] = [];
    for (const def of BENEFICIOS_SOCIO) {
      const texto = (valores[def.tipo] ?? "").trim().replace(",", ".");
      if (texto === "") continue;

      let valor: number;
      if (def.unidad === "dinero") valor = pesos(Number(texto) || 0);
      else if (def.unidad === "porcentaje") valor = (Number(texto) || 0) / 100;
      else if (def.unidad === "bandera") valor = 1;
      else valor = Math.max(0, Math.round(Number(texto) || 0));

      if (valor <= 0) continue;
      const nota = (notasBeneficio[def.tipo] ?? "").trim();
      salida.push({ tipo: def.tipo, valor, ...(nota ? { nota } : {}) });
    }
    return salida;
  }

  function datosCapturados(): DatosSocio {
    const parte = Number(participacion.replace(",", "."));
    return {
      nombre,
      telefono,
      correo,
      cumpleanos,
      notas,
      ...(Number.isFinite(parte) && parte > 0 ? { participacion: parte / 100 } : {}),
      beneficios: beneficiosCapturados(),
    };
  }

  function guardar() {
    error = "";
    socios.actuarComo(sesion.usuarioActual?.id ?? "sistema");
    const r =
      editando === "nuevo"
        ? socios.registrar(datosCapturados())
        : socios.actualizar(editando!, datosCapturados());

    if (!r.ok) {
      error = r.error ?? "No se pudo guardar";
      return;
    }
    editando = null;
  }

  function alternarBandera(tipo: TipoBeneficio) {
    valores = { ...valores, [tipo]: valores[tipo] ? "" : "1" };
  }

  function darDeBaja(socio: Socio) {
    const motivo = prompt(`¿Por qué deja de ser socio ${socio.nombre}?`);
    if (motivo === null) return;
    socios.actuarComo(sesion.usuarioActual?.id ?? "sistema");
    socios.desactivar(socio.socio_id, motivo);
  }

  function reactivar(socio: Socio) {
    socios.actuarComo(sesion.usuarioActual?.id ?? "sistema");
    socios.reactivar(socio.socio_id);
  }

  /** Cómo se lee un beneficio ya guardado, en la lista. */
  function etiquetaValor(b: BeneficioSocio): string {
    const def = BENEFICIOS_SOCIO.find((d) => d.tipo === b.tipo);
    if (!def) return String(b.valor);
    if (def.unidad === "dinero") return `${mxn(b.valor as never)} al mes`;
    if (def.unidad === "porcentaje") return `${Math.round(b.valor * 100)} %`;
    if (def.unidad === "bandera") return "Sí";
    return `${b.valor} ${b.valor === 1 ? "persona" : "personas"}`;
  }
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Socios e inversionistas</h1>
      <p class="sub">
        Quién puso dinero en el restaurante y qué tiene pactado a cambio. Lo que
        un socio consume se cobra contra su bolsa del mes desde la cuenta, en
        <b>Venta → Cortesía por socio</b>.
      </p>
    </div>
    {#if puedeEditar}
      <button class="principal" onclick={abrirNuevo}>Dar de alta un socio</button>
    {/if}
  </div>

  <!--
    LA REGLA QUE MÁS SE MALINTERPRETA, DICHA ARRIBA.

    Que el socio no pague no significa que la venta no exista: el producto salió
    de la cocina y el insumo del almacén. Si esas cuentas se descontaran de la
    venta, el food cost y el ticket promedio del local dirían cosas falsas justo
    en un restaurante donde los socios comen seguido.
  -->
  <p class="nota-regla">
    <b>El consumo de un socio sí es una venta.</b> Se registra a precio de carta y
    cuenta completo en Finanzas y en Inteligencia; lo único distinto es que el
    dinero no entra al cajón, sale de su bolsa. Así el costo de los insumos y el
    ticket promedio del local siguen siendo ciertos.
  </p>

  {#if socios.socios.length === 0}
    <p class="vacio">
      Todavía no hay socios registrados. Al darlos de alta, sus beneficios
      aparecen en la cuenta durante el servicio.
    </p>
  {:else}
    <div class="lista">
      {#each socios.socios as socio (socio.socio_id)}
        {@const bolsa = socios.bolsa(socio)}
        <section class="tarjeta socio" class:baja={!socio.activo}>
          <div class="cab">
            <div class="quien">
              <h2>{socio.nombre}</h2>
              <span class="contacto">
                {#if socio.participacion}
                  {(socio.participacion * 100).toFixed(2)} % del negocio
                {/if}
                {#if socio.telefono}· {socio.telefono}{/if}
                {#if socio.correo}· {socio.correo}{/if}
              </span>
            </div>
            {#if !socio.activo}<span class="chip baja">Dado de baja</span>{/if}
            {#if puedeEditar}
              <button class="mini" onclick={() => abrirEdicion(socio)}>Editar</button>
              {#if socio.activo}
                <button class="mini peligro" onclick={() => darDeBaja(socio)}>Dar de baja</button>
              {:else}
                <button class="mini" onclick={() => reactivar(socio)}>Reactivar</button>
              {/if}
            {/if}
          </div>

          {#if bolsa.tope > 0}
            <div class="bolsa">
              <div class="barra">
                <span
                  class="lleno"
                  style="width: {Math.min(100, Math.round((bolsa.consumido / bolsa.tope) * 100))}%"
                ></span>
              </div>
              <p class="cifras">
                Este mes lleva <b>{mxn(bolsa.consumido)}</b> de {mxn(bolsa.tope)} ·
                le quedan <b class="queda">{mxn(bolsa.disponible)}</b>
              </p>
            </div>
          {/if}

          {#if socio.beneficios.length === 0}
            <p class="sin-beneficios">Sin beneficios pactados todavía.</p>
          {:else}
            <ul class="beneficios">
              {#each socio.beneficios as b (b.tipo)}
                <li>
                  <span class="nombre-b">
                    {BENEFICIOS_SOCIO.find((d) => d.tipo === b.tipo)?.nombre ?? b.tipo}
                  </span>
                  <span class="valor-b">{etiquetaValor(b)}</span>
                  {#if b.nota}<small>{b.nota}</small>{/if}
                </li>
              {/each}
            </ul>
          {/if}

          {#if socio.notas}<p class="notas">{socio.notas}</p>{/if}
        </section>
      {/each}
    </div>
  {/if}
</div>

<!-- Alta y edición -->
{#if editando && puedeEditar}
  <div class="velo" role="presentation" onclick={() => (editando = null)}></div>
  <div class="dialogo" role="dialog" aria-modal="true" aria-label="Datos del socio">
    <h2>{editando === "nuevo" ? "Nuevo socio" : "Editar socio"}</h2>

    <div class="campos">
      <label class="ancho">
        <span>Nombre</span>
        <input bind:value={nombre} placeholder="María Fernández" />
      </label>
      <label>
        <span>Teléfono</span>
        <input bind:value={telefono} placeholder="33 1234 5678" />
      </label>
      <label>
        <span>Correo</span>
        <input bind:value={correo} placeholder="maria@ejemplo.mx" />
      </label>
      <label>
        <span>Participación en el negocio (%)</span>
        <input bind:value={participacion} inputmode="decimal" placeholder="25" />
      </label>
      <label>
        <span>Cumpleaños (MM-DD)</span>
        <input bind:value={cumpleanos} placeholder="07-14" maxlength="5" />
      </label>
      <label class="ancho">
        <span>Notas del trato</span>
        <input bind:value={notas} placeholder="Socio fundador. Prefiere la mesa 8." />
      </label>
    </div>

    <h3>Beneficios</h3>
    <p class="explica">
      Deja en blanco lo que no aplique. Un beneficio en cero es lo mismo que no
      tenerlo, así que no se guarda.
    </p>

    <div class="beneficios-edit">
      {#each BENEFICIOS_SOCIO as def (def.tipo)}
        <div class="beneficio">
          <div class="cab-b">
            <b>{def.nombre}</b>
            <span class="que-hace">{def.efecto}</span>
          </div>
          <div class="entrada">
            {#if def.unidad === "bandera"}
              <button
                class="mini"
                class:on={!!valores[def.tipo]}
                aria-pressed={!!valores[def.tipo]}
                onclick={() => alternarBandera(def.tipo)}
              >
                {valores[def.tipo] ? "Sí, lo tiene" : "No lo tiene"}
              </button>
            {:else}
              <span class="unidad">{def.unidad === "dinero" ? "$" : def.unidad === "porcentaje" ? "%" : "personas"}</span>
              <input
                class="valor"
                inputmode="decimal"
                value={valores[def.tipo] ?? ""}
                oninput={(e) => (valores = { ...valores, [def.tipo]: e.currentTarget.value })}
                placeholder={def.unidad === "dinero" ? "0.00" : "0"}
              />
            {/if}
            <input
              class="nota-b"
              value={notasBeneficio[def.tipo] ?? ""}
              oninput={(e) =>
                (notasBeneficio = { ...notasBeneficio, [def.tipo]: e.currentTarget.value })}
              placeholder="Condiciones: «solo de lunes a jueves»"
            />
          </div>
          <p class="descripcion-b">{def.descripcion}</p>
        </div>
      {/each}
    </div>

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <div class="botones">
      <button class="secundario" onclick={() => (editando = null)}>Cancelar</button>
      <button class="principal" onclick={guardar}>Guardar</button>
    </div>
  </div>
{/if}

<style>
  .seccion {
    flex: 1;
    padding: 1.5rem 1.75rem;
    overflow-y: auto;
    max-width: 62rem;
  }
  .encabezado {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .encabezado > div {
    flex: 1;
  }
  h1 {
    font-family: var(--font-titulo);
    font-size: 1.55rem;
    font-weight: 700;
  }
  .sub {
    font-size: 0.88rem;
    color: var(--gris);
    margin-top: 0.25rem;
    max-width: 44rem;
    line-height: 1.5;
  }
  .nota-regla {
    font-size: 0.84rem;
    line-height: 1.55;
    color: var(--pizarra);
    background: var(--claro);
    border-radius: var(--r-md);
    padding: 0.75rem 0.9rem;
    margin-bottom: 1rem;
    max-width: 46rem;
  }
  .nota-regla b {
    color: var(--acento);
  }
  .vacio {
    font-size: 0.9rem;
    color: var(--gris);
    font-style: italic;
  }
  .lista {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .tarjeta {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1rem 1.15rem;
  }
  .socio.baja {
    opacity: 0.62;
  }
  .cab {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .quien {
    flex: 1;
    min-width: 12rem;
  }
  h2 {
    font-size: 1.08rem;
    font-weight: 650;
  }
  .contacto {
    font-size: 0.78rem;
    color: var(--gris);
  }
  .chip.baja {
    background: #fdeae8;
    color: var(--peligro);
    border-radius: var(--r-pill);
    padding: 0.15rem 0.6rem;
    font-size: 0.72rem;
    font-weight: 700;
  }
  .bolsa {
    margin-top: 0.75rem;
  }
  .barra {
    height: 0.5rem;
    border-radius: var(--r-pill);
    background: var(--fondo);
    overflow: hidden;
  }
  .barra .lleno {
    display: block;
    height: 100%;
    background: var(--acento);
  }
  .cifras {
    margin-top: 0.3rem;
    font-size: 0.8rem;
    color: var(--gris);
  }
  .cifras b {
    color: var(--pizarra);
  }
  .cifras .queda {
    color: var(--acento);
  }
  .beneficios {
    margin-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .beneficios li {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.86rem;
    padding: 0.3rem 0;
    border-top: 1px solid var(--borde);
    flex-wrap: wrap;
  }
  .nombre-b {
    flex: 1;
    min-width: 10rem;
  }
  .valor-b {
    font-weight: 650;
    color: var(--acento);
  }
  .beneficios small {
    flex-basis: 100%;
    font-size: 0.75rem;
    color: var(--gris);
  }
  .sin-beneficios,
  .notas {
    margin-top: 0.6rem;
    font-size: 0.82rem;
    color: var(--gris);
    font-style: italic;
  }
  .mini {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.3rem 0.65rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
    flex: none;
  }
  .mini:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .mini.on {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .mini.peligro:hover {
    border-color: var(--peligro);
    color: var(--peligro);
  }
  .principal {
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.6rem 1.1rem;
    font-family: var(--font-titulo);
    font-weight: 600;
    flex: none;
  }
  .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.6rem 1.1rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
  }

  /* --- Diálogo --- */
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.55);
    z-index: 60;
  }
  .dialogo {
    position: fixed;
    z-index: 61;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(44rem, calc(100vw - 2rem));
    max-height: calc(100vh - 3rem);
    overflow-y: auto;
    background: #fff;
    border-radius: var(--r-lg);
    padding: 1.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    box-shadow: var(--sombra-lg);
  }
  .dialogo h2 {
    font-family: var(--font-titulo);
    font-size: 1.2rem;
    font-weight: 700;
  }
  .dialogo h3 {
    margin-top: 0.5rem;
    font-size: 0.98rem;
    font-weight: 650;
  }
  .explica {
    font-size: 0.82rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .campos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
  }
  .campos label {
    flex: 1;
    min-width: 11rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .campos label.ancho {
    flex-basis: 100%;
  }
  .campos span {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--gris);
  }
  input {
    padding: 0.55rem 0.7rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font: inherit;
    font-size: 0.9rem;
    width: 100%;
    box-sizing: border-box;
  }
  input:focus {
    outline: none;
    border-color: var(--acento);
  }
  .beneficios-edit {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .beneficio {
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.6rem 0.75rem;
  }
  .cab-b {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .cab-b b {
    font-size: 0.9rem;
  }
  .que-hace {
    flex: 1;
    min-width: 12rem;
    font-size: 0.74rem;
    color: var(--acento);
  }
  .entrada {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.4rem;
  }
  .unidad {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--gris);
    min-width: 4rem;
  }
  .entrada .valor {
    max-width: 8rem;
  }
  .descripcion-b {
    margin-top: 0.35rem;
    font-size: 0.76rem;
    color: var(--gris);
    line-height: 1.45;
  }
  .error {
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--peligro);
  }
  .botones {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 0.3rem;
  }
</style>
