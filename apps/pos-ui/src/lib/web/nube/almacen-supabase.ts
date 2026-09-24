/**
 * `AlmacenNube` sobre las tablas de Supabase (modalidad nube, 1.6.0).
 *
 * Solo transporta texto cifrado. Las políticas RLS ya limitan todo a la
 * sucursal del pase; los filtros por sucursal de aquí son comodidad y no
 * seguridad —confiar en el filtro sería confiar en el cliente—.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlmacenNube, FilaDocumentoNube, FilaEventoNube } from "./servidor-nube";

export class AlmacenSupabase implements AlmacenNube {
  constructor(
    private cliente: SupabaseClient,
    private sucursalId: string,
  ) {}

  async seqActual(): Promise<number> {
    const { data, error } = await this.cliente
      .from("eventos_nube")
      .select("seq")
      .eq("sucursal_id", this.sucursalId)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? Number((data as { seq: number }).seq) : 0;
  }

  async empujar(filas: { id: string; device_id: string; sobre: string }[]): Promise<{ id: string; seq: number }[]> {
    const { data, error } = await this.cliente.rpc("empujar_eventos_nube", { p_eventos: filas });
    if (error) throw new Error(error.message);
    return ((data ?? []) as { id: string; seq: number | string }[]).map((f) => ({ id: f.id, seq: Number(f.seq) }));
  }

  async desde(seq: number, limite: number): Promise<FilaEventoNube[]> {
    const { data, error } = await this.cliente
      .from("eventos_nube")
      .select("seq, id, device_id, sobre")
      .eq("sucursal_id", this.sucursalId)
      .gt("seq", seq)
      .order("seq", { ascending: true })
      .limit(limite);
    if (error) throw new Error(error.message);
    return ((data ?? []) as FilaEventoNube[]).map((f) => ({ ...f, seq: Number(f.seq) }));
  }

  async documentos(prefijo: string): Promise<FilaDocumentoNube[]> {
    const { data, error } = await this.cliente
      .from("documentos_nube")
      .select("llave, sobre")
      .eq("sucursal_id", this.sucursalId)
      .like("llave", `${prefijo}%`);
    if (error) throw new Error(error.message);
    return (data ?? []) as FilaDocumentoNube[];
  }

  async publicarDocumento(llave: string, version: string, sobre: string): Promise<boolean> {
    const { data, error } = await this.cliente.rpc("publicar_documento_nube", {
      p_llave: llave,
      p_version: version,
      p_sobre: sobre,
    });
    if (error) throw new Error(error.message);
    return data === true;
  }

  async licencia(): Promise<unknown | null> {
    const { data, error } = await this.cliente
      .from("licencias_pendientes")
      .select("licencia")
      .eq("sucursal_id", this.sucursalId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { licencia?: unknown } | null)?.licencia ?? null;
  }
}
