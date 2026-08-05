/**
 * Canales de venta: la configuración de los agregadores y sus reportes.
 *
 * La comisión se CONGELA en cada venta al capturarla. Cuando el restaurante
 * renegocie con Rappi, el histórico tiene que seguir contando lo que de verdad
 * le cobraron entonces — si no, el reporte del mes pasado cambia solo el día que
 * se firma un contrato nuevo.
 */
import {
  configuracionPorDefecto,
  porCobrarDeAgregadores,
  ventasPorCanal,
  type CanalVenta,
  type ConfiguracionCanal,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";
import { pos } from "./pos.svelte";

export const CLAVE_CANALES = "canales_config";

class StoreCanales {
  private datos = $state<ConfiguracionCanal[]>(configuracionPorDefecto());
  private almacen: Almacen | null = null;

  get config(): ConfiguracionCanal[] {
    return this.datos;
  }

  /** Los agregadores que este restaurante de verdad usa. */
  get activos(): ConfiguracionCanal[] {
    return this.datos.filter((c) => c.activo);
  }

  get hayAlguno(): boolean {
    return this.activos.length > 0;
  }

  async hidratar(almacen: Almacen): Promise<void> {
    this.almacen = almacen;
    const guardada = await almacen.estado.cargar<ConfiguracionCanal[]>(CLAVE_CANALES);
    if (guardada && guardada.length > 0) {
      // Se fusiona con el catálogo actual: si mañana se agrega una plataforma
      // nueva, aparece apagada en vez de desaparecer la configuración guardada.
      const porCanal = new Map(guardada.map((c) => [c.canal, c]));
      this.datos = configuracionPorDefecto().map((base) => porCanal.get(base.canal) ?? base);
    }
  }

  private guardar(): void {
    void this.almacen?.estado.guardar(CLAVE_CANALES, this.datos).catch((causa) => {
      console.error("No se pudo guardar la configuración de canales", causa);
    });
  }

  actualizar(canal: CanalVenta, cambios: Partial<ConfiguracionCanal>): void {
    this.datos = this.datos.map((c) => (c.canal === canal ? { ...c, ...cambios } : c));
    this.guardar();
  }

  alternar(canal: CanalVenta): void {
    const previo = this.datos.find((c) => c.canal === canal);
    this.actualizar(canal, { activo: !previo?.activo });
  }

  /** La comisión pactada hoy con una plataforma, para congelarla en la venta. */
  comisionDe(canal: CanalVenta): number {
    return this.datos.find((c) => c.canal === canal)?.comision ?? 0;
  }

  // --- Reportes ---------------------------------------------------------------

  resumen = $derived(ventasPorCanal(pos.todasLasComandas, this.datos));

  porCobrar = $derived(porCobrarDeAgregadores(pos.todasLasComandas, this.datos));
}

export const canales = new StoreCanales();
