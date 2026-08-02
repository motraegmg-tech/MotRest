/**
 * Los restaurantes que atiende el relay, y sus credenciales.
 *
 * Es lo ÚNICO que el relay guarda. Ni comandas, ni ventas, ni clientes: eso vive
 * en el local de cada restaurante y ahí se queda (TRD R3). Aquí solo está lo
 * mínimo para saber a quién le toca un mensaje y con qué llave mandarlo.
 *
 * POR QUÉ IMPORTA QUE SEA TAN POCO
 *
 * El relay es la única parte de MotRest expuesta a internet. Si algún día lo
 * comprometen, lo que se llevan son credenciales de WhatsApp —revocables en un
 * clic desde el panel de Meta— y no la operación de cincuenta restaurantes.
 * Esa asimetría es deliberada y es lo que hace defendible tener algo en la nube.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Inquilino } from "./nucleo.js";

/** Enlace vivo con el Hub de un restaurante. */
export interface EnlaceHub {
  sucursal_id: string;
  enviar(mensaje: unknown): void;
}

export class Inquilinos {
  private porNumero = new Map<string, Inquilino>();
  private porSucursal = new Map<string, Inquilino>();
  /** Hubs conectados ahora. Un restaurante puede tener el suyo apagado. */
  private enlaces = new Map<string, EnlaceHub>();

  constructor(private ruta: string) {
    this.cargar();
  }

  private cargar(): void {
    if (!existsSync(this.ruta)) return;
    try {
      const lista = JSON.parse(readFileSync(this.ruta, "utf8")) as Inquilino[];
      for (const i of lista) this.indexar(i);
    } catch (causa) {
      // Un archivo corrupto no puede impedir que arranque el relay de TODOS:
      // se avisa y se sigue con lo que se pueda.
      console.error("No se pudo leer el padrón de restaurantes:", causa);
    }
  }

  private indexar(i: Inquilino): void {
    this.porNumero.set(i.phone_number_id, i);
    this.porSucursal.set(i.sucursal_id, i);
  }

  private guardar(): void {
    mkdirSync(dirname(this.ruta), { recursive: true });
    writeFileSync(this.ruta, JSON.stringify([...this.porSucursal.values()], null, 2), "utf8");
  }

  /** El mapa que usa el enrutador. Solo lectura. */
  get mapa(): ReadonlyMap<string, Inquilino> {
    return this.porNumero;
  }

  de(sucursalId: string): Inquilino | undefined {
    return this.porSucursal.get(sucursalId);
  }

  /**
   * Da de alta o actualiza un restaurante.
   *
   * Se reindexa por número porque un local puede cambiar de número —o migrar de
   * la app de WhatsApp Business a la API— y quedarse con el índice viejo haría
   * que sus mensajes se enrutaran a la nada.
   */
  registrar(inquilino: Inquilino): void {
    const previo = this.porSucursal.get(inquilino.sucursal_id);
    if (previo && previo.phone_number_id !== inquilino.phone_number_id) {
      this.porNumero.delete(previo.phone_number_id);
    }
    this.indexar(inquilino);
    this.guardar();
  }

  /** El restaurante deja MotRest: se olvidan sus credenciales de inmediato. */
  darDeBaja(sucursalId: string): void {
    const previo = this.porSucursal.get(sucursalId);
    if (!previo) return;
    this.porNumero.delete(previo.phone_number_id);
    this.porSucursal.delete(sucursalId);
    this.enlaces.delete(sucursalId);
    this.guardar();
  }

  // --- Hubs conectados ------------------------------------------------------------

  conectar(enlace: EnlaceHub): void {
    this.enlaces.set(enlace.sucursal_id, enlace);
  }

  desconectar(sucursalId: string): void {
    this.enlaces.delete(sucursalId);
  }

  enlaceDe(sucursalId: string): EnlaceHub | undefined {
    return this.enlaces.get(sucursalId);
  }

  get conectados(): number {
    return this.enlaces.size;
  }

  get total(): number {
    return this.porSucursal.size;
  }
}
