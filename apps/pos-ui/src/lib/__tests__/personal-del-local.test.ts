/**
 * DE QUIÉN ES EL PERSONAL QUE SALE EN LA PANTALLA DE ACCESO.
 *
 * Lo reportó el programador que estrenaba el entorno: cerró sesión, volvió a
 * abrir y en «¿Quién eres?» le salieron «Gonzalo DJA», «Marco» y «Lucía» en vez
 * de la cuenta que él había configurado con su nombre y su PIN.
 *
 * No era la lista de nadie: era la SEMILLA de juguete de la compilación de
 * desarrollo, con sus PIN escritos en el código fuente. Salía porque la
 * identidad solo se rehidrataba cuando el log local tenía algo; una terminal
 * enlazada con un Hub arranca con el log vacío —espera a recibir la operación—
 * y se quedaba operando contra esa constante, sin leer su disco y sin escuchar
 * al Hub. Y de paso la sembraba en el log del local, así que los tres usuarios
 * de juguete acababan grabados en el Hub del restaurante.
 *
 * Este archivo corre en MODO_DEMO —la semilla existe— justamente porque es
 * donde el defecto se ve.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  FabricaEventos,
  crearCredencial,
  permisosDePlantilla,
  streamIdentidad,
  type Credencial,
  type EventoIdentidad,
  type ID,
} from "@motrest/dominio";
import { CLAVES, almacenIndexedDB, generarClaveLocal } from "@motrest/protocolo-sync";
import { credencialesDeDemostracion } from "../sesion/usuarios";

const CLAVE_LOCAL = generarClaveLocal();
const PIN_DEL_LOCAL = "740316";

/** Abre la aplicación de cero, como cuando se vuelve a levantar la ventana. */
async function abrir() {
  vi.resetModules();
  const { arranque } = await import("../persistencia/arranque.svelte");
  const { sesion } = await import("../sesion/sesion.svelte");
  await arranque.iniciar();
  expect(arranque.error).toBe("");
  return { arranque, sesion };
}

/** La URL con la que se empareja una terminal: dirección del Hub y clave. */
function terminalEnlazada(): void {
  vi.stubGlobal("location", {
    search: `?hub=ws://localhost:8787/sync&k=${CLAVE_LOCAL}`,
    pathname: "/",
    protocol: "https:",
    host: "localhost:5173",
    href: `https://localhost:5173/?hub=ws://localhost:8787/sync&k=${CLAVE_LOCAL}`,
  });
}

/**
 * El personal que el Hub le manda a la terminal, tal como llega: primero se
 * guarda en el log local y después se avisa a los stores.
 */
async function recibirDelHub(
  usuarios: readonly { id: ID; nombre: string; puesto: string }[],
): Promise<EventoIdentidad[]> {
  const almacen = await almacenIndexedDB();
  const fabrica = new FabricaEventos<EventoIdentidad>({
    device_id: "dev-caja-del-local",
    empleado_id: usuarios[0]!.id,
    sucursal_id: "suc-del-local",
  });
  const eventos = usuarios.map((u) =>
    fabrica.crear("usuario_creado", streamIdentidad("suc-del-local"), {
      usuario_id: u.id,
      nombre: u.nombre,
      puesto: u.puesto,
      rol_id: "propietario" as const,
      permisos: permisosDePlantilla("propietario"),
    }),
  );
  await almacen.eventos.anexar(eventos);
  return eventos;
}

describe("una terminal enlazada con el Hub del restaurante", () => {
  let sesion: Awaited<ReturnType<typeof abrir>>["sesion"];
  let arranque: Awaited<ReturnType<typeof abrir>>["arranque"];

  beforeAll(async () => {
    globalThis.indexedDB = new IDBFactory();
    terminalEnlazada();
    ({ arranque, sesion } = await abrir());
  });

  /* LA FOTO DEL DEFECTO. Esta lista es lo que el programador vio. */
  it("no ofrece a nadie mientras el Hub no le mande el personal", () => {
    expect(arranque.esperandoHub).toBe(true);
    expect(sesion.usuariosDelLocal).toEqual([]);
  });

  it("y los PIN de fábrica de la demostración no abren nada", async () => {
    const demo = credencialesDeDemostracion();
    expect((await sesion.iniciarSesion("usr-gonzalo", demo.contrasena)).ok).toBe(false);
    expect((await sesion.iniciarSesion("usr-lucia", "1234")).ok).toBe(false);
    expect(sesion.autenticado).toBe(false);
  });

  /*
   * LO QUE MÁS DAÑO HACÍA: la semilla se emitía como `usuario_creado` y viajaba
   * al Hub. Tres cuentas de juguete quedaban grabadas como personal del local, y
   * de ahí ya no salen solas ni cambiando a una compilación de producción.
   */
  it("no le mete al local ni un usuario inventado", async () => {
    const almacen = await almacenIndexedDB();
    const guardados = await almacen.eventos.leerTodos();
    const altas = guardados.filter((e) => e.tipo === "usuario_creado");
    expect(altas).toEqual([]);
  });

  /*
   * Y CUANDO EL HUB CONTESTA, la pantalla se entera SIN reiniciar la aplicación.
   * Antes los eventos se guardaban en el disco de la terminal y ahí se quedaban:
   * había que cerrar y volver a abrir para ver al propio personal.
   */
  it("enseña al personal del local en cuanto llega, sin reiniciar", async () => {
    const eventos = await recibirDelHub([
      { id: "usr-gonzalo", nombre: "Rubén Mora", puesto: "Responsable del restaurante" },
    ]);
    sesion.integrar(eventos);

    expect(sesion.usuariosDelLocal).toHaveLength(1);
    expect(sesion.usuariosDelLocal[0]).toMatchObject({
      id: "usr-gonzalo",
      nombre: "Rubén Mora",
      puesto: "Responsable del restaurante",
    });
  });
});

describe("la cuenta que el restaurante configuró", () => {
  let sesion: Awaited<ReturnType<typeof abrir>>["sesion"];

  beforeAll(async () => {
    globalThis.indexedDB = new IDBFactory();
    terminalEnlazada();

    // El disco tal como queda tras crear la cuenta: el alta en el log del local
    // y el PIN elegido en el almacén de secretos del equipo.
    const almacen = await almacenIndexedDB();
    await recibirDelHub([
      { id: "usr-gonzalo", nombre: "Rubén Mora", puesto: "Responsable del restaurante" },
    ]);
    const credencial = await crearCredencial("usr-gonzalo", PIN_DEL_LOCAL, "pin");
    await almacen.estado.guardar<Record<ID, Credencial[]>>(CLAVES.credenciales, {
      "usr-gonzalo": [credencial],
    });

    ({ sesion } = await abrir());
  });

  it("es la que sale al volver a abrir, y no la semilla", () => {
    expect(sesion.usuariosDelLocal.map((u) => u.nombre)).toEqual(["Rubén Mora"]);
  });

  /*
   * «Y guardarse». El PIN se perdía porque la terminal arrancaba con el mapa de
   * credenciales de la semilla y lo escribía ENCIMA del que tenía el equipo en
   * cuanto se conectaba el almacén.
   */
  it("y su PIN sigue sirviendo", async () => {
    expect((await sesion.iniciarSesion("usr-gonzalo", PIN_DEL_LOCAL)).ok).toBe(true);
    expect(sesion.usuarioActual?.nombre).toBe("Rubén Mora");
  });
});

/*
 * EL OTRO LADO: la demostración tiene que seguir sirviendo para lo que existe.
 * Un POS suelto —`dev:pos` sin enlazar con ningún Hub— no es el local de nadie,
 * así que ahí los usuarios de juguete no contaminan nada y ahorran el alta.
 */
describe("un POS suelto, sin Hub", () => {
  it("sigue naciendo con los usuarios de la demostración", async () => {
    globalThis.indexedDB = new IDBFactory();
    vi.stubGlobal("location", {
      search: "",
      pathname: "/",
      protocol: "https:",
      host: "localhost:5173",
      href: "https://localhost:5173/",
    });

    const { sesion } = await abrir();
    expect(sesion.usuariosDelLocal.map((u) => u.nombre)).toEqual(["Gonzalo DJA", "Marco", "Lucía"]);
  });
});
