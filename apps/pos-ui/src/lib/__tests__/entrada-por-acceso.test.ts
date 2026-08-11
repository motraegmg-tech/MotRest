/**
 * Abrir sesión checa la entrada, una sola vez al día.
 *
 * El checador supone una tablet en la puerta que en un local pequeño no existe:
 * la gente llega, abre su usuario en la caja y se pone a comandar. La prenómina
 * del sábado salía en ceros y había que reconstruirla de memoria.
 *
 * Lo que se prueba aquí es sobre todo lo que NO debe pasar: que ir y venir entre
 * usuarios durante el turno abra turnos nuevos e infle las horas de alguien. Ese
 * error no se ve en pantalla, se ve en el sobre del sábado.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { permisosDePlantilla, type Usuario } from "@motrest/dominio";
import { asistencia } from "../asistencia.svelte";
import { arranque } from "../persistencia/arranque.svelte";
import { sesion } from "../sesion/sesion.svelte";
import { credencialesDeDemostracion } from "../sesion/usuarios";

const CONTRASENA_PROPIETARIO = credencialesDeDemostracion().contrasena;

let contador = 500;
let mesero: Usuario;
let PIN = "";

beforeAll(async () => {
  await arranque.iniciar();
});

beforeEach(async () => {
  await sesion.iniciarSesion("usr-gonzalo", CONTRASENA_PROPIETARIO);

  contador += 1;
  PIN = `${contador}3`;
  const r = await sesion.crearUsuario({
    nombre: `Mesero ${contador}`,
    rol_id: "mesero",
    puesto: "mesero",
    pin: PIN,
    permisos: permisosDePlantilla("mesero"),
  });
  if (!r.ok) throw new Error(`No se pudo crear al mesero: ${r.error}`);
  mesero = sesion.usuarios.find((u) => u.nombre === `Mesero ${contador}`)!;

  sesion.cerrarSesion();
});

describe("la entrada se checa sola al iniciar sesión", () => {
  it("el primer acceso del día registra la entrada", async () => {
    expect(asistencia.checadas(mesero.id)).toHaveLength(0);

    await sesion.iniciarSesion(mesero.id, PIN);

    const suyas = asistencia.checadas(mesero.id);
    expect(suyas).toHaveLength(1);
    expect(suyas[0]!.tipo).toBe("entrada");
    expect(asistencia.resumen(mesero.id).dentro).toBe(true);
  });

  /*
   * El caso que de verdad importa: la caja cambia de manos muchas veces por
   * turno. Cada vuelta no puede ser un turno nuevo.
   */
  it("volver a entrar durante el turno NO abre otro turno", async () => {
    await sesion.iniciarSesion(mesero.id, PIN);
    sesion.cerrarSesion();
    await sesion.iniciarSesion(mesero.id, PIN);
    sesion.cerrarSesion();
    await sesion.iniciarSesion(mesero.id, PIN);

    expect(asistencia.checadas(mesero.id)).toHaveLength(1);
    expect(asistencia.resumen(mesero.id).turnos).toBe(1);
  });

  it("después de checar salida, volver a la caja no le abre otra jornada", async () => {
    await sesion.iniciarSesion(mesero.id, PIN);
    asistencia.registrar(mesero.id, mesero.id, "salida");
    sesion.cerrarSesion();

    await sesion.iniciarSesion(mesero.id, PIN);

    // Entrada + salida, y nada más: entrar a consultar algo no es un turno.
    expect(asistencia.checadas(mesero.id)).toHaveLength(2);
    expect(asistencia.resumen(mesero.id).dentro).toBe(false);
  });

  it("la checada es del trabajador, no del dispositivo", async () => {
    await sesion.iniciarSesion(mesero.id, PIN);
    const checada = asistencia.checadas(mesero.id)[0]!;

    expect(checada.trabajador_id).toBe(mesero.id);
    expect(checada.capturada_por).toBe(mesero.id);
    // No es una corrección: nadie tuvo que autorizarla.
    expect(checada.corregida).toBe(false);
  });
});
