/**
 * Borrar a alguien de la plantilla, en definitiva.
 *
 * Es la única operación de usuarios que NO se deshace, así que lo que se prueba
 * aquí es sobre todo quién no puede hacerla y qué sobrevive después de hacerla.
 *
 * La regla del negocio, en una línea: **la decide la dirección del restaurante**
 * —el rango más alto— y **no borra la bitácora**. Lo primero evita que un
 * gerente enfadado deshaga la plantilla un viernes; lo segundo es lo que
 * mantiene el sistema útil para aclarar un faltante de caja tres meses después.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { permisosDePlantilla, type Permiso, type Usuario } from "@motrest/dominio";
import { arranque } from "../persistencia/arranque.svelte";
import { sesion } from "../sesion/sesion.svelte";
import { credencialesDeDemostracion } from "../sesion/usuarios";

const CONTRASENA_PROPIETARIO = credencialesDeDemostracion().contrasena;

let contador = 500;
let gerente: Usuario;
let mesero: Usuario;
let PIN_GERENTE = "";
let PIN_MESERO = "";

async function alta(
  nombre: string,
  rol: "gerente" | "mesero",
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
  if (!r.ok) throw new Error(`No se pudo crear a ${nombre}: ${r.error}`);
  return sesion.usuarios.find((u) => u.nombre === nombre)!;
}

beforeAll(async () => {
  await arranque.iniciar();
});

beforeEach(async () => {
  await sesion.iniciarSesion("usr-gonzalo", CONTRASENA_PROPIETARIO);
  contador += 1;
  PIN_GERENTE = `${contador}9`;
  PIN_MESERO = `${contador}7`;
  gerente = await alta(`Gerente ${contador}`, "gerente", PIN_GERENTE);
  mesero = await alta(`Mesero ${contador}`, "mesero", PIN_MESERO);
});

describe("la dirección elimina a alguien de la plantilla", () => {
  it("desaparece de la lista de usuarios", () => {
    expect(sesion.eliminarUsuario(mesero.id).ok).toBe(true);
    expect(sesion.usuarios.some((u) => u.id === mesero.id)).toBe(false);
  });

  /*
   * Lo que de verdad importa: su PIN deja de abrir.
   *
   * Sacarlo de la lista sin destruir su credencial sería peor que no hacer
   * nada, porque el diálogo de autorización no busca por la lista sino por
   * credencial: un empleado despedido seguiría firmando cancelaciones.
   */
  it("y su PIN deja de servir para entrar", async () => {
    sesion.eliminarUsuario(mesero.id);

    const entrada = await sesion.iniciarSesion(mesero.id, PIN_MESERO);
    expect(entrada.ok).toBe(false);
  });

  /* La bitácora solo agrega: el borrado se registra con quién lo firmó. */
  it("queda escrito quién lo eliminó y a quién", () => {
    const nombre = mesero.nombre;
    sesion.eliminarUsuario(mesero.id);

    const anotado = sesion.eventos.find(
      (e) => e.tipo === "usuario_eliminado" && e.usuario_id === mesero.id,
    );
    expect(anotado).toBeDefined();
    expect(anotado).toMatchObject({ eliminado_por: "usr-gonzalo", nombre });
  });
});

describe("quién NO puede eliminar", () => {
  it("un gerente no puede: no es el rango más alto", async () => {
    await sesion.iniciarSesion(gerente.id, PIN_GERENTE);

    const r = sesion.eliminarUsuario(mesero.id);
    expect(r.ok).toBe(false);
    expect(sesion.usuarios.some((u) => u.id === mesero.id)).toBe(true);
  });

  /*
   * Ni siquiera el propietario se borra a sí mismo. Dejaría al restaurante sin
   * nadie que administre —el propietario es el ancla de confianza del sistema—
   * y sería el camino más corto para que una cuenta comprometida borre su
   * propio rastro.
   */
  it("nadie se elimina a sí mismo, tampoco la dirección", () => {
    const r = sesion.eliminarUsuario("usr-gonzalo");
    expect(r.ok).toBe(false);
    expect(sesion.usuarios.some((u) => u.id === "usr-gonzalo")).toBe(true);
  });

  it("un gerente tampoco puede eliminar a otro gerente", async () => {
    const otro = await alta(`Gerente par ${contador}`, "gerente", `${contador}5`);
    await sesion.iniciarSesion(gerente.id, PIN_GERENTE);

    expect(sesion.eliminarUsuario(otro.id).ok).toBe(false);
  });
});

describe("lo que la interfaz debe poder preguntar", () => {
  it("puedeEliminar dice que sí a la dirección sobre alguien por debajo", () => {
    expect(sesion.puedeEliminar(mesero.id)).toBe(true);
  });

  it("y que no sobre uno mismo", () => {
    expect(sesion.puedeEliminar("usr-gonzalo")).toBe(false);
  });

  it("ni cuando quien pregunta es un gerente", async () => {
    await sesion.iniciarSesion(gerente.id, PIN_GERENTE);
    expect(sesion.puedeEliminar(mesero.id)).toBe(false);
  });
});
