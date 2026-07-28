/**
 * Recuperar el acceso del propietario con el código de rescate.
 *
 * Es la puerta más delicada del sistema: la única que NO firma otra persona.
 * Por eso lo que más se prueba aquí es lo que NO debe funcionar —un código
 * equivocado, uno ya gastado— y que la puerta se cierre sola detrás de quien
 * pasa.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { arranque } from "../persistencia/arranque.svelte";
import { sesion } from "../sesion/sesion.svelte";
import { CONTRASENA_INICIAL_PROPIETARIO } from "../sesion/usuarios";

const PROPIETARIO = "usr-gonzalo";

beforeAll(async () => {
  await arranque.iniciar();
});

/** El código vigente. Solo existe en claro justo después de emitirse. */
async function codigoVigente(): Promise<string> {
  const codigo = await sesion.emitirCodigoRescate();
  sesion.olvidarCodigoMostrado();
  return codigo;
}

describe("se emite a petición, no solo", () => {
  /*
   * Antes se emitía al arrancar y la pantalla lo enseñaba. Salía en cada
   * instalación y estorbaba, así que ahora se pide desde Administración cuando
   * se quiere tener uno. La consecuencia asumida: un local sin código emitido
   * no tiene forma de recuperar el acceso del propietario.
   */
  it("un local recién instalado NO trae uno de fábrica", () => {
    expect(sesion.hayCodigoRescate).toBe(false);
  });

  it("se emite cuando se pide", async () => {
    await sesion.emitirCodigoRescate();
    expect(sesion.hayCodigoRescate).toBe(true);
    sesion.olvidarCodigoMostrado();
  });

  it("el código se enseña una vez y después solo queda el hash", async () => {
    const codigo = await sesion.emitirCodigoRescate();
    expect(sesion.codigoRescateNuevo).toBe(codigo);

    sesion.olvidarCodigoMostrado();
    expect(sesion.codigoRescateNuevo).toBeNull();
  });
});

describe("recuperar el acceso", () => {
  it("con el código correcto, la contraseña nueva sirve", async () => {
    const codigo = await codigoVigente();

    const r = await sesion.recuperarAcceso(codigo, "Rodizio.Nueva.2026");
    expect(r.ok).toBe(true);

    const entrada = await sesion.iniciarSesion(PROPIETARIO, "Rodizio.Nueva.2026");
    expect(entrada.ok).toBe(true);
  });

  it("da igual cómo se transcriba del papel", async () => {
    const codigo = await codigoVigente();
    // Sin guiones, en minúsculas y con una O donde iba una Q.
    const comoLoAnotaron = codigo.replace(/-/g, "").toLowerCase().replace(/q/g, "O");

    const r = await sesion.recuperarAcceso(comoLoAnotaron, "Rodizio.Otra.2026");
    expect(r.ok).toBe(true);
  });

  /*
   * EL CANDADO PRINCIPAL. Sin esto, el "rescate" sería una puerta trasera:
   * cualquiera que se sentara en la caja entraría como el dueño.
   */
  it("un código equivocado no abre nada", async () => {
    await codigoVigente();

    const r = await sesion.recuperarAcceso("AAAAA-BBBBB-CCCCC-DDDDD", "Intento.Malo.2026");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no es correcto/i);

    // Y la contraseña anterior sigue siendo la buena.
    const entrada = await sesion.iniciarSesion(PROPIETARIO, "Intento.Malo.2026");
    expect(entrada.ok).toBe(false);
  });

  /*
   * De un solo uso: un código anotado en un papel viejo —o visto por encima del
   * hombro— no puede seguir sirviendo para siempre.
   */
  it("el código usado se quema y ya no vuelve a servir", async () => {
    const codigo = await codigoVigente();

    expect((await sesion.recuperarAcceso(codigo, "Primera.Vez.2026")).ok).toBe(true);
    sesion.olvidarCodigoMostrado();

    const segunda = await sesion.recuperarAcceso(codigo, "Segunda.Vez.2026");
    expect(segunda.ok).toBe(false);
  });

  it("al gastarlo se entrega otro en el acto, y ese sí funciona", async () => {
    const codigo = await codigoVigente();

    await sesion.recuperarAcceso(codigo, "Con.Codigo.Nuevo.2026");
    const nuevo = sesion.codigoRescateNuevo;
    expect(nuevo).toBeTruthy();
    expect(nuevo).not.toBe(codigo);
    sesion.olvidarCodigoMostrado();

    expect((await sesion.recuperarAcceso(nuevo!, "Tercera.2026")).ok).toBe(true);
  });

  it("una contraseña que no cumple la política se rechaza antes de tocar nada", async () => {
    const codigo = await codigoVigente();

    const r = await sesion.recuperarAcceso(codigo, "123");
    expect(r.ok).toBe(false);

    // El código NO se gastó: el rechazo fue por la contraseña, no por él.
    sesion.olvidarCodigoMostrado();
    expect((await sesion.recuperarAcceso(codigo, "Sigue.Sirviendo.2026")).ok).toBe(true);
  });
});

describe("queda en la bitácora", () => {
  it("recuperar el acceso deja constancia", async () => {
    const codigo = await codigoVigente();
    await sesion.recuperarAcceso(codigo, "Para.La.Bitacora.2026");
    sesion.olvidarCodigoMostrado();

    const huella = sesion.eventos.filter((e) => e.tipo === "acceso_recuperado");
    expect(huella.length).toBeGreaterThan(0);
    expect(huella.at(-1)).toMatchObject({ usuario_id: PROPIETARIO });
  });
});
