/**
 * El sellador del local: guarda el CSD y firma los comprobantes.
 *
 * Es la única pieza del sistema que puede emitir una factura a nombre del
 * restaurante, así que concentra dos responsabilidades a propósito: dónde vive
 * el CSD y quién lo usa. Repartirlas sería multiplicar los lugares desde donde
 * se puede firmar.
 *
 * DÓNDE SE GUARDA Y QUÉ PROTEGE ESO
 *
 * En la carpeta de datos del local, restringida con ACL de NTFS a SYSTEM, a los
 * administradores y al usuario que corre el Hub (`soloElDueno`). Conviene decir
 * con claridad qué significa y qué no:
 *
 *   - Protege de otro usuario del mismo equipo y de una copia descuidada de la
 *     carpeta del programa.
 *   - NO protege de quien tenga acceso de administrador a la caja, ni de quien
 *     se lleve el disco. La contraseña de la llave vive al lado, porque el Hub
 *     tiene que poder sellar sin que nadie la teclee cuando el restaurante
 *     reinicia el equipo un sábado a las nueve de la noche.
 *
 * **Esto antes no era verdad, y estaba escrito como si lo fuera.** Decía «con
 * permisos de solo-el-dueño (0600)», y en Windows —la única plataforma donde
 * MotRest se instala— `fs.chmod` no toca las ACL: solo pone el atributo de solo
 * lectura. Los permisos efectivos seguían siendo los heredados de la carpeta
 * padre. El `mode: 0o600` se queda porque no estorba y sirve fuera de Windows,
 * pero la protección real la pone `permisos.ts`.
 *
 * Cifrarla con otra llave guardada en el mismo disco sería ofuscación disfrazada
 * de seguridad. Contra el disco robado lo que protege es BitLocker, y por eso
 * está en la guía de instalación.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KeyObject } from "node:crypto";
import { cadenaOriginal, type Comprobante } from "@motrest/dominio";
import { soloElDueno } from "../permisos.js";
import {
  abrirLlave,
  leerCertificado,
  problemaDelCsd,
  sellar,
  sonPareja,
  type Csd,
} from "./csd.js";

const ARCHIVO_CER = "csd.cer";
const ARCHIVO_KEY = "csd.key";
const ARCHIVO_CLAVE = "csd.pass";
/** Solo el dueño del proceso puede leerlo. */
const SOLO_DUENO = 0o600;

/** Lo que el comprobante gana al sellarse. */
export interface Sellado {
  no_certificado: string;
  certificado: string;
  sello: string;
  cadena: string;
}

export interface EstadoCsd {
  cargado: boolean;
  rfc: string | null;
  no_certificado: string | null;
  valido_hasta: string | null;
  dias_restantes: number | null;
}

export class Sellador {
  private csd: Csd | null = null;
  private llave: KeyObject | null = null;

  /** Qué pasó al restringir la carpeta. Lo consulta `main.ts` para registrarlo. */
  readonly permisos: { ok: boolean; detalle: string };

  constructor(private carpeta: string) {
    mkdirSync(carpeta, { recursive: true });
    // Antes de leer o escribir nada: si la carpeta acaba de nacer, se cierra
    // ahora; si ya existía de una versión anterior, se corrige ahora.
    this.permisos = soloElDueno(carpeta);
    this.cargarDelDisco();
  }

  /**
   * Recupera el CSD guardado, si lo hay.
   *
   * Un CSD ilegible no puede tumbar el arranque del Hub: sin caja no hay
   * servicio, y no facturar es un problema mucho menor que no vender. Se
   * registra y se sigue sin sellador.
   */
  private cargarDelDisco(): void {
    const cer = join(this.carpeta, ARCHIVO_CER);
    const key = join(this.carpeta, ARCHIVO_KEY);
    const pass = join(this.carpeta, ARCHIVO_CLAVE);
    if (!existsSync(cer) || !existsSync(key) || !existsSync(pass)) return;

    try {
      this.csd = leerCertificado(readFileSync(cer));
      this.llave = abrirLlave(readFileSync(key), readFileSync(pass, "utf8"));
    } catch {
      this.csd = null;
      this.llave = null;
    }
  }

  /**
   * Instala un CSD nuevo.
   *
   * Todas las comprobaciones ocurren ANTES de escribir nada. Guardar un CSD que
   * no sirve y descubrirlo con el comensal esperando su factura es el peor
   * momento posible para enterarse; aquí el error llega mientras alguien está
   * configurando, que es cuando hay tiempo de arreglarlo.
   */
  instalar(
    cer: Uint8Array,
    key: Uint8Array,
    contrasena: string,
    rfcEmisor: string,
  ): { ok: true } | { ok: false; problema: string } {
    let csd: Csd;
    let llave: KeyObject;

    try {
      csd = leerCertificado(cer);
      llave = abrirLlave(key, contrasena);
    } catch (error) {
      return { ok: false, problema: error instanceof Error ? error.message : String(error) };
    }

    if (!sonPareja(csd, llave)) {
      return {
        ok: false,
        problema:
          "El certificado y la llave no son pareja: son de dos CSD distintos. Revisa que ambos archivos salgan del mismo trámite.",
      };
    }

    const problema = problemaDelCsd(csd, rfcEmisor);
    if (problema) return { ok: false, problema };

    writeFileSync(join(this.carpeta, ARCHIVO_CER), Buffer.from(cer), { mode: SOLO_DUENO });
    writeFileSync(join(this.carpeta, ARCHIVO_KEY), Buffer.from(key), { mode: SOLO_DUENO });
    writeFileSync(join(this.carpeta, ARCHIVO_CLAVE), contrasena, { mode: SOLO_DUENO });

    this.csd = csd;
    this.llave = llave;
    return { ok: true };
  }

  /** Quita el CSD del local. Se usa al renovarlo o al dar de baja el equipo. */
  desinstalar(): void {
    for (const archivo of [ARCHIVO_CER, ARCHIVO_KEY, ARCHIVO_CLAVE]) {
      rmSync(join(this.carpeta, archivo), { force: true });
    }
    this.csd = null;
    this.llave = null;
  }

  /** Lo que se puede contar de un CSD sin exponerlo. Nunca incluye la llave. */
  estado(ahora: Date = new Date()): EstadoCsd {
    if (!this.csd) {
      return {
        cargado: false,
        rfc: null,
        no_certificado: null,
        valido_hasta: null,
        dias_restantes: null,
      };
    }
    const DIA = 86_400_000;
    return {
      cargado: true,
      rfc: this.csd.rfc,
      no_certificado: this.csd.no_certificado,
      valido_hasta: this.csd.valido_hasta.toISOString(),
      dias_restantes: Math.floor((this.csd.valido_hasta.getTime() - ahora.getTime()) / DIA),
    };
  }

  get listo(): boolean {
    return this.csd !== null && this.llave !== null;
  }

  /**
   * Sella un comprobante.
   *
   * El orden importa: primero se pone el número de certificado, y DESPUÉS se
   * arma la cadena. `NoCertificado` forma parte de la cadena original, así que
   * armarla antes daría una cadena a la que le falta un campo — y un sello que
   * el PAC rechazaría sin explicar por qué.
   */
  sellarComprobante(comprobante: Comprobante): Sellado {
    if (!this.csd || !this.llave) {
      throw new Error(
        "No hay un CSD cargado en esta caja. Súbelo en Administración antes de facturar.",
      );
    }

    const conCertificado: Comprobante = {
      ...comprobante,
      no_certificado: this.csd.no_certificado,
    };
    const cadena = cadenaOriginal(conCertificado);

    return {
      no_certificado: this.csd.no_certificado,
      certificado: this.csd.certificado_base64,
      sello: sellar(cadena, this.llave),
      cadena,
    };
  }
}

/** Dónde guarda el local su CSD, junto al resto de sus datos. */
export function carpetaDelCsd(rutaBase: string): string {
  return join(rutaBase, "csd");
}
