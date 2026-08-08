import { describe, expect, it } from "vitest";
import { crearCredencial, verificarCredencial } from "../identidad/credenciales.js";
import {
  cuentaResponsableDeLicencia,
  requiereAltaDeResponsable,
  usuarioResponsable,
  PUESTO_RESPONSABLE,
  USUARIO_RESPONSABLE_ID,
} from "../identidad/responsable.js";
import { puedeGestionarA } from "../identidad/matriz.js";
import { usuarioSoporte } from "../identidad/soporte.js";
import { permisosDePlantilla, type Usuario } from "../identidad/roles.js";
import type { Licencia } from "../organizacion/licencia.js";

const SUCURSAL = "suc-rodizio";
const PIN_DE_PRUEBA = "28164937";

async function licenciaConResponsable(): Promise<Licencia> {
  const credencial = await crearCredencial(USUARIO_RESPONSABLE_ID, PIN_DE_PRUEBA, "pin");
  return {
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
    firma: "firma-de-prueba",
  };
}

describe("el responsable licenciado", () => {
  it("solo nace de una licencia comprobada y queda debajo de soporte", async () => {
    const licencia = await licenciaConResponsable();

    expect(cuentaResponsableDeLicencia(licencia, false, SUCURSAL, true)).toBeNull();

    const cuenta = cuentaResponsableDeLicencia(licencia, true, SUCURSAL, true)!;
    expect(cuenta.usuario).toMatchObject({
      id: USUARIO_RESPONSABLE_ID,
      nombre: "Responsable Rodizio",
      rol_id: "propietario",
      puesto: PUESTO_RESPONSABLE,
      debe_cambiar_credencial: true,
    });
    expect(await verificarCredencial(PIN_DE_PRUEBA, cuenta.credencial)).toBe(true);
    expect(puedeGestionarA(usuarioSoporte(SUCURSAL), cuenta.usuario)).toBe(true);
    expect(puedeGestionarA(cuenta.usuario, usuarioSoporte(SUCURSAL))).toBe(false);
  });

  it("rechaza un perfil malformado aunque haya llegado desde el archivo", async () => {
    const licencia = await licenciaConResponsable();
    // En una constante y no leyendo `licencia.responsable` dentro del propio
    // literal: ahí sigue siendo opcional para el compilador, y `tsc --noEmit`
    // rechazaba el archivo entero.
    const responsable = licencia.responsable!;
    licencia.responsable = {
      ...responsable,
      credencial: null as unknown as typeof responsable.credencial,
    };

    expect(cuentaResponsableDeLicencia(licencia, true, SUCURSAL, false)).toBeNull();
  });
});

// --- El primer arranque del restaurante ------------------------------------------------

/**
 * La pregunta que decide si MotRest abre pidiendo el alta del responsable o
 * pidiendo un PIN. Cada caso de aquí es un restaurante real en un estado real.
 */
describe("cuándo hay que dar de alta al responsable", () => {
  const mesero = (extra: Partial<Usuario> = {}): Usuario => ({
    id: "usr-mesero",
    nombre: "Lucía",
    iniciales: "L",
    rol_id: "mesero",
    puesto: "Mesera",
    sucursal_id: SUCURSAL,
    permisos: permisosDePlantilla("mesero"),
    activo: true,
    ...extra,
  });

  const conPin = () => true;
  const sinPin = () => false;

  /* Instalación recién hecha: no hay nadie, hay que crear al dueño. */
  it("sí, cuando el local no tiene ningún usuario", () => {
    expect(requiereAltaDeResponsable([], conPin)).toBe(true);
  });

  /* Un usuario sin hash guardado no puede entrar: la puerta sigue cerrada. */
  it("sí, cuando el usuario que hay no tiene credencial", () => {
    expect(requiereAltaDeResponsable([mesero()], sinPin)).toBe(true);
  });

  /*
   * EL CASO QUE MOTIVA TODO ESTO. La cuenta que MOTRAE preparó en la licencia
   * existe y tiene hash, pero su PIN lo conoce quien la provisionó, no el
   * restaurante. Si contara como usable, el local abriría pidiendo un PIN que
   * quizá nadie le dictó — y no habría forma de entrar.
   */
  it("sí, cuando la única cuenta es la que MOTRAE provisionó y nadie estrenó", () => {
    const licenciado = usuarioResponsable(
      { id: USUARIO_RESPONSABLE_ID, nombre: "Responsable Rodizio", puesto: PUESTO_RESPONSABLE },
      SUCURSAL,
      true,
    );
    expect(requiereAltaDeResponsable([licenciado], conPin)).toBe(true);
  });

  /* Ya eligió su PIN: a partir de aquí se entra como todos, con la lista. */
  it("no, en cuanto el responsable estrena su PIN", () => {
    const responsable = usuarioResponsable(
      { id: USUARIO_RESPONSABLE_ID, nombre: "Ana Ruiz", puesto: PUESTO_RESPONSABLE },
      SUCURSAL,
      false,
    );
    expect(requiereAltaDeResponsable([responsable], conPin)).toBe(false);
  });

  /*
   * EL CANDADO. Un local que ya opera —aunque su propietario tenga un cambio de
   * PIN pendiente— no puede volver a esta pantalla: sería fabricar un segundo
   * dueño del negocio en un restaurante con personal dentro.
   */
  it("no, cuando hay cualquier otro empleado con su PIN estrenado", () => {
    const pendiente = usuarioResponsable(
      { id: USUARIO_RESPONSABLE_ID, nombre: "Ana Ruiz", puesto: PUESTO_RESPONSABLE },
      SUCURSAL,
      true,
    );
    expect(requiereAltaDeResponsable([pendiente, mesero()], conPin)).toBe(false);
  });

  /* Una cuenta desactivada no abre el sistema, así que tampoco cuenta. */
  it("sí, cuando el único usuario con PIN está desactivado", () => {
    expect(requiereAltaDeResponsable([mesero({ activo: false })], conPin)).toBe(true);
  });
});
