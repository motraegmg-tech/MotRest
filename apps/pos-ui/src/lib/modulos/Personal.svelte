<script lang="ts">
  /**
   * M6 · Personal: checador de asistencia y jornadas del equipo.
   *
   * El checador está pensado para una tablet en la entrada: la sesión abierta es
   * la del dispositivo, y cada quien marca su hora con su PIN sin cambiarla.
   */
  import {
    DIAS_DEL_ROL,
    MODOS_PROPINA,
    MODOS_SUELDO,
    etiquetaChecada,
    formatearJornada,
    nombreDia,
    pesos,
    semanaDe,
    sueldoSemanal,
    type Centavos,
    type DiaSemana,
    type ModoPropina,
    type ModoSueldo,
    type SueldoSemanal,
    type TipoChecada,
  } from "@motrest/dominio";
  import VentanaAmplia from "../VentanaAmplia.svelte";
  import { asistencia } from "../asistencia.svelte";
  import { hora, mxn } from "../formato";
  import { prenomina } from "../prenomina.svelte";
  import { rutas } from "../nav/rutas.svelte";
  import { sesion } from "../sesion/sesion.svelte";
  import RolDeMesas from "./personal/RolDeMesas.svelte";

  let seleccionado = $state<string>("");

  /**
   * Cuántas checadas se listan antes de pedir «Ver más».
   *
   * Veinte cubren un turno con su equipo completo entrando y saliendo. El resto
   * se busca cuando se está revisando una nómina, y para eso está la ventana.
   */
  const TOPE_CHECADAS = 20;
  let verChecadas = $state(false);
  let pin = $state("");
  let mensaje = $state("");
  let error = $state("");
  let verificando = $state(false);

  // Se refresca cada minuto para que las jornadas abiertas avancen solas.
  let ahora = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (ahora = Date.now()), 60_000);
    return () => clearInterval(t);
  });

  const equipo = $derived(sesion.usuariosDelLocal);
  const puedeAjustar = $derived(sesion.puedeOperar("rrhh.checada.ajustar"));
  const usuario = $derived(seleccionado ? sesion.usuarioDe(seleccionado) : undefined);
  const proxima = $derived<TipoChecada | null>(
    seleccionado ? asistencia.siguiente(seleccionado) : null,
  );

  function elegir(id: string) {
    seleccionado = seleccionado === id ? "" : id;
    pin = "";
    error = "";
    mensaje = "";
  }

  async function checar() {
    if (!seleccionado || pin.length < 4) return;
    verificando = true;
    error = "";

    const valida = await sesion.comprobarCredencial(seleccionado, pin);
    verificando = false;

    if (!valida.ok) {
      error = valida.error ?? "PIN incorrecto";
      pin = "";
      return;
    }

    // Quien captura es la sesión del dispositivo; el dueño de la jornada es
    // quien acaba de teclear su PIN.
    const r = asistencia.registrar(
      seleccionado,
      sesion.usuarioActual?.id ?? seleccionado,
    );
    mensaje = `${usuario?.nombre}: ${etiquetaChecada(r.tipo!).toLowerCase()} a las ${hora(Date.now())}`;
    pin = "";
    seleccionado = "";
  }

  function teclear(digito: string) {
    if (pin.length < 8) pin += digito;
  }

  /*
   * EL PIN TAMBIÉN SE MARCA CON EL TECLADO.
   *
   * La caja del local tiene teclado y quien checa lo hace de pie y con prisa:
   * teclear cuatro dígitos a ciegas es mucho más rápido que apuntar a la
   * pantalla. Hasta ahora solo funcionaba si el foco estaba dentro del campo, y
   * como el campo no se enfocaba solo, escribir no hacía nada y parecía que el
   * checador estaba colgado.
   *
   * El manejador se salta lo que se teclea dentro de un campo de texto: ahí el
   * `bind:value` ya hace su trabajo y duplicaríamos cada dígito.
   */
  $effect(() => {
    if (!seleccionado || vista !== "checador") return;

    function alTeclear(e: KeyboardEvent) {
      const destino = e.target as HTMLElement | null;
      const etiqueta = destino?.tagName;
      if (etiqueta === "INPUT" || etiqueta === "TEXTAREA" || destino?.isContentEditable) return;

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        teclear(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        pin = pin.slice(0, -1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        void checar();
      } else if (e.key === "Escape") {
        e.preventDefault();
        elegir(seleccionado);
      }
    }

    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  });

  /**
   * El campo se enfoca solo al elegir a alguien.
   *
   * Es lo que hace que empezar a teclear funcione sin tocar nada, que es como se
   * usa un checador con teclado.
   */
  let campoPin = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (seleccionado && campoPin) campoPin.focus();
  });

  // --- Prenómina --------------------------------------------------------------------

  type Vista = "checador" | "prenomina" | "mesas";

  /*
   * La pestaña también entra por la URL (`#/personal/mesas`).
   *
   * Lo necesita el enlace «Cambiar rol de mesas» que hay al pie de cada mesa en
   * Venta: llevar al módulo pero no a la pestaña deja al usuario a medio camino.
   */
  const seccion = $derived(rutas.actual.seccion);
  let elegida = $state<Vista | null>(null);
  const vista = $derived<Vista>(
    elegida ?? (seccion === "mesas" || seccion === "prenomina" ? (seccion as Vista) : "checador"),
  );

  const puedeNomina = $derived(sesion.puedeOperar("rrhh.empleado.editar"));

  /** Cuántas semanas hacia atrás: 0 = la semana en curso. */
  let semanasAtras = $state(0);
  const rango = $derived(semanaDe(ahora - semanasAtras * 7 * 86_400_000));
  const raya = $derived(prenomina.calcular(equipo, rango, ahora));
  const porDia = $derived(prenomina.modoSueldo === "por_dia");

  let editandoTarifa = $state<string>("");
  let tarifaTexto = $state("");
  let errorTarifa = $state("");

  function abrirTarifa(id: string) {
    editandoTarifa = id;
    const actual = prenomina.tarifaDe(id);
    tarifaTexto = actual ? (actual / 100).toFixed(2) : "";
    errorTarifa = "";
  }

  function guardarTarifa() {
    errorTarifa = "";
    prenomina.actuarComo(sesion.usuarioActual?.id ?? "sistema");
    const r = prenomina.asignarTarifa(editandoTarifa, pesos(Number(tarifaTexto) || 0));
    if (!r.ok) {
      errorTarifa = r.error ?? "No se pudo guardar";
      return;
    }
    editandoTarifa = "";
    tarifaTexto = "";
  }

  // --- Sueldo diario: la semana de cada quien -------------------------------------

  /** A quién se le está editando la semana de sueldos. */
  let editandoSueldo = $state<string>("");
  /** Lo tecleado, en pesos y por día. Se convierte a centavos al guardar. */
  let sueldoTexto = $state<Record<number, string>>({});
  let errorSueldo = $state("");

  function abrirSueldo(id: string) {
    editandoSueldo = id;
    errorSueldo = "";
    const actual = prenomina.sueldoDe(id);
    const texto: Record<number, string> = {};
    for (const d of DIAS_DEL_ROL) {
      const monto = actual[d.valor];
      texto[d.valor] = monto ? (monto / 100).toFixed(2) : "";
    }
    sueldoTexto = texto;
  }

  /** Copia lo tecleado en un día al resto de la semana, para no repetirlo siete veces. */
  function replicarSueldo(dia: DiaSemana) {
    const valor = sueldoTexto[dia] ?? "";
    const copia = { ...sueldoTexto };
    for (const d of DIAS_DEL_ROL) copia[d.valor] = valor;
    sueldoTexto = copia;
  }

  function guardarSueldo() {
    errorSueldo = "";
    const sueldo: SueldoSemanal = {};
    for (const d of DIAS_DEL_ROL) {
      const monto = Number(sueldoTexto[d.valor] ?? "");
      if (!Number.isFinite(monto) || monto <= 0) continue;
      sueldo[d.valor] = pesos(monto);
    }

    prenomina.actuarComo(sesion.usuarioActual?.id ?? "sistema");
    const r = prenomina.asignarSueldoDiario(editandoSueldo, sueldo);
    if (!r.ok) {
      errorSueldo = r.error ?? "No se pudo guardar";
      return;
    }
    editandoSueldo = "";
  }

  /** Lo que ese trabajador tiene pactado por semana completa. */
  function totalSemanalDe(id: string): Centavos {
    return sueldoSemanal(prenomina.sueldoDe(id));
  }

  function rangoTexto(r: { desde: number; hasta: number }): string {
    const f = (ts: number) =>
      new Date(ts).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
    return `${f(r.desde)} — ${f(r.hasta - 86_400_000)}`;
  }
</script>

<div class="seccion">
  <div class="encabezado">
    <div>
      <h1>Personal</h1>
      <p class="sub">
        Checador de asistencia. Cada checada es un hecho: no se edita, se corrige
        dejando rastro de quién la autorizó.
      </p>
    </div>
    <div class="pestanas">
      <button class:on={vista === "checador"} onclick={() => (elegida = "checador")}>
        Checador
      </button>
      <button class:on={vista === "mesas"} onclick={() => (elegida = "mesas")}>
        Rol de mesas
      </button>
      {#if puedeNomina}
        <button class:on={vista === "prenomina"} onclick={() => (elegida = "prenomina")}>
          Prenómina
        </button>
      {/if}
    </div>
  </div>

  {#if mensaje}<p class="ok" role="status">{mensaje}</p>{/if}

  {#if vista === "mesas"}
    <RolDeMesas />
  {:else if vista === "prenomina" && puedeNomina}
    <!--
      Prenómina: lo que se le paga a cada quien esta semana, más sus propinas.
      No es nómina fiscal —sin IMSS ni ISR, eso es F2—: es el número con el que
      se paga la raya el sábado.
    -->
    <section class="tarjeta">
      <div class="cab-raya">
        <div>
          <h2>Prenómina de la semana</h2>
          <p class="pista">{rangoTexto(rango)}</p>
        </div>
        <div class="controles-raya">
          <button class="mini" onclick={() => (semanasAtras += 1)}>← Anterior</button>
          <button class="mini" disabled={semanasAtras === 0} onclick={() => (semanasAtras -= 1)}>
            Siguiente →
          </button>
        </div>
      </div>

      <div class="modos">
        <label class="modo">
          <span>Cómo se paga el sueldo</span>
          <select
            value={prenomina.modoSueldo}
            onchange={(e) => (prenomina.modoSueldo = e.currentTarget.value as ModoSueldo)}
          >
            {#each MODOS_SUELDO as m (m.valor)}
              <option value={m.valor}>{m.etiqueta}</option>
            {/each}
          </select>
        </label>

        <label class="modo">
          <span>Reparto de propinas</span>
          <select
            value={prenomina.modoPropina}
            onchange={(e) => (prenomina.modoPropina = e.currentTarget.value as ModoPropina)}
          >
            {#each MODOS_PROPINA as m (m.valor)}
              <option value={m.valor}>{m.etiqueta}</option>
            {/each}
          </select>
        </label>
      </div>
      <p class="pista">
        {MODOS_SUELDO.find((m) => m.valor === prenomina.modoSueldo)?.descripcion}
      </p>
      <p class="pista">
        {MODOS_PROPINA.find((m) => m.valor === prenomina.modoPropina)?.descripcion}
      </p>

      {#if porDia && raya.faltas > 0}
        <!--
          El descuento por faltas va SEÑALADO y con su importe a la vista, no
          escondido dentro del sueldo. Es la cifra que el empleado va a reclamar
          el sábado, así que quien paga tiene que poder explicarla renglón por
          renglón antes de entregar el sobre.
        -->
        <p class="aviso-raya" role="alert">
          {raya.faltas}
          {raya.faltas === 1 ? "falta descontada" : "faltas descontadas"} por
          {mxn(raya.total_descuentos)} en total. Revisa que no sea una checada
          olvidada antes de pagar: se descuenta el día programado en el que nadie
          registró entrada.
        </p>
      {/if}

      {#if raya.turnos_abiertos > 0}
        <p class="aviso-raya" role="alert">
          {raya.turnos_abiertos}
          {raya.turnos_abiertos === 1 ? "persona tiene" : "personas tienen"} un turno
          sin checar salida: sus horas se miden hasta ahora y están infladas.
          Corrige la checada antes de pagar.
        </p>
      {/if}
      {#if raya.sin_tarifa > 0}
        <p class="aviso-raya" role="alert">
          {raya.sin_tarifa}
          {raya.sin_tarifa === 1 ? "persona trabajó" : "personas trabajaron"} sin
          {porDia ? "sueldo capturado" : "tarifa capturada"}: su sueldo sale en
          cero hasta que se le asigne.
        </p>
      {/if}

      {#if raya.renglones.length === 0}
        <p class="vacio">
          {porDia
            ? "Nadie tiene sueldo capturado ni registró horas en esta semana."
            : "Nadie registró horas ni propinas en esta semana."}
        </p>
      {:else if porDia}
        <!--
          LA TABLA DEL SUELDO DIARIO.

          Se lee de izquierda a derecha como se explica de viva voz: esto es lo
          que tienes pactado, estos son los días que viniste, esto se te
          descuenta, esto te llevas. El descuento va en su propia columna y en
          rojo — dentro del sueldo neto sería justo la cifra que nadie sabría
          explicar cuando la reclamen.
        -->
        <div class="marco-tabla">
          <table>
            <thead>
              <tr>
                <th>Trabajador</th>
                <th class="num">Programado</th>
                <th class="num">Días</th>
                <th class="num">Faltas</th>
                <th class="num">Descuento</th>
                <th class="num">Sueldo</th>
                <th class="num">Propinas</th>
                <th class="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {#each raya.renglones as r (r.trabajador_id)}
                <tr class:con-falta={r.faltas.length > 0}>
                  <td>
                    <button class="tarifa" onclick={() => abrirSueldo(r.trabajador_id)}>
                      <b>{r.nombre}</b>
                    </button>
                    {#if r.turnoAbierto}<small class="ojo">turno sin cerrar</small>{/if}
                    {#if r.sinTarifa}<small class="ojo">sin sueldo capturado</small>{/if}
                  </td>
                  <td class="num">{mxn(r.sueldo_programado)}</td>
                  <td class="num">
                    {r.dias_programados.length - r.faltas.length}/{r.dias_programados.length}
                  </td>
                  <td class="num">
                    {#if r.faltas.length === 0}
                      <span class="tenue">—</span>
                    {:else}
                      <span class="faltas" title={r.faltas.map(nombreDia).join(", ")}>
                        {r.faltas.map((d) => DIAS_DEL_ROL.find((x) => x.valor === d)?.corto).join(" ")}
                      </span>
                    {/if}
                  </td>
                  <td class="num descuento">
                    {r.descuento_faltas > 0 ? `−${mxn(r.descuento_faltas)}` : "—"}
                  </td>
                  <td class="num">{mxn(r.sueldo)}</td>
                  <td class="num">{mxn(r.propinas)}</td>
                  <td class="num"><b>{mxn(r.total)}</b></td>
                </tr>
              {/each}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="4"><b>Total a pagar</b></td>
                <td class="num descuento">
                  {raya.total_descuentos > 0 ? `−${mxn(raya.total_descuentos)}` : "—"}
                </td>
                <td class="num">{mxn(raya.total_sueldos)}</td>
                <td class="num">{mxn(raya.total_propinas)}</td>
                <td class="num total-raya">{mxn(raya.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p class="pista">
          Toca un nombre para capturar su sueldo de cada día. Un día en blanco es
          su <b>descanso</b>: no se paga y tampoco se le puede descontar por no venir.
        </p>
      {:else}
        <div class="marco-tabla">
          <table>
            <thead>
              <tr>
                <th>Trabajador</th>
                <th class="num">Horas</th>
                <th class="num">Tarifa</th>
                <th class="num">Sueldo</th>
                <th class="num">Propinas</th>
                <th class="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {#each raya.renglones as r (r.trabajador_id)}
                <tr>
                  <td>
                    <b>{r.nombre}</b>
                    {#if r.turnoAbierto}<small class="ojo">turno sin cerrar</small>{/if}
                  </td>
                  <td class="num" class:alerta={r.turnoAbierto}>{r.horas.toFixed(2)}</td>
                  <td class="num">
                    {#if editandoTarifa === r.trabajador_id}
                      <input
                        class="celda"
                        inputmode="decimal"
                        bind:value={tarifaTexto}
                        placeholder="0.00"
                      />
                    {:else}
                      <button class="tarifa" onclick={() => abrirTarifa(r.trabajador_id)}>
                        {r.sinTarifa ? "Asignar" : mxn(r.tarifa_hora)}
                      </button>
                    {/if}
                  </td>
                  <td class="num">{mxn(r.sueldo)}</td>
                  <td class="num">{mxn(r.propinas)}</td>
                  <td class="num"><b>{mxn(r.total)}</b></td>
                </tr>
              {/each}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3"><b>Total a pagar</b></td>
                <td class="num">{mxn(raya.total_sueldos)}</td>
                <td class="num">{mxn(raya.total_propinas)}</td>
                <td class="num total-raya">{mxn(raya.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {#if editandoTarifa}
          <div class="guardar-tarifa">
            {#if errorTarifa}<span class="error">{errorTarifa}</span>{/if}
            <span class="pista">
              Tarifa por hora de {sesion.nombreDe(editandoTarifa)}. Queda en la
              bitácora: cuándo cambió y quién lo hizo.
            </span>
            <button class="mini" onclick={() => (editandoTarifa = "")}>Cancelar</button>
            <button class="principal mini" onclick={guardarTarifa}>Guardar tarifa</button>
          </div>
        {/if}
      {/if}

      <!-- La semana de sueldos de una persona -->
      {#if editandoSueldo}
        <div class="editor-sueldo">
          <div class="cab-sueldo">
            <h3>Sueldo por día · {sesion.nombreDe(editandoSueldo)}</h3>
            <span class="semana-total">
              Semana completa: <b>{mxn(totalSemanalDe(editandoSueldo))}</b>
            </span>
            <button class="cerrar" onclick={() => (editandoSueldo = "")} aria-label="Cerrar">✕</button>
          </div>

          <div class="dias-sueldo">
            {#each DIAS_DEL_ROL as d (d.valor)}
              <label class="dia-sueldo">
                <span>{d.corto}</span>
                <div class="moneda">
                  <i>$</i>
                  <input
                    inputmode="decimal"
                    value={sueldoTexto[d.valor] ?? ""}
                    oninput={(e) =>
                      (sueldoTexto = { ...sueldoTexto, [d.valor]: e.currentTarget.value })}
                    placeholder="descanso"
                  />
                </div>
                <button
                  class="replicar"
                  title="Poner este mismo importe todos los días"
                  onclick={() => replicarSueldo(d.valor)}
                >
                  ⇄ todos
                </button>
              </label>
            {/each}
          </div>

          {#if errorSueldo}<p class="error" role="alert">{errorSueldo}</p>{/if}

          <div class="acciones-sueldo">
            <span class="pista">
              Queda en la bitácora: cuándo cambió el sueldo y quién lo cambió.
            </span>
            <button class="mini" onclick={() => (editandoSueldo = "")}>Cancelar</button>
            <button class="principal mini" onclick={guardarSueldo}>Guardar la semana</button>
          </div>
        </div>
      {/if}
    </section>
  {:else}
  <div class="columnas">
    <!-- Checador -->
    <section class="tarjeta checador">
      <h2>Checar</h2>
      {#if !seleccionado}
        <p class="pista">Elige tu nombre y teclea tu PIN.</p>
        <div class="personas">
          {#each equipo as u (u.id)}
            {@const r = asistencia.resumen(u.id, ahora)}
            <button class="persona" class:dentro={r.dentro} onclick={() => elegir(u.id)}>
              <span class="ini">{u.iniciales}</span>
              <span class="nom">{u.nombre}</span>
              <span class="estado">{r.dentro ? "dentro" : "fuera"}</span>
            </button>
          {/each}
        </div>
      {:else}
        <div class="quien">
          <b>{usuario?.nombre}</b>
          <span>va a registrar: <b class="accion">{etiquetaChecada(proxima!)}</b></span>
        </div>

        <input
          class="pin"
          type="password"
          inputmode="numeric"
          bind:this={campoPin}
          bind:value={pin}
          placeholder="PIN"
          onkeydown={(e) => e.key === "Enter" && checar()}
        />
        <p class="pista-teclado">
          Marca tu PIN con el teclado o con los botones · Enter para checar
        </p>

        <div class="teclado">
          {#each ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as d (d)}
            <button onclick={() => teclear(d)}>{d}</button>
          {/each}
          <button class="borrar" onclick={() => (pin = pin.slice(0, -1))}>←</button>
          <button onclick={() => teclear("0")}>0</button>
          <button class="ok-btn" onclick={checar} disabled={pin.length < 4 || verificando}>
            ✓
          </button>
        </div>

        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <button class="cancelar" onclick={() => elegir(seleccionado)}>Cancelar</button>
      {/if}
    </section>

    <!-- Jornadas -->
    <section class="tarjeta">
      <h2>Jornadas de hoy</h2>
      <table>
        <thead>
          <tr>
            <th>Empleado</th>
            <th>Estado</th>
            <th class="num">Turnos</th>
            <th class="num">Trabajado</th>
            <th class="num">Descanso</th>
          </tr>
        </thead>
        <tbody>
          {#each equipo as u (u.id)}
            {@const r = asistencia.resumen(u.id, ahora)}
            <tr>
              <td>
                <b>{u.nombre}</b>
                <small>{u.puesto}</small>
              </td>
              <td>
                {#if r.dentro}
                  <span class="chip dentro">Dentro</span>
                {:else if r.turnoAbierto}
                  <span class="chip abierto">Sin checar salida</span>
                {:else if r.turnos > 0}
                  <span class="chip">Fuera</span>
                {:else}
                  <span class="chip tenue">Sin checar</span>
                {/if}
              </td>
              <td class="num">{r.turnos}</td>
              <td class="num">{r.minutos > 0 ? formatearJornada(r.minutos) : "—"}</td>
              <td class="num tenue">
                {r.minutosDescanso > 0 ? formatearJornada(r.minutosDescanso) : "—"}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if puedeAjustar}
        <p class="pista">
          Una checada olvidada se corrige agregando la que falta, con tu
          autorización y su motivo. El registro original nunca se borra.
        </p>
      {/if}
    </section>
  </div>

  <!-- Bitácora de checadas -->
  {#snippet listaChecadas(lista: typeof asistencia.recientes)}
    <div class="registro">
      {#each lista as c (c.id)}
        <div class="checada">
          <span class="h">{hora(c.momento)}</span>
          <span class="nombre">{sesion.nombreDe(c.trabajador_id)}</span>
          <span class="tipo">{etiquetaChecada(c.tipo)}</span>
          {#if c.corregida}
            <span class="corregida">
              corrección de {sesion.nombreDe(c.autorizador_id ?? "")}
              {#if c.motivo}· {c.motivo}{/if}
            </span>
          {/if}
        </div>
      {/each}
    </div>
  {/snippet}

  <section class="tarjeta">
    <h2>Últimas checadas</h2>
    {#if !asistencia.hayRegistro}
      <p class="vacio">Todavía nadie ha checado en este dispositivo.</p>
    {:else}
      {@render listaChecadas(asistencia.recientes.slice(0, TOPE_CHECADAS))}
      {#if asistencia.recientes.length > TOPE_CHECADAS}
        <button class="ver-todo" onclick={() => (verChecadas = true)}>
          Ver más ({asistencia.recientes.length - TOPE_CHECADAS} checadas más)
        </button>
      {/if}
    {/if}
  </section>

  {#if verChecadas}
    <VentanaAmplia
      titulo="Checadas"
      subtitulo="{asistencia.recientes.length} registros en este dispositivo, del más reciente al más antiguo"
      onCerrar={() => (verChecadas = false)}
    >
      {@render listaChecadas(asistencia.recientes)}
    </VentanaAmplia>
  {/if}
  {/if}
</div>

<style>
  .seccion {
    flex: 1;
    overflow-y: auto;
    padding: 2rem 2.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    max-width: 72rem;
  }
  h1 {
    font-size: 1.7rem;
    font-weight: 600;
  }
  .sub {
    margin-top: 0.25rem;
    font-size: 0.88rem;
    color: var(--gris);
    max-width: 40rem;
  }
  .columnas {
    display: grid;
    grid-template-columns: minmax(18rem, 22rem) 1fr;
    gap: 1rem;
    align-items: start;
  }
  @media (max-width: 900px) {
    .columnas {
      grid-template-columns: 1fr;
    }
  }
  .tarjeta {
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-lg);
    padding: 1.1rem 1.25rem;
    overflow-x: auto;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 600;
    margin-bottom: 0.85rem;
  }
  .pista {
    font-size: 0.82rem;
    color: var(--gris);
    line-height: 1.5;
    margin-top: 0.6rem;
  }
  .pista-teclado {
    margin-top: 0.4rem;
    font-size: 0.74rem;
    color: var(--gris);
    text-align: center;
  }
  .personas {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.6rem;
  }
  .persona {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.55rem 0.75rem;
    text-align: left;
  }
  .persona:hover {
    border-color: var(--acento);
  }
  .ini {
    width: 2rem;
    height: 2rem;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--fondo);
    font-family: var(--font-titulo);
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--pizarra);
  }
  .persona.dentro .ini {
    background: var(--acento);
    color: #fff;
  }
  .nom {
    flex: 1;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .estado {
    font-size: 0.74rem;
    color: var(--gris);
  }
  .quien {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin-bottom: 0.75rem;
  }
  .quien > b {
    font-family: var(--font-titulo);
    font-size: 1.2rem;
  }
  .quien span {
    font-size: 0.85rem;
    color: var(--gris);
  }
  .accion {
    color: var(--acento);
  }
  .pin {
    width: 100%;
    padding: 0.7rem 0.85rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    font-size: 1.3rem;
    font-family: var(--font-titulo);
    letter-spacing: 0.3em;
    text-align: center;
  }
  .pin:focus {
    outline: none;
    border-color: var(--acento);
  }
  .teclado {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.4rem;
    margin-top: 0.6rem;
  }
  .teclado button {
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.75rem;
    font-family: var(--font-titulo);
    font-size: 1.15rem;
    font-weight: 600;
  }
  .teclado button:hover {
    border-color: var(--acento);
  }
  .teclado .ok-btn {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .teclado .ok-btn:disabled {
    opacity: 0.4;
  }
  .cancelar {
    width: 100%;
    margin-top: 0.5rem;
    padding: 0.5rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--gris);
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
  th.num,
  td.num {
    text-align: right;
    white-space: nowrap;
  }
  td {
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--borde);
  }
  td small {
    display: block;
    font-size: 0.74rem;
    color: var(--gris);
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
  .chip.dentro {
    background: var(--acento);
    color: #fff;
  }
  .chip.abierto {
    background: #fdeae8;
    color: var(--peligro);
  }
  .registro {
    display: flex;
    flex-direction: column;
  }
  .checada {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--borde);
    font-size: 0.86rem;
  }
  .checada .h {
    font-family: var(--font-titulo);
    font-size: 0.8rem;
    color: var(--gris);
    width: 3rem;
    flex: none;
  }
  .checada .nombre {
    font-weight: 600;
    min-width: 9rem;
  }
  .checada .tipo {
    color: var(--acento);
    font-weight: 600;
    font-size: 0.82rem;
  }
  .corregida {
    font-size: 0.76rem;
    color: var(--acento-2);
    font-style: italic;
  }
  .vacio {
    font-size: 0.88rem;
    color: var(--gris);
    font-style: italic;
  }
  .ok {
    background: #eef6e9;
    border: 1px solid #6b8f57;
    border-radius: var(--r-md);
    padding: 0.7rem 1rem;
    font-size: 0.88rem;
    font-weight: 600;
    color: #3f5c31;
  }
  .error {
    margin-top: 0.5rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--peligro);
  }

  /* --- Prenómina --- */
  .pestanas {
    display: flex;
    gap: 0.3rem;
    background: var(--fondo);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.2rem;
    flex: none;
  }
  .pestanas button {
    padding: 0.4rem 0.9rem;
    border-radius: var(--r-sm);
    font-size: 0.83rem;
    font-weight: 600;
    color: var(--gris);
  }
  .pestanas button.on {
    background: var(--acento);
    color: #fff;
  }
  .cab-raya {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }
  .controles-raya {
    display: flex;
    gap: 0.4rem;
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
  .mini:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .mini.principal {
    background: var(--acento);
    border-color: var(--acento);
    color: #fff;
  }
  .modo {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-width: 22rem;
    margin-top: 0.5rem;
  }
  .modo span {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--gris);
  }
  .modo select {
    padding: 0.55rem 0.7rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font: inherit;
    background: #fff;
  }
  .modo select:focus {
    outline: none;
    border-color: var(--acento);
  }
  .aviso-raya {
    margin-top: 0.8rem;
    background: #fdeae8;
    border: 1px solid var(--peligro);
    border-radius: var(--r-md);
    padding: 0.7rem 0.95rem;
    font-size: 0.85rem;
    line-height: 1.5;
  }
  .celda {
    width: 5.5rem;
    padding: 0.3rem 0.45rem;
    border: 1.5px solid var(--acento);
    border-radius: var(--r-sm);
    font: inherit;
    text-align: right;
  }
  .celda:focus {
    outline: none;
  }
  .tarifa {
    border: 1px dashed var(--borde);
    border-radius: var(--r-sm);
    padding: 0.2rem 0.5rem;
    font-size: 0.84rem;
    font-weight: 600;
    color: var(--pizarra);
    background: transparent;
  }
  .tarifa:hover {
    border-color: var(--acento);
    color: var(--acento);
  }
  .ojo {
    display: block;
    font-size: 0.72rem;
    color: var(--peligro);
    font-weight: 600;
  }
  .alerta {
    color: var(--peligro);
    font-weight: 700;
  }
  tfoot td {
    border-top: 2px solid var(--borde);
    border-bottom: none;
    padding-top: 0.6rem;
    font-size: 0.9rem;
  }
  .total-raya {
    font-family: var(--font-titulo);
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--acento);
  }
  .guardar-tarifa {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    justify-content: flex-end;
    flex-wrap: wrap;
    margin-top: 0.9rem;
    padding-top: 0.8rem;
    border-top: 1px dashed var(--borde);
  }
  .guardar-tarifa .pista {
    flex: 1;
    min-width: 12rem;
    margin: 0;
  }

  /* --- Sueldo diario --- */

  .modos {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }
  /* La tabla del sueldo diario tiene ocho columnas: se desplaza ella sola en
     una tablet, en vez de empujar la página entera. */
  .marco-tabla {
    overflow-x: auto;
  }
  .marco-tabla table {
    min-width: 44rem;
  }
  .descuento {
    color: var(--peligro);
    font-weight: 600;
  }
  .faltas {
    color: var(--peligro);
    font-weight: 700;
    font-size: 0.8rem;
    letter-spacing: 0.02em;
  }
  .tenue {
    color: var(--borde);
  }
  /* Un renglón con falta se marca de lado: es el que alguien va a reclamar. */
  tr.con-falta td:first-child {
    box-shadow: inset 3px 0 0 var(--peligro);
  }
  .editor-sueldo {
    margin-top: 1rem;
    border: 1.5px solid var(--acento);
    border-radius: var(--r-md);
    padding: 0.9rem 1rem;
    background: var(--fondo);
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  .cab-sueldo {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .cab-sueldo h3 {
    flex: 1;
    font-size: 1rem;
    font-weight: 700;
    color: var(--pizarra);
  }
  .semana-total {
    font-size: 0.82rem;
    color: var(--gris);
  }
  .semana-total b {
    color: var(--acento);
    font-family: var(--font-titulo);
    font-size: 1rem;
  }
  .cerrar {
    font-size: 0.95rem;
    color: var(--gris);
    padding: 0.1rem 0.4rem;
  }
  .dias-sueldo {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
    gap: 0.6rem;
  }
  .dia-sueldo {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .dia-sueldo > span {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
  }
  .moneda {
    position: relative;
    display: flex;
    align-items: center;
  }
  .moneda i {
    position: absolute;
    left: 0.6rem;
    font-style: normal;
    font-weight: 600;
    color: var(--gris);
  }
  .moneda input {
    width: 100%;
    padding: 0.5rem 0.6rem 0.5rem 1.4rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font: inherit;
    font-size: 0.9rem;
    background: #fff;
  }
  .moneda input:focus {
    outline: none;
    border-color: var(--acento);
  }
  .moneda input::placeholder {
    font-size: 0.78rem;
    color: var(--borde);
  }
  .replicar {
    align-self: flex-start;
    font-size: 0.68rem;
    color: var(--gris);
    text-decoration: underline;
  }
  .replicar:hover {
    color: var(--acento);
  }
  .acciones-sueldo {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .acciones-sueldo .pista {
    flex: 1;
    min-width: 12rem;
    margin: 0;
  }
</style>
