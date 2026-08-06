/**
 * El Hub se entera de que hay versión nueva, la baja y la instala.
 *
 * DE DÓNDE. De los **Releases** de un repositorio de GitHub. Gratis, por HTTPS,
 * con la disponibilidad de GitHub detrás y sin un servidor que mantener. Cada
 * release lleva dos cosas: el instalador y un `motrest.json` con el manifiesto
 * firmado por MOTRAE.
 *
 * LAS TRES COMPROBACIONES, EN ESTE ORDEN Y POR ESTA RAZÓN:
 *
 *   1. **La firma del manifiesto**, antes de descargar un solo byte del
 *      instalador. Si alguien tomara la cuenta de GitHub y publicara un
 *      ejecutable propio, aquí se acaba: sin el secreto de MOTRAE no hay firma
 *      válida, y el Hub ni siquiera llega a pedir el archivo.
 *
 *   2. **La huella del archivo descargado** contra la que dice el manifiesto ya
 *      verificado. Cubre lo que la firma no puede: que la descarga se corte a
 *      medias o que el archivo del release no sea el que se firmó.
 *
 *   3. **El momento**, que lo decide el dominio. Nunca con la caja abierta.
 *
 * SI NO HAY INTERNET NO PASA NADA. Fallar al consultar es normal en un
 * restaurante y no se registra como error: se vuelve a intentar a la siguiente.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hayNovedad,
  verificarVersion,
  type VersionDisponible,
} from "@motrest/dominio";

export interface OrigenActualizaciones {
  /** "motrae/motrest". De ahí sale la URL de la API. */
  repositorio: string;
  /** Llave con la que se verifica el manifiesto. */
  llaveDeFirma: string;
  /** Token de GitHub. Solo hace falta si el repositorio es privado. */
  token?: string;
}

/** El asset del release que lleva el manifiesto firmado. */
const MANIFIESTO = "motrest.json";

/** Cada cuánto se pregunta a GitHub. Doce horas: esto no es urgente. */
export const CADA_MS = 12 * 60 * 60 * 1000;

interface AssetGitHub {
  name: string;
  browser_download_url: string;
}

interface ReleaseGitHub {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: AssetGitHub[];
}

export class Actualizaciones {
  constructor(
    private readonly origen: OrigenActualizaciones,
    private readonly versionInstalada: string,
    private readonly registrar: (nivel: "info" | "aviso" | "error", texto: string) => void,
    private readonly llamar: typeof fetch = fetch,
  ) {}

  private get cabeceras(): Record<string, string> {
    return {
      accept: "application/vnd.github+json",
      "user-agent": "MotRest-Hub",
      ...(this.origen.token ? { authorization: `Bearer ${this.origen.token}` } : {}),
    };
  }

  /**
   * ¿Hay algo nuevo publicado y firmado por MOTRAE?
   *
   * Devuelve `null` tanto si está al día como si no se pudo preguntar. Son casos
   * distintos pero la respuesta del Hub es la misma —seguir trabajando— y
   * distinguirlos aquí solo complicaría a quien llama.
   */
  async buscar(): Promise<VersionDisponible | null> {
    let release: ReleaseGitHub;
    try {
      const respuesta = await this.llamar(
        `https://api.github.com/repos/${this.origen.repositorio}/releases/latest`,
        { headers: this.cabeceras },
      );
      if (!respuesta.ok) {
        // 404 en un repositorio sin releases todavía es lo normal al principio.
        if (respuesta.status !== 404) {
          this.registrar("aviso", `GitHub respondió ${respuesta.status} al buscar versiones`);
        }
        return null;
      }
      release = (await respuesta.json()) as ReleaseGitHub;
    } catch {
      // Sin internet. Ni un renglón en la bitácora: en un restaurante es normal.
      return null;
    }

    if (release.draft || release.prerelease) return null;

    const asset = release.assets?.find((a) => a.name === MANIFIESTO);
    if (!asset) {
      this.registrar("aviso", `El release no trae ${MANIFIESTO}: no se puede verificar`);
      return null;
    }

    let manifiesto: VersionDisponible;
    try {
      const respuesta = await this.llamar(asset.browser_download_url, { headers: this.cabeceras });
      if (!respuesta.ok) return null;
      manifiesto = (await respuesta.json()) as VersionDisponible;
    } catch {
      return null;
    }

    /*
     * LA COMPROBACIÓN QUE MANDA, y va antes de mirar siquiera si es más nueva.
     * Un manifiesto sin firma de MOTRAE no existe para este Hub, da igual lo que
     * prometa.
     */
    if (!(await verificarVersion(manifiesto, this.origen.llaveDeFirma))) {
      this.registrar(
        "error",
        `Se publicó MotRest ${manifiesto.version} con una firma que no es de MOTRAE. Se ignora.`,
      );
      return null;
    }

    if (!hayNovedad(this.versionInstalada, manifiesto.version)) return null;

    this.registrar("info", `Hay una versión nueva de MotRest: ${manifiesto.version}`);
    return manifiesto;
  }

  /**
   * Baja el instalador y comprueba su huella. Devuelve la ruta del archivo.
   *
   * La huella no es paranoia: una descarga cortada a la mitad produce un
   * ejecutable que arranca y falla a medio instalar, y eso deja la instalación
   * peor que si no se hubiera intentado nada.
   */
  async descargar(version: VersionDisponible): Promise<string> {
    const carpeta = join(tmpdir(), "motrest-actualizacion");
    await mkdir(carpeta, { recursive: true });
    const destino = join(carpeta, `MotRest_${version.version}_setup.exe`);

    const respuesta = await this.llamar(version.url, { headers: this.cabeceras });
    if (!respuesta.ok) {
      throw new Error(`No se pudo descargar el instalador (${respuesta.status})`);
    }

    const bytes = Buffer.from(await respuesta.arrayBuffer());
    const huella = createHash("sha256").update(bytes).digest("hex");

    if (huella.toLowerCase() !== version.sha256.toLowerCase()) {
      await rm(carpeta, { recursive: true, force: true });
      throw new Error(
        "El instalador descargado no coincide con el que MOTRAE firmó. No se instala.",
      );
    }

    await writeFile(destino, bytes);
    this.registrar("info", `MotRest ${version.version} descargada y verificada`);
    return destino;
  }

  /**
   * Lanza el instalador y se aparta.
   *
   * `detached` y sin esperar a que termine, a propósito: el instalador va a
   * cerrar este mismo proceso para reemplazar sus archivos. Si el Hub se quedara
   * esperándolo, se estaría esperando a sí mismo.
   *
   * `/S` es el modo silencioso de NSIS, que es lo que genera Tauri. Sin él, la
   * instalación se queda parada en una ventana que nadie va a ver: la caja de un
   * restaurante de madrugada no tiene a nadie delante.
   */
  async instalar(rutaInstalador: string): Promise<void> {
    this.registrar("aviso", "Instalando la actualización de MotRest. El sistema se reiniciará.");
    const proceso = spawn(rutaInstalador, ["/S"], { detached: true, stdio: "ignore" });
    proceso.unref();
  }
}
