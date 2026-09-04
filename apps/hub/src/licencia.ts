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
  firmaDeMotrae,
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

/**
 * Quita la marca de orden de bytes con la que el Bloc de notas guarda en UTF-8.
 *
 * TRES BYTES INVISIBLES QUE DEJAN UN LOCAL SIN LICENCIA. Windows los antepone al
 * guardar, `JSON.parse` los rechaza, y el mensaje que sale —«no se pudo leer»—
 * apunta al archivo entero cuando lo que sobra es un carácter que nadie ve.
 *
 * Y pegar la licencia a mano con el Bloc de notas es un camino legítimo: es lo
 * que hace quien monta una caja con el archivo en una USB, o quien entra por SSH
 * a un restaurante. Pasó exactamente así la primera vez que se probó.
 *
 * Se limpia al leer y no al escribir, porque el archivo puede venir de fuera:
 * arreglarlo solo en nuestra escritura no ayudaría a quien lo pegó él mismo.
 */
export function sinBom(texto: string): string {
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

export class GestorLicencia {
  private licencia: Licencia | null = null;
  private verificada = false;

  constructor(
    private readonly ruta: string,
    /**
     * Qué local es este, PREGUNTADO cada vez y no copiado al construir.
     *
     * Puede cambiar debajo: un equipo recién instalado arranca con un
     * identificador provisional y lo sustituye por el de la licencia en cuanto
     * se activa. Con una copia, el gestor seguiría comparando contra el viejo.
     */
    private readonly sucursalActual: () => string,
    private readonly llaveDeVerificacion: string,
    private readonly registrar: (nivel: "info" | "aviso" | "error", texto: string) => void,
    /**
     * Fija la identidad del local con la que trae la licencia.
     *
     * Devuelve `false` si no procede —el local ya tiene identidad propia— y
     * entonces la licencia se trata como lo que es: de otro restaurante.
     */
    private readonly fijarIdentidad: (sucursalId: string) => boolean = () => false,
  ) {}

  /**
   * ¿Es una licencia auténtica que además puede dar identidad a este equipo?
   *
   * Es el alta de un restaurante nuevo: el equipo todavía no sabe cuál es, y el
   * documento firmado por MOTRAE se lo dice. Solo se llega aquí cuando la
   * comprobación normal ya falló por el identificador.
   */
  private async adoptarIdentidadDe(licencia: Licencia): Promise<boolean> {
    if (!(await firmaDeMotrae(licencia, this.llaveDeVerificacion))) return false;
    if (!this.fijarIdentidad(licencia.sucursal_id)) return false;

    this.registrar(
      "info",
      `Restaurante identificado por su licencia: ${licencia.nombre} (${licencia.sucursal_id}).`,
    );
    return true;
  }

  /** Lee y comprueba el archivo. Se llama al arrancar y al pegar una nueva. */
  async cargar(): Promise<VeredictoLicencia> {
    if (!existsSync(this.ruta)) {
      this.licencia = null;
      this.verificada = false;
      this.registrar(
        "aviso",
        "Sin licencia todavía. El sistema opera con normalidad; actívala desde MotRest Central.",
      );
      return this.veredicto();
    }

    try {
      this.licencia = JSON.parse(sinBom(await readFile(this.ruta, "utf8"))) as Licencia;
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
      this.sucursalActual(),
      this.llaveDeVerificacion,
    );

    /*
     * Copiar el archivo a mano es una forma legítima de dar de alta un local:
     * es lo que hace quien monta la caja con la licencia en una USB. Si el
     * equipo todavía no sabe qué restaurante es, el documento se lo dice.
     */
    if (!this.verificada) {
      this.verificada = await this.adoptarIdentidadDe(this.licencia);
    }

    if (!this.verificada) {
      this.registrar(
        "error",
        `La licencia no corresponde a este local (${this.sucursalActual()}) o fue alterada.`,
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

    const esDeEsteLocal = await verificarLicencia(
      licencia,
      this.sucursalActual(),
      this.llaveDeVerificacion,
    );

    // El alta de un restaurante nuevo: el equipo aún no sabe cuál es y la
    // licencia se lo dice. En un local que ya tiene identidad esto devuelve
    // `false` y la licencia ajena se rechaza como siempre.
    if (!esDeEsteLocal && !(await this.adoptarIdentidadDe(licencia))) {
      /*
       * No se escribe una licencia inválida NI SIQUIERA para "intentarlo
       * después". Sustituiría a la buena que ya estaba y dejaría al local peor
       * de lo que estaba antes de pegarla.
       */
      return {
        ok: false,
        error: `Esa licencia no es de este local. Este equipo es ${this.sucursalActual()}.`,
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
   * LAS CREDENCIALES DE SOPORTE Y DEL RESPONSABLE SOLO VAN A LA CAJA, nunca a
   * las tablets del salón.
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

    // `nube` sale junto a los otros dos: es la credencial con la que ESTE
    // restaurante se identifica ante MOTRAE, y una tablet del salón no tiene
    // ningún motivo para conocerla. Solo la caja habla con la nube.
    const {
      soporte: _soporte,
      responsable: _responsable,
      nube: _nube,
      ...resto
    } = this.licencia;
    return { licencia: resto as Licencia, verificada: this.verificada };
  }

  get credencialSoporte() {
    return this.verificada ? (this.licencia?.soporte ?? null) : null;
  }

  /**
   * Por dónde reportar el pulso, si la licencia lo trae.
   *
   * Solo de una licencia VERIFICADA: sin eso, cualquiera que dejara un archivo
   * en la carpeta podría apuntar el latido del restaurante a un servidor suyo.
   */
  get enlaceNube() {
    return this.verificada ? (this.licencia?.nube ?? null) : null;
  }
}
