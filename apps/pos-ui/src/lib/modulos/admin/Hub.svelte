<script lang="ts">
  /**
   * M9 · Enlace con el Hub del local.
   *
   * El Hub NO es requisito para vender: es lo que permite que varias terminales
   * compartan el mismo salón en vivo. Sin él, cada dispositivo opera en isla y
   * se reconcilia cuando vuelva (TRD R3).
   */
  import { hora } from "../../formato";
  import { sync } from "../../sync.svelte";
  import CodigoQr from "./CodigoQr.svelte";

  let enlace = $state("");
  let error = $state("");
  let guardando = $state(false);
  /** El QR lleva la clave del local: se muestra a petición, no de entrada. */
  let mostrarQr = $state(false);
  let cual = $state(0);

  const estado = $derived(sync.estado);
  const terminales = $derived(sync.terminales);
  const enlaces = $derived(sync.enlaces);
  const elegido = $derived(enlaces[Math.min(cual, enlaces.length - 1)]);

  // Se refresca cada 5 s: es una pantalla que se deja abierta mientras se
  // encienden las terminales del local, y hay que verlas aparecer.
  $effect(() => {
    sync.pedirTerminales();
    sync.pedirEnlace();
    const t = setInterval(() => sync.pedirTerminales(), 5_000);
    return () => clearInterval(t);
  });

  async function emparejar() {
    guardando = true;
    const r = await sync.emparejar(enlace);
    error = r.ok ? "" : (r.error ?? "");
    if (r.ok) enlace = "";
    guardando = false;
  }

  // --- Estado del respaldo ------------------------------------------------------------

  interface EstadoRegistro {
    eventos: number;
    bytes: number;
    nivel: "sano" | "aviso" | "critico";
  }
  let registro = $state<EstadoRegistro | null>(null);

  interface EstadoRespaldo {
    ultimo: number | null;
    copias: number;
    carpeta: string;
  }
  let respaldo = $state<EstadoRespaldo | null>(null);

  /**
   * Si el Hub arranca solo al entrar a Windows.
   *
   * Importa verlo: el Hub es el corazón del local, y el día que el equipo
   * reinicia solo tras un apagón nadie se acuerda de abrirlo. Se descubre a
   * media cena, cuando dos terminales dejan de verse.
   */
  interface EstadoArranque {
    soportado: boolean;
    activo: boolean;
    motivo?: string;
  }
  let arranque = $state<EstadoArranque | null>(null);
  let cambiandoArranque = $state(false);

  async function alternarArranque() {
    if (!arranque?.soportado || cambiandoArranque) return;
    cambiandoArranque = true;
    try {
      const r = await fetch("/arranque-automatico", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activo: !arranque.activo }),
      });
      if (r.ok) arranque = (await r.json()) as EstadoArranque;
    } catch {
      // Si no se pudo, se deja el estado que ya se mostraba: no se finge nada.
    } finally {
      cambiandoArranque = false;
    }
  }

  /*
   * Solo la CAJA puede leer esto: `/salud` entrega el detalle únicamente a quien
   * pregunta desde el propio equipo, y desde una terminal de la red la consulta
   * ni siquiera es del mismo origen. Si no se puede leer, no se muestra nada en
   * vez de inventar un estado.
   */
  $effect(() => {
    let vivo = true;
    const consultar = async () => {
      try {
        const r = await fetch("/salud", { cache: "no-store" });
        if (!r.ok) return;
        const datos = (await r.json()) as {
          respaldo?: EstadoRespaldo;
          registro?: EstadoRegistro;
          arranque_automatico?: EstadoArranque;
        };
        if (!vivo) return;
        if (datos.respaldo) respaldo = datos.respaldo;
        if (datos.registro) registro = datos.registro;
        if (datos.arranque_automatico) arranque = datos.arranque_automatico;
      } catch {
        // Terminal de la red: no es la caja y no le toca ver esto.
      }
    };
    void consultar();
    const t = setInterval(consultar, 60_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  });

  /** Un respaldo de hace más de dos días ya es un problema que hay que ver. */
  const respaldoViejo = $derived(
    respaldo?.ultimo ? Date.now() - respaldo.ultimo > 2 * 86_400_000 : false,
  );

  function fechaHora(ts: number): string {
    return `${new Date(ts).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })} ${hora(ts)}`;
  }
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Hub del local</h1>
      <p class="sub">
        El servicio que comparte la operación entre las terminales del
        restaurante y arbitra el orden de los eventos.
      </p>
    </div>
    <div class="estado {estado}" class:sin={!sync.configurado}>
      <span class="punto"></span>
      {sync.etiqueta}
    </div>
  </div>

  <!--
    Arranque automático. Se muestra solo en la caja: es una decisión sobre ESTA
    computadora, y el Hub solo la acepta desde su propio equipo.
  -->
  {#if arranque}
    <div class="bloque" class:aviso={!arranque.activo && arranque.soportado}>
      <div class="texto">
        <b>
          {arranque.activo
            ? "El Hub enciende solo al entrar a Windows"
            : "El Hub NO enciende solo"}
        </b>
        <p>
          {#if arranque.activo}
            Si se va la luz y el equipo reinicia, el Hub vuelve sin que nadie
            tenga que abrirlo.
          {:else if arranque.soportado}
            Hay que abrirlo a mano cada vez. El día que el equipo reinicie solo,
            las terminales dejarán de verse a media cena.
          {:else}
            {arranque.motivo ?? "No se puede configurar en este equipo."}
          {/if}
        </p>
      </div>
      {#if arranque.soportado}
        <button class="mini" onclick={alternarArranque} disabled={cambiandoArranque}>
          {arranque.activo ? "Desactivar" : "Activar"}
        </button>
      {/if}
    </div>
  {/if}

  <!--
    Respaldo del registro del local. Se muestra solo en la caja, que es donde
    corre el Hub y el único equipo al que /salud le entrega el detalle.
  -->
  <!--
    Cuánto ha crecido el registro. El log es append-only por diseño y cada
    terminal lo carga entero al arrancar: se mide para poder decidir con datos
    cuándo archivar, en vez de descubrirlo el día que la caja tarda en abrir
    (ADR-21).
  -->
  {#if registro}
    <section class="tarjeta respaldo" class:mal={registro.nivel !== "sano"}>
      <div class="cab-respaldo">
        <h2>Tamaño del registro</h2>
        <span class="sello" class:bien={registro.nivel === "sano"} class:malo={registro.nivel !== "sano"}>
          {registro.nivel === "sano" ? "Holgado" : registro.nivel === "aviso" ? "Conviene planear" : "Toca archivar"}
        </span>
      </div>
      <p class="dato-respaldo">
        <b>{registro.eventos.toLocaleString("es-MX")}</b> eventos ·
        {(registro.bytes / 1024 / 1024).toFixed(1)} MB
      </p>
      {#if registro.nivel !== "sano"}
        <p class="aclaracion">
          Nada se ha perdido: el registro guarda toda la operación desde el
          primer día, y eso es lo que hace confiable la bitácora. Pero cada
          terminal lo carga entero al abrir, así que conviene archivar los
          ejercicios ya cerrados.
        </p>
      {/if}
    </section>
  {/if}

  {#if respaldo}
    <section class="tarjeta respaldo" class:mal={respaldo.copias === 0 || respaldoViejo}>
      <div class="cab-respaldo">
        <h2>Respaldo del registro</h2>
        {#if respaldo.copias === 0}
          <span class="sello malo">Sin respaldo</span>
        {:else if respaldoViejo}
          <span class="sello malo">Atrasado</span>
        {:else}
          <span class="sello bien">Al día</span>
        {/if}
      </div>

      {#if respaldo.ultimo}
        <p class="dato-respaldo">
          Último: <b>{fechaHora(respaldo.ultimo)}</b> · {respaldo.copias}
          {respaldo.copias === 1 ? "copia guardada" : "copias guardadas"}
        </p>
      {:else}
        <p class="dato-respaldo alerta">
          Todavía no hay ninguna copia. Revisa que el Hub pueda escribir en la
          carpeta de respaldos.
        </p>
      {/if}

      <p class="ruta-respaldo">{respaldo.carpeta}</p>
      <p class="aclaracion">
        Se respalda solo, al encender y una vez al día, y cada copia se verifica
        antes de darla por buena. <b>Ojo:</b> si las copias están en el mismo
        disco que la base, protegen de un borrado o una corrupción, pero no de
        que el disco se dañe. Para eso, apunta los respaldos a una USB o a una
        carpeta sincronizada.
      </p>
    </section>
  {/if}

  <section class="tarjeta">
    <h2>{sync.configurado ? "Esta terminal" : "Emparejar esta terminal"}</h2>

    {#if sync.configurado}
      <div class="campos">
        <div class="dato">
          <span>Enlazada a</span>
          <b>{sync.url}</b>
        </div>
        <div class="dato">
          <span>Canal</span>
          <b class="cifrado">🔒 Cifrado AES-256</b>
        </div>
        <button class="secundario" onclick={() => sync.olvidar()}>Desvincular</button>
      </div>
    {:else}
      <p class="pista">
        Pega el enlace que aparece en la consola del Hub, o el que te da otra
        terminal ya enlazada. Sin enlace, esta terminal opera sola.
      </p>
      <div class="campos">
        <label>
          <span>Enlace de emparejamiento</span>
          <input bind:value={enlace} placeholder="http://192.168.1.50:5173/?hub=…&k=…" />
        </label>
        <button class="principal" onclick={emparejar} disabled={guardando}>Enlazar</button>
      </div>
    {/if}

    {#if error}<p class="detalle mal" role="alert">{error}</p>{/if}
    {#if sync.detalle}<p class="detalle">{sync.detalle}</p>{/if}
    {#if sync.recibidos > 0 || sync.catalogosRecibidos > 0}
      <p class="detalle ok">
        {sync.recibidos} eventos recibidos de otras terminales en esta sesión{#if sync.catalogosRecibidos > 0}
          · {sync.catalogosRecibidos} actualizaciones de catálogo{/if}.
      </p>
    {/if}
  </section>

  {#if sync.configurado}
    <!-- Agregar una terminal -->
    <section class="tarjeta">
      <h2>Agregar una terminal</h2>
      <p class="pista">
        Escanea este código con la tablet o el celular y quedará enlazado al
        local. No sembrará una demostración propia: recibirá la operación que ya
        está en curso.
      </p>

      {#if enlaces.length === 0}
        <p class="vacio">Pidiendo el enlace al Hub…</p>
      {:else if !mostrarQr}
        <button class="principal" onclick={() => (mostrarQr = true)}>Mostrar código</button>
        <p class="pista tenue">
          El código <b>lleva la clave del local</b>. Se muestra solo cuando lo
          pides, para que no quede a la vista de quien pase junto a la caja.
        </p>
      {:else}
        {#if enlaces.length > 1}
          <div class="direcciones">
            <span class="etiqueta-red">Red del local:</span>
            {#each enlaces as e, i (e.etiqueta)}
              <button class="red" class:on={i === cual} onclick={() => (cual = i)}>
                {e.etiqueta}
              </button>
            {/each}
          </div>
        {/if}

        <div class="qr">
          <CodigoQr contenido={elegido?.url ?? ""} />
          <div class="al-lado">
            <p><b>1.</b> Abre la cámara de la tablet y apunta al código.</p>
            <p><b>2.</b> Acepta el aviso del certificado, solo la primera vez.</p>
            <p><b>3.</b> Vuelve aquí y autorízala en la lista de abajo.</p>
            <button class="secundario" onclick={() => (mostrarQr = false)}>Ocultar código</button>
          </div>
        </div>
      {/if}
    </section>

    <!-- Terminales del local -->
    <section class="tarjeta">
      <h2>Terminales del local</h2>
      {#if terminales.length === 0}
        <p class="vacio">
          {estado === "isla"
            ? "Sin contacto con el Hub. Revisa que esté encendido y que la dirección sea correcta."
            : "Ninguna terminal registrada todavía."}
        </p>
      {:else}
        <table>
          <thead>
            <tr>
              <th>Terminal</th>
              <th>Estado</th>
              <th class="num">Al día hasta</th>
              <th class="num">Vista</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each terminales as t (t.device_id)}
              <tr>
                <td>
                  <b>{t.nombre ?? t.device_id.slice(0, 12)}</b>
                  {#if sync.esEstaTerminal(t.device_id)}<small>esta terminal</small>{/if}
                </td>
                <td>
                  {#if t.aprobado}
                    <span class="chip ok">Autorizada</span>
                  {:else}
                    <span class="chip pendiente">Sin autorizar</span>
                  {/if}
                </td>
                <td class="num tenue">seq {t.ultimo_seq}</td>
                <td class="num tenue">{hora(t.visto_ts)}</td>
                <td class="num">
                  {#if !t.aprobado}
                    <button onclick={() => sync.autorizar(t.device_id)}>Autorizar</button>
                  {:else if !sync.esEstaTerminal(t.device_id)}
                    <button class="peligro" onclick={() => sync.revocar(t.device_id)}>
                      Revocar
                    </button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="pista">
          Una terminal nace <b>sin autorizar</b>: alcanzar la red del local no da
          derecho a escribir en el registro de ventas. Revocar una la desconecta
          en el acto; su registro se conserva para saber hasta dónde llegó.
        </p>
      {/if}
    </section>
  {/if}

  <section class="tarjeta">
    <h2>Cómo funciona</h2>
    <dl>
      <dt>Sin Hub, el restaurante sigue vendiendo</dt>
      <dd>
        Cada terminal escribe en su propio registro. Si el Hub se apaga a media
        noche de viernes, nadie se entera: las comandas se siguen tomando y se
        cobran igual.
      </dd>

      <dt>Al volver, todo se reconcilia solo</dt>
      <dd>
        Lo que se vendió sin enlace se envía en cuanto hay conexión. Cada evento
        lleva un identificador único, así que reenviar algo que el Hub ya tenía
        <b>no lo duplica</b>: conserva el lugar que ya se le había asignado.
      </dd>

      <dt>El Hub decide el orden</dt>
      <dd>
        Los relojes de las terminales pueden ir desfasados. Quién ocurrió antes
        lo determina un solo árbitro, para que el corte de caja y la bitácora
        cuadren siempre.
      </dd>
    </dl>
  </section>

  <section class="tarjeta seguridad">
    <h2>🔒 Seguridad del canal</h2>
    <p>
      Todo lo que viaja entre las terminales y el Hub va <b>cifrado</b> con la
      clave del local (AES-256-GCM): ventas, precios, importes de caja y datos
      del personal. Quien esté conectado al wifi del restaurante no puede leerlo
      ni inyectar comandas falsas.
    </p>
    <p>
      El <b>enlace de emparejamiento lleva la clave</b>: trátalo como una
      contraseña. Si se filtra, basta con borrar la clave del Hub y volver a
      emparejar las terminales.
    </p>
    <p class="limites">
      Lo que esto no cubre: no hay secreto hacia atrás —quien obtenga la clave y
      hubiera grabado tráfico anterior podría leerlo—, y como la clave es
      compartida, una terminal enlazada podría hacerse pasar por otra. Quién
      hizo qué se sigue apoyando en la sesión del empleado y en la revalidación
      de permisos del Hub. Falta el descubrimiento automático y el QR de
      emparejamiento (etapa 12).
    </p>
  </section>
</div>

<style>
  .seccion {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 2.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    max-width: 56rem;
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
    max-width: 34rem;
  }
  .estado {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.35rem 0.9rem;
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .punto {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--gris);
  }
  .estado.sincronizado {
    border-color: #6b8f57;
    color: #3f5c31;
  }
  .estado.sincronizado .punto {
    background: #6b8f57;
  }
  .estado.conectando .punto,
  .estado.sincronizando .punto {
    background: var(--acento-2);
  }
  .estado.isla:not(.sin) {
    border-color: var(--acento-2);
  }
  .tarjeta {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1.1rem 1.25rem;
  }
  /* Arranque automático del Hub: estado y su interruptor. */
  .bloque {
    display: flex;
    align-items: center;
    gap: 1rem;
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 0.9rem 1.1rem;
  }
  .bloque.aviso {
    border-color: var(--acento);
    background: color-mix(in srgb, var(--acento) 6%, #fff);
  }
  .bloque .texto {
    flex: 1;
  }
  .bloque b {
    font-size: 0.95rem;
    font-weight: 650;
  }
  .bloque p {
    font-size: 0.84rem;
    color: var(--gris);
    line-height: 1.5;
    margin-top: 0.2rem;
  }
  .mini {
    padding: 0.4rem 0.85rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    background: #fff;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .mini:hover:not(:disabled) {
    border-color: var(--acento);
    color: var(--acento);
  }
  .mini:disabled {
    opacity: 0.5;
    cursor: default;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 600;
    margin-bottom: 0.85rem;
  }
  .campos {
    display: flex;
    gap: 0.6rem;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .campos label {
    flex: 1;
    min-width: 15rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .campos span {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--gris);
  }
  input {
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.9rem;
    font-family: var(--font-cuerpo);
    background: #fff;
    width: 100%;
  }
  input:focus {
    outline: none;
    border-color: var(--acento);
  }
  .pista {
    margin-top: 0.7rem;
    font-size: 0.8rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .detalle {
    margin-top: 0.5rem;
    font-size: 0.82rem;
    color: var(--acento-2);
    font-weight: 600;
  }
  .detalle.ok {
    color: #3f5c31;
  }
  .pista.tenue {
    font-size: 0.76rem;
    font-style: italic;
  }
  .qr {
    display: flex;
    gap: 1.25rem;
    align-items: flex-start;
    flex-wrap: wrap;
    margin-top: 0.85rem;
  }
  .al-lado {
    flex: 1;
    min-width: 14rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .al-lado p {
    font-size: 0.85rem;
    line-height: 1.45;
  }
  .al-lado button {
    align-self: flex-start;
    margin-top: 0.4rem;
  }
  .direcciones {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-top: 0.7rem;
  }
  .etiqueta-red {
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--gris);
  }
  .red {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.2rem 0.7rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--gris);
    background: #fff;
  }
  .red.on {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .peligro {
    color: var(--gris);
  }
  .peligro:hover {
    border-color: var(--peligro) !important;
    color: var(--peligro) !important;
  }
  table button {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.3rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
    white-space: nowrap;
  }
  table button:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.87rem;
  }
  th {
    text-align: left;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--borde);
  }
  th.num,
  td.num {
    text-align: right;
    white-space: nowrap;
  }
  td {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--borde);
  }
  td small {
    display: block;
    font-size: 0.72rem;
    color: var(--acento);
  }
  .tenue {
    color: var(--gris);
  }
  .chip {
    display: inline-block;
    font-size: 0.74rem;
    font-weight: 600;
    border-radius: var(--r-pill);
    padding: 0.1rem 0.6rem;
    background: var(--fondo);
    color: var(--gris);
  }
  .chip.ok {
    background: #eef6e9;
    color: #3f5c31;
  }
  .chip.pendiente {
    background: #fdf1e5;
    color: #8a5a1f;
  }
  .vacio {
    font-size: 0.87rem;
    color: var(--gris);
    font-style: italic;
    line-height: 1.5;
  }
  dl {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  dt {
    font-weight: 600;
    font-size: 0.92rem;
  }
  dd {
    margin-top: 0.2rem;
    font-size: 0.85rem;
    color: var(--gris);
    line-height: 1.55;
  }
  .seguridad {
    border-color: #6b8f57;
    background: #f4f8f1;
  }
  .seguridad p {
    font-size: 0.85rem;
    line-height: 1.55;
  }
  .seguridad p + p {
    margin-top: 0.6rem;
  }
  .seguridad .limites {
    font-size: 0.8rem;
    color: var(--gris);
    border-top: 1px solid var(--borde);
    padding-top: 0.6rem;
  }
  .dato {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 12rem;
  }
  .dato span {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gris);
  }
  .dato b {
    font-size: 0.88rem;
    word-break: break-all;
  }
  .dato b.cifrado {
    color: #3f5c31;
  }
  .detalle.mal {
    color: var(--peligro);
  }
  .secundario {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.55rem 1.1rem;
    font-weight: 600;
    color: var(--pizarra);
    background: #fff;
    white-space: nowrap;
  }
  .secundario:hover {
    border-color: var(--peligro);
    color: var(--peligro);
  }
  .principal {
    background: var(--acento);
    color: #fff;
    border-radius: var(--r-md);
    padding: 0.62rem 1.3rem;
    font-family: var(--font-titulo);
    font-weight: 600;
  }
  .principal:disabled {
    opacity: 0.5;
  }

  /* --- Respaldo --- */
  .respaldo {
    border-left: 4px solid #57ad30;
  }
  .respaldo.mal {
    border-left-color: var(--peligro);
  }
  .cab-respaldo {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }
  .sello {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    white-space: nowrap;
  }
  .sello.bien {
    background: #eef7e8;
    color: #3f6b2c;
  }
  .sello.malo {
    background: #fdeae8;
    color: var(--peligro);
  }
  .dato-respaldo {
    font-size: 0.88rem;
  }
  .dato-respaldo.alerta {
    color: var(--peligro);
    font-weight: 600;
  }
  .ruta-respaldo {
    margin-top: 0.3rem;
    font-family: ui-monospace, Consolas, monospace;
    font-size: 0.74rem;
    color: var(--gris);
    word-break: break-all;
  }
  .aclaracion {
    margin-top: 0.7rem;
    font-size: 0.8rem;
    color: var(--gris);
    line-height: 1.55;
  }
</style>
