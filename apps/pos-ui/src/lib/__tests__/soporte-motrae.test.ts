/**
 * El acceso de soporte de MOTRAE, cableado de verdad en la caja.
 *
 * ESTE ARCHIVO EXISTE POR UN HUECO REAL. El dominio de soporte estaba escrito y
 * probado, y aun así «Gonzalo DJA» NO podía entrar a un MotRest: nadie llamaba a
 * `credencialDeSoporte` desde la aplicación. Las pruebas del dominio pasaban al
 * cien por cien y la función no se ejecutaba nunca en producción.
 *
 * Se descubrió buscando el nombre dentro del paquete ya compilado, no leyendo el
 * código. Lo que se prueba aquí es justo lo que aquellas pruebas no podían ver:
 * que el cable existe.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  crearCredencial,
  emitirLicencia,
  generarPar,
  NOMBRE_SOPORTE,
  PUESTO_RESPONSABLE,
  USUARIO_RESPONSABLE_ID,
  USUARIO_SOPORTE_ID,
  type Licencia,
  type ParDeLlaves,
} from "@motrest/dominio";
import { arranque } from "../persistencia/arranque.svelte";
import { sesion } from "../sesion/sesion.svelte";

const CONTRASENA_SOPORTE = "contrasena-de-soporte-de-prueba";
const PIN_RESPONSABLE = "28164937";
const SUCURSAL = "suc-rodizio-centro";
let MOTRAE: ParDeLlaves;

async function licenciaConSoporte(): Promise<Licencia> {
  const c = await crearCredencial(USUARIO_SOPORTE_ID, CONTRASENA_SOPORTE, "contrasena");
  return emitirLicencia(
    {
      sucursal_id: SUCURSAL,
      nombre: "Rodizio",
      plan: "mensual",
      vence_ts: Date.now() + 30 * 86_400_000,
      gracia_dias: 3,
      emitida_ts: Date.now(),
      soporte: { sal: c.sal, hash: c.hash, iteraciones: c.iteraciones },
    },
    MOTRAE.privada,
  );
}

async function licenciaConResponsable(): Promise<Licencia> {
  const credencial = await crearCredencial(USUARIO_RESPONSABLE_ID, PIN_RESPONSABLE, "pin");
  return emitirLicencia(
    {
      sucursal_id: SUCURSAL,
      nombre: "Rodizio",
      plan: "mensual",
      vence_ts: Date.now() + 30 * 86_400_000,
      gracia_dias: 3,
      emitida_ts: Date.now(),
      responsable: {
        id: USUARIO_RESPONSABLE_ID,
        nombre: "Responsable Rodizio",
        puesto: PUESTO_RESPONSABLE,
        provision_id: "018f8fe4-6740-7d0d-98b5-a4a3e0000001",
        credencial,
      },
    },
    MOTRAE.privada,
  );
}

/**
 * Simula la caja: el marcador `__MOTREST_HUB__` y la respuesta de `/licencia`.
 *
 * `verificada` la manda el Hub, que es quien tiene la llave. Aquí se simula
 * porque la terminal NO la recalcula — si pudiera, bastaría con abrir las
 * herramientas del navegador para desbloquear el sistema.
 */
function montarCaja(licencia: Licencia | null, verificada = true): void {
  (globalThis as { __MOTREST_HUB__?: unknown }).__MOTREST_HUB__ = { url: "https://localhost:8787" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/licencia")) {
        return new Response(JSON.stringify({ licencia, verificada }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

function desmontarCaja(): void {
  delete (globalThis as { __MOTREST_HUB__?: unknown }).__MOTREST_HUB__;
  vi.unstubAllGlobals();
}

beforeEach(async () => {
  desmontarCaja();
  MOTRAE = await generarPar();
});

describe("el acceso licenciado en la caja", () => {
  it("monta al responsable licenciado como el propietario visible del local", async () => {
    montarCaja(await licenciaConResponsable());
    await arranque.iniciar();

    const responsable = sesion.usuarioDe(USUARIO_RESPONSABLE_ID);
    expect(responsable).toMatchObject({
      nombre: "Responsable Rodizio",
      rol_id: "propietario",
      puesto: PUESTO_RESPONSABLE,
      debe_cambiar_credencial: true,
    });
    expect(sesion.usuariosDelLocal.some((u) => u.id === USUARIO_RESPONSABLE_ID)).toBe(true);
    expect(sesion.credencialesIniciales).toBeNull();

    expect((await sesion.iniciarSesion(USUARIO_RESPONSABLE_ID, PIN_RESPONSABLE)).ok).toBe(true);
  });

  /*
   * LA PRUEBA QUE FALTABA. No comprueba el dominio —eso ya estaba probado—:
   * comprueba que la aplicación LLAMA al dominio y que la credencial acaba donde
   * el inicio de sesión la busca.
   */
  it("con licencia verificada, puede entrar", async () => {
    montarCaja(await licenciaConSoporte());
    await arranque.iniciar();

    const soporte = sesion.usuarios.find((u) => u.id === USUARIO_SOPORTE_ID);
    expect(soporte?.nombre).toBe(NOMBRE_SOPORTE);

    const r = await sesion.iniciarSesion(USUARIO_SOPORTE_ID, CONTRASENA_SOPORTE);
    expect(r.ok).toBe(true);
    expect(sesion.usuarioActual?.id).toBe(USUARIO_SOPORTE_ID);
  });

  /* Y sigue sin aparecer en ninguna lista del restaurante. */
  it("aunque pueda entrar, el restaurante no lo ve", async () => {
    montarCaja(await licenciaConSoporte());
    await arranque.iniciar();

    expect(sesion.usuarios.some((u) => u.id === USUARIO_SOPORTE_ID)).toBe(true);
    expect(sesion.usuariosDelLocal.some((u) => u.id === USUARIO_SOPORTE_ID)).toBe(false);
    expect(sesion.usuariosAdministrables.some((u) => u.id === USUARIO_SOPORTE_ID)).toBe(false);
  });

  /*
   * EL CANDADO DE LA FIRMA, visto desde la aplicación. Sin verificar, no se
   * monta: si no, bastaría con editar `licencia.json` a mano y pegar el hash de
   * una contraseña propia para entrar con todos los permisos del proveedor.
   */
  it("con una licencia que no verifica, NO existe", async () => {
    montarCaja(await licenciaConSoporte(), false);
    await arranque.iniciar();

    expect(sesion.usuarios.some((u) => u.id === USUARIO_SOPORTE_ID)).toBe(false);
  });

  it("sin licencia, tampoco", async () => {
    montarCaja(null);
    await arranque.iniciar();

    expect(sesion.usuarios.some((u) => u.id === USUARIO_SOPORTE_ID)).toBe(false);
  });

  /*
   * En una tablet del salón no hay `__MOTREST_HUB__`, así que ni se pregunta. El
   * hash de la contraseña que abre TODOS los restaurantes no viaja ahí.
   */
  it("en una tablet del salón no se monta ni se pregunta", async () => {
    const llamar = vi.fn();
    vi.stubGlobal("fetch", llamar);
    await arranque.iniciar();

    expect(sesion.usuarios.some((u) => u.id === USUARIO_SOPORTE_ID)).toBe(false);
    expect(llamar).not.toHaveBeenCalled();
  });

  /*
   * LO QUE NUNCA PUEDE PASAR: que un Hub caído impida abrir la caja. El soporte
   * es una comodidad de MOTRAE; el servicio del restaurante no.
   */
  it("si el Hub no contesta, la caja abre igual", async () => {
    (globalThis as { __MOTREST_HUB__?: unknown }).__MOTREST_HUB__ = { url: "x" };
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("sin Hub"); }));

    await expect(arranque.iniciar()).resolves.not.toThrow();
    expect(sesion.usuarios.length).toBeGreaterThan(0);
  });
});
