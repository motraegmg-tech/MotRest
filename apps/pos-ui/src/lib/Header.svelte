<script lang="ts">
  import { diaYHora } from "./formato";
  import { pos } from "./pos.svelte";
  import { EMPLEADO_ACTUAL, cabecera, empleadosPorId } from "./presentacion";

  // Reloj del propio dispositivo (ADR-17): el software no tiene reloj propio.
  let ahora = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (ahora = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  const empleado = $derived(empleadosPorId.get(EMPLEADO_ACTUAL));
</script>

<header class="hd">
  <h1>{cabecera.titulo}</h1>
  <span class="chip">{cabecera.sucursal} ▾</span>
  <span class="chip acento">Mesa {pos.numeroMesaActiva}</span>
  <span class="chip gray">{diaYHora(ahora)}</span>
  <span class="chip gray">{cabecera.demo}</span>
  <span class="sp"></span>
  <span class="avatar">
    <span class="av">{empleado?.iniciales ?? "?"}</span>
    {empleado?.nombre ?? "Sin sesión"} · {empleado?.puesto ?? ""}
  </span>
</header>

<style>
  .hd {
    height: 4rem;
    background: #fff;
    border-bottom: 1px solid var(--borde);
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0 1.5rem;
    flex: none;
  }
  h1 {
    font-size: 1.4rem;
    font-weight: 600;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--claro);
    border-radius: var(--r-pill);
    padding: 0.4rem 0.85rem;
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .chip.gray {
    background: #eef1ed;
    color: var(--gris);
  }
  .chip.acento {
    background: var(--acento);
    color: #fff;
  }
  .sp {
    flex: 1;
  }
  .avatar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.95rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .av {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    background: var(--acento);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
  }
</style>
