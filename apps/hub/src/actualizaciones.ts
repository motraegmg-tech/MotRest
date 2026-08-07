/**
 * El Hub se entera de que hay versión nueva, la baja y la instala.
 *
 * El manifiesto se verifica antes de descargar. Después se comprueba el SHA-256
 * del archivo ya escrito a disco, y se vuelve a calcular justo antes de arrancar
 * el instalador. Las tres barreras cubren identidades distintas: quién publicó,
 * qué bytes llegaron y qué bytes se van a ejecutar.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  aceptarManifiesto,
  verificarVersion,
  type MemoriaDeCanal,
  type VersionDisponible,
} from "@motrest/dominio";

export interface OrigenActualizaciones {
  /** "motrae/motrest". De ahí sale la URL de la API. */
  repositorio: string;
  /** Llave pública con la que se verifica el manifiesto. */
  llaveDeFirma: string;
  /** Token de GitHub. Solo hace falta si el repositorio es privado. */
  token?: string;
}

/** El asset del release que lleva el manifiesto firmado. */
const MANIFIESTO = "motrest.json";

/** Cada cuánto se pregunta a GitHub. Doce horas: esto no es urgente. */
export const CADA_MS = 12 * 60 * 60 * 1000;

const REPOSITORIO_VALIDO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/*
 * Un manifiesto firmado NO es autorización para enviar el token de GitHub a
 * cualquier host. GitHub usa estos hosts al servir assets y redirigirlos; el
 * token, en cambio, solo se adjunta a sus dos endpoints de autenticación.
 */
const HOSTS_GITHUB = new Set([
  "api.github.com",
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);
const HOSTS_GITHUB_CON_TOKEN = new Set(["api.github.com", "github.com"]);

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

type Registrar = (nivel: "info" | "aviso" | "error", texto: string) => void;
type GuardarMemoria = (memoria: MemoriaDeCanal) => Promise<void> | void;

function urlGitHubSegura(texto: string): URL | null {
  try {
    const url = new URL(texto);
    if (url.protocol !== "https:" || !HOSTS_GITHUB.has(url.hostname.toLowerCase())) return null;
    return url;
  } catch {
    return null;
  }
}

function esRedireccion(estatus: number): boolean {
  return estatus === 301 || estatus === 302 || estatus === 303 || estatus === 307 || estatus === 308;
}

function esManifiesto(valor: unknown): valor is VersionDisponible {
  if (!valor || typeof valor !== "object") return false;
  const v = valor as Record<string, unknown>;
  return (
    typeof v.version === "string" &&
    typeof v.notas === "string" &&
    typeof v.url === "string" &&
    typeof v.sha256 === "string" &&
    typeof v.publicado_ts === "number" &&
    typeof v.firma === "string" &&
    (v.obligatoria === undefined || typeof v.obligatoria === "boolean") &&
    (v.version_minima_soportada === undefined || typeof v.version_minima_soportada === "string")
  );
}

function sha256DeArchivo(ruta: string): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const hash = createHash("sha256");
    const archivo = createReadStream(ruta);
    archivo.on("error", rechazar);
    archivo.on("data", (trozo) => hash.update(trozo));
    archivo.on("end", () => resolver(hash.digest("hex")));
  });
}

export class Actualizaciones {
  private readonly instaladores = new Map<string, string>();

  constructor(
    private readonly origen: OrigenActualizaciones,
    private readonly versionInstalada: string,
    private readonly registrar: Registrar,
    private readonly llamar: typeof fetch = fetch,
    private readonly memoria: MemoriaDeCanal = {},
    private readonly guardarMemoria: GuardarMemoria = () => undefined,
  ) {}

  private cabeceras(url: URL): Record<string, string> {
    return {
      accept: "application/vnd.github+json",
      "user-agent": "MotRest-Hub",
      ...(this.origen.token && HOSTS_GITHUB_CON_TOKEN.has(url.hostname.toLowerCase())
        ? { authorization: `Bearer ${this.origen.token}` }
        : {}),
    };
  }

  /**
   * Pide únicamente HTTPS de GitHub y sigue redirecciones una por una.
   *
   * `fetch` suele quitar Authorization al cruzar de host, pero esa conducta no
   * debe ser nuestra única defensa: cada salto se vuelve a validar y recibe
   * cabeceras recién calculadas. Así un `Location` malicioso nunca ve el token.
   */
  private async pedir(texto: string): Promise<Response> {
    const inicial = urlGitHubSegura(texto);
    if (!inicial) throw new Error("La URL no usa HTTPS en un host permitido de GitHub");
    let url: URL = inicial;

    for (let salto = 0; salto < 5; salto++) {
      const respuesta: Response = await this.llamar(url.toString(), {
        headers: this.cabeceras(url),
        redirect: "manual",
      });
      if (!esRedireccion(respuesta.status)) return respuesta;

      const destino: string | null = respuesta.headers.get("location");
      const siguiente: URL | null = destino
        ? urlGitHubSegura(new URL(destino, url).toString())
        : null;
      if (!siguiente) {
        throw new Error("GitHub redirigió la descarga fuera de HTTPS/GitHub");
      }
      url = siguiente;
    }

    throw new Error("GitHub redirigió demasiadas veces la descarga");
  }

  private async recordar(version: VersionDisponible, ahora: number): Promise<boolean> {
    const anterior = { ...this.memoria };
    this.memoria.ultimo_publicado_ts = Math.max(
      this.memoria.ultimo_publicado_ts ?? 0,
      version.publicado_ts,
    );
    this.memoria.ultima_consulta_ts = ahora;

    try {
      await this.guardarMemoria({ ...this.memoria });
      return true;
    } catch (causa) {
      Object.assign(this.memoria, anterior);
      this.registrar(
        "error",
        `No se pudo guardar la memoria anti-reversión del canal: ${String(causa)}`,
      );
      return false;
    }
  }

  /** ¿Hay algo nuevo publicado y firmado por MOTRAE? */
  async buscar(ahora = Date.now()): Promise<VersionDisponible | null> {
    if (!REPOSITORIO_VALIDO.test(this.origen.repositorio)) {
      this.registrar("error", "El repositorio de actualizaciones no tiene el formato dueño/repositorio");
      return null;
    }

    let release: ReleaseGitHub;
    try {
      const [dueno, repositorio] = this.origen.repositorio.split("/");
      const respuesta = await this.pedir(
        `https://api.github.com/repos/${encodeURIComponent(dueno!)}/${encodeURIComponent(repositorio!)}/releases/latest`,
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

    let manifiesto: unknown;
    try {
      const respuesta = await this.pedir(asset.browser_download_url);
      if (!respuesta.ok) return null;
      manifiesto = await respuesta.json();
    } catch (causa) {
      this.registrar("error", `No se pudo obtener un manifiesto seguro: ${String(causa)}`);
      return null;
    }

    if (!esManifiesto(manifiesto)) {
      this.registrar("error", "El release trae un manifiesto con formato inválido. Se ignora.");
      return null;
    }

    if (!(await verificarVersion(manifiesto, this.origen.llaveDeFirma))) {
      this.registrar(
        "error",
        `Se publicó MotRest ${manifiesto.version} con una firma que no es de MOTRAE. Se ignora.`,
      );
      return null;
    }

    const veredicto = aceptarManifiesto(manifiesto, this.memoria, this.versionInstalada, ahora);
    if (!veredicto.aceptar) {
      if (veredicto.razon !== "No es más nueva que la instalada") {
        this.registrar("aviso", `Se ignoró el manifiesto de MotRest: ${veredicto.razon}`);
      }
      return null;
    }

    if (!(await this.recordar(manifiesto, ahora))) return null;

    if (veredicto.instalada_por_debajo_del_minimo) {
      this.registrar(
        "aviso",
        `MotRest ${this.versionInstalada} quedó por debajo del mínimo soportado (${manifiesto.version_minima_soportada}).`,
      );
    }

    this.registrar("info", `Hay una versión nueva de MotRest: ${manifiesto.version}`);
    return manifiesto;
  }

  /**
   * Baja el instalador a un directorio único y comprueba el archivo desde disco.
   *
   * No se usa un nombre fijo en %TEMP%: otro proceso del mismo usuario podía
   * preparar ese directorio de antemano y cambiar el ejecutable entre la primera
   * comprobación y el `spawn` (CN-039).
   */
  async descargar(version: VersionDisponible): Promise<string> {
    const esperada = version.sha256.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(esperada)) {
      throw new Error("El manifiesto no trae una huella SHA-256 válida");
    }

    const carpeta = await mkdtemp(join(tmpdir(), "motrest-actualizacion-"));
    const destino = join(carpeta, "MotRest_setup.exe");

    try {
      const respuesta = await this.pedir(version.url);
      if (!respuesta.ok) {
        throw new Error(`No se pudo descargar el instalador (${respuesta.status})`);
      }

      await writeFile(destino, Buffer.from(await respuesta.arrayBuffer()), {
        flag: "wx",
        mode: 0o600,
      });

      const huella = await sha256DeArchivo(destino);
      if (huella.toLowerCase() !== esperada) {
        throw new Error("El instalador descargado no coincide con el que MOTRAE firmó. No se instala.");
      }

      this.instaladores.set(resolve(destino), esperada);
      this.registrar("info", `MotRest ${version.version} descargada y verificada`);
      return destino;
    } catch (causa) {
      await rm(carpeta, { recursive: true, force: true });
      throw causa;
    }
  }

  /**
   * Lanza el instalador después de volver a leerlo y calcular su SHA-256.
   *
   * La segunda lectura es deliberada: verificar el buffer recibido y ejecutar
   * una ruta después deja una ventana TOCTOU. Solo se ejecutan rutas que esta
   * instancia descargó a un directorio temporal único.
   */
  async instalar(rutaInstalador: string, version: Pick<VersionDisponible, "sha256" | "version">): Promise<void> {
    const ruta = resolve(rutaInstalador);
    const esperada = version.sha256.trim().toLowerCase();
    if (this.instaladores.get(ruta) !== esperada) {
      throw new Error("El instalador no fue descargado y verificado por este Hub");
    }

    const huella = await sha256DeArchivo(ruta);
    if (huella.toLowerCase() !== esperada) {
      this.instaladores.delete(ruta);
      await rm(dirname(ruta), { recursive: true, force: true });
      throw new Error("El instalador cambió después de verificarse. No se ejecuta.");
    }

    this.registrar("aviso", "Instalando la actualización de MotRest. El sistema se reiniciará.");
    const proceso = spawn(ruta, ["/S"], { detached: true, stdio: "ignore" });
    proceso.unref();
  }
}
