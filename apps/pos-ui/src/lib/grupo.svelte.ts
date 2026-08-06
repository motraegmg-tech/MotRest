/**
 * El grupo de sucursales, visto desde un local (F4).
 *
 * ESTA PANTALLA ES DE LECTURA Y NADA MÁS. Cada local sigue siendo autónomo:
 * tiene su Hub, su registro y su caja, y sigue vendiendo aunque los demás se
 * caigan. Lo multisucursal no es una base de datos compartida — es juntar lo que
 * cada local ya calculó por su cuenta.
 *
 * CÓMO LLEGAN LOS REPORTES. Cada Hub manda su jornada cerrada al relay, y el
 * relay se los reparte a los demás locales del grupo. Si no hay internet, no
 * llegan, y entonces el consolidado sale incompleto y LO DICE. Eso es lo
 * correcto: un local que vendió $40 000 y no reportó no es un local que vendió
 * cero, y presentar el total sin decirlo hace que el dueño decida con un número
 * que no existe.
 */
import {
  compararSucursales,
  consolidar,
  saludDelGrupo,
  type Consolidado,
  type ReporteDeSucursal,
  type Sucursal,
} from "@motrest/dominio";
import type { Almacen } from "@motrest/protocolo-sync";

export const CLAVE_GRUPO = "grupo_sucursales";
export const CLAVE_REPORTES = "grupo_reportes";

interface DatosGrupo {
  sucursales: Sucursal[];
  reportes: ReporteDeSucursal[];
}

/** El inicio del día operativo, que es a las 5 de la mañana y no a medianoche. */
export function inicioDeJornada(ts = Date.now()): number {
  const d = new Date(ts);
  /*
   * Un servicio que termina a las 2 de la mañana del sábado pertenece al viernes.
   * Cortar a medianoche partiría en dos la noche que más vende de la semana.
   */
  if (d.getHours() < 5) d.setDate(d.getDate() - 1);
  d.setHours(5, 0, 0, 0);
  return d.getTime();
}

class StoreGrupo {
  private datos = $state<DatosGrupo>({ sucursales: [], reportes: [] });
  private almacen: Almacen | null = null;

  /** Jornada que se está mirando. Por defecto, la de hoy. */
  dia = $state(inicioDeJornada());

  get sucursales(): Sucursal[] {
    return this.datos.sucursales;
  }

  /** ¿Este local pertenece a un grupo? Con uno solo, la pantalla no aplica. */
  get esGrupo(): boolean {
    return this.datos.sucursales.filter((s) => s.activa).length > 1;
  }

  get consolidado(): Consolidado {
    return consolidar(this.datos.sucursales, this.datos.reportes, this.dia);
  }

  get comparativa() {
    return compararSucursales(this.consolidado);
  }

  get salud() {
    return saludDelGrupo(this.datos.sucursales, this.datos.reportes);
  }

  /** Las jornadas de las que hay algo que enseñar, de la más nueva a la más vieja. */
  get jornadas(): number[] {
    return [...new Set(this.datos.reportes.map((r) => r.dia))].sort((a, b) => b - a).slice(0, 30);
  }

  async hidratar(almacen: Almacen): Promise<void> {
    this.almacen = almacen;
    const guardado = await almacen.estado.cargar<DatosGrupo>(CLAVE_GRUPO);
    if (guardado) this.datos = guardado;
  }

  /** La lista de locales del grupo. La configura la dirección. */
  fusionarSucursales(sucursales: Sucursal[]): void {
    this.datos = { ...this.datos, sucursales };
    this.guardar();
  }

  /**
   * Lo que reportó otro local.
   *
   * Se sustituye el reporte previo de esa sucursal y esa jornada en vez de
   * acumularlo: un Hub que reintentó tras una caída manda el mismo día dos
   * veces, y guardarlos los dos duplicaría la venta del grupo.
   */
  recibirReporte(reporte: ReporteDeSucursal): void {
    const otros = this.datos.reportes.filter(
      (r) => !(r.sucursal_id === reporte.sucursal_id && r.dia === reporte.dia),
    );
    this.datos = { ...this.datos, reportes: [...otros, reporte] };
    this.guardar();
  }

  private guardar(): void {
    void this.almacen?.estado.guardar(CLAVE_GRUPO, this.datos).catch((causa) => {
      console.error("No se pudo guardar el grupo", causa);
    });
  }
}

export const grupo = new StoreGrupo();
