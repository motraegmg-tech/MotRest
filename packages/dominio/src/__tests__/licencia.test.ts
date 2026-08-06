/**
 * La licencia de uso.
 *
 * Aquí lo que hay que probar NO es que cobre: es que NUNCA deje al restaurante
 * sin vender. Un POS que se apaga a media cena por una licencia es una
 * catástrofe, y sería culpa de MOTRAE — el comensal está esperando su cuenta y
 * el mesero no puede cobrarle.
 *
 * Por eso la mitad de estas pruebas comprueban que algo SIGUE funcionando.
 */
import { describe, expect, it } from "vitest";
import {
  DIAS_AVISO,
  emitirLicencia,
  permiteLicencia,
  situacionDe,
  verificarLicencia,
  type Licencia,
} from "../organizacion/licencia.js";

const SECRETO = "secreto-de-motrae";
const SUC = "suc-rodizio";
const AHORA = new Date(2026, 6, 24, 21, 0).getTime();
const DIA = 86_400_000;

async function licencia(diasParaVencer: number, gracia = 7): Promise<Licencia> {
  return emitirLicencia(
    {
      sucursal_id: SUC,
      nombre: "Rodizio",
      plan: "mensual",
      vence_ts: AHORA + diasParaVencer * DIA,
      gracia_dias: gracia,
      emitida_ts: AHORA - 30 * DIA,
    },
    SECRETO,
  );
}

// --- La firma -----------------------------------------------------------------------------

describe("la licencia viene de MOTRAE o no vale", () => {
  it("una licencia emitida por MOTRAE se verifica", async () => {
    expect(await verificarLicencia(await licencia(30), SUC, SECRETO)).toBe(true);
  });

  /* Sin esto, cualquiera se extiende la licencia editando un archivo. */
  it("cambiar la fecha de vencimiento la invalida", async () => {
    const l = await licencia(-100);
    const alterada = { ...l, vence_ts: AHORA + 365 * DIA };
    expect(await verificarLicencia(alterada, SUC, SECRETO)).toBe(false);
  });

  /*
   * Sin comprobar la sucursal, la licencia de un restaurante que sí paga
   * serviría para todos los demás con solo copiar un archivo.
   */
  it("la licencia de otro local no sirve aquí", async () => {
    const l = await licencia(30);
    expect(await verificarLicencia(l, "suc-otro-restaurante", SECRETO)).toBe(false);
  });

  it("una firma inventada no pasa", async () => {
    const l = { ...(await licencia(30)), firma: "0".repeat(64) };
    expect(await verificarLicencia(l, SUC, SECRETO)).toBe(false);
  });

  it("otro secreto no puede emitir licencias válidas", async () => {
    const falsa = await emitirLicencia(
      {
        sucursal_id: SUC, nombre: "Rodizio", plan: "anual",
        vence_ts: AHORA + 999 * DIA, gracia_dias: 7, emitida_ts: AHORA,
      },
      "secreto-de-un-pirata",
    );
    expect(await verificarLicencia(falsa, SUC, SECRETO)).toBe(false);
  });
});

// --- Los estados --------------------------------------------------------------------------

describe("en qué situación está", () => {
  const sit = (dias: number, gracia = 7) =>
    situacionDe(
      {
        sucursal_id: SUC, nombre: "Rodizio", plan: "mensual",
        vence_ts: AHORA + dias * DIA, gracia_dias: gracia,
        emitida_ts: AHORA - 30 * DIA, firma: "x",
      },
      true,
      AHORA,
    );

  it("con tiempo de sobra, ni avisa", () => {
    const s = sit(60);
    expect(s.estado).toBe("activa");
    expect(s.avisar).toBe(false);
    expect(s.opera).toBe(true);
  });

  it("cerca del vencimiento avisa, sin estorbar", () => {
    const s = sit(DIAS_AVISO - 3);
    expect(s.estado).toBe("por_vencer");
    expect(s.avisar).toBe(true);
    expect(s.opera).toBe(true);
    expect(s.mensaje).toContain("vence en");
  });

  /*
   * LA GRACIA EXISTE PARA ESTO: que un pago que se atrasó dos días no le cueste
   * un viernes al restaurante. Todo sigue funcionando.
   */
  it("vencida pero en gracia, TODO sigue funcionando", () => {
    const s = sit(-3);
    expect(s.estado).toBe("gracia");
    expect(s.opera).toBe(true);
    expect(s.mensaje).toContain("sigue funcionando");
  });

  it("pasada la gracia, se restringe", () => {
    const s = sit(-15);
    expect(s.estado).toBe("restringida");
    expect(s.opera).toBe(false);
  });

  it("sin licencia, o con una que no verifica, es inválida", () => {
    expect(situacionDe(null, false, AHORA).estado).toBe("invalida");
    const l = { sucursal_id: SUC } as Licencia;
    expect(situacionDe(l, false, AHORA).estado).toBe("invalida");
  });

  it("la gracia la decide la licencia, no una constante", () => {
    // Con 30 días de gracia, a los 15 vencida todavía opera.
    expect(sit(-15, 30).estado).toBe("gracia");
    expect(sit(-15, 30).opera).toBe(true);
  });
});

// --- Lo que nunca se bloquea ---------------------------------------------------------------

describe("lo que se puede hacer aunque no se haya pagado", () => {
  const restringida = situacionDe(
    {
      sucursal_id: SUC, nombre: "Rodizio", plan: "mensual",
      vence_ts: AHORA - 90 * DIA, gracia_dias: 7,
      emitida_ts: AHORA - 400 * DIA, firma: "x",
    },
    true,
    AHORA,
  );
  const invalida = situacionDe(null, false, AHORA);

  /*
   * EL CANDADO MÁS IMPORTANTE DEL ARCHIVO. Un restaurante a media cena tiene
   * comensales esperando su cuenta. Impedirle cobrar por un adeudo convierte un
   * problema de cobranza en una catástrofe de servicio — y la culpa sería
   * nuestra, no suya.
   */
  it("VENDER y COBRAR se pueden siempre, hasta sin licencia", () => {
    for (const s of [restringida, invalida]) {
      expect(permiteLicencia(s, "vender")).toBe(true);
      expect(permiteLicencia(s, "cerrar")).toBe(true);
    }
  });

  /*
   * Sus ventas son suyas y las necesita para el SAT. Retenerlas no es una
   * palanca de cobro: es un problema legal.
   */
  it("EXPORTAR sus datos se puede siempre", () => {
    for (const s of [restringida, invalida]) {
      expect(permiteLicencia(s, "exportar")).toBe(true);
    }
  });

  /* Lo que se restringe es lo que hace crecer la operación, no lo que la cierra. */
  it("abrir turno nuevo y dar de alta terminales sí se bloquean", () => {
    expect(permiteLicencia(restringida, "abrir_turno")).toBe(false);
    expect(permiteLicencia(restringida, "agregar_terminal")).toBe(false);
  });

  it("en gracia no se bloquea nada", () => {
    const gracia = situacionDe(
      {
        sucursal_id: SUC, nombre: "Rodizio", plan: "mensual",
        vence_ts: AHORA - 2 * DIA, gracia_dias: 7,
        emitida_ts: AHORA - 32 * DIA, firma: "x",
      },
      true,
      AHORA,
    );
    expect(permiteLicencia(gracia, "abrir_turno")).toBe(true);
  });
});

// --- Sin internet -------------------------------------------------------------------------

describe("comprobar sin internet", () => {
  /*
   * La licencia es un documento firmado que el Hub guarda. No hay llamada a
   * ningún servidor al arrancar: si MOTRAE se cae, los restaurantes siguen
   * abriendo.
   */
  it("una licencia guardada se verifica sin llamar a nadie", async () => {
    const l = await licencia(30);
    const guardada = JSON.parse(JSON.stringify(l)) as Licencia;
    expect(await verificarLicencia(guardada, SUC, SECRETO)).toBe(true);
    expect(situacionDe(guardada, true, AHORA).opera).toBe(true);
  });
});
