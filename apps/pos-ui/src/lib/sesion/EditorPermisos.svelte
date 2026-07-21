<script lang="ts">
  /**
   * Lista completa de actividades, permisos y alcances (pedido de Gonzalo).
   *
   * Muestra TODAS las acciones del sistema agrupadas por módulo. Para cada una
   * se elige el nivel —sin acceso, ver, operar o autorizar— y, donde aplica, el
   * alcance máximo (porcentaje de descuento o monto en pesos).
   */
  import {
    CATALOGO_ACCIONES,
    aPesos,
    pesos,
    type Accion,
    type Nivel,
    type Permiso,
  } from "@motrest/dominio";

  interface Props {
    permisos: Permiso[];
    onCambio: (permisos: Permiso[]) => void;
    soloLectura?: boolean;
    /**
     * Filtro de delegación: solo se concede lo que uno mismo tiene. Los niveles
     * que el administrador no posee aparecen deshabilitados.
     */
    puedeOtorgar?: (permiso: Permiso) => boolean;
  }
  let { permisos, onCambio, soloLectura = false, puedeOtorgar }: Props = $props();

  function otorgable(accion: Accion, nivel: Nivel | "ninguno"): boolean {
    if (nivel === "ninguno") return true;
    if (!puedeOtorgar) return true;
    return puedeOtorgar({ accion, nivel });
  }

  /** Acciones cuyo alcance se puede acotar, y en qué unidad. */
  const LIMITES: Partial<Record<Accion, "porcentaje" | "monto">> = {
    "pos.descuento.aplicar": "porcentaje",
    "caja.retiro.registrar": "monto",
    "fin.egreso.registrar": "monto",
  };

  const NIVELES: { valor: Nivel | "ninguno"; etiqueta: string }[] = [
    { valor: "ninguno", etiqueta: "Sin acceso" },
    { valor: "ver", etiqueta: "Ver" },
    { valor: "operar", etiqueta: "Operar" },
    { valor: "autorizar", etiqueta: "Autorizar" },
  ];

  let abiertos = $state<Record<string, boolean>>({ m1: true });

  function permisoDe(accion: Accion): Permiso | undefined {
    return permisos.find((p) => p.accion === accion);
  }

  function nivelDe(accion: Accion): Nivel | "ninguno" {
    return permisoDe(accion)?.nivel ?? "ninguno";
  }

  function fijarNivel(accion: Accion, nivel: Nivel | "ninguno") {
    if (soloLectura) return;
    const sinEsta = permisos.filter((p) => p.accion !== accion);
    if (nivel === "ninguno") {
      onCambio(sinEsta);
      return;
    }
    const previo = permisoDe(accion);
    onCambio([...sinEsta, { accion, nivel, ...(previo?.limite === undefined ? {} : { limite: previo.limite }) }]);
  }

  function fijarLimite(accion: Accion, texto: string) {
    if (soloLectura) return;
    const permiso = permisoDe(accion);
    if (!permiso) return;
    const unidad = LIMITES[accion];
    const numero = Number(texto);
    const sinEsta = permisos.filter((p) => p.accion !== accion);

    if (texto === "" || Number.isNaN(numero) || numero <= 0) {
      onCambio([...sinEsta, { accion: permiso.accion, nivel: permiso.nivel }]);
      return;
    }
    const limite = unidad === "porcentaje" ? numero / 100 : pesos(numero);
    onCambio([...sinEsta, { accion: permiso.accion, nivel: permiso.nivel, limite }]);
  }

  function valorLimite(accion: Accion): string {
    const limite = permisoDe(accion)?.limite;
    if (limite === undefined) return "";
    return LIMITES[accion] === "porcentaje"
      ? String(Math.round(limite * 100))
      : String(aPesos(limite as never));
  }

  const totalConcedidos = $derived(permisos.length);
</script>

<div class="editor">
  <div class="resumen">
    <b>{totalConcedidos}</b> de {CATALOGO_ACCIONES.reduce((n, g) => n + g.acciones.length, 0)}
    actividades concedidas
  </div>

  {#each CATALOGO_ACCIONES as grupo (grupo.modulo)}
    {@const concedidas = grupo.acciones.filter((a) => nivelDe(a.accion) !== "ninguno").length}
    <section class="grupo">
      <button
        class="cabecera"
        onclick={() => (abiertos[grupo.modulo] = !abiertos[grupo.modulo])}
        aria-expanded={abiertos[grupo.modulo] ?? false}
      >
        <span class="flecha" class:abierta={abiertos[grupo.modulo]}>▸</span>
        <span class="titulo">{grupo.titulo}</span>
        <span class="cuenta" class:activa={concedidas > 0}>
          {concedidas}/{grupo.acciones.length}
        </span>
      </button>

      {#if abiertos[grupo.modulo]}
        <div class="acciones">
          {#each grupo.acciones as definicion (definicion.accion)}
            {@const nivel = nivelDe(definicion.accion)}
            <div class="fila" class:concedida={nivel !== "ninguno"}>
              <div class="texto">
                <b>
                  {definicion.etiqueta}
                  {#if definicion.sensible}<span class="sensible" title="Acción sensible">!</span>{/if}
                </b>
                <small>{definicion.descripcion}</small>
              </div>

              <div class="niveles">
                {#each NIVELES as opcion (opcion.valor)}
                  {@const permitido = otorgable(definicion.accion, opcion.valor)}
                  <button
                    class="nivel"
                    class:on={nivel === opcion.valor}
                    disabled={soloLectura || !permitido}
                    title={permitido ? "" : "No puedes conceder un nivel que tú no tienes"}
                    onclick={() => fijarNivel(definicion.accion, opcion.valor)}
                  >
                    {opcion.etiqueta}
                  </button>
                {/each}
              </div>

              {#if LIMITES[definicion.accion] && nivel !== "ninguno"}
                <label class="limite">
                  <span>Máx.</span>
                  <input
                    type="number"
                    min="0"
                    disabled={soloLectura}
                    value={valorLimite(definicion.accion)}
                    oninput={(e) => fijarLimite(definicion.accion, e.currentTarget.value)}
                    placeholder="sin tope"
                  />
                  <span>{LIMITES[definicion.accion] === "porcentaje" ? "%" : "MXN"}</span>
                </label>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/each}
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .resumen {
    font-size: 0.82rem;
    color: var(--gris);
  }
  .resumen b {
    color: var(--acento);
    font-family: var(--font-titulo);
    font-size: 1rem;
  }
  .grupo {
    border: 1px solid var(--borde);
    border-radius: var(--r-md);
    overflow: hidden;
  }
  .cabecera {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.7rem 0.85rem;
    background: var(--fondo);
    text-align: left;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--pizarra);
  }
  .flecha {
    color: var(--gris);
    transition: transform 0.12s ease;
    display: inline-block;
  }
  .flecha.abierta {
    transform: rotate(90deg);
  }
  .titulo {
    flex: 1;
  }
  .cuenta {
    font-size: 0.78rem;
    color: var(--gris);
    background: #fff;
    border: 1px solid var(--borde);
    border-radius: var(--r-pill);
    padding: 0.1rem 0.5rem;
  }
  .cuenta.activa {
    color: var(--acento);
    border-color: var(--acento);
  }
  .acciones {
    display: flex;
    flex-direction: column;
  }
  .fila {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.85rem;
    border-top: 1px solid var(--borde);
    flex-wrap: wrap;
  }
  .fila.concedida {
    background: #fffaf5;
  }
  .texto {
    flex: 1;
    min-width: 11rem;
    display: flex;
    flex-direction: column;
  }
  .texto b {
    font-size: 0.88rem;
    font-weight: 600;
  }
  .texto small {
    font-size: 0.75rem;
    color: var(--gris);
  }
  .sensible {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    background: var(--peligro);
    color: #fff;
    font-size: 0.65rem;
    margin-left: 0.3rem;
    vertical-align: middle;
  }
  .niveles {
    display: flex;
    gap: 0.2rem;
    background: var(--fondo);
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    padding: 0.15rem;
  }
  .nivel {
    padding: 0.28rem 0.55rem;
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--gris);
    white-space: nowrap;
  }
  .nivel.on {
    background: var(--acento);
    color: #fff;
  }
  .nivel:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }
  .nivel.on:disabled {
    opacity: 0.75;
  }
  .limite {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.75rem;
    color: var(--gris);
  }
  .limite input {
    width: 4.5rem;
    padding: 0.28rem 0.4rem;
    border: 1px solid var(--borde);
    border-radius: var(--r-sm);
    font-size: 0.8rem;
    font-family: var(--font-cuerpo);
  }
</style>
