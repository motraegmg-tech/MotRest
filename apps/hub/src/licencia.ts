/**
 * La licencia, en el Hub. Aquí es donde se decide de verdad.
 *
 * POR QUÉ AQUÍ Y NO EN LAS TERMINALES. Porque la llave pública de verificación
 * vive aquí, incrustada en el Hub. Si cada tablet comprobara la firma por su
 * cuenta, tendría que llevar la identidad de MOTRAE en el navegador. El Hub
 * verifica y manda su veredicto; las pantallas lo pintan y no lo discuten.
 *
 * SIN INTERNET, SIN PROBLEMA. La licencia es un archivo firmado que se lee del
 * disco. No hay llamada a ningún servidor al arrancar: si MOTRAE se cae, los
 * restaurantes que están al corriente abren igual. Depender de nuestra
 * disponibilidad para que ellos vendan sería cambiar un riesgo suyo por uno
 * nuestro, y el suyo cuesta un servicio entero.
 *
 * QUÉ PASA SI NO HAY ARCHIVO. Se opera con normalidad y se avisa. Un local
 * recién instalado todavía no tiene licencia, y arrancar bloqueado el día de la
 * instalación —justo cuando MOTRAE está ahí montándolo— no tiene ningún sentido.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  situacionDe,
  verificarLicencia,
  type Licencia,
  type SituacionLicencia,
} from "@motrest/dominio";

export interface VeredictoLicencia {
  licencia: Licencia | null;
  /** Lo calculó ESTE proceso, comprobando la firma. */
  verificada: boolean;
  situacion: SituacionLicencia;
}

export class GestorLicencia {
  private licencia: Licencia | null = null;
  private verificada = false;

  constructor(
    private readonly ruta: string,
    private readonly sucursal_id: string,
    private readonly llaveDeVerificacion: string,
    private readonly registrar: (nivel: "info" | "aviso" | "error", texto: string) => void,
  ) {}

  /** Lee y comprueba el archivo. Se llama al arrancar y al pegar una nueva. */
  async cargar(): Promise<VeredictoLicencia> {
    if (!existsSync(this.ruta)) {
      this.licencia = null;
      this.verificada = false;
      this.registrar(
        "aviso",
        "Sin licencia todavía. El sistema opera con normalidad; actívala desde MOTRAE Central.",
      );
      return this.veredicto();
    }

    try {
      this.licencia = JSON.parse(await readFile(this.ruta, "utf8")) as Licencia;
    } catch (causa) {
      this.licencia = null;
      this.verificada = false;
      this.registrar("error", `El archivo de licencia no se pudo leer: ${String(causa)}`);
      return this.veredicto();
    }

    /*
     * SIN LLAVE NO SE VERIFICA NADA, y eso significa "inválida", no "válida".
     * Al revés, bastaría con borrar una variable de entorno para desactivar toda
     * la comprobación.
     */
    if (!this.llaveDeVerificacion) {
      this.verificada = false;
      this.registrar(
        "error",
        "Falta la llave pública Ed25519 compilada: no se puede comprobar la licencia.",
      );
      return this.veredicto();
    }

    this.verificada = await verificarLicencia(
      this.licencia,
      this.sucursal_id,
      this.llaveDeVerificacion,
    );

    if (!this.verificada) {
      this.registrar(
        "error",
        `La licencia no corresponde a este local (${this.sucursal_id}) o fue alterada.`,
      );
    } else {
      const s = this.veredicto().situacion;
      this.registrar(
        s.estado === "activa" ? "info" : "aviso",
        s.estado === "activa"
          ? `Licencia de ${this.licencia.nombre} en orden: ${s.dias} días.`
          : s.mensaje,
      );
    }

    return this.veredicto();
  }

  /** Guarda una licencia nueva y la comprueba. Si no vale, no la escribe. */
  async instalar(licencia: Licencia): Promise<{ ok: boolean; error?: string }> {
    if (!this.llaveDeVerificacion) {
      return { ok: false, error: "Falta la llave pública de verificación en el Hub" };
    }

    if (!(await verificarLicencia(licencia, this.sucursal_id, this.llaveDeVerificacion))) {
      /*
       * No se escribe una licencia inválida NI SIQUIERA para "intentarlo
       * después". Sustituiría a la buena que ya estaba y dejaría al local peor
       * de lo que estaba antes de pegarla.
       */
      return {
        ok: false,
        error: `Esa licencia no es de este local. Este equipo es ${this.sucursal_id}.`,
      };
    }

    await writeFile(this.ruta, JSON.stringify(licencia, null, 2), "utf8");
    this.licencia = licencia;
    this.verificada = true;
    this.registrar("info", `Licencia actualizada. Vence el ${new Date(licencia.vence_ts).toLocaleDateString("es-MX")}.`);
    return { ok: true };
  }

  veredicto(ahora = Date.now()): VeredictoLicencia {
    return {
      licencia: this.licencia,
      verificada: this.verificada,
      situacion: situacionDe(this.licencia, this.verificada, ahora),
    };
  }

  /**
   * Lo que se le manda a una terminal.
   *
   * LA CREDENCIAL DE SOPORTE SOLO VA A LA CAJA, nunca a las tablets del salón.
   *
   * No es desconfianza del personal: es que ese hash no le sirve de nada a una
   * tablet y sí es material para intentar adivinar con calma la contraseña que
   * abre TODOS los restaurantes. La caja es la misma máquina donde corre el Hub
   * y donde MOTRAE se conecta a resolver un problema — que es el único sitio
   * donde ese acceso hace falta.
   *
   * La distinción `esLocal` es la misma que ya usa `/salud` para no publicar por
   * la wifi del local detalles que solo importan en la caja.
   */
  paraTerminales(esLocal: boolean): { licencia: Licencia | null; verificada: boolean } {
    if (!this.licencia) return { licencia: null, verificada: this.verificada };
    if (esLocal) return { licencia: this.licencia, verificada: this.verificada };

    const { soporte: _soporte, ...resto } = this.licencia;
    return { licencia: resto as Licencia, verificada: this.verificada };
  }

  get credencialSoporte() {
    return this.verificada ? (this.licencia?.soporte ?? null) : null;
  }
}
