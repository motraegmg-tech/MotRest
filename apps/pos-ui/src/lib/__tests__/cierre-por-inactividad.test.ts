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
import { permisosDePlantilla, type Usuario } from "@motrest/dominio";
import { INACTIVIDAD_CAJA_MS, INACTIVIDAD_MS, inactividad } from "../sesion/inactividad";
import { arranque } from "../persistencia/arranque.svelte";
import { sesion } from "../sesion/sesion.svelte";
import { credencialesDeDemostracion } from "../sesion/usuarios";

const CONTRASENA = credencialesDeDemostracion().contrasena;
const T0 = 1_800_000_000_000;

/** Personal de piso: el plazo corto. Se crea una vez y se reutiliza. */
let mesero: Usuario;
const PIN_MESERO = "8317";

beforeAll(async () => {
  await arranque.iniciar();
  await sesion.iniciarSesion("usr-gonzalo", CONTRASENA);

  const r = await sesion.crearUsuario({
    nombre: "Mesero del plazo corto",
    rol_id: "mesero",
    puesto: "mesero",
    pin: PIN_MESERO,
    permisos: permisosDePlantilla("mesero"),
  });
  if (!r.ok) throw new Error(`No se pudo crear al mesero: ${r.error}`);
  mesero = sesion.usuarios.find((u) => u.nombre === "Mesero del plazo corto")!;
});

beforeEach(async () => {
  // El propietario es quien sella el corte: le toca el plazo largo.
  if (sesion.usuarioActual?.id !== "usr-gonzalo") {
    sesion.cerrarSesion();
    await sesion.iniciarSesion("usr-gonzalo", CONTRASENA);
  }
  inactividad.registrarActividad(T0);
});

describe("los dos plazos", () => {
  it("son 30 segundos para el piso y 7 minutos para quien cierra la caja", () => {
    expect(INACTIVIDAD_MS).toBe(30_000);
    expect(INACTIVIDAD_CAJA_MS).toBe(7 * 60_000);
  });

  it("al personal de piso se le cierra a los 30 segundos", async () => {
    sesion.cerrarSesion();
    await sesion.iniciarSesion(mesero.id, PIN_MESERO);
    inactividad.registrarActividad(T0);

    expect(inactividad.plazoMs()).toBe(INACTIVIDAD_MS);
    expect(inactividad.revisar(T0 + INACTIVIDAD_MS - 1)).toBe(false);
    expect(inactividad.revisar(T0 + INACTIVIDAD_MS)).toBe(true);
    expect(sesion.autenticado).toBe(false);
  });

  /*
   * EL ARQUEO. Contar el efectivo de un turno son varios minutos con las manos
   * en los billetes y ninguna en la pantalla. Con el plazo corto, la sesión se
   * caía justo a la mitad: billetes contados y nada registrado.
   */
  it("a quien sella el corte se le respetan los 7 minutos", () => {
    expect(inactividad.plazoMs()).toBe(INACTIVIDAD_CAJA_MS);

    // Donde al mesero ya se le habría cerrado, aquí sigue contando.
    expect(inactividad.revisar(T0 + INACTIVIDAD_MS * 5)).toBe(false);
    expect(sesion.autenticado).toBe(true);

    expect(inactividad.revisar(T0 + INACTIVIDAD_CAJA_MS)).toBe(true);
    expect(sesion.autenticado).toBe(false);
  });

  /*
   * El plazo se resuelve en cada latido, no al entrar. En la caja el usuario
   * cambia veinte veces por turno con el conmutador rápido, y el plazo tiene que
   * seguir a quien está dentro AHORA — si se congelara al iniciar sesión, un
   * mesero heredaría los 7 minutos del gerente que lo precedió.
   */
  it("el plazo sigue a quien está dentro, no a quien entró primero", async () => {
    expect(inactividad.plazoMs()).toBe(INACTIVIDAD_CAJA_MS);

    sesion.cerrarSesion();
    await sesion.iniciarSesion(mesero.id, PIN_MESERO);

    expect(inactividad.plazoMs()).toBe(INACTIVIDAD_MS);
  });

  /*
   * El caso de todos los días: alguien está comandando y el plazo vence a media
   * captura. Cada toque tiene que devolver el plazo ENTERO, no un resto.
   */
  it("tocar la interfaz devuelve el plazo completo", async () => {
    sesion.cerrarSesion();
    await sesion.iniciarSesion(mesero.id, PIN_MESERO);
    inactividad.registrarActividad(T0);

    inactividad.revisar(T0 + 29_000);
    inactividad.registrarActividad(T0 + 29_000);

    // Han pasado 29 s desde el toque, pero 58 desde el principio.
    expect(inactividad.revisar(T0 + 58_000)).toBe(false);
    expect(sesion.autenticado).toBe(true);

    expect(inactividad.revisar(T0 + 29_000 + INACTIVIDAD_MS)).toBe(true);
  });

  it("informa cuánto falta, para poder avisar antes de cerrar", () => {
    expect(inactividad.restante(T0)).toBe(INACTIVIDAD_CAJA_MS);
    expect(inactividad.restante(T0 + 60_000)).toBe(INACTIVIDAD_CAJA_MS - 60_000);
    // Nunca negativo: vencido es vencido.
    expect(inactividad.restante(T0 + INACTIVIDAD_CAJA_MS * 2)).toBe(0);
  });
});

describe("cuándo NO debe cerrar", () => {
  it("sin nadie dentro no hace nada", () => {
    sesion.cerrarSesion();
    expect(sesion.autenticado).toBe(false);

    expect(inactividad.revisar(T0 + INACTIVIDAD_CAJA_MS * 10)).toBe(false);
  });

  /*
   * SI EL PLAZO ENVEJECIERA CON LA PANTALLA DE ACCESO PUESTA, quien entrara se
   * encontraría el reloj ya vencido y su sesión duraría lo que tarda el
   * siguiente latido. La caja quedaría inservible: entrar, cerrarse, entrar.
   */
  it("el plazo no envejece mientras nadie ha entrado", async () => {
    const LA_NOCHE = T0 + 8 * 60 * 60 * 1000;
    sesion.cerrarSesion();

    // La terminal pasa la noche entera en la pantalla de acceso.
    inactividad.revisar(LA_NOCHE);

    // Se prueba con el mesero, que es quien tiene el plazo apretado: con el
    // largo, cualquier resultado pasaría y la prueba no diría nada.
    await sesion.iniciarSesion(mesero.id, PIN_MESERO);
    inactividad.registrarActividad(LA_NOCHE);

    // Quien llega en la mañana estrena sus 30 segundos completos.
    expect(inactividad.revisar(LA_NOCHE + INACTIVIDAD_MS - 1)).toBe(false);
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
    expect(inactividad.revisar(T0 + INACTIVIDAD_CAJA_MS)).toBe(true);

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
