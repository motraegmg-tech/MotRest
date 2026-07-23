/**
 * Restablecer una credencial olvidada, con la firma de un superior.
 *
 * Es el caso de todos los días —un mesero olvida su PIN a media tarde— y a la
 * vez la puerta más delicada del sistema: quien pueda restablecer credenciales
 * ajenas puede entrar como cualquiera. Lo que se prueba aquí es sobre todo
 * quién NO puede.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_INTENTOS, permisosDePlantilla, type Permiso, type Usuario } from "@motrest/dominio";
import { arranque } from "../persistencia/arranque.svelte";
import { sesion } from "../sesion/sesion.svelte";

/*
 * PIN distintos en cada prueba.
 *
 * Los usuarios se acumulan a lo largo del archivo —cada `beforeEach` crea dos—
 * y `restablecerCredencial` busca al primer autorizador cuya clave coincida.
 * Con un PIN compartido, quien firmaba podía ser el gerente de una prueba
 * anterior, y la comprobación de quién autorizó se volvía mentira.
 */
let PIN_GERENTE = "";
let PIN_MESERO = "";
let contador = 100;

/** Alta de un usuario con PIN conocido, saltándose la interfaz. */
async function alta(
  nombre: string,
  rol: "gerente" | "mesero" | "cajero",
  pin: string,
  permisos?: Permiso[],
): Promise<Usuario> {
  const r = await sesion.crearUsuario({
    nombre,
    rol_id: rol,
    puesto: rol,
    pin,
    permisos: permisos ?? permisosDePlantilla(rol),
  });
  // El motivo importa: un alta rechazada sin decir por qué manda a depurar a ciegas.
  if (!r.ok) throw new Error(`No se pudo crear a ${nombre}: ${r.error}`);
  return sesion.usuarios.find((u) => u.nombre === nombre)!;
}

/** Permisos de un rol, elevando una acción concreta a «autorizar». */
function conAutorizacion(rol: "gerente" | "mesero" | "cajero"): Permiso[] {
  const base = permisosDePlantilla(rol).filter((p) => p.accion !== "admin.credencial.autorizar");
  return [...base, { accion: "admin.credencial.autorizar", nivel: "autorizar" }];
}

let gerente: Usuario;
let mesero: Usuario;

beforeAll(async () => {
  await arranque.iniciar();
});

beforeEach(async () => {
  // El propietario es quien puede dar de alta a los demás.
  await sesion.iniciarSesion("usr-gonzalo", "MotCEO21");

  contador += 1;
  PIN_GERENTE = `${contador}9`;
  PIN_MESERO = `${contador}7`;

  gerente = await alta(`Gerente ${contador}`, "gerente", PIN_GERENTE, conAutorizacion("gerente"));
  mesero = await alta(`Mesero ${contador}`, "mesero", PIN_MESERO);
});

// --- El caso que se resuelve solo --------------------------------------------------------

describe("un mesero olvida su PIN", () => {
  it("el gerente lo autoriza y el PIN nuevo funciona", async () => {
    const r = await sesion.restablecerCredencial(mesero.id, "9090", "pin", PIN_GERENTE);
    expect(r.ok).toBe(true);

    const entrada = await sesion.iniciarSesion(mesero.id, "9090");
    expect(entrada.ok).toBe(true);
  });

  it("el PIN viejo deja de servir", async () => {
    await sesion.restablecerCredencial(mesero.id, "9090", "pin", PIN_GERENTE);

    const conElViejo = await sesion.iniciarSesion(mesero.id, PIN_MESERO);
    expect(conElViejo.ok).toBe(false);
  });

  /*
   * Quien olvidó su PIN suele haber gastado intentos tratando de recordarlo.
   * Restablecerlo sin borrar esa cuenta dejaría el problema igual.
   *
   * No se fuerza el bloqueo completo: el sistema frena los reintentos rápidos
   * antes de contarlos —y hace bien—, así que una prueba que lo intentara
   * estaría midiendo el freno y no lo que interesa.
   */
  it("restablecerlo borra los intentos fallidos acumulados", async () => {
    await sesion.iniciarSesion(mesero.id, "0000");
    expect(sesion.intentosRestantes(mesero.id)).toBeLessThan(MAX_INTENTOS);

    await sesion.restablecerCredencial(mesero.id, "9090", "pin", PIN_GERENTE);

    expect(sesion.intentosRestantes(mesero.id)).toBe(MAX_INTENTOS);
    expect(sesion.estaBloqueado(mesero.id)).toBe(false);
  });

  it("queda en la bitácora quién lo autorizó", async () => {
    await sesion.restablecerCredencial(mesero.id, "9090", "pin", PIN_GERENTE);

    const ultimo = [...sesion.eventos].reverse().find((e) => e.tipo === "credencial_cambiada");
    expect(ultimo).toMatchObject({ usuario_id: mesero.id, autorizador_id: gerente.id });
  });
});

// --- Identidad de los usuarios nuevos ----------------------------------------------------

describe("cada usuario tiene su propio identificador", () => {
  /*
   * Esta prueba nació de un fallo real: el id se armaba con los primeros 8
   * caracteres de un UUIDv7, que son SOLO la marca de tiempo en milisegundos.
   * Dar de alta a dos personas seguidas —lo normal al registrar al personal—
   * les daba el mismo id, y el segundo pisaba las credenciales del primero.
   */
  it("dos altas en el mismo instante no colisionan", async () => {
    const marca = Date.now();
    const uno = await alta(`Uno ${marca}`, "mesero", "1123", permisosDePlantilla("mesero"));
    const dos = await alta(`Dos ${marca}`, "mesero", "2234", permisosDePlantilla("mesero"));

    expect(uno.id).not.toBe(dos.id);
  });

  it("y cada uno conserva SU credencial", async () => {
    const marca = Date.now();
    const uno = await alta(`Tres ${marca}`, "mesero", "1212", permisosDePlantilla("mesero"));
    const dos = await alta(`Cuatro ${marca}`, "mesero", "3434", permisosDePlantilla("mesero"));

    expect((await sesion.iniciarSesion(uno.id, "1212")).ok).toBe(true);
    expect((await sesion.iniciarSesion(dos.id, "3434")).ok).toBe(true);
  });
});

// --- Quién NO puede ----------------------------------------------------------------------

describe("los candados", () => {
  it("una clave que no es de nadie no autoriza nada", async () => {
    const r = await sesion.restablecerCredencial(mesero.id, "9090", "pin", "000000");
    expect(r.ok).toBe(false);
    expect((await sesion.iniciarSesion(mesero.id, PIN_MESERO)).ok).toBe(true);
  });

  /*
   * Tener el PIN no basta: hace falta el permiso. Un cajero puede cobrar y
   * autorizar descuentos sin que eso lo habilite para tocar credenciales.
   */
  it("sin el permiso «Autorizar cambio de PIN» no se puede firmar", async () => {
    const cajero = await alta(`Cajero ${Date.now()}`, "cajero", "5567");
    expect(cajero).toBeDefined();

    const r = await sesion.restablecerCredencial(mesero.id, "9090", "pin", "5567");
    expect(r.ok).toBe(false);
  });

  /*
   * ESTE es el candado que evita una toma de control. Sin él, un gerente con
   * permiso de credenciales podría restablecer la contraseña del dueño y
   * entrar como él.
   */
  it("nadie puede restablecer la credencial de un rango igual o superior", async () => {
    const r = await sesion.restablecerCredencial(
      "usr-gonzalo",
      "otracosa123",
      "contrasena",
      PIN_GERENTE,
    );
    expect(r.ok).toBe(false);

    // La del propietario sigue siendo la suya.
    expect((await sesion.iniciarSesion("usr-gonzalo", "MotCEO21")).ok).toBe(true);
  });

  it("un gerente tampoco puede restablecer la de otro gerente", async () => {
    const otro = await alta(`Gerente B ${Date.now()}`, "gerente", "112233");

    const r = await sesion.restablecerCredencial(otro.id, "9090", "pin", PIN_GERENTE);
    expect(r.ok).toBe(false);
  });

  it("un PIN nuevo que no cumple las reglas se rechaza antes de tocar nada", async () => {
    const r = await sesion.restablecerCredencial(mesero.id, "1", "pin", PIN_GERENTE);
    expect(r.ok).toBe(false);
    expect((await sesion.iniciarSesion(mesero.id, PIN_MESERO)).ok).toBe(true);
  });
});

// --- Lo que ve la pantalla ---------------------------------------------------------------

describe("a quién se le ofrece el botón", () => {
  it("al mesero sí: hay quien pueda autorizarlo", () => {
    expect(sesion.hayQuienAutoriceCredencialDe(mesero)).toBe(true);
  });

  /*
   * Al propietario no, y no es un olvido: por encima de él no hay nadie. Su
   * contraseña la cambia él mismo estando dentro, desde el menú de usuario.
   */
  it("al propietario no: nadie lo supera en rango", () => {
    const propietario = sesion.usuarios.find((u) => u.id === "usr-gonzalo")!;
    expect(sesion.hayQuienAutoriceCredencialDe(propietario)).toBe(false);
  });
});

// --- Cambiar la propia -------------------------------------------------------------------

describe("cambiar la propia credencial estando dentro", () => {
  it("no necesita que nadie la autorice", async () => {
    await sesion.iniciarSesion(mesero.id, PIN_MESERO);

    const r = await sesion.cambiarCredencialPropia("4321", "pin");
    expect(r.ok).toBe(true);
    expect((await sesion.iniciarSesion(mesero.id, "4321")).ok).toBe(true);
  });

  /*
   * Es la única vía para el propietario, precisamente porque el
   * restablecimiento con firma le está vedado a todos.
   */
  it("el propietario puede cambiar la suya", async () => {
    await sesion.iniciarSesion("usr-gonzalo", "MotCEO21");

    const r = await sesion.cambiarCredencialPropia("NuevaClave2026", "contrasena");
    expect(r.ok).toBe(true);
    expect((await sesion.iniciarSesion("usr-gonzalo", "NuevaClave2026")).ok).toBe(true);

    // Se deja como estaba para no afectar a las demás pruebas.
    await sesion.cambiarCredencialPropia("MotCEO21", "contrasena");
  });
});
