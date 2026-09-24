/**
 * «Entra a tu restaurante» (MotRest en la web, 1.6.0).
 *
 * En la web no hay Hub que sirva la página ni QR que la empareje. Lo que dice a
 * qué restaurante pertenece este navegador es esto: la clave del restaurante y
 * su contraseña, que se cambian en la Edge Function `entrar-restaurante` por un
 * pase de Supabase y la clave remota ENVUELTA. La contraseña la abre aquí, en el
 * navegador; ni la nube ni nadie más la tiene en claro.
 *
 * DESPUÉS DE ENTRAR SE RECARGA LA PÁGINA, a propósito. La identidad del local
 * (`SUCURSAL_ID`) se decide al cargar el programa, y todo el arranque —plano,
 * menú, personal, sincronización— cuelga de ella. Rehacerlo en caliente sería
 * repetir el arranque entero a mano; recargar lo hace con el mismo código
 * probado de siempre, ya con el restaurante correcto.
 *
 * UN NAVEGADOR, UN RESTAURANTE. Entrar a otro, o salir, borra lo que este
 * dispositivo guardaba del anterior: en una tableta compartida, las ventas de un
 * restaurante no pueden quedarse en el disco a la vista del siguiente.
 */
import { desenvolverClaveRemota, type ModalidadWeb } from "@motrest/dominio";
import type { SocketLike } from "@motrest/protocolo-sync";

const LLAVE_RESTAURANTE = "motrest.web.restaurante";
const LLAVE_SUCURSAL = "motrest.sucursal_id";
const BASE_DE_DATOS = "motrest";

export interface RestauranteWeb {
  sucursal_id: string;
  clave: string;
  nombre: string;
  modalidad: ModalidadWeb;
  version: number;
}

interface Guardado extends RestauranteWeb {
  clave_remota: string;
}

export type EstadoAccesoWeb = "revisando" | "fuera" | "entrando" | "dentro";

function leerGuardado(): Guardado | null {
  try {
    const crudo = localStorage.getItem(LLAVE_RESTAURANTE);
    if (!crudo) return null;
    const g = JSON.parse(crudo) as Partial<Guardado>;
    if (
      typeof g.sucursal_id === "string" &&
      typeof g.clave === "string" &&
      typeof g.clave_remota === "string" &&
      (g.modalidad === "ambas" || g.modalidad === "nube")
    ) {
      return {
        sucursal_id: g.sucursal_id,
        clave: g.clave,
        nombre: typeof g.nombre === "string" ? g.nombre : g.clave,
        modalidad: g.modalidad,
        version: typeof g.version === "number" ? g.version : 1,
        clave_remota: g.clave_remota,
      };
    }
  } catch {
    /* sin almacenamiento: no hay nada guardado */
  }
  return null;
}

/** Borra la base local del POS. Se espera: recargar antes dejaría la vieja abierta. */
function borrarBaseLocal(): Promise<void> {
  return new Promise((resolver) => {
    try {
      const peticion = indexedDB.deleteDatabase(BASE_DE_DATOS);
      peticion.onsuccess = () => resolver();
      peticion.onerror = () => resolver();
      peticion.onblocked = () => resolver();
    } catch {
      resolver();
    }
  });
}

class StoreAccesoWeb {
  estado = $state<EstadoAccesoWeb>("revisando");
  error = $state("");
  restaurante = $state<RestauranteWeb | null>(null);
  /** Por qué no hay enlace con el restaurante ahora mismo, si no lo hay. */
  motivoDesconexion = $state("");
  /** La última clave con que se entró, para no tener que volver a teclearla. */
  ultimaClave = $state("");

  private claveRemota = "";

  /**
   * Al abrir: ¿este navegador ya pertenece a un restaurante con pase vigente?
   * Devuelve true si puede arrancar la operación.
   */
  async restaurar(): Promise<boolean> {
    const guardado = leerGuardado();
    this.ultimaClave = guardado?.clave ?? "";
    if (!guardado) {
      this.estado = "fuera";
      return false;
    }
    try {
      const { nube } = await import("./nube");
      const { data } = await nube().auth.getSession();
      if (!data.session) {
        this.estado = "fuera";
        this.error = "Tu sesión terminó (la contraseña pudo haber cambiado). Vuelve a entrar.";
        return false;
      }
    } catch (causa) {
      /*
       * Sin red al abrir no se echa a nadie: los datos del local están en este
       * dispositivo y el POS opera en isla. El pase se revisa al reconectar.
       */
      console.warn("No se pudo revisar la sesión web; se sigue con lo guardado", causa);
    }
    const { clave_remota, ...publico } = guardado;
    this.claveRemota = clave_remota;
    this.restaurante = publico;
    this.estado = "dentro";
    return true;
  }

  async entrar(clave: string, contrasena: string): Promise<void> {
    if (this.estado === "entrando") return;
    this.error = "";
    this.estado = "entrando";
    try {
      const { nube, direccionNube, llavePublicable } = await import("./nube");
      const respuesta = await fetch(`${direccionNube()}/functions/v1/entrar-restaurante`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: llavePublicable() },
        body: JSON.stringify({ clave, contrasena }),
      });
      const cuerpo = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>;
      if (!respuesta.ok) {
        this.error = typeof cuerpo.error === "string" ? cuerpo.error : "No se pudo entrar. Inténtalo de nuevo.";
        this.estado = "fuera";
        return;
      }

      const claveRemota = await desenvolverClaveRemota(cuerpo.envoltura, contrasena);
      const sesion = cuerpo.sesion as { access_token?: string; refresh_token?: string } | undefined;
      const modalidad = cuerpo.modalidad;
      if (
        !claveRemota ||
        !sesion?.access_token ||
        !sesion.refresh_token ||
        typeof cuerpo.sucursal_id !== "string" ||
        (modalidad !== "ambas" && modalidad !== "nube")
      ) {
        /*
         * La nube aceptó la contraseña pero la envoltura no abre con ella: se
         * cambió a medias. No es culpa de quien teclea y no se arregla
         * reintentando; lo arregla MOTRAE generando otra.
         */
        this.error = "Tu contraseña es correcta, pero el acceso de tu restaurante quedó a medio actualizar. Llama a MOTRAE.";
        this.estado = "fuera";
        return;
      }

      const { error } = await nube().auth.setSession({
        access_token: sesion.access_token,
        refresh_token: sesion.refresh_token,
      });
      if (error) {
        this.error = "No se pudo abrir la sesión en este navegador. Inténtalo de nuevo.";
        this.estado = "fuera";
        return;
      }

      const anterior = leerGuardado();
      if (anterior && anterior.sucursal_id !== cuerpo.sucursal_id) await borrarBaseLocal();

      const guardado: Guardado = {
        sucursal_id: cuerpo.sucursal_id,
        clave: typeof cuerpo.clave === "string" ? cuerpo.clave : clave,
        nombre: typeof cuerpo.nombre === "string" ? cuerpo.nombre : clave,
        modalidad,
        version: typeof cuerpo.version === "number" ? cuerpo.version : 1,
        clave_remota: claveRemota,
      };
      localStorage.setItem(LLAVE_RESTAURANTE, JSON.stringify(guardado));
      localStorage.setItem(LLAVE_SUCURSAL, guardado.sucursal_id);
      location.reload();
    } catch (causa) {
      console.error("Fallo al entrar al restaurante", causa);
      this.error = "No hay conexión con la nube de MotRest. Revisa tu internet e inténtalo de nuevo.";
      this.estado = "fuera";
    }
  }

  /** Sale del restaurante y borra de este dispositivo todo lo suyo. */
  async salir(): Promise<void> {
    try {
      const { nube } = await import("./nube");
      await nube().auth.signOut();
    } catch {
      /* sin red se sale igual: lo importante es lo que queda en el dispositivo */
    }
    try {
      localStorage.removeItem(LLAVE_RESTAURANTE);
      localStorage.removeItem(LLAVE_SUCURSAL);
    } catch {
      /* nada que borrar */
    }
    await borrarBaseLocal();
    location.reload();
  }

  /**
   * A dónde se conecta la sincronización y con qué socket. `null` fuera.
   *
   * La `url` no se usa para abrir nada —el socket ya sabe a dónde va—, pero
   * es lo que la pantalla del Hub enseña: que diga de dónde vienen los datos.
   */
  destino(): { url: string; clave: string; crearSocket: () => SocketLike } | null {
    const r = this.restaurante;
    if (!r || !this.claveRemota) return null;
    const avisar = (motivo: string) => (this.motivoDesconexion = motivo);
    const claveRemota = this.claveRemota;
    return {
      url: r.modalidad === "nube" ? `nube://${r.clave}` : `tunel://${r.clave}`,
      clave: claveRemota,
      crearSocket: () => {
        this.motivoDesconexion = "";
        return crearSocketWeb(r, claveRemota, avisar);
      },
    };
  }

  /**
   * El propietario cambia la contraseña web desde la web (1.6.0).
   *
   * Se hace aquí porque aquí está la clave remota: se envuelve con la nueva
   * contraseña, y la nueva se sella para el buzón de Central —cuya pública viaja
   * firmada en la licencia— para que Gonzalo la siga viendo. La nube guarda las
   * dos cosas y no puede abrir ninguna. Pide la contraseña ACTUAL: una tableta
   * olvidada con la sesión abierta no basta para dejar fuera al dueño.
   *
   * Al terminar se vuelve a entrar con la nueva: la nube cerró todas las
   * sesiones, incluida esta.
   */
  async cambiarContrasena(
    actual: string,
    nueva: string,
    buzonCentral: string | undefined,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const r = this.restaurante;
    if (!r || !this.claveRemota) return { ok: false, error: "Esta página no ha entrado a ningún restaurante." };
    const { cerrarSobre, contrasenaWebAceptable, envolverClaveRemota } = await import("@motrest/dominio");
    const aceptable = contrasenaWebAceptable(nueva);
    if (!aceptable.ok) return aceptable;
    if (!buzonCentral) {
      return { ok: false, error: "La licencia de tu restaurante no permite cambiarla desde aquí. Pídesela a MOTRAE." };
    }
    try {
      const { nube, direccionNube, llavePublicable } = await import("./nube");
      const { data } = await nube().auth.getSession();
      const pase = data.session?.access_token;
      if (!pase) return { ok: false, error: "Tu sesión terminó. Sal y vuelve a entrar." };

      const respuesta = await fetch(`${direccionNube()}/functions/v1/cambiar-contrasena-web`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: llavePublicable(),
          authorization: `Bearer ${pase}`,
        },
        body: JSON.stringify({
          contrasena: nueva,
          contrasena_actual: actual,
          envoltura: await envolverClaveRemota(this.claveRemota, nueva),
          sobre_para_central: await cerrarSobre(buzonCentral, nueva),
        }),
      });
      const cuerpo = (await respuesta.json().catch(() => ({}))) as { error?: string };
      if (!respuesta.ok) return { ok: false, error: cuerpo.error ?? "No se pudo cambiar la contraseña." };
    } catch {
      return { ok: false, error: "No hay conexión con la nube de MotRest. Inténtalo de nuevo." };
    }
    await this.entrar(r.clave, nueva);
    return { ok: true };
  }

  /**
   * La licencia completa de un restaurante en nube, verificada aquí mismo.
   *
   * En la red del salón la da la caja por `/licencia`. En nube no hay caja: se
   * lee de la nube y se comprueba la firma con la pública de MOTRAE que va en
   * esta compilación. Una nube comprometida no puede fabricar una licencia.
   */
  async licenciaDeLaNube(): Promise<{ licencia: import("@motrest/dominio").Licencia | null; verificada: boolean } | null> {
    const r = this.restaurante;
    if (!r || r.modalidad !== "nube") return null;
    try {
      const [{ nube }, { AlmacenSupabase }, { verificarLicencia }] = await Promise.all([
        import("./nube"),
        import("./nube/almacen-supabase"),
        import("@motrest/dominio"),
      ]);
      const cruda = await new AlmacenSupabase(nube(), r.sucursal_id).licencia();
      if (!cruda || typeof cruda !== "object") return { licencia: null, verificada: false };
      const licencia = cruda as import("@motrest/dominio").Licencia;
      const llave = (import.meta.env.VITE_MOTREST_LICENCIA_PUBLICA ?? "").trim();
      const verificada = llave ? await verificarLicencia(licencia, r.sucursal_id, llave) : false;
      return { licencia, verificada };
    } catch {
      return null;
    }
  }
}

/**
 * El socket según la modalidad. Se carga diferido para que el código de la nube
 * no viaje en el arranque; mientras llega, un socket que espera y reenvía.
 */
function crearSocketWeb(r: RestauranteWeb, claveRemota: string, avisar: (motivo: string) => void): SocketLike {
  const diferido = new SocketDiferido();
  void (async () => {
    const { nube } = await import("./nube");
    if (r.modalidad === "ambas") {
      const { SocketTunel } = await import("./socket-tunel");
      diferido.conectar(new SocketTunel(nube(), r.sucursal_id, avisar));
    } else {
      const { SocketNube } = await import("./nube/socket-nube");
      diferido.conectar(new SocketNube(nube(), r.sucursal_id, claveRemota, avisar));
    }
  })().catch((causa) => {
    avisar(`No se pudo abrir la conexión: ${String(causa)}`);
    diferido.fallar();
  });
  return diferido;
}

/** Un `SocketLike` que delega en otro que todavía se está cargando. */
class SocketDiferido implements SocketLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((evento: { data: unknown }) => void) | null = null;
  private real: SocketLike | null = null;
  private cerrado = false;

  conectar(real: SocketLike): void {
    if (this.cerrado) return real.close();
    this.real = real;
    real.onopen = () => this.onopen?.();
    real.onclose = () => this.onclose?.();
    real.onerror = () => this.onerror?.();
    real.onmessage = (e) => this.onmessage?.(e);
  }

  fallar(): void {
    this.onerror?.();
    this.onclose?.();
  }

  send(datos: string): void {
    this.real?.send(datos);
  }

  close(): void {
    this.cerrado = true;
    this.real?.close();
  }
}

export const accesoWeb = new StoreAccesoWeb();
