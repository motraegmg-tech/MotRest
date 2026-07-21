/**
 * Orquestador de acciones sensibles: una sola puerta para todo el sistema.
 *
 *   const permitido = await autorizacion.solicitar("pos.item.cancelar_enviado", ctx);
 *   if (permitido.ok) { ...emitir el evento con permitido.autorizador_id... }
 *
 * Resuelve los tres veredictos de la matriz: ejecuta, deniega con explicación, o
 * abre el teclado de PIN para que un superior firme.
 */
import type { Accion, ContextoAccion, RolId } from "@motrest/dominio";
import { sesion } from "./sesion.svelte";

export interface ResultadoAutorizacion {
  ok: boolean;
  autorizador_id?: string;
}

interface Pendiente {
  accion: Accion;
  razon: string;
  roles: RolId[];
  contexto?: string;
  resolver: (r: ResultadoAutorizacion) => void;
}

class GestorAutorizacion {
  pendiente = $state<Pendiente | null>(null);
  aviso = $state<string>("");
  private temporizador: ReturnType<typeof setTimeout> | undefined;

  /** Muestra un aviso efímero (p. ej. una acción denegada). */
  avisar(texto: string): void {
    this.aviso = texto;
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => (this.aviso = ""), 3200);
  }

  /**
   * Pide permiso para ejecutar una acción.
   * Espera a que el superior firme si hace falta.
   */
  async solicitar(
    accion: Accion,
    ctx?: ContextoAccion,
    contexto?: string,
  ): Promise<ResultadoAutorizacion> {
    const veredicto = sesion.evaluar(accion, ctx);

    if (veredicto.resultado === "permitido") return { ok: true };

    if (veredicto.resultado === "denegado") {
      this.avisar(veredicto.razon);
      return { ok: false };
    }

    return new Promise<ResultadoAutorizacion>((resolver) => {
      this.pendiente = {
        accion,
        razon: veredicto.razon,
        roles: veredicto.roles_autorizantes,
        contexto,
        resolver,
      };
    });
  }

  completar(autorizadorId: string): void {
    const pendiente = this.pendiente;
    this.pendiente = null;
    pendiente?.resolver({ ok: true, autorizador_id: autorizadorId });
    this.avisar(`Autorizado por ${sesion.nombreDe(autorizadorId)}`);
  }

  cancelar(): void {
    const pendiente = this.pendiente;
    this.pendiente = null;
    pendiente?.resolver({ ok: false });
  }
}

export const autorizacion = new GestorAutorizacion();
