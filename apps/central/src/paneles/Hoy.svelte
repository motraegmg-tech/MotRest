<script lang="ts">
  /**
   * Lo primero que se ve al abrir Central.
   *
   * ARRIBA LO QUE ESTÁ MAL, ABAJO EL DINERO. No es una preferencia estética: el
   * ingreso del mes que viene depende de que los restaurantes funcionen hoy, así
   * que un panel que abre con la gráfica de ingresos y esconde "Rodizio lleva 30
   * horas sin reportar" está ordenado al revés.
   *
   * Si no hay nada urgente, se dice explícitamente. Un espacio en blanco donde
   * debería ir una lista no se lee como "todo bien": se lee como "no cargó".
   */
  import { central } from "../lib/central.svelte";
  import { desde, dinero } from "../lib/formato";
  import type { Urgencia } from "@motrest/dominio";

  const { onAbrir }: { onAbrir: (id: string) => void } = $props();

  const pendientes = $derived(central.pendientes);
  const resumen = $derived(central.resumen);

  /*
   * Los avisos que no son de ningún restaurante, sino de MOTRAE.
   *
   * Van arriba del todo y por delante de la lista de locales porque son los dos
   * que nadie va a ir a buscar a otra pantalla: unas llaves sin respaldo no
   * duelen hasta el día que la máquina no arranca, y una contraseña de soporte a
   * medio rotar no duele hasta que hay que usarla en el local equivocado.
   */
  const sinRespaldo = $derived(!central.respaldoAlDia);
  const soportePendiente = $derived(central.localesConSoportePendiente);
  const relay = $derived(central.saludNube);

  /*
   * Renovaciones que ya se firmaron y el local todavía no ha recogido.
   *
   * Solo molestan si llevan más de un día ahí: un local cerrado por la noche es
   * lo normal y avisar de eso enseñaría a ignorar el aviso. Pasadas 24 horas ya
   * no es que esté cerrado — es que su Hub no está conectando, y ése es el que
   * va a llamar el día que se le bloquee.
   */
  const renovacionesAtascadas = $derived(
    central.licenciasPendientes.filter(
      (p) => !p.conectado && central.ahora - p.depositada_ts > 86_400_000,
    ),
  );

  function nombreDe(sucursal_id: string): string {
    return central.clientes.find((c) => c.id === sucursal_id)?.nombre ?? sucursal_id;
  }
  /* Si el relay no contesta, lo caído es el relay y no los restaurantes. */
  const relayMudo = $derived(central.puedeConsultarNube && central.errorPulsos !== "");

  const ETIQUETA: Record<Urgencia, string> = {
    caido: "Caído",
    bloqueado: "Bloqueado",
    vence_hoy: "Vence",
    por_cobrar: "Por cobrar",
    // No dice «Caído» porque no lo está: dice que no lo vemos. La acción que
    // toca es reemitirle la licencia con el enlace, no llamar al restaurante
    // para preguntarle por qué no vende.
    sin_telemetria: "Sin señal",
    revisar: "Revisar",
  };
</script>

<section>
  <h1>Hoy</h1>

  {#if relayMudo}
    <!--
      Si el relay se cae, lo que se ve abajo es «todos llevan horas sin
      reportar», que se lee como avería masiva cuando en realidad todos están
      vendiendo. Decir quién es el caído cambia a quién hay que llamar.
    -->
    <div class="alarma">
      <b>El relay no contesta.</b>
      Los restaurantes siguen operando igual: lo que se pierde es la vista, no el
      servicio. Lo de abajo puede estar viejo.
    </div>
  {/if}

  {#if renovacionesAtascadas.length > 0}
    <!--
      Una renovación firmada que nadie recoge es una factura cobrada y un
      servicio que se va a cortar igual. Es el aviso que evita la llamada.
    -->
    <div class="ojo">
      <b>
        {renovacionesAtascadas.length === 1
          ? "Una renovación lleva más de un día sin llegar a su restaurante."
          : `${renovacionesAtascadas.length} renovaciones llevan más de un día sin llegar a su restaurante.`}
      </b>
      Su Hub no se ha conectado. La recogerá sola en cuanto lo haga, pero si el
      equipo está apagado o sin internet hay que llamarlos.
      <span class="quienes">
        {renovacionesAtascadas.map((p) => nombreDe(p.sucursal_id)).join(", ")}
      </span>
    </div>
  {/if}

  {#if sinRespaldo}
    <div class="alarma">
      <b>Las llaves de firma no tienen un respaldo que abra fuera de esta computadora.</b>
      Si este equipo se pierde, se van con él las licencias y las actualizaciones
      de todos los restaurantes, y no se pueden regenerar. Sáquelo en
      <b>Llaves → Respaldo portátil</b>.
    </div>
  {/if}

  {#if soportePendiente.length > 0}
    <div class="ojo">
      <b>
        {soportePendiente.length === 1
          ? "Un local sigue aceptando la contraseña de soporte anterior."
          : `${soportePendiente.length} locales siguen aceptando la contraseña de soporte anterior.`}
      </b>
      Viaja firmada dentro de la licencia: hasta reemitirles, su acceso no cambió.
      <span class="quienes">
        {soportePendiente.map((c) => c.nombre).join(", ")}
      </span>
    </div>
  {/if}

  {#if central.clientes.length === 0}
    <div class="vacio">
      <p><b>Todavía no hay ningún restaurante dado de alta.</b></p>
      <p>
        Empieza en <b>Llaves</b> capturando los secretos de firma, y después da de
        alta tu primer local en <b>Restaurantes</b>.
      </p>
    </div>
  {:else}
    <h2>Qué atender</h2>

    {#if pendientes.length === 0}
      <div class="tranquilo">
        Todos los locales reportando y al corriente. Nada que atender.
      </div>
    {:else}
      <ul class="pendientes">
        {#each pendientes as p (p.sucursal_id)}
          <li>
            <button onclick={() => onAbrir(p.sucursal_id)}>
              <span class="marca {p.urgencia}">{ETIQUETA[p.urgencia]}</span>
              <span class="nombre">{p.nombre}</span>
              <span class="detalle">{p.detalle}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <h2>El negocio</h2>
    <!--
      LO COBRADO VA AL LADO DE LO PROMETIDO, y la distancia entre los dos es el
      único número honesto de esta pantalla. Un panel que solo enseña «al mes si
      todos pagan» hace sentir un negocio que puede no estar pasando.
    -->
    <div class="cifras">
      <div class="cifra">
        <b>{resumen.locales}</b>
        <span>locales activos</span>
      </div>
      <div class="cifra destacada">
        <b>{dinero(resumen.cobrado_mes)}</b>
        <span>cobrado en 30 días</span>
      </div>
      <div class="cifra">
        <b>{dinero(resumen.ingreso_mensual)}</b>
        <span>al mes si todos pagan</span>
      </div>
      <div class="cifra" class:mal={resumen.bloqueados > 0}>
        <b>{resumen.bloqueados}</b>
        <span>bloqueados</span>
      </div>
    </div>

    {#if resumen.por_cobrar_resultados > 0}
      <p class="resultados-pendientes">
        Además, <b>{dinero(resumen.por_cobrar_resultados)}</b> en comisiones por
        resultado ya verificadas y todavía sin cobrar.
      </p>
    {/if}

    {#if relay}
      <h2>El relay</h2>
      <div class="relay">
        <span><b>{relay.hubs_conectados}</b> de {relay.restaurantes} Hubs conectados ahora</span>
        <span>{relay.pulsos} partes guardados</span>
        <span>consultado {desde(relay.consultado_ts, central.ahora)}</span>
      </div>
    {/if}

    {#if resumen.versiones.length > 0}
      <h2>Qué versión tiene cada quien</h2>
      <!--
        Muchas versiones distintas es un despliegue disperso, y eso convierte
        cada soporte en una adivinanza: "no me funciona X" significa cosas
        distintas según la versión que tenga delante.
      -->
      <div class="versiones">
        {#each resumen.versiones as v (v.version)}
          <span class="chip">
            {v.version}
            <b>{v.locales}</b>
          </span>
        {/each}
        {#if resumen.versiones.length > 2}
          <span class="disperso">
            {resumen.versiones.length} versiones distintas en la calle: conviene
            emparejarlas.
          </span>
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style>
  section {
    padding: 1.5rem 1.75rem 3rem;
    max-width: 62rem;
  }
  h1 {
    font-family: var(--font-titulo);
    font-size: 1.6rem;
    margin: 0 0 1.4rem;
    color: var(--pizarra);
  }
  h2 {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--gris);
    margin: 1.9rem 0 0.7rem;
  }
  h2:first-of-type {
    margin-top: 0;
  }
  .vacio,
  .tranquilo {
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 1.1rem 1.2rem;
    font-size: 0.9rem;
    line-height: 1.6;
    color: var(--pizarra);
  }
  .alarma,
  .ojo {
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-left: 3px solid var(--peligro);
    border-radius: var(--r-md);
    padding: 0.85rem 1rem;
    margin-bottom: 0.7rem;
    font-size: 0.86rem;
    line-height: 1.6;
    color: var(--pizarra);
  }
  .ojo {
    border-left-color: var(--acento-2);
  }
  .quienes {
    display: block;
    margin-top: 0.3rem;
    font-size: 0.8rem;
    color: var(--gris);
  }
  .resultados-pendientes {
    font-size: 0.84rem;
    color: var(--gris);
    margin: 0.6rem 0 0;
  }
  .resultados-pendientes b {
    color: var(--acento);
  }
  .relay {
    display: flex;
    flex-wrap: wrap;
    gap: 1.2rem;
    font-size: 0.82rem;
    color: var(--gris);
  }
  .relay b {
    color: var(--pizarra);
  }
  .vacio p {
    margin: 0 0 0.5rem;
  }
  .vacio p:last-child {
    margin: 0;
  }
  .tranquilo {
    border-left: 3px solid #2f9e6b;
    color: var(--gris);
  }
  .pendientes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .pendientes button {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    width: 100%;
    padding: 0.7rem 0.9rem;
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .pendientes button:hover {
    border-color: var(--acento);
  }
  .marca {
    flex: none;
    min-width: 5.6rem;
    text-align: center;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.25rem 0.5rem;
    border-radius: var(--r-pill);
    color: var(--blanco);
  }
  /* Rojo lo que está parado, ámbar lo que urge cobrar, gris lo que solo se mira. */
  .marca.caido,
  .marca.bloqueado {
    background: var(--peligro);
  }
  .marca.vence_hoy {
    background: var(--acento);
  }
  .marca.por_cobrar {
    background: var(--acento-2);
    color: var(--negro);
  }
  .marca.revisar {
    background: var(--borde);
    color: var(--gris);
  }
  .nombre {
    font-weight: 600;
    font-size: 0.92rem;
    color: var(--pizarra);
  }
  .detalle {
    font-size: 0.82rem;
    color: var(--gris);
    margin-left: auto;
    text-align: right;
  }
  .cifras {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.6rem;
  }
  .cifra {
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    padding: 0.9rem 1rem;
  }
  .cifra b {
    display: block;
    font-family: var(--font-titulo);
    font-size: 1.5rem;
    color: var(--pizarra);
  }
  .cifra span {
    font-size: 0.76rem;
    color: var(--gris);
  }
  .cifra.destacada b {
    color: var(--acento);
  }
  .cifra.mal b {
    color: var(--peligro);
  }
  .versiones {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--blanco);
    border: 1px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.3rem 0.7rem;
    font-size: 0.8rem;
    color: var(--pizarra);
  }
  .chip b {
    color: var(--acento);
  }
  .disperso {
    font-size: 0.78rem;
    color: var(--gris);
    margin-left: 0.4rem;
  }
</style>
