/**
 * La terminal que se queda sola se cierra sola.
 *
 * Es una medida de seguridad con una consecuencia de operación grande: si se
 * pasa de celosa, echa al cajero a media cuenta; si se queda corta, cualquiera
 * que pase por la caja opera con los permisos del que se fue. Por eso el plazo
 * se prueba por los dos lados —justo antes y justo después— y no solo "cierra".
 *
 * El reloj se le pasa a mano a `revisar()`. Con temporizadores falsos habría que
 * confiar en que el latido de un segundo cae donde uno cree; así la prueba dice
 * exactamente en qué instante se mira.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { INACTIVIDAD_MS, inactividad } from "../sesion/inactividad";
import { arranque } from "../persistencia/arranque.svelte";
import { sesion } from "../sesion/sesion.svelte";
import { credencialesDeDemostracion } from "../sesion/usuarios";

const CONTRASENA = credencialesDeDemostracion().contrasena;
const T0 = 1_800_000_000_000;

beforeAll(async () => {
  await arranque.iniciar();
});

beforeEach(async () => {
  if (!sesion.autenticado) await sesion.iniciarSesion("usr-gonzalo", CONTRASENA);
  inactividad.registrarActividad(T0);
});

describe("el plazo", () => {
  it("cierra la sesión cuando se cumplen los 45 segundos sin tocar nada", () => {
    expect(sesion.autenticado).toBe(true);

    expect(inactividad.revisar(T0 + INACTIVIDAD_MS)).toBe(true);
    expect(sesion.autenticado).toBe(false);
  });

  it("un instante antes NO cierra: el cajero sigue dentro", () => {
    expect(inactividad.revisar(T0 + INACTIVIDAD_MS - 1)).toBe(false);
    expect(sesion.autenticado).toBe(true);
  });

  it("son 45 segundos, ni más ni menos", () => {
    expect(INACTIVIDAD_MS).toBe(45_000);
  });

  /*
   * El caso de todos los días: alguien está comandando y el plazo vence a media
   * captura. Cada toque tiene que devolver el plazo ENTERO, no un resto.
   */
  it("tocar la interfaz devuelve el plazo completo", () => {
    inactividad.revisar(T0 + 44_000);
    inactividad.registrarActividad(T0 + 44_000);

    // Han pasado 44 s desde el toque, pero 88 desde el principio.
    expect(inactividad.revisar(T0 + 88_000)).toBe(false);
    expect(sesion.autenticado).toBe(true);

    expect(inactividad.revisar(T0 + 44_000 + INACTIVIDAD_MS)).toBe(true);
  });

  it("informa cuánto falta, para poder avisar antes de cerrar", () => {
    expect(inactividad.restante(T0)).toBe(INACTIVIDAD_MS);
    expect(inactividad.restante(T0 + 30_000)).toBe(15_000);
    // Nunca negativo: vencido es vencido.
    expect(inactividad.restante(T0 + 90_000)).toBe(0);
  });
});

describe("cuándo NO debe cerrar", () => {
  it("sin nadie dentro no hace nada", () => {
    sesion.cerrarSesion();
    expect(sesion.autenticado).toBe(false);

    expect(inactividad.revisar(T0 + INACTIVIDAD_MS * 10)).toBe(false);
  });

  /*
   * SI EL PLAZO ENVEJECIERA CON LA PANTALLA DE ACCESO PUESTA, quien entrara se
   * encontraría el reloj ya vencido y su sesión duraría lo que tarda el
   * siguiente latido. La caja quedaría inservible: entrar, cerrarse, entrar.
   */
  it("el plazo no envejece mientras nadie ha entrado", async () => {
    sesion.cerrarSesion();

    // La terminal pasa la noche en la pantalla de acceso.
    inactividad.revisar(T0 + 8 * 60 * 60 * 1000);

    await sesion.iniciarSesion("usr-gonzalo", CONTRASENA);
    inactividad.registrarActividad(T0 + 8 * 60 * 60 * 1000);

    // Y quien llega en la mañana estrena los 45 segundos completos.
    expect(inactividad.revisar(T0 + 8 * 60 * 60 * 1000 + 44_000)).toBe(false);
    expect(sesion.autenticado).toBe(true);
  });

  /*
   * LA PANTALLA DE COCINA. El KDS es este mismo POS en `#/cocina/tablero` sobre
   * una tablet en modo kiosco: nadie la toca durante el servicio, se mira.
   * Cerrarla dejaría a la cocina sin tablero y pidiendo un PIN con las manos
   * llenas de harina.
   */
  it("la pantalla exenta no se cierra por más que pase el tiempo", () => {
    let enCocina = true;
    const detener = inactividad.iniciar(() => enCocina);
    inactividad.registrarActividad(T0);

    try {
      expect(inactividad.revisar(T0 + INACTIVIDAD_MS * 20)).toBe(false);
      expect(sesion.autenticado).toBe(true);

      // Y al salir de cocina el plazo arranca limpio, no vencido de antes.
      enCocina = false;
      inactividad.revisar(T0 + INACTIVIDAD_MS * 20);
      expect(sesion.autenticado).toBe(true);
    } finally {
      detener();
    }
  });
});

describe("lo que queda en la bitácora", () => {
  it("se distingue del «Salir» que pulsa una persona", () => {
    inactividad.revisar(T0 + INACTIVIDAD_MS);

    const ultimo = [...sesion.eventos].reverse().find((e) => e.tipo === "sesion_cerrada");
    expect(ultimo).toBeDefined();
    expect(ultimo!.tipo === "sesion_cerrada" && ultimo!.motivo).toBe("inactividad");
  });

  it("un cierre a mano no lleva motivo", async () => {
    if (!sesion.autenticado) await sesion.iniciarSesion("usr-gonzalo", CONTRASENA);
    sesion.cerrarSesion();

    const ultimo = [...sesion.eventos].reverse().find((e) => e.tipo === "sesion_cerrada");
    expect(ultimo!.tipo === "sesion_cerrada" && ultimo!.motivo).toBeUndefined();
  });
});
