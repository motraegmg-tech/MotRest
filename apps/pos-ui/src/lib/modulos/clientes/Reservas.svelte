<script lang="ts">
  /**
   * La puerta del restaurante: reservas del día y quién está esperando.
   *
   * Es la pantalla del anfitrión un viernes. Todo lo que hace falta para no
   * perder gente en la entrada cabe aquí: quién viene, quién se retrasó, qué
   * mesa hay, y cuánto decirle a quien acaba de llegar sin reserva.
   */
  import {
    acomodosParaGrupo,
    correoPlausible,
    franjaDe,
    mesasDeComanda,
    type Cliente,
    type ID,
    type OpcionDeAcomodo,
    type Reserva,
  } from "@motrest/dominio";
  import { clientes } from "../../clientes.svelte";
  import { correo, type SolicitudCorreo } from "../../correo.svelte";
  import { cuandoDeReserva, datosDelCorreo, esVispera } from "../../correos-del-comensal";
  import EnvioCorreo from "../../EnvioCorreo.svelte";
  import { hora } from "../../formato";
  import VerMas from "../../listas/VerMas.svelte";
  import { Paginado } from "../../listas/listas.svelte";
  import { rutas } from "../../nav/rutas.svelte";
  import { plano } from "../../plano.svelte";
  import { pos } from "../../pos.svelte";
  import { reservas } from "../../reservas.svelte";
  import { sesion } from "../../sesion/sesion.svelte";
  import { revelar, subirAlPrincipio } from "../../subir";
  import { borrador, type Formulario } from "./borrador-de-reserva.svelte";
  import SelectorDeFicha from "./SelectorDeFicha.svelte";

  const puedeEditar = $derived(sesion.puedeOperar("crm.cliente.editar"));

  /* El reloj avanza solo: "se retrasó 20 min" tiene que envejecer sin recargar. */
  let ahora = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (ahora = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  const puerta = $derived(reservas.enPuerta(ahora));

  /*
   * «VER MÁS» EN «POR LLEGAR» (1.5.6, pedido de Gonzalo). Ahí están TODAS las
   * reservas vigentes, no solo las de hoy: las de la cena de fin de año, las de
   * los cumpleaños de dentro de tres semanas. Pintadas todas, empujaban la lista
   * de espera —la que se usa con gente de pie en la puerta— fuera de la
   * pantalla. Se ven las 10 más próximas, que son las que importan ahora.
   *
   * No lleva «Ordenar»: el orden es el de la hora de llegada, que es el de la
   * puerta. Tampoco la lista de espera, cuyo orden ES el turno.
   */
  const pagPorLlegar = new Paginado();
  const rotacion = $derived(reservas.rotacion);
  const esperaAhora = $derived(reservas.esperaPara(reservas.espera.length, ahora));

  /** Mesas libres ahora mismo, para el desplegable de "sentar". */
  const libres = $derived(
    plano.todasLasMesas.filter((m) => pos.estadoMesa(m.id) === "libre"),
  );

  let aviso = $state("");

  /*
   * EL AVISO SALE ARRIBA; LA RESERVA QUE LO PROVOCA, NO.
   *
   * «Sentar en…», «Confirmar en…», «Cancelar» y «Anotar en la lista» viven a
   * media pantalla —en la puerta, en la lista de espera—, y cuando algo fallaba
   * el motivo se escribía encima de todo, fuera de cuadro. Un viernes, con la
   * gente en la entrada, parecía que la tableta no había hecho caso.
   */
  let raiz = $state<HTMLDivElement | null>(null);

  /** Publica el resultado y, si fue un error, sube a enseñarlo. */
  function publicar(r: { ok: boolean; error?: string }) {
    aviso = r.ok ? "" : (r.error ?? "");
    if (!r.ok) subirAlPrincipio(raiz);
  }

  // --- Dónde sentar a cada grupo ---

  /*
   * Un acomodo viaja por el <select> como el JSON de sus mesas: ["m3","m4"].
   *
   * No como "m3+m4". El id compuesto obligaba a partirlo del otro lado y a
   * confiar en que ningún id llevara un "+", y de ahí salían las tres cuentas
   * separadas para un mismo grupo. El JSON se resuelve sin adivinar.
   */
  function claveDe(opcion: OpcionDeAcomodo): string {
    return JSON.stringify(opcion.mesas);
  }

  function mesasDeClave(clave: string): ID[] {
    return clave ? (JSON.parse(clave) as ID[]) : [];
  }

  /** "Mesa 7 · 6 comensales" o "Juntar 3 + 4 · 8 comensales". */
  function etiquetaAcomodo(opcion: OpcionDeAcomodo): string {
    const mesas = plano.etiquetaMesas(opcion.mesas);
    const donde = opcion.unida ? `Juntar ${mesas}` : `Mesa ${mesas}`;
    const caben = `${opcion.capacidad} ${opcion.capacidad === 1 ? "comensal" : "comensales"}`;
    return opcion.sobran > 0 ? `${donde} · ${caben} (sobran ${opcion.sobran})` : `${donde} · ${caben}`;
  }

  function sinDonde(personas: number): string {
    return `No hay dónde sentar a ${personas} ${personas === 1 ? "persona" : "personas"}`;
  }

  /**
   * Cómo se llama la mesa de una reserva que ya está sentada.
   *
   * La reserva guarda solo la principal, pero si el grupo ocupa una unión hay
   * que decirlo entero: mandar al mesero a "la mesa 3" cuando el grupo está en
   * la 3 y la 4 es mandarlo a media mesa.
   */
  function mesaDeReserva(mesaId: ID): string {
    const cuenta = pos.comandaDeMesa(mesaId);
    return plano.etiquetaMesas(cuenta && !cuenta.cerrada ? mesasDeComanda(cuenta) : [mesaId]);
  }

  /*
   * Los acomodos se calculan AQUÍ, una vez por tamaño de grupo, y nunca dentro
   * de un {#each}. Armar combinaciones de mesas por fila y en cada tic del
   * reloj es lo que arrastraba la tableta del anfitrión un viernes.
   */
  const acomodosParaSentar = $derived.by(() => {
    const porTamano = new Map<number, OpcionDeAcomodo[]>();
    const grupos = [
      ...puerta.retrasadas.map((r) => r.personas),
      ...puerta.esperando.map((r) => r.personas),
      ...reservas.espera.map((e) => e.personas),
    ];
    for (const personas of grupos) {
      if (!porTamano.has(personas)) porTamano.set(personas, acomodosParaGrupo(libres, personas));
    }
    return porTamano;
  });

  /*
   * Para confirmar una solicitud se miran TODAS las mesas, no solo las libres:
   * la reserva es para dentro de tres días y el salón de esta noche no dice
   * nada de lo que estará libre entonces.
   */
  const acomodosParaConfirmar = $derived.by(() => {
    const porTamano = new Map<number, OpcionDeAcomodo[]>();
    for (const r of reservas.solicitadas) {
      if (!porTamano.has(r.personas)) {
        porTamano.set(r.personas, acomodosParaGrupo(plano.todasLasMesas, r.personas));
      }
    }
    return porTamano;
  });

  // --- Alta de reserva ---

  /*
   * LO TECLEADO NO VIVE AQUÍ, VIVE EN EL BORRADOR DEL MÓDULO.
   *
   * Desde la 1.5.6, «+ Nuevo cliente» lleva al alta de comensal de verdad, y eso
   * desmonta esta pantalla. Con las variables en el componente, quien estaba
   * apartando el viernes a las 21:00 para ocho volvía con el formulario en
   * blanco. Ver `borrador-de-reserva.svelte.ts`.
   */
  const alta = $derived(borrador.reserva);

  const comensalesAlta = $derived(Math.max(1, Number(alta.personas) || 1));
  const acomodosAlta = $derived(acomodosParaGrupo(plano.todasLasMesas, comensalesAlta));
  const mesasAlta = $derived(mesasDeClave(alta.acomodo));
  const paraTs = $derived(new Date(`${alta.fecha}T${alta.hora || "00:00"}`).getTime());

  /*
   * Al cambiar el número de personas, el acomodo elegido puede desaparecer de
   * la lista. Se suelta en cuanto pasa: un desplegable que se ve en blanco
   * pero guarda una mesa por dentro aparta la mesa equivocada.
   */
  $effect(() => {
    if (alta.acomodo && !acomodosAlta.some((o) => claveDe(o) === alta.acomodo)) {
      borrador.reserva.acomodo = "";
    }
  });

  /* Se avisa del choque MIENTRAS se captura, no al guardar. */
  const choques = $derived(
    mesasAlta[0] && Number.isFinite(paraTs) ? reservas.choques(mesasAlta[0], paraTs) : [],
  );
  const plantones = $derived(reservas.plantonesDe(alta.telefono.trim() || undefined));

  /*
   * ESE TELÉFONO YA ES DE ALGUIEN.
   *
   * Se mira MIENTRAS se teclea, no al guardar, y solo mientras no haya ficha
   * elegida: quien está atendiendo decide, y su decisión no se discute. Es la
   * regla que pidió Gonzalo —«si se teclea un teléfono que ya tiene ficha, se
   * liga a esa»—, y avisarlo aquí es lo que evita la pregunta obvia del
   * restaurantero: «¿por qué me la guardó a nombre de otro?».
   */
  const fichaDelTelefonoAlta = $derived(
    alta.cliente_id ? undefined : clientes.porTelefono(alta.telefono),
  );

  /** La ficha de la reserva: la elegida, la del teléfono, o una nueva. */
  function ligarFicha(datos: {
    cliente_id?: ID;
    nombre: string;
    telefono: string;
    correo?: string;
  }): { ok: boolean; id?: ID; error?: string } {
    /*
     * Quién da de alta la ficha queda en la bitácora. Sin esto el alta saldría
     * firmada por «sistema» y la ficha de un cliente nuevo aparecería sin dueño,
     * como si la hubiera creado la máquina.
     */
    clientes.actuarComo(sesion.usuarioActual?.id ?? "sistema");
    return clientes.ligarFicha(datos);
  }

  function apartar() {
    /*
     * PRIMERO SE COMPRUEBA, DESPUÉS SE CREA LA FICHA.
     *
     * Apartar puede dar de alta a un comensal, y una ficha creada para una
     * reserva que no se guardó —porque «Personas» venía en cero— es basura que
     * alguien tendría que borrar a mano en la lista de clientes.
     */
    const problema = reservas.problemaAlApartar({
      nombre: alta.nombre,
      personas: Number(alta.personas) || 0,
    });
    if (problema) {
      publicar({ ok: false, error: problema });
      return;
    }

    const ficha = ligarFicha({
      cliente_id: alta.cliente_id,
      nombre: alta.nombre,
      telefono: alta.telefono,
      correo: alta.correo,
    });
    if (!ficha.ok) {
      publicar(ficha);
      return;
    }

    const r = reservas.apartar({
      nombre: alta.nombre,
      telefono: alta.telefono,
      correo: alta.correo,
      cliente_id: ficha.id,
      personas: Number(alta.personas) || 0,
      para_ts: paraTs,
      /* La reserva aparta la principal; la unión se arma al sentarlos. */
      mesa_id: mesasAlta[0],
    });
    publicar(r);
    if (r.ok) borrador.limpiarReserva();
  }

  // --- El viaje al alta del comensal, y la vuelta ---

  /*
   * «+ Nuevo cliente» no abre un diálogo propio: lleva al ALTA DE VERDAD, la de
   * la ficha del comensal, con su domicilio, sus datos fiscales y su permiso de
   * publicidad. Dos altas distintas del mismo cliente es como se acaba con dos
   * fichas que no se parecen, y con un comensal que «no tiene domicilio» porque
   * se dio de alta desde la puerta.
   *
   * El parámetro `volver` es lo que hace que al guardar se regrese aquí, con el
   * cliente ya puesto y sin haber perdido lo tecleado.
   */
  function nuevoCliente(cual: Formulario) {
    borrador.pedirFicha(cual);
    rutas.ir("clientes", "clientes", { nuevo: "1", volver: "reservas" });
  }

  /** Lo que se copia de la ficha elegida a cada formulario. */
  function copiarDeLaFicha(cual: Formulario, ficha: Cliente) {
    if (cual === "espera") {
      if (ficha.telefono) borrador.espera.telefono = ficha.telefono;
      return;
    }
    if (ficha.telefono) borrador.reserva.telefono = ficha.telefono;
    if (ficha.correo) borrador.reserva.correo = ficha.correo;
  }

  /** Se adopta la ficha del teléfono, con su nombre. */
  function usarLaFicha(cual: Formulario, ficha: Cliente) {
    if (cual === "espera") borrador.espera.cliente_id = ficha.cliente_id;
    else borrador.reserva.cliente_id = ficha.cliente_id;
    if (cual === "espera") borrador.espera.nombre = ficha.nombre;
    else borrador.reserva.nombre = ficha.nombre;
    copiarDeLaFicha(cual, ficha);
  }

  /**
   * Se liga a la ficha pero la reserva conserva el nombre que se escribió.
   *
   * Es un caso real y no un capricho: José Pérez aparta la mesa «a nombre de la
   * Familia Pérez». La ficha es suya —su historial, su teléfono, sus plantones—
   * y el nombre que hay que cantar en la puerta es el otro.
   */
  function ligarSinCambiarElNombre(cual: Formulario, ficha: Cliente) {
    if (cual === "espera") borrador.espera.cliente_id = ficha.cliente_id;
    else borrador.reserva.cliente_id = ficha.cliente_id;
  }

  /** El nombre de la reserva lleva a su ficha del comensal. */
  function verFicha(clienteId: ID) {
    rutas.ir("clientes", "clientes", { ficha: clienteId });
  }

  async function sentar(reserva: Reserva, clave: string) {
    if (!clave) return;
    const r = await reservas.sentar(reserva.id, mesasDeClave(clave));
    publicar(r);
  }

  async function sentarDeEspera(esperaId: ID, clave: string) {
    if (!clave) return;
    await reservas.sentarDeEspera(esperaId, mesasDeClave(clave));
  }

  function confirmar(reserva: Reserva, valor: string) {
    if (!valor) return;
    // "sin-mesa" acepta la reserva sin comprometer una mesa concreta: es lo
    // normal cuando todavía falta una semana y el salón puede cambiar.
    const mesas = valor === "sin-mesa" ? [] : mesasDeClave(valor);
    const r = reservas.confirmar(reserva.id, mesas[0]);
    publicar(r);
  }

  function cancelar(reserva: Reserva) {
    const motivo = prompt(`¿Por qué se cancela la reserva de ${reserva.nombre}?`);
    if (!motivo) return;
    const r = reservas.cancelar(reserva.id, motivo);
    publicar(r);
  }

  // --- Lista de espera ---

  /* Se comporta igual que el alta: también reconoce al comensal y también
     sobrevive al viaje al alta de la ficha. */
  const fila = $derived(borrador.espera);

  const fichaDelTelefonoEspera = $derived(
    fila.cliente_id ? undefined : clientes.porTelefono(fila.telefono),
  );

  function anotar() {
    const problema = reservas.problemaAlAnotar({ nombre: fila.nombre });
    if (problema) {
      publicar({ ok: false, error: problema });
      return;
    }

    const ficha = ligarFicha({
      cliente_id: fila.cliente_id,
      nombre: fila.nombre,
      telefono: fila.telefono,
    });
    if (!ficha.ok) {
      publicar(ficha);
      return;
    }

    const r = reservas.anotarEnEspera({
      nombre: fila.nombre,
      telefono: fila.telefono,
      cliente_id: ficha.id,
      personas: Number(fila.personas) || 0,
    });
    publicar(r);
    if (r.ok) borrador.limpiarEspera();
  }

  function minutosDesde(ts: number): number {
    return Math.max(0, Math.round((ahora - ts) / 60_000));
  }

  // --- El recordatorio por correo ---

  /*
   * Se ofrece AQUÍ porque es donde se ve quién viene mañana, y solo la víspera:
   * el correo dice «Lo esperamos mañana», y mandarlo tres días antes —o la
   * misma tarde— es mandar un asunto que miente.
   */
  let recordandoId = $state<ID | null>(null);
  const recordando = $derived(
    recordandoId ? reservas.reservas.find((r) => r.id === recordandoId) : undefined,
  );
  const datosRecordatorio = $derived(
    recordando
      ? datosDelCorreo("reserva_recordatorio", { nombre: recordando.nombre, reserva: recordando })
      : {},
  );

  /** El recordatorio que ya se pidió para esta reserva, si hay. */
  function recordatorioDe(r: Reserva): SolicitudCorreo | undefined {
    return correoPlausible(r.correo)
      ? correo.recordatorioDe(cuandoDeReserva(r.para_ts), [r.correo])
      : undefined;
  }

  /**
   * ¿Se le puede ofrecer «Recordarle»?
   *
   * Si ya hay uno en camino o entregado, NO: un recordatorio repetido se lee
   * como spam, y el spam es lo que deja la cuenta del restaurante sin entregar
   * nada. Si el anterior no salió, sí, y se dice por qué falló.
   */
  function sePuedeRecordar(r: Reserva, previo: SolicitudCorreo | undefined): boolean {
    return (
      correoPlausible(r.correo) &&
      esVispera(r.para_ts, ahora) &&
      (!previo || previo.estado === "rechazado")
    );
  }

  function comoVaElRecordatorio(s: SolicitudCorreo): { texto: string; tono: string } {
    if (s.estado === "enviado") return { texto: "Recordatorio enviado", tono: "bien" };
    if (s.estado === "rechazado") {
      return { texto: `El recordatorio no salió: ${s.motivo ?? "el Hub no dijo por qué"}`, tono: "mal" };
    }
    return ahora - s.pedido_ts > 60_000
      ? { texto: "Recordatorio pedido: el Hub todavía no lo ha visto", tono: "espera" }
      : { texto: "Recordatorio en camino", tono: "espera" };
  }

  /**
   * La ficha del comensal de una reserva, si se le conoce.
   *
   * Desde la 1.5.6 una reserva apartada en la caja NACE LIGADA, así que casi
   * siempre es `r.cliente_id` y nada más. La búsqueda por teléfono y por correo
   * se queda por las de antes: las que se apartaron sin ficha siguen en la
   * agenda, y esconder la ficha de quien viene el viernes porque su reserva se
   * anotó la semana pasada no la haría menos suya.
   *
   * Sirve para dos cosas: que el recordatorio por correo aparezca en «Últimos
   * correos» de su ficha, y que el nombre de la puerta lleve hasta ella.
   */
  function fichaDe(r: Reserva): ID | undefined {
    if (r.cliente_id) return r.cliente_id;

    const porTelefono = clientes.porTelefono(r.telefono);
    if (porTelefono) return porTelefono.cliente_id;

    const correoReserva = r.correo?.trim().toLowerCase();
    if (!correoReserva) return undefined;
    return clientes.activos.find((c) => c.correo?.trim().toLowerCase() === correoReserva)
      ?.cliente_id;
  }

  /** La ficha de quien espera de pie: la que se le reconoció, o la de su teléfono. */
  function fichaDeEspera(telefono: string | undefined, clienteId: ID | undefined): ID | undefined {
    return clienteId ?? clientes.porTelefono(telefono)?.cliente_id;
  }

  function alTeclear(e: KeyboardEvent) {
    if (e.key === "Escape" && recordandoId) recordandoId = null;
  }

  /*
   * EL DÍA, CUANDO NO ES HOY. «Por llegar» junta las reservas de hoy con las de
   * los próximos días, y con la hora sola una reserva del sábado a las 21:00 se
   * leía como si fuera de esta noche.
   */
  function diaSiNoEsHoy(ts: number): string {
    const d = new Date(ts);
    const hoy = new Date();
    const manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);
    if (d.toDateString() === hoy.toDateString()) return "";
    if (d.toDateString() === manana.toDateString()) return "Mañana · ";
    const texto = d.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
    return texto.charAt(0).toUpperCase() + texto.slice(1) + " · ";
  }
</script>

<svelte:window onkeydown={alTeclear} />

<!--
  ESE TELÉFONO YA TIENE FICHA, Y SE DICE ANTES DE GUARDAR.
  Se liga a esa ficha sin duplicarla —decisión de Gonzalo—, y si el nombre no
  coincide se deja elegir cuál de los dos vale. Se usa en el alta y en la lista
  de espera, que se comportan igual.
-->
{#snippet avisoDeFicha(ficha: Cliente, nombreTecleado: string, cual: Formulario)}
  {@const escrito = nombreTecleado.trim()}
  {@const distinto = escrito !== "" && escrito !== ficha.nombre.trim()}
  <div class="reconocido" use:revelar>
    <p>
      Ese teléfono ya es de la ficha de <b>{ficha.nombre}</b>.
      {#if distinto}
        Escribiste «{escrito}»: no se duplica su ficha, queda ligada a {ficha.nombre}.
      {:else}
        Queda ligada a su ficha.
      {/if}
    </p>
    <div class="elegir">
      <button class="mini" onclick={() => usarLaFicha(cual, ficha)}>
        Usar «{ficha.nombre}»
      </button>
      {#if distinto}
        <button class="mini" onclick={() => ligarSinCambiarElNombre(cual, ficha)}>
          Dejar «{escrito}»
        </button>
      {/if}
    </div>
  </div>
{/snippet}

<!--
  El nombre lleva a su ficha cuando se le conoce. Es la mitad que faltaba: se
  podía llegar a la reserva desde la ficha, pero no al revés, y quien está en la
  puerta es justo el que necesita saber si el que llega es cliente de años.
-->
{#snippet quien(nombre: string, clienteId: ID | undefined)}
  {#if clienteId}
    <button
      class="nombre-ficha"
      onclick={() => verFicha(clienteId)}
      title="Abrir su ficha del comensal"
    >
      {nombre}
    </button>
  {:else}
    <b>{nombre}</b>
  {/if}
{/snippet}

<div class="seccion" bind:this={raiz}>
  <div class="encabezado">
    <div>
      <h1>Reservas y lista de espera</h1>
      <p class="sub">
        {#if rotacion.confiable}
          Una mesa dura <b>{rotacion.minutos_mediana} min</b> en este local, medido
          sobre {rotacion.muestras} sentadas reales.
        {:else}
          Todavía no hay suficientes sentadas para medir la rotación real
          ({rotacion.muestras} de las que hacen falta). Se usa
          <b>{rotacion.minutos_mediana} min</b> mientras tanto.
        {/if}
      </p>
    </div>
    {#if puedeEditar}
      <button class="principal" onclick={() => (borrador.reserva.abierto = !alta.abierto)}>
        {alta.abierto ? "Cerrar" : "+ Apartar mesa"}
      </button>
    {/if}
  </div>

  {#if aviso}<p class="error" role="alert">{aviso}</p>{/if}

  {#if alta.abierto && puedeEditar}
    <div class="tarjeta" use:revelar>
      <div class="campos">
        <!--
          «A nombre de» ES LA LISTA DE LAS FICHAS, con buscador y con
          «+ Nuevo cliente». Ver `SelectorDeFicha.svelte`.
        -->
        <SelectorDeFicha
          bind:nombre={borrador.reserva.nombre}
          bind:clienteId={borrador.reserva.cliente_id}
          onelegir={(ficha) => copiarDeLaFicha("reserva", ficha)}
          onnuevo={() => nuevoCliente("reserva")}
        />
        <label>
          <span>Teléfono</span>
          <input bind:value={borrador.reserva.telefono} inputmode="tel" placeholder="33 1122 3344" />
        </label>
        <!--
          El correo es lo que permite recordarle la reserva la víspera. Se pide
          aquí, al anotar por teléfono, porque es el único momento en que el
          comensal está al habla.

          Antes decía «para mandarle su confirmación», y era falso: la
          confirmación automática sale solo al aceptar una reserva pedida desde
          el celular. Una apartada por teléfono nace ya apartada y el Hub no le
          manda nada.
        -->
        <label>
          <span>Correo</span>
          <input
            bind:value={borrador.reserva.correo}
            inputmode="email"
            placeholder="Para recordarle su reserva"
          />
        </label>
        <label>
          <span>Personas</span>
          <input type="number" min="1" bind:value={borrador.reserva.personas} />
        </label>
        <label>
          <span>Día</span>
          <input type="date" bind:value={borrador.reserva.fecha} />
        </label>
        <label>
          <span>Hora</span>
          <input type="time" bind:value={borrador.reserva.hora} />
        </label>
        <label>
          <span>Mesa</span>
          <select bind:value={borrador.reserva.acomodo}>
            <option value="">Sin mesa asignada</option>
            {#if acomodosAlta.length === 0}
              <option value="" disabled>{sinDonde(comensalesAlta)}</option>
            {:else}
              {#each acomodosAlta as opcion (claveDe(opcion))}
                <option value={claveDe(opcion)}>{etiquetaAcomodo(opcion)}</option>
              {/each}
            {/if}
          </select>
        </label>
      </div>

      <!--
        El choque se avisa MIENTRAS se captura. Descubrirlo cuando llegan los dos
        grupos significa mandar a alguien a esperar de pie con una reserva en la
        mano: la peor forma de perder a un cliente que ya había decidido venir.
      -->
      {#each choques as choque (choque.reserva.id)}
        <p class="choque" role="alert">
          Esa mesa ya está apartada para <b>{choque.reserva.nombre}</b> a las
          {hora(choque.reserva.para_ts)} — se encimarían {choque.minutos_encimados} min.
        </p>
      {/each}

      {#if fichaDelTelefonoAlta}
        {@render avisoDeFicha(fichaDelTelefonoAlta, alta.nombre, "reserva")}
      {/if}

      {#if plantones > 0}
        <!-- El dato caro: con esto se decide si se le vuelve a apartar mesa. -->
        <p class="antecedente">
          Este teléfono no llegó {plantones} {plantones === 1 ? "vez" : "veces"}.
        </p>
      {/if}

      <div class="acciones">
        <button class="principal" onclick={apartar}>Apartar</button>
      </div>

      <!--
        Se dice lo que va a pasar ANTES de pulsar. Que el software dé de alta a
        un cliente solo es útil si quien lo usa sabe que lo hizo: descubrirlo
        después, viendo fichas que nadie recuerda haber creado, da la impresión
        contraria — la de un sistema que hace cosas a tus espaldas.
      -->
      <p class="nota">
        {#if alta.cliente_id}
          La reserva queda ligada a su ficha del comensal.
        {:else if alta.telefono.trim() !== ""}
          Si ese teléfono no tiene ficha, se le abre una con su nombre y su
          teléfono, y la reserva queda ligada a ella.
        {:else}
          Sin teléfono la reserva se guarda como un nombre suelto: no se le
          puede reconocer la próxima vez.
        {/if}
      </p>
    </div>
  {/if}

  <!--
    BANDEJA DE SOLICITUDES. Lo que pidieron desde el portal y nadie ha
    contestado. Va arriba de todo y con su propio color porque es lo único de
    esta pantalla que ESPERA UNA DECISIÓN: un comensal que pidió mesa y no
    recibe respuesta se va a otro lado, y ni siquiera nos enteramos.
  -->
  {#if reservas.solicitadas.length > 0}
    <section class="tarjeta solicitudes">
      <h2>
        Pidieron mesa desde el celular
        <span class="cuantas">{reservas.solicitadas.length}</span>
      </h2>
      <p class="nota">
        Todavía <b>no tienen mesa apartada</b>. Confirma o cancela: al confirmar,
        la mesa queda comprometida.
      </p>

      {#each reservas.solicitadas as r (r.id)}
        {@const opciones = acomodosParaConfirmar.get(r.personas) ?? []}
        <article class="reserva pedida">
          <div class="datos">
            {@render quien(r.nombre, fichaDe(r))}
            <span>
              {new Date(r.para_ts).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
              {hora(r.para_ts)} · {r.personas}
              {r.personas === 1 ? "persona" : "personas"}
              {#if r.telefono} · {r.telefono}{/if}
            </span>
          </div>
          {#if puedeEditar}
            <select onchange={(e) => confirmar(r, e.currentTarget.value)}>
              <option value="">Confirmar en…</option>
              <option value="sin-mesa">Sin asignar mesa</option>
              {#if opciones.length === 0}
                <option value="" disabled>{sinDonde(r.personas)}</option>
              {:else}
                {#each opciones as opcion (claveDe(opcion))}
                  <option value={claveDe(opcion)}>{etiquetaAcomodo(opcion)}</option>
                {/each}
              {/if}
            </select>
            <button class="mini x" onclick={() => cancelar(r)}>Rechazar</button>
          {/if}
        </article>
      {/each}
    </section>
  {/if}

  <div class="columnas">
    <!-- Quién viene -->
    <section class="tarjeta">
      <h2>En puerta</h2>

      {#if puerta.retrasadas.length > 0}
        <h3 class="alerta">Se retrasaron</h3>
        {#each puerta.retrasadas as r (r.id)}
          {@const opciones = acomodosParaSentar.get(r.personas) ?? []}
          <article class="reserva tarde">
            <div class="datos">
              {@render quien(r.nombre, fichaDe(r))}
              <span>
                {hora(r.para_ts)} · {r.personas}
                {r.personas === 1 ? "persona" : "personas"} ·
                {minutosDesde(r.para_ts)} min de retraso
              </span>
            </div>
            {#if puedeEditar}
              <select onchange={(e) => sentar(r, e.currentTarget.value)}>
                <option value="">Sentar en…</option>
                {#if opciones.length === 0}
                  <option value="" disabled>{sinDonde(r.personas)}</option>
                {:else}
                  {#each opciones as opcion (claveDe(opcion))}
                    <option value={claveDe(opcion)}>{etiquetaAcomodo(opcion)}</option>
                  {/each}
                {/if}
              </select>
              <!--
                Nadie se marca plantado solo: el reloj no sabe que vienen
                llegando. Liberar la mesa lo decide quien está en la puerta.
              -->
              <button class="mini" onclick={() => reservas.noLlego(r.id)}>No llegó</button>
            {/if}
          </article>
        {/each}
      {/if}

      <h3>Por llegar</h3>
      {#if puerta.esperando.length === 0}
        <p class="vacio">Sin reservas por llegar.</p>
      {:else}
        {#each pagPorLlegar.de(puerta.esperando) as r (r.id)}
          {@const opciones = acomodosParaSentar.get(r.personas) ?? []}
          {@const previo = recordatorioDe(r)}
          {@const estadoRecordatorio = previo ? comoVaElRecordatorio(previo) : undefined}
          <article class="reserva">
            <div class="datos">
              {@render quien(r.nombre, fichaDe(r))}
              <span>
                {diaSiNoEsHoy(r.para_ts)}{hora(r.para_ts)}–{hora(franjaDe(r).hasta)} · {r.personas}
                {r.personas === 1 ? "persona" : "personas"}
                {#if r.mesa_id} · mesa {mesaDeReserva(r.mesa_id)}{/if}
              </span>
              {#if estadoRecordatorio}
                <span class="recordatorio {estadoRecordatorio.tono}">{estadoRecordatorio.texto}</span>
              {/if}
            </div>
            {#if puedeEditar && sePuedeRecordar(r, previo)}
              <button class="mini recordar" onclick={() => (recordandoId = r.id)}>
                {previo ? "Recordarle otra vez" : "Recordarle"}
              </button>
            {/if}
            {#if puedeEditar}
              <select onchange={(e) => sentar(r, e.currentTarget.value)}>
                <option value="">Sentar en…</option>
                {#if opciones.length === 0}
                  <option value="" disabled>{sinDonde(r.personas)}</option>
                {:else}
                  {#each opciones as opcion (claveDe(opcion))}
                    <option value={claveDe(opcion)}>{etiquetaAcomodo(opcion)}</option>
                  {/each}
                {/if}
              </select>
              <button class="mini x" onclick={() => cancelar(r)}>Cancelar</button>
            {/if}
          </article>
        {/each}
        <VerMas pag={pagPorLlegar} lista={puerta.esperando} />
        {#if puedeEditar}
          <!-- Explica por qué el botón no está en todas: no es un fallo, es la víspera. -->
          <p class="nota">
            «Recordarle» aparece la víspera de cada reserva que dejó su correo, y
            una sola vez por reserva.
          </p>
        {/if}
      {/if}
    </section>

    <!-- Quién espera de pie -->
    <section class="tarjeta">
      <h2>Lista de espera</h2>

      <div class="estimacion" class:tenue={!esperaAhora.confiable}>
        <span>Al siguiente que llegue, dile</span>
        <b>
          {esperaAhora.minutos === 0 ? "pasan de inmediato" : `~${esperaAhora.minutos} min`}
        </b>
        <small>
          {esperaAhora.mesas_libres} libres · {esperaAhora.mesas_ocupadas} ocupadas
          {#if !esperaAhora.confiable} · estimación provisional{/if}
        </small>
      </div>

      {#if puedeEditar}
        <div class="campos">
          <!-- La misma lista de fichas que el alta: quien espera de pie también
               puede ser el cliente de siempre. -->
          <SelectorDeFicha
            bind:nombre={borrador.espera.nombre}
            bind:clienteId={borrador.espera.cliente_id}
            etiqueta="Nombre"
            placeholder="Para llamarlos"
            onelegir={(ficha) => copiarDeLaFicha("espera", ficha)}
            onnuevo={() => nuevoCliente("espera")}
          />
          <label>
            <span>Teléfono</span>
            <input bind:value={borrador.espera.telefono} inputmode="tel" />
          </label>
          <label>
            <span>Personas</span>
            <input type="number" min="1" bind:value={borrador.espera.personas} />
          </label>
        </div>

        {#if fichaDelTelefonoEspera}
          {@render avisoDeFicha(fichaDelTelefonoEspera, fila.nombre, "espera")}
        {/if}

        <div class="acciones">
          <button class="secundario" onclick={anotar}>Anotar en la lista</button>
        </div>
      {/if}

      {#if reservas.espera.length === 0}
        <p class="vacio">Nadie esperando.</p>
      {:else}
        {#each reservas.espera as e, i (e.id)}
          {@const opciones = acomodosParaSentar.get(e.personas) ?? []}
          <article class="reserva">
            <div class="datos">
              <span class="turno">
                <b>{i + 1}.</b>
                {@render quien(e.nombre, fichaDeEspera(e.telefono, e.cliente_id))}
              </span>
              <span>
                {e.personas} {e.personas === 1 ? "persona" : "personas"} ·
                lleva {minutosDesde(e.desde_ts)} min ·
                le toca en ~{reservas.esperaPara(i, ahora).minutos} min
              </span>
            </div>
            {#if puedeEditar}
              <select onchange={(e2) => sentarDeEspera(e.id, e2.currentTarget.value)}>
                <option value="">Sentar en…</option>
                {#if opciones.length === 0}
                  <option value="" disabled>{sinDonde(e.personas)}</option>
                {:else}
                  {#each opciones as opcion (claveDe(opcion))}
                    <option value={claveDe(opcion)}>{etiquetaAcomodo(opcion)}</option>
                  {/each}
                {/if}
              </select>
              <button class="mini x" onclick={() => reservas.quitarDeEspera(e.id)}>Se fue</button>
            {/if}
          </article>
        {/each}
        <p class="nota">
          La lista vive solo en esta terminal: quien espera de pie no es historia
          del negocio. Si la caja se reinicia hay que volver a anotarlos.
        </p>
      {/if}
    </section>
  </div>
</div>

{#if recordando && recordando.correo && puedeEditar}
  <div class="velo" role="presentation" onclick={() => (recordandoId = null)}></div>
  <div class="dialogo" role="dialog" aria-modal="true" aria-label="Recordarle su reserva">
    <header>
      <h2>Recordarle su reserva a {recordando.nombre}</h2>
      <button class="cerrar" onclick={() => (recordandoId = null)} aria-label="Cerrar">×</button>
    </header>
    <EnvioCorreo
      tipo="reserva_recordatorio"
      para={recordando.correo}
      nombre={recordando.nombre}
      datos={datosRecordatorio}
      clienteId={fichaDe(recordando)}
      aceptaMarketing={false}
      oncerrar={() => (recordandoId = null)}
    />
  </div>
{/if}

<style>
  .seccion {
    padding: 1.5rem 1.75rem;
    overflow-y: auto;
  }
  .encabezado {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 1.1rem;
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
  .columnas {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(21rem, 1fr));
    gap: 1rem;
    margin-top: 1rem;
    align-items: start;
  }
  /* Fondo, borde, radio y sombra los pone `.tarjeta` en base.css: aquí solo
     queda lo que es propio de esta pantalla. */
  .tarjeta {
    padding: 1.1rem 1.25rem;
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 600;
    margin-bottom: 0.85rem;
  }
  h3 {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--gris);
    margin: 0.9rem 0 0.5rem;
  }
  h3.alerta {
    color: var(--peligro);
    margin-top: 0;
  }
  .campos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
  }
  .campos label {
    flex: 1;
    min-width: 8rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  /* El campo que ocupaba el renglón entero era «A nombre de», y ahora lo dibuja
     `SelectorDeFicha` con su propio ancho: la regla se quedaba sin nadie. */
  .campos span {
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--gris);
  }
  input,
  select {
    padding: 0.55rem 0.7rem;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.9rem;
    font-family: var(--font-cuerpo);
    background: #fff;
    width: 100%;
  }
  .acciones {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.8rem;
  }
  .principal {
    background: var(--acento);
    color: var(--sobre-acento);
    border-radius: var(--r-md);
    padding: 0.6rem 1.15rem;
    font-family: var(--font-titulo);
    font-weight: 600;
    cursor: pointer;
  }
  .secundario {
    background: #fff;
    border: 1.5px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.55rem 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .reserva {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    margin-bottom: 0.4rem;
  }
  .reserva.tarde {
    border-color: var(--peligro);
    background: color-mix(in srgb, var(--peligro) 6%, transparent);
  }
  /* La bandeja: lo único de la pantalla que espera una decisión. */
  .solicitudes {
    border-color: var(--acento);
    background: color-mix(in srgb, var(--acento) 5%, #fff);
    margin-bottom: 1rem;
  }
  .cuantas {
    display: inline-block;
    min-width: 1.4rem;
    padding: 0.1rem 0.4rem;
    border-radius: var(--r-pill);
    background: var(--acento);
    color: var(--sobre-acento);
    font-size: 0.8rem;
    text-align: center;
    vertical-align: middle;
  }
  .reserva.pedida {
    border-color: var(--acento);
    background: #fff;
  }
  .reserva .datos {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .reserva b {
    font-size: 0.92rem;
  }
  .reserva span {
    font-size: 0.78rem;
    color: var(--gris);
  }
  /* El renglón del turno en la lista de espera: «3. Familia Ramírez». El número
     y el nombre son el título de la fila, no el texto tenue de debajo. */
  .reserva span.turno {
    display: flex;
    align-items: baseline;
    gap: 0.3rem;
    font-size: inherit;
    color: inherit;
  }
  /*
   * EL NOMBRE QUE LLEVA A SU FICHA.
   *
   * Se pinta del acento y subrayado porque en una tableta no hay ratón que
   * descubra los enlaces: si no se ve que se puede tocar, nadie lo toca.
   */
  .nombre-ficha {
    align-self: flex-start;
    padding: 0;
    background: none;
    border: none;
    font-family: inherit;
    font-size: 0.92rem;
    font-weight: 700;
    color: var(--acento-texto);
    text-align: left;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 0.18em;
    cursor: pointer;
  }
  /*
   * «Ese teléfono ya es de alguien». Del color del acento y no del de peligro:
   * no es un error, es un reconocimiento —y casi siempre es justo lo que se
   * quería—.
   */
  .reconocido {
    margin-top: 0.7rem;
    padding: 0.6rem 0.75rem;
    border: 1.5px solid var(--acento);
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--acento) 6%, transparent);
    font-size: 0.85rem;
    line-height: 1.45;
  }
  .reconocido .elegir {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }
  .reconocido .mini {
    min-height: var(--toque);
    font-weight: 600;
  }
  .reserva select {
    width: auto;
    font-size: 0.8rem;
    padding: 0.3rem 0.5rem;
  }
  .mini {
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.76rem;
    background: #fff;
    cursor: pointer;
    white-space: nowrap;
  }
  .mini.x {
    color: var(--peligro);
  }
  .estimacion {
    display: flex;
    flex-direction: column;
    padding: 0.7rem 0.85rem;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--acento) 9%, transparent);
    margin-bottom: 0.9rem;
  }
  .estimacion.tenue {
    background: var(--fondo);
  }
  .estimacion span {
    font-size: 0.78rem;
    color: var(--gris);
  }
  .estimacion b {
    font-family: var(--font-titulo);
    font-size: 1.5rem;
    color: var(--acento-texto);
  }
  .estimacion.tenue b {
    color: var(--pizarra);
  }
  .estimacion small {
    font-size: 0.74rem;
    color: var(--gris);
  }
  .choque {
    margin-top: 0.7rem;
    padding: 0.55rem 0.7rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--peligro);
    color: var(--pizarra);
    font-size: 0.83rem;
    line-height: 1.45;
  }
  .antecedente {
    margin-top: 0.5rem;
    font-size: 0.83rem;
    color: var(--peligro);
    font-weight: 600;
  }
  .error {
    color: var(--peligro);
    font-size: 0.86rem;
    margin-bottom: 0.7rem;
  }
  .vacio,
  .nota {
    font-size: 0.83rem;
    color: var(--gris);
    line-height: 1.5;
  }
  .nota {
    margin-top: 0.7rem;
    font-size: 0.76rem;
  }

  /* --- El recordatorio por correo --- */
  .mini.recordar {
    border-color: var(--acento);
    color: var(--acento-texto);
    font-weight: 600;
  }
  .reserva span.recordatorio {
    font-weight: 600;
  }
  .reserva span.recordatorio.bien {
    color: var(--exito-texto);
  }
  .reserva span.recordatorio.mal {
    color: var(--peligro);
  }
  .reserva span.recordatorio.espera {
    color: var(--acento-texto);
  }
  .velo {
    position: fixed;
    inset: 0;
    background: rgba(20, 24, 26, 0.55);
    z-index: var(--z-velo);
  }
  .dialogo {
    position: fixed;
    z-index: var(--z-dialogo);
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(40rem, calc(100vw - 2rem));
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    background: var(--blanco);
    border-radius: var(--r-xl);
    padding: 1.25rem 1.4rem 1.4rem;
    box-shadow: var(--sombra-lg);
  }
  .dialogo header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.85rem;
  }
  .dialogo h2 {
    flex: 1;
    margin-bottom: 0;
  }
  .cerrar {
    font-size: 1.5rem;
    line-height: 1;
    color: var(--gris);
    min-width: var(--toque);
    min-height: var(--toque);
  }
</style>
