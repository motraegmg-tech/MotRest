/**
 * La licencia de uso.
 *
 * Tres días de gracia y después el software queda inservible: es la decisión de
 * Gonzalo y es lo que hace que la mensualidad se cobre. Lo que hay que probar es
 * que el bloqueo NO se pueda esquivar editando un archivo, y que la única
 * concesión —no caer con un turno abierto— sea exactamente esa y ninguna más.
 */
import { describe, expect, it } from "vitest";
import {
  DIAS_AVISO,
  GRACIA_POR_DEFECTO,
  debeBloquearse,
  emitirLicencia,
  momentoDeBloquear,
  permiteLicencia,
  siguienteVencimiento,
  situacionDe,
  verificarLicencia,
  type Licencia,
} from "../organizacion/licencia.js";

const SECRETO = "secreto-de-motrae";
const SUC = "suc-rodizio";
const AHORA = new Date(2026, 6, 24, 21, 0).getTime();
const DIA = 86_400_000;

async function licencia(diasParaVencer: number, extra: Partial<Licencia> = {}): Promise<Licencia> {
  return emitirLicencia(
    {
      sucursal_id: SUC,
      nombre: "Rodizio",
      plan: "mensual",
      vence_ts: AHORA + diasParaVencer * DIA,
      gracia_dias: GRACIA_POR_DEFECTO,
      emitida_ts: AHORA - 30 * DIA,
      ...extra,
    },
    SECRETO,
  );
}

const sit = (dias: number, gracia = GRACIA_POR_DEFECTO) =>
  situacionDe(
    {
      sucursal_id: SUC, nombre: "Rodizio", plan: "mensual",
      vence_ts: AHORA + dias * DIA, gracia_dias: gracia,
      emitida_ts: AHORA - 30 * DIA, firma: "x",
    },
    true,
    AHORA,
  );

// --- La firma -----------------------------------------------------------------------------

describe("la licencia viene de MOTRAE o no vale", () => {
  it("una licencia emitida por MOTRAE se verifica", async () => {
    expect(await verificarLicencia(await licencia(30), SUC, SECRETO)).toBe(true);
  });

  /* Sin esto, cualquiera se extiende la licencia editando un archivo. */
  it("cambiar la fecha de vencimiento la invalida", async () => {
    const alterada = { ...(await licencia(-100)), vence_ts: AHORA + 365 * DIA };
    expect(await verificarLicencia(alterada, SUC, SECRETO)).toBe(false);
  });

  /* Alargarse la gracia es la otra forma obvia de esquivar el bloqueo. */
  it("estirar los días de gracia la invalida", async () => {
    const alterada = { ...(await licencia(-10)), gracia_dias: 999 };
    expect(await verificarLicencia(alterada, SUC, SECRETO)).toBe(false);
  });

  /*
   * Sin comprobar la sucursal, la licencia de un restaurante que sí paga
   * serviría para todos los demás con solo copiar un archivo.
   */
  it("la licencia de otro local no sirve aquí", async () => {
    expect(await verificarLicencia(await licencia(30), "suc-otro", SECRETO)).toBe(false);
  });

  it("una firma inventada no pasa", async () => {
    const l = { ...(await licencia(30)), firma: "0".repeat(64) };
    expect(await verificarLicencia(l, SUC, SECRETO)).toBe(false);
  });

  it("otro secreto no puede emitir licencias válidas", async () => {
    const falsa = await emitirLicencia(
      {
        sucursal_id: SUC, nombre: "Rodizio", plan: "anual",
        vence_ts: AHORA + 999 * DIA, gracia_dias: 3, emitida_ts: AHORA,
      },
      "secreto-de-un-pirata",
    );
    expect(await verificarLicencia(falsa, SUC, SECRETO)).toBe(false);
  });

  /*
   * EL CANDADO DEL ACCESO DE SOPORTE. Si la credencial de MOTRAE no fuera parte
   * de lo firmado, el restaurante podría pegar el hash de una contraseña suya y
   * entrar con todos los permisos del proveedor.
   */
  it("meterle una credencial de soporte propia la invalida", async () => {
    const l = await licencia(30, {
      soporte: { sal: "sal-de-motrae", hash: "hash-de-motrae", iteraciones: 600_000 },
    });
    expect(await verificarLicencia(l, SUC, SECRETO)).toBe(true);

    const suplantada = {
      ...l,
      soporte: { sal: "mi-sal", hash: "hash-de-mi-contrasena", iteraciones: 600_000 },
    };
    expect(await verificarLicencia(suplantada, SUC, SECRETO)).toBe(false);
  });
});

// --- Los estados --------------------------------------------------------------------------

describe("en qué situación está", () => {
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

  it("la gracia son tres días, como pidió Gonzalo", () => {
    expect(GRACIA_POR_DEFECTO).toBe(3);
    expect(sit(-1).estado).toBe("gracia");
    expect(sit(-3).estado).toBe("gracia");
    expect(sit(-4).estado).toBe("bloqueada");
  });

  /* Mientras dura la gracia no estorba nada: ni cobra ni deja trabajar sería lo peor. */
  it("en gracia TODO sigue funcionando, y se avisa cuánto queda", () => {
    const s = sit(-1);
    expect(s.opera).toBe(true);
    expect(s.mensaje).toContain("2 días");
  });

  it("el último día de gracia lo dice sin rodeos", () => {
    expect(sit(-3).mensaje).toContain("mañana el sistema deja de funcionar");
  });

  it("pasada la gracia queda bloqueada", () => {
    const s = sit(-15);
    expect(s.estado).toBe("bloqueada");
    expect(s.opera).toBe(false);
  });

  /* El mensaje del bloqueo tiene que decir que sus datos siguen ahí. */
  it("el bloqueo no asusta con perder información", () => {
    expect(sit(-15).mensaje).toContain("intacta");
  });

  it("sin licencia, o con una que no verifica, es inválida", () => {
    expect(situacionDe(null, false, AHORA).estado).toBe("invalida");
    expect(situacionDe({ sucursal_id: SUC } as Licencia, false, AHORA).estado).toBe("invalida");
  });

  it("la gracia la decide la licencia, no una constante", () => {
    expect(sit(-15, 30).estado).toBe("gracia");
    expect(sit(-15, 30).opera).toBe(true);
  });
});

// --- El bloqueo ----------------------------------------------------------------------------

describe("lo que se puede hacer con el software bloqueado", () => {
  const bloqueada = sit(-15);
  const invalida = situacionDe(null, false, AHORA);

  /*
   * NADA. Es la decisión de Gonzalo y es lo que hace que la mensualidad se
   * cobre: un bloqueo con excepciones es un bloqueo que se ignora.
   */
  it("nada, ni vender ni cobrar ni cerrar", () => {
    for (const s of [bloqueada, invalida]) {
      for (const accion of ["vender", "cerrar", "abrir_turno", "agregar_terminal", "exportar"] as const) {
        expect(permiteLicencia(s, accion)).toBe(false);
      }
    }
  });

  it("en gracia no se bloquea nada", () => {
    for (const accion of ["vender", "abrir_turno", "exportar"] as const) {
      expect(permiteLicencia(sit(-2), accion)).toBe(true);
    }
  });
});

// --- Cuándo cae el bloqueo -----------------------------------------------------------------

describe("cuándo cae el bloqueo", () => {
  /*
   * LA ÚNICA CONCESIÓN, Y NO ES SUAVIZAR EL COBRO. Bloquear con doce mesas
   * abiertas encierra ese dinero: el restaurante no puede cobrarle ni a los que
   * están sentados. Esa llamada de auxilio a las diez de la noche le cae a
   * MOTRAE, no al moroso. Difiriendo al cierre pierden igual el servicio
   * siguiente, que es a las pocas horas.
   */
  it("con un turno abierto espera a que cierre", () => {
    expect(momentoDeBloquear(sit(-15), true)).toBe("al_cerrar_turno");
    expect(debeBloquearse(sit(-15), true)).toBe(false);
  });

  it("sin turno abierto cae de inmediato", () => {
    expect(momentoDeBloquear(sit(-15), false)).toBe("ahora");
    expect(debeBloquearse(sit(-15), false)).toBe(true);
  });

  /* Y el diferimiento se puede apagar por licencia, si Gonzalo lo prefiere. */
  it("con bloqueo_inmediato no espera a nadie", () => {
    const l = {
      sucursal_id: SUC, nombre: "Rodizio", plan: "mensual" as const,
      vence_ts: AHORA - 15 * DIA, gracia_dias: 3, emitida_ts: AHORA, firma: "x",
      bloqueo_inmediato: true,
    };
    expect(momentoDeBloquear(situacionDe(l, true, AHORA), true, l)).toBe("ahora");
  });

  it("una licencia sana no bloquea aunque no haya turno", () => {
    expect(debeBloquearse(sit(60), false)).toBe(false);
    expect(debeBloquearse(sit(-2), false)).toBe(false);
  });
});

// --- Renovar -------------------------------------------------------------------------------

describe("cuándo vence lo que se paga hoy", () => {
  /* Pagar tres días antes no debe regalar tres días. */
  it("pagar antes de vencer suma sobre el vencimiento anterior", () => {
    const vencia = AHORA + 3 * DIA;
    const nuevo = siguienteVencimiento(vencia, "mensual", AHORA);
    expect(nuevo).toBe(new Date(vencia).setMonth(new Date(vencia).getMonth() + 1));
  });

  /* Y pagar tarde no debe cobrar los días que estuvieron bloqueados. */
  it("pagar después de vencer cuenta desde hoy", () => {
    const nuevo = siguienteVencimiento(AHORA - 40 * DIA, "mensual", AHORA);
    expect(nuevo).toBe(new Date(AHORA).setMonth(new Date(AHORA).getMonth() + 1));
  });

  it("el plan anual suma doce meses", () => {
    const nuevo = siguienteVencimiento(null, "anual", AHORA);
    expect(nuevo).toBe(new Date(AHORA).setMonth(new Date(AHORA).getMonth() + 12));
  });
});

// --- Sin internet -------------------------------------------------------------------------

describe("comprobar sin internet", () => {
  /*
   * La licencia es un documento firmado que el Hub guarda. No hay llamada a
   * ningún servidor al arrancar: si MOTRAE se cae, los restaurantes que están al
   * corriente siguen abriendo.
   */
  it("una licencia guardada se verifica sin llamar a nadie", async () => {
    const guardada = JSON.parse(JSON.stringify(await licencia(30))) as Licencia;
    expect(await verificarLicencia(guardada, SUC, SECRETO)).toBe(true);
    expect(situacionDe(guardada, true, AHORA).opera).toBe(true);
  });
});
