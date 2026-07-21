<script lang="ts">
  import { moduloActivo, modulos } from "./presentacion";
</script>

<aside class="sb">
  <div class="logo">MotRest<span>.</span></div>
  <nav>
    {#each modulos as modulo (modulo)}
      <div class="item" class:on={modulo === moduloActivo}>
        <i></i>{modulo}
      </div>
    {/each}
  </nav>
  <div class="foot">MOTRAE · Innovation already in motion</div>
</aside>

<style>
  .sb {
    width: 15rem;
    flex: none;
    background: var(--negro);
    color: #fff;
    display: flex;
    flex-direction: column;
    padding: 1.5rem 1rem;
  }
  .logo {
    font-family: var(--font-titulo);
    font-size: 1.75rem;
    font-weight: 700;
    padding: 0 0.75rem 1.5rem;
  }
  .logo span {
    color: var(--acento);
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.7rem 0.85rem;
    border-radius: var(--r-md);
    color: #b9c2bc;
    font-size: 1rem;
    font-weight: 500;
  }
  .item.on {
    background: var(--acento);
    color: #fff;
    font-weight: 600;
  }
  .item i {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 3px;
    background: currentColor;
    opacity: 0.55;
  }
  .foot {
    margin-top: auto;
    padding: 0.75rem 0.85rem;
    font-size: 0.8rem;
    color: var(--gris);
  }
</style>
