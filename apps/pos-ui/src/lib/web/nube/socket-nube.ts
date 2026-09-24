/**
 * El «WebSocket» de un restaurante en modalidad nube (1.6.0).
 *
 * Por fuera es un `SocketLike` como el de la red del salón; por dentro, el
 * «Hub» corre aquí mismo (`ServidorNube`) y guarda en Supabase. Lo que avisa de
 * que otro dispositivo vendió algo es Realtime: una fila nueva en
 * `eventos_nube` despierta una consulta, y la consulta entrega en orden.
 */
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { verificarLicencia } from "@motrest/dominio";
import { derivarClaves, derivarLlaveDatosNube, type SocketLike } from "@motrest/protocolo-sync";
import { AlmacenSupabase } from "./almacen-supabase";
import { ServidorNube, type FilaDocumentoNube } from "./servidor-nube";

/** La pública de licencias de MOTRAE, que se incrusta al compilar la web. */
function llaveDeLicencias(): string {
  return (import.meta.env.VITE_MOTREST_LICENCIA_PUBLICA ?? "").trim();
}

export class SocketNube implements SocketLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((evento: { data: unknown }) => void) | null = null;

  private servidor: ServidorNube | null = null;
  private canal: RealtimeChannel | null = null;
  private cerrado = false;
  private pendientes: string[] = [];

  constructor(
    private cliente: SupabaseClient,
    private sucursalId: string,
    claveRemota: string,
    private avisar?: (motivo: string) => void,
  ) {
    void this.abrir(claveRemota).catch((causa) => {
      console.error("No se pudo abrir la nube del restaurante", causa);
      this.terminar("No se pudo abrir la nube de tu restaurante. Revisa tu internet.");
    });
  }

  private async abrir(claveRemota: string): Promise<void> {
    const [canal, datos] = await Promise.all([derivarClaves(claveRemota, "hub"), derivarLlaveDatosNube(claveRemota)]);
    const llave = llaveDeLicencias();

    const servidor = new ServidorNube({
      almacen: new AlmacenSupabase(this.cliente, this.sucursalId),
      sucursal_id: this.sucursalId,
      canal,
      datos,
      verificarLicencia: async (l) => (llave ? verificarLicencia(l, this.sucursalId, llave) : false),
      entregar: (crudo) => {
        if (!this.cerrado) this.onmessage?.({ data: crudo });
      },
      avisar: this.avisar,
    });
    this.servidor = servidor;

    await this.cliente.realtime.setAuth();
    const filtro = `sucursal_id=eq.${this.sucursalId}`;
    this.canal = this.cliente
      .channel(`nube-${this.sucursalId}-${crypto.randomUUID().slice(0, 8)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "eventos_nube", filter: filtro }, () =>
        servidor.hayEventosNuevos(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "documentos_nube", filter: filtro }, (carga) => {
        const fila = carga.new as Partial<FilaDocumentoNube> | null;
        if (fila && typeof fila.llave === "string" && typeof fila.sobre === "string") {
          servidor.cambioDocumento({ llave: fila.llave, sobre: fila.sobre });
        }
      })
      .subscribe((estado) => {
        if (estado === "SUBSCRIBED") {
          if (this.cerrado) return;
          this.onopen?.();
          for (const crudo of this.pendientes.splice(0)) servidor.recibir(crudo);
        } else if (estado === "CHANNEL_ERROR" || estado === "TIMED_OUT") {
          this.terminar("Se perdió la conexión con la nube de tu restaurante.");
        }
      });
  }

  send(datos: string): void {
    if (this.cerrado) return;
    if (this.servidor) this.servidor.recibir(datos);
    else this.pendientes.push(datos);
  }

  close(): void {
    this.terminar("La terminal cerró la sesión");
  }

  private terminar(motivo: string): void {
    if (this.cerrado) return;
    this.cerrado = true;
    const canal = this.canal;
    this.canal = null;
    if (canal) void this.cliente.removeChannel(canal);
    this.avisar?.(motivo);
    this.onclose?.();
  }
}
