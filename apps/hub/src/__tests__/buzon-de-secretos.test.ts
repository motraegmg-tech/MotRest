/**
 * El buzón `secretos_pendientes`, visto desde el enlace del Hub con la nube.
 *
 * Dos cosas que solo se ven con la nube de verdad y aquí se fijan con un doble:
 * que el Hub conteste SOLO con las tres columnas que RLS le deja tocar
 * (`entregado_ts`, `aplicado_ts`, `ultimo_error`), y que su propio UPDATE, que
 * le vuelve por Realtime, no lo meta en un bucle abriendo el mismo sobre.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const nube = vi.hoisted(() => ({
  secretos: [] as Record<string, unknown>[],
  cambios: [] as { tabla: string; valores: Record<string, unknown>; columna: string; valor: unknown }[],
  escuchas: new Map<string, (carga: { new: Record<string, unknown> }) => void>(),
}));

vi.mock("@supabase/supabase-js", () => {
  const consulta = (tabla: string) => {
    const filas = tabla === "secretos_pendientes" ? nube.secretos : [];
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      is: () => q,
      gte: () => q,
      order: () => q,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (resolver: (r: unknown) => unknown) => resolver({ data: filas, error: null }),
      update: (valores: Record<string, unknown>) => ({
        eq: async (columna: string, valor: unknown) => {
          nube.cambios.push({ tabla, valores, columna, valor });
          return { error: null };
        },
      }),
    });
    return q;
  };
  return {
    createClient: () => ({
      auth: { signInWithPassword: async () => ({ error: null }), signOut: async () => ({}) },
      channel: () => {
        const canal: Record<string, unknown> = {};
        Object.assign(canal, {
          on: (_tipo: string, filtro: { table: string }, escucha: (c: { new: Record<string, unknown> }) => void) => {
            nube.escuchas.set(filtro.table, escucha);
            return canal;
          },
          subscribe: () => canal,
          unsubscribe: async () => ({}),
        });
        return canal;
      },
      from: consulta,
      functions: { invoke: async () => ({ error: null }) },
    }),
  };
});

const { EnlaceSupabase } = await import("../enlace-supabase.js");

const SUC = "suc-rodizio";
let recibidos: unknown[];
let respuesta: { aplicado: boolean; problema?: string };

function enlace() {
  const e = new EnlaceSupabase({
    url: "https://motrest.supabase.co",
    llavePublicable: "pk",
    clave: "clave",
    sucursal_id: SUC,
    alLlegarMensaje: () => {},
    registrar: () => {},
    alLlegarSecreto: async (fila) => {
      recibidos.push(fila.sobre);
      return respuesta;
    },
  });
  e.conectar();
  return e;
}

beforeEach(() => {
  nube.secretos = [];
  nube.cambios = [];
  nube.escuchas.clear();
  recibidos = [];
  respuesta = { aplicado: true };
});

describe("el buzón de secretos", () => {
  it("recoge lo que Central dejó y contesta solo con las tres columnas permitidas", async () => {
    nube.secretos = [
      { id: "s1", clase: "facturapi", sobre: { formato: "x" }, depositado_ts: "2026-09-19T10:00:00Z", entregado_ts: null },
      // Ya contestado: no se vuelve a abrir.
      { id: "s2", clase: "gmail", sobre: { formato: "y" }, depositado_ts: "2026-09-19T10:00:00Z", entregado_ts: "2026-09-19T10:05:00Z" },
    ];
    const e = enlace();
    await vi.waitFor(() => expect(nube.cambios).toHaveLength(1));

    expect(recibidos).toEqual([{ formato: "x" }]);
    const [cambio] = nube.cambios;
    expect(cambio!.tabla).toBe("secretos_pendientes");
    expect(cambio!.columna).toBe("id");
    expect(cambio!.valor).toBe("s1");
    expect(Object.keys(cambio!.valores).sort()).toEqual(["aplicado_ts", "entregado_ts", "ultimo_error"]);
    expect(cambio!.valores.ultimo_error).toBeNull();
    expect(cambio!.valores.aplicado_ts).toBe(cambio!.valores.entregado_ts);
    e.desconectar();
  });

  it("su propio UPDATE de vuelta por Realtime no lo mete en un bucle", async () => {
    const e = enlace();
    await vi.waitFor(() => expect(nube.escuchas.has("secretos_pendientes")).toBe(true));
    const escucha = nube.escuchas.get("secretos_pendientes")!;

    const fila = { id: "s1", clase: "facturapi", sobre: { formato: "x" }, depositado_ts: "2026-09-19T10:00:00Z", entregado_ts: null };
    escucha({ new: fila });
    await vi.waitFor(() => expect(nube.cambios).toHaveLength(1));
    // Llega el eco con la fecha de entrega que puso el Hub.
    escucha({ new: { ...fila, entregado_ts: nube.cambios[0]!.valores.entregado_ts } });
    // Y el mismo depósito repetido (reconexión) tampoco.
    escucha({ new: fila });
    await new Promise((r) => setTimeout(r, 20));
    expect(recibidos).toHaveLength(1);

    // Un depósito NUEVO de Central sí se atiende.
    escucha({ new: { ...fila, depositado_ts: "2026-09-19T11:00:00Z", entregado_ts: "2026-09-19T10:00:01Z" } });
    await vi.waitFor(() => expect(recibidos).toHaveLength(2));
    e.desconectar();
  });

  it("si no se aplicó, el motivo va en ultimo_error (máx. 1000) y la entrega no queda antes del depósito", async () => {
    respuesta = { aplicado: false, problema: "x".repeat(1500) };
    const futuro = new Date(Date.now() + 3_600_000).toISOString(); // el reloj del Hub va atrás
    nube.secretos = [{ id: "s1", clase: "facturapi", sobre: {}, depositado_ts: futuro, entregado_ts: null }];
    const e = enlace();
    await vi.waitFor(() => expect(nube.cambios).toHaveLength(1));

    const { valores } = nube.cambios[0]!;
    expect(valores.aplicado_ts).toBeNull();
    expect(String(valores.ultimo_error)).toHaveLength(1000);
    expect(Date.parse(String(valores.entregado_ts))).toBeGreaterThanOrEqual(Date.parse(futuro));
    e.desconectar();
  });
});
