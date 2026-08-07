/**
 * El comparativo contra el mercado, visto desde el local (F5).
 *
 * QUÉ SALE DE AQUÍ Y QUÉ NO. Sale un puñado de razones y promedios —food cost,
 * ticket, rotación— **sin una sola cifra absoluta de venta** y sin nada que
 * identifique al restaurante. No sale el nombre, ni el id, ni la dirección, ni
 * un solo renglón de comanda.
 *
 * Es la diferencia entre "comparto mis indicadores" y "le doy mis ventas a mi
 * proveedor", y el restaurantero tiene derecho a saber cuál de las dos está
 * aceptando. Por eso `aporteDelPeriodo` construye el objeto entero aquí, a la
 * vista, en vez de mandar un volcado y filtrar en el servidor.
 */
import {
  consentimientoInicial,
  type AporteAnonimo,
  type ConsentimientoBenchmark,
  type PerfilComparable,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";
import { SUCURSAL_ID } from "./presentacion";

export const CLAVE_BENCHMARK = "benchmark_consentimiento";
export const CLAVE_MUESTRA = "benchmark_muestra";

class StoreBenchmark {
  private datos = $state<ConsentimientoBenchmark>(consentimientoInicial(SUCURSAL_ID));
  /** Lo que MOTRAE devuelve: aportes anónimos de locales parecidos. */
  muestra = $state<AporteAnonimo[]>([]);
  /** El perfil de este local. Lo captura la dirección en Administración. */
  perfil = $state<PerfilComparable | null>(null);
  /** Los indicadores propios del último periodo cerrado. */
  propio = $state<AporteAnonimo | null>(null);

  private almacen: Almacen | null = null;

  get consentimiento(): ConsentimientoBenchmark {
    return this.datos;
  }

  get participa(): boolean {
    return this.datos.participa;
  }

  async hidratar(almacen: Almacen): Promise<void> {
    this.almacen = almacen;
    const guardado = await almacen.estado.cargar<ConsentimientoBenchmark>(CLAVE_BENCHMARK);
    if (guardado) this.datos = guardado;

    const muestra = await almacen.estado.cargar<AporteAnonimo[]>(CLAVE_MUESTRA);
    if (muestra) this.muestra = muestra;
  }

  activar(): void {
    this.datos = { ...this.datos, participa: true, aceptado_ts: Date.now() };
    this.guardar();
  }

  /**
   * Deja de participar.
   *
   * Se borra también la muestra recibida: seguir enseñando el comparativo de un
   * local que se dio de baja sería usar datos que dejó de tener derecho a ver, y
   * daría a entender que sigue aportando cuando ya no.
   */
  desactivar(): void {
    this.datos = { ...this.datos, participa: false };
    this.muestra = [];
    this.guardar();
    void this.almacen?.estado.guardar(CLAVE_MUESTRA, []).catch(() => {});
  }

  /** Lo que llega de MOTRAE. Solo si el local participa. */
  fusionarMuestra(muestra: AporteAnonimo[]): void {
    if (!this.datos.participa) return;
    this.muestra = muestra;
    void this.almacen?.estado.guardar(CLAVE_MUESTRA, muestra).catch(() => {});
  }

  /** Los indicadores del periodo, calculados por el propio local. */
  fijarPropio(aporte: AporteAnonimo | null): void {
    this.propio = aporte;
  }

  private guardar(): void {
    void this.almacen?.estado.guardar(CLAVE_BENCHMARK, this.datos).catch((causa) => {
      console.error("No se pudo guardar el consentimiento del comparativo", causa);
    });
  }
}

export const benchmark = new StoreBenchmark();
