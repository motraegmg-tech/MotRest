/**
 * El límite de crecimiento del registro.
 *
 * Se prueba que el aviso llegue ANTES de que estorbe, no cuando ya estorba: un
 * aviso que aparece el día que la caja tarda en abrir no sirve de nada.
 */
import { describe, expect, it } from "vitest";
import {
  EVENTOS_AVISO,
  EVENTOS_CRITICO,
  enMegas,
  evaluarCrecimiento,
} from "../crecimiento.js";

describe("niveles", () => {
  it("un local que arranca está sano y sin recomendaciones", () => {
    const c = evaluarCrecimiento(128, 155_648);
    expect(c.nivel).toBe("sano");
    expect(c.recomendacion).toBe("");
  });

  it("medio año de operación todavía está sano", () => {
    // ~1 400 eventos/día × 180 días.
    expect(evaluarCrecimiento(252_000, 160 * 1024 * 1024).nivel).toBe("sano");
  });

  it("cerca del año avisa, con tiempo de planear", () => {
    expect(evaluarCrecimiento(EVENTOS_AVISO, 0).nivel).toBe("aviso");
    expect(evaluarCrecimiento(EVENTOS_AVISO, 0).recomendacion).toMatch(/planear/i);
  });

  it("pasado el umbral crítico dice que ya toca actuar", () => {
    const c = evaluarCrecimiento(EVENTOS_CRITICO + 1, 0);
    expect(c.nivel).toBe("critico");
    expect(c.recomendacion).toMatch(/archivar/i);
  });

  /* El aviso tiene que llegar antes que el problema, no con él. */
  it("el umbral de aviso queda holgadamente por debajo del crítico", () => {
    expect(EVENTOS_AVISO).toBeLessThan(EVENTOS_CRITICO / 1.5);
  });
});

describe("presentación", () => {
  it("el tamaño se reporta en megas legibles", () => {
    expect(enMegas(155_648)).toBe("0.1 MB");
    expect(enMegas(336 * 1024 * 1024)).toBe("336.0 MB");
  });
});
