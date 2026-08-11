/**
 * El primer arranque de un restaurante REAL, de principio a fin.
 *
 * ## Por qué este archivo existe aparte
 *
 * Todas las demás pruebas corren en `MODO_DEMO`, donde el local nace con Gonzalo,
 * Marco y Lucía ya sembrados y con credenciales conocidas. Eso es cómodo para
 * probar la operación, pero **oculta exactamente el camino que recorre un
 * restaurante nuevo**: en producción no hay ni un usuario, y de ahí salió el
 * problema real —una caja instalada que enseñaba «Gonzalo DJA» en la pantalla de
 * acceso y ninguna contraseña que sirviera para entrar—.
 *
 * Aquí se apaga `MODO_DEMO` con `vi.mock` para arrancar como arranca el
 * instalador, y se recorre el flujo completo: abrir sin nadie, crear la cuenta del
 * responsable, entrar a todo, y volver a abrir el software al día siguiente.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

/*
 * Producción, no demostración. Se conserva todo lo demás del módulo —la sucursal,
 * el id de dispositivo— porque lo único que cambia en un local real es que no
 * viene sembrado con usuarios de juguete.
 */
vi.mock("../presentacion", async (original) => ({
  ...(await original<typeof import("../presentacion")>()),
  MODO_DEMO: false,
}));

import {
  crearCredencial,
  emitirLicencia,
  generarPar,
  permisosDePlantilla,
  streamIdentidad,
  FabricaEventos,
  PUESTO_RESPONSABLE,
  USUARIO_RESPONSABLE_ID,
  type EventoIdentidad,
  type Licencia,
} from "@motrest/dominio";
import { almacenIndexedDB } from "@motrest/protocolo-sync";
import { arranque } from "../persistencia/arranque.svelte";
import { sesion } from "../sesion/sesion.svelte";

const PIN = "472913";

/**
 * Cierra y vuelve a abrir la aplicación.
 *
 * Rehacer el grafo de módulos es la forma honesta de simularlo: los stores nacen
 * de cero, como cuando el instalador vuelve a levantar la ventana. Lo que NO se
 * borra es IndexedDB —el disco del equipo—, que es justo lo que tiene que
 * sobrevivir.
 */
async function volverAAbrir(): Promise<typeof sesion> {
  vi.resetModules();
  const { arranque: nuevoArranque } = await import("../persistencia/arranque.svelte");
  const { sesion: nuevaSesion } = await import("../sesion/sesion.svelte");
  await nuevoArranque.iniciar();
  expect(nuevoArranque.error).toBe("");
  return nuevaSesion;
}

describe("un restaurante que se instala hoy", () => {
  beforeAll(async () => {
    await arranque.iniciar();
    expect(arranque.error).toBe("");
  });

  /*
   * EL PUNTO DE PARTIDA. Ni un usuario, y por tanto ninguna credencial: nada de
   * lo que va dentro del instalador sirve para entrar a ningún local.
   */
  it("abre sin ningún usuario y sin sesión", () => {
    expect(sesion.usuariosDelLocal).toHaveLength(0);
    expect(sesion.autenticado).toBe(false);
  });

  it("pide dar de alta al responsable en vez de pedir un PIN", () => {
    expect(sesion.requiereAltaInicial).toBe(true);
    expect(sesion.responsablePendiente).toBeUndefined();
  });

  it("crea la cuenta con el PIN que elige el restaurante y lo deja dentro", async () => {
    const r = await sesion.crearResponsableInicial({ nombre: "Ana Ruiz", pin: PIN });
    expect(r.ok).toBe(true);

    expect(sesion.usuarioActual).toMatchObject({
      id: USUARIO_RESPONSABLE_ID,
      nombre: "Ana Ruiz",
      rol_id: "propietario",
      puesto: PUESTO_RESPONSABLE,
    });
    // No hay nada que cambiar después: el PIN lo eligió él y nadie más lo conoce.
    expect(sesion.debeCambiarCredencial).toBe(false);
    // Y la pantalla de alta no vuelve a salir.
    expect(sesion.requiereAltaInicial).toBe(false);
  });

  /* «Luego pueda entrar a todo el software»: los nueve módulos, no solo el POS. */
  it("desde el primer momento tiene acceso a todo", () => {
    for (const accion of [
      "pos.orden.abrir",
      "cocina.receta.ver",
      "inv.existencias.ver",
      "compras.proveedor.editar",
      "fin.corte.ver",
      "rrhh.empleado.editar",
      "crm.cliente.ver",
      "admin.usuario.crear",
    ] as const) {
      expect(sesion.puedeVer(accion)).toBe(true);
    }
  });

  /*
   * El alta es un hecho del negocio, no una casilla en un archivo de estado: va al
   * event log, firmada por el propio responsable, y de ahí la lee el Hub.
   */
  it("el alta queda en la bitácora a nombre del responsable", () => {
    const alta = sesion.eventos.find(
      (evento): evento is Extract<EventoIdentidad, { tipo: "usuario_creado" }> =>
        evento.tipo === "usuario_creado",
    );
    expect(alta).toMatchObject({
      usuario_id: USUARIO_RESPONSABLE_ID,
      nombre: "Ana Ruiz",
      rol_id: "propietario",
      empleado_id: USUARIO_RESPONSABLE_ID,
    });
  });

  /*
   * LA SEGUNDA APERTURA, que es la mitad de lo que se pidió: ya no se crea nada,
   * se elige de la lista y se marca el PIN. Y NO se entra de corrido: la sesión de
   * anoche no puede seguir abierta esta mañana.
   */
  describe("al día siguiente, cuando se vuelve a abrir el software", () => {
    let despues: typeof sesion;

    beforeAll(async () => {
      despues = await volverAAbrir();
    });

    it("muestra la lista de usuarios y pide identificarse", () => {
      expect(despues.requiereAltaInicial).toBe(false);
      expect(despues.autenticado).toBe(false);
      expect(despues.usuariosDelLocal).toHaveLength(1);
      expect(despues.usuariosDelLocal[0]).toMatchObject({ nombre: "Ana Ruiz" });
    });

    /* Y con PIN, no con contraseña: es lo que hace que salga el teclado numérico. */
    it("la credencial del responsable es un PIN", () => {
      expect(despues.tipoCredencialDe(USUARIO_RESPONSABLE_ID)).toBe("pin");
    });

    it("entra con el PIN que eligió y no con ningún otro", async () => {
      expect((await despues.iniciarSesion(USUARIO_RESPONSABLE_ID, "000000")).ok).toBe(false);

      const r = await despues.iniciarSesion(USUARIO_RESPONSABLE_ID, PIN);
      expect(r.ok).toBe(true);
      expect(despues.usuarioActual?.nombre).toBe("Ana Ruiz");
    });

    /*
     * EL CANDADO. Con el local ya en marcha, el alta inicial no puede volver a
     * servir para fabricarse un segundo propietario.
     */
    it("el alta inicial ya no se puede volver a usar", async () => {
      const r = await despues.crearResponsableInicial({ nombre: "Intruso", pin: "998877" });
      expect(r.ok).toBe(false);
      expect(despues.usuariosDelLocal).toHaveLength(1);
    });
  });
});

// --- El otro camino: el local llega con el responsable ya provisionado ------------------

const PIN_ELEGIDO = "581204";

/**
 * Cuando Gonzalo da de alta el restaurante en MotRest Central, la licencia firmada
 * llega con el nombre del responsable y un PIN de ocho dígitos. Ese PIN hay que
 * dictarlo por teléfono, y es la fricción que se quiso quitar: el nombre se
 * respeta —lo firmó MOTRAE— pero el PIN lo elige el restaurante en la caja.
 */
describe("un restaurante cuya licencia ya trae al responsable", () => {
  let despues: typeof sesion;

  async function licenciaConResponsable(): Promise<Licencia> {
    const credencial = await crearCredencial(USUARIO_RESPONSABLE_ID, "28164937", "pin");
    const { privada } = await generarPar();
    return emitirLicencia(
      {
        sucursal_id: "suc-rodizio-centro",
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
      privada,
    );
  }

  beforeAll(async () => {
    // Equipo nuevo: disco en blanco. Y es la CAJA, así que el Hub le sirve la
    // licencia con las cuentas que MOTRAE firmó (`verificada` la decide el Hub).
    globalThis.indexedDB = new IDBFactory();
    const licencia = await licenciaConResponsable();
    (globalThis as { __MOTREST_HUB__?: unknown }).__MOTREST_HUB__ = { url: "https://localhost:8787" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("/licencia")
          ? new Response(JSON.stringify({ licencia, verificada: true }), { status: 200 })
          : new Response("{}", { status: 404 }),
      ),
    );
  });

  it("no pide el nombre otra vez: enseña el que firmó MOTRAE y pide el PIN", async () => {
    const caja = await volverAAbrir();

    expect(caja.requiereAltaInicial).toBe(true);
    expect(caja.responsablePendiente).toMatchObject({
      id: USUARIO_RESPONSABLE_ID,
      nombre: "Responsable Rodizio",
    });

    // El nombre que se le pase da igual: manda el perfil firmado.
    const r = await caja.crearResponsableInicial({ nombre: "Otro Nombre", pin: PIN_ELEGIDO });
    expect(r.ok).toBe(true);
    expect(caja.usuarioActual?.nombre).toBe("Responsable Rodizio");
    expect(caja.usuariosDelLocal).toHaveLength(1);
  });

  /*
   * EL CANDADO QUE IMPORTA. La caja vuelve a leer la MISMA licencia en cada
   * arranque. Si eso reaplicara la provisión, el restaurante perdería el PIN que
   * eligió y volvería a depender de uno que MOTRAE le dictó por teléfono.
   */
  it("volver a abrir con la misma licencia no le pisa el PIN elegido", async () => {
    despues = await volverAAbrir();

    expect(despues.requiereAltaInicial).toBe(false);
    expect(despues.debeCambiarCredencial).toBe(false);
    expect((await despues.iniciarSesion(USUARIO_RESPONSABLE_ID, "28164937")).ok).toBe(false);
    expect((await despues.iniciarSesion(USUARIO_RESPONSABLE_ID, PIN_ELEGIDO)).ok).toBe(true);
  });

  /*
   * LA REGRESIÓN QUE REPORTÓ GONZALO: «cada que entro me vuelve a salir la
   * pantalla de bienvenida».
   *
   * Pasa cuando Central repone el acceso del responsable —al cobrar, o porque le
   * dictaron un PIN nuevo—: la licencia llega con otra provisión, la caja la
   * aplica con «debe cambiar credencial» y de pronto NINGUNA cuenta cuenta como
   * usable. El alta inicial es la respuesta equivocada a eso: lo que hay que
   * pedir es el PIN nuevo, no crear un segundo dueño encima del que ya existe.
   *
   * El local se da por estrenado en cuanto hay un `credencial_cambiada` en su
   * log, y a partir de ahí esa pantalla no vuelve nunca.
   */
  it("una provisión NUEVA de Central no resucita la pantalla de bienvenida", async () => {
    const credencial = await crearCredencial(USUARIO_RESPONSABLE_ID, "77665544", "pin");
    const { privada } = await generarPar();
    const reemitida = await emitirLicencia(
      {
        sucursal_id: "suc-rodizio-centro",
        nombre: "Rodizio",
        plan: "mensual",
        vence_ts: Date.now() + 30 * 86_400_000,
        gracia_dias: 3,
        emitida_ts: Date.now(),
        responsable: {
          id: USUARIO_RESPONSABLE_ID,
          nombre: "Responsable Rodizio",
          puesto: PUESTO_RESPONSABLE,
          // Provisión distinta: es exactamente lo que cambia al reponer el acceso.
          provision_id: "018f8fe4-6740-7d0d-98b5-a4a3e0000002",
          credencial,
        },
      },
      privada,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("/licencia")
          ? new Response(JSON.stringify({ licencia: reemitida, verificada: true }), { status: 200 })
          : new Response("{}", { status: 404 }),
      ),
    );

    const reprovisionada = await volverAAbrir();

    // Lo que NO puede pasar: volver a pedir que se cree el usuario del local.
    expect(reprovisionada.requiereAltaInicial).toBe(false);
    expect(reprovisionada.yaEstrenado).toBe(true);
    // Y sigue habiendo un solo dueño, con su nombre.
    expect(reprovisionada.usuariosDelLocal).toHaveLength(1);
    expect(reprovisionada.usuariosDelLocal[0]).toMatchObject({ nombre: "Responsable Rodizio" });
    // Lo que SÍ pasa: el acceso repuesto vale y hay que cambiarlo al entrar.
    expect((await reprovisionada.iniciarSesion(USUARIO_RESPONSABLE_ID, "77665544")).ok).toBe(true);
    expect(reprovisionada.debeCambiarCredencial).toBe(true);
  });
});

// --- La caja que ya está instalada y se actualiza ---------------------------------------

/**
 * ESTE ES EL CASO DE RODIZIO HOY, y el que de verdad hay que arreglar.
 *
 * Su caja tiene en el disco un alta de «Gonzalo DJA» —el propietario que sembraban
 * las versiones anteriores— y ninguna credencial que sirva para entrar: la
 * pantalla de claves generadas nunca llegó a aparecer. Al actualizar, esa caja
 * tiene que poder salir del bloqueo Y quedarse con el nombre del dueño real, no
 * con el de la semilla de MOTRAE.
 */
describe("una caja instalada con el propietario heredado y sin credencial", () => {
  let caja: typeof sesion;

  beforeAll(async () => {
    globalThis.indexedDB = new IDBFactory();
    delete (globalThis as { __MOTREST_HUB__?: unknown }).__MOTREST_HUB__;
    vi.unstubAllGlobals();

    // El disco tal como lo dejó la versión anterior: el alta en el log, y nada
    // más. Y desactivado, que es el caso peor: sin tratarlo, el alta añadiría una
    // SEGUNDA entrada con el mismo id y la cuenta volvería a desactivarse sola al
    // reproyectar el log — el local quedaría fuera otra vez y en bucle.
    const almacen = await almacenIndexedDB();
    const stream = streamIdentidad("suc-rodizio-centro");
    const fabrica = new FabricaEventos<EventoIdentidad>({
      device_id: "dev-caja-vieja",
      empleado_id: USUARIO_RESPONSABLE_ID,
      sucursal_id: "suc-rodizio-centro",
    });
    await almacen.eventos.anexar([
      fabrica.crear("usuario_creado", stream, {
        usuario_id: USUARIO_RESPONSABLE_ID,
        nombre: "Gonzalo DJA",
        puesto: "Dirección General",
        rol_id: "propietario",
        permisos: permisosDePlantilla("propietario"),
      }),
      fabrica.crear("usuario_actualizado", stream, {
        usuario_id: USUARIO_RESPONSABLE_ID,
        cambios: { activo: false },
      }),
    ]);

    caja = await volverAAbrir();
  });

  it("no la deja fuera: ofrece el alta en vez de pedir una clave que nadie vio", () => {
    expect(caja.requiereAltaInicial).toBe(true);
    // Y pide el nombre, porque este propietario NO viene de una licencia firmada.
    expect(caja.responsablePendiente).toBeUndefined();
  });

  it("renombra la cuenta heredada con el nombre del dueño real", async () => {
    const r = await caja.crearResponsableInicial({ nombre: "Ana Ruiz", pin: "334455" });
    expect(r.ok).toBe(true);

    // La misma cuenta, no una segunda: el local sigue teniendo un solo
    // propietario. Se mira la lista COMPLETA —la que incluye desactivados—
    // porque un id duplicado no se vería en la lista de la pantalla.
    expect(caja.usuarios.filter((u) => u.id === USUARIO_RESPONSABLE_ID)).toHaveLength(1);
    expect(caja.usuariosDelLocal).toHaveLength(1);
    expect(caja.usuariosDelLocal[0]).toMatchObject({
      id: USUARIO_RESPONSABLE_ID,
      nombre: "Ana Ruiz",
      puesto: PUESTO_RESPONSABLE,
      rol_id: "propietario",
    });
  });

  it("y el nombre nuevo sobrevive a cerrar y volver a abrir", async () => {
    const otroDia = await volverAAbrir();

    expect(otroDia.requiereAltaInicial).toBe(false);
    expect(otroDia.usuariosDelLocal).toHaveLength(1);
    expect(otroDia.usuariosDelLocal[0]).toMatchObject({ nombre: "Ana Ruiz", activo: true });
    expect((await otroDia.iniciarSesion(USUARIO_RESPONSABLE_ID, "334455")).ok).toBe(true);
  });
});
