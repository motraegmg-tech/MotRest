/**
 * Reservas y ficha del comensal, conectadas (1.5.6).
 *
 * ## El defecto que estas pruebas cierran
 *
 * Una reserva apartada por teléfono no se ataba a NADIE. El campo `cliente_id`
 * existía en el dominio desde el primer día, pero solo lo llenaba el portal del
 * comensal; lo que se anotaba en la caja —que es casi todo— nacía como un
 * nombre suelto. Así, el cliente que reserva cada quince días entraba como
 * «Ramírez», «Familia Ramírez» y «Sra. Ramírez», con el teléfono escrito de tres
 * formas, y la ficha del comensal —que existe justo para saber quién viene— no
 * se enteraba de ninguna de las tres. Gonzalo: «quiero que reservas del comensal
 * y ficha del cliente estén conectadas».
 *
 * Lo que se prueba aquí es la mitad de la caja:
 *
 *  - que un teléfono que ya tiene ficha se ligue a ESA ficha, sin duplicarla, se
 *    dicte como se dicte —con lada, con `+52`, con espacios o con guiones—;
 *  - que si no hay ficha, apartar la cree con el nombre y el teléfono, y que la
 *    reserva quede ligada a ella;
 *  - que el viaje a «+ Nuevo cliente» y la vuelta no se lleve por delante lo que
 *    se estaba tecleando;
 *  - y que lo que llega del portal, que ya viene ligado, no cambie de dueño.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { FabricaEventos, streamReservas, type EventoReserva } from "@motrest/dominio";
import { clientes, mismoTelefono, telefonoClave, type ComoSeLigo } from "../clientes.svelte";
import { borrador } from "../modulos/clientes/borrador-de-reserva.svelte";
import { SUCURSAL_ID } from "../presentacion";
import { reservas } from "../reservas.svelte";

/** El viernes de las pruebas. Una fecha fija: las reservas se ordenan por hora. */
const VIERNES = new Date("2026-09-25T21:00:00").getTime();

/** Deja los dos almacenes y el borrador como recién arrancada la caja. */
beforeEach(() => {
  clientes.hidratar([]);
  reservas.hidratar([]);
  for (const quien of [...reservas.espera]) reservas.quitarDeEspera(quien.id);
  borrador.reserva = {
    abierto: false,
    cliente_id: undefined,
    nombre: "",
    telefono: "",
    correo: "",
    personas: "2",
    fecha: "2026-09-25",
    hora: "21:00",
    acomodo: "",
  };
  borrador.espera = { cliente_id: undefined, nombre: "", telefono: "", personas: "2" };
  borrador.cancelarViaje();
});

/** Una ficha de comensal ya dada de alta. */
function ficha(nombre: string, telefono?: string, correo?: string): string {
  const r = clientes.registrar({ nombre, telefono, correo });
  expect(r.ok).toBe(true);
  return r.id!;
}

/** Lo que hace la pantalla al pulsar «Apartar»: primero la ficha, luego la reserva. */
function apartarComoLaPantalla(datos: {
  cliente_id?: string;
  nombre: string;
  telefono?: string;
  correo?: string;
  personas?: number;
}): { ok: boolean; error?: string; cliente_id?: string; como?: ComoSeLigo } {
  const personas = datos.personas ?? 2;
  const problema = reservas.problemaAlApartar({ nombre: datos.nombre, personas });
  if (problema) return { ok: false, error: problema };

  const ligada = clientes.ligarFicha(datos);
  if (!ligada.ok) return { ok: false, error: ligada.error };

  const r = reservas.apartar({
    nombre: datos.nombre,
    telefono: datos.telefono,
    correo: datos.correo,
    cliente_id: ligada.id,
    personas,
    para_ts: VIERNES,
  });
  return { ...r, cliente_id: ligada.id, como: ligada.como };
}

describe("el teléfono reconoce al comensal", () => {
  it("un teléfono que ya tiene ficha se liga a ESA ficha, sin duplicarla", () => {
    const jose = ficha("José Pérez", "33 1122 3344");

    const ligada = clientes.ligarFicha({ nombre: "Familia Pérez", telefono: "3311223344" });

    expect(ligada.id).toBe(jose);
    expect(ligada.como).toBe("telefono");
    // La decisión de Gonzalo, escrita: no se duplica la ficha.
    expect(clientes.activos).toHaveLength(1);
  });

  it("da igual cómo se dicte el número: con lada, con +52, con espacios o guiones", () => {
    const jose = ficha("José Pérez", "+52 33 1122 3344");

    for (const dictado of ["3311223344", "33-1122-3344", "52 33 1122 3344", "521 3311223344"]) {
      expect(clientes.porTelefono(dictado)?.cliente_id).toBe(jose);
    }

    // Y el que NO es suyo no se le cuelga, aunque se parezca.
    expect(clientes.porTelefono("33 1122 3345")).toBeUndefined();
    expect(mismoTelefono("33 1122 3344", undefined)).toBe(false);
    expect(telefonoClave("  ")).toBeNull();
  });

  it("la ficha elegida a mano gana sobre lo que diga el teléfono", () => {
    const jose = ficha("José Pérez", "33 1122 3344");
    const ana = ficha("Ana Ruiz", "33 5566 7788");

    /*
     * Quien está atendiendo sabe más que la comparación de cadenas: apartó la
     * mesa para Ana y anotó el teléfono del marido. Si el sistema le cambiara la
     * ficha por su cuenta, la reserva saldría a nombre de otro.
     */
    const ligada = clientes.ligarFicha({
      cliente_id: ana,
      nombre: "Ana Ruiz",
      telefono: "33 1122 3344",
    });

    expect(ligada.id).toBe(ana);
    expect(ligada.id).not.toBe(jose);
    expect(ligada.como).toBe("elegida");
  });

  it("los plantones se cuentan aunque el número se escriba distinto", () => {
    const r = reservas.apartar({ nombre: "Toño", telefono: "33 1122 3344", personas: 2, para_ts: VIERNES });
    expect(r.ok).toBe(true);
    reservas.noLlego(reservas.reservas[0]!.id);

    // Antes se comparaban las cadenas tal cual: un espacio borraba el dato caro.
    expect(reservas.plantonesDe("3311223344")).toBe(1);
    expect(reservas.plantonesDe("+52 33 1122 3344")).toBe(1);
  });
});

describe("apartar mesa da de alta al que no tenía ficha", () => {
  it("crea la ficha con su nombre y su teléfono, y la reserva queda ligada", () => {
    const r = apartarComoLaPantalla({
      nombre: "Familia Ramírez",
      telefono: "33 9988 7766",
      correo: "ramirez@correo.mx",
      personas: 8,
    });

    expect(r.ok).toBe(true);
    expect(r.como).toBe("nueva");

    const nueva = clientes.activos[0]!;
    expect(clientes.activos).toHaveLength(1);
    expect(nueva.nombre).toBe("Familia Ramírez");
    expect(nueva.telefono).toBe("33 9988 7766");

    const reserva = reservas.reservas[0]!;
    expect(reserva.cliente_id).toBe(nueva.cliente_id);
    expect(reserva.personas).toBe(8);
  });

  it("la segunda reserva del mismo teléfono reutiliza la ficha que se creó", () => {
    apartarComoLaPantalla({ nombre: "Familia Ramírez", telefono: "33 9988 7766" });
    const segunda = apartarComoLaPantalla({ nombre: "Ramírez", telefono: "3399887766" });

    expect(segunda.como).toBe("telefono");
    expect(clientes.activos).toHaveLength(1);
    // Las dos reservas son de la misma persona, aunque se apuntaran distinto.
    const ligadas = new Set(reservas.reservas.map((r) => r.cliente_id));
    expect(ligadas.size).toBe(1);
  });

  it("sin teléfono no se inventa ninguna ficha", () => {
    /*
     * Una ficha con solo un nombre no se puede reconocer la próxima vez —se
     * duplicaría en cada reserva— y ensuciaría la lista de clientes con apuntes
     * de una noche. La reserva se guarda igual, como antes.
     */
    const r = apartarComoLaPantalla({ nombre: "Mesa de Toño" });

    expect(r.ok).toBe(true);
    expect(r.como).toBe("sin_ficha");
    expect(clientes.activos).toHaveLength(0);
    expect(reservas.reservas[0]!.cliente_id).toBeUndefined();
  });

  it("una reserva que no se puede guardar no deja una ficha suelta", () => {
    // «Personas» en cero: la reserva no se guarda, así que tampoco nace nadie.
    const r = apartarComoLaPantalla({
      nombre: "Familia Ramírez",
      telefono: "33 9988 7766",
      personas: 0,
    });

    expect(r.ok).toBe(false);
    expect(r.error).toBe("¿Cuántas personas vienen?");
    expect(clientes.activos).toHaveLength(0);
    expect(reservas.reservas).toHaveLength(0);
  });

  it("quien espera de pie también se reconoce, y su ficha llega a la mesa", () => {
    const jose = ficha("José Pérez", "33 1122 3344");
    const ligada = clientes.ligarFicha({ nombre: "José", telefono: "3311223344" });

    const r = reservas.anotarEnEspera({
      nombre: "José",
      telefono: "3311223344",
      cliente_id: ligada.id,
      personas: 4,
    });

    expect(r.ok).toBe(true);
    expect(reservas.espera[0]!.cliente_id).toBe(jose);
  });
});

describe("el viaje a «+ Nuevo cliente» y la vuelta", () => {
  it("lo tecleado sigue ahí al volver, y el cliente queda puesto", () => {
    /* Se estaba capturando la mesa del viernes a las 21:30 para ocho. */
    borrador.reserva.abierto = true;
    borrador.reserva.nombre = "Familia Ramírez";
    borrador.reserva.telefono = "33 9988 7766";
    borrador.reserva.personas = "8";
    borrador.reserva.hora = "21:30";
    borrador.reserva.acomodo = JSON.stringify(["m3", "m4"]);

    /* «+ Nuevo cliente»: lo tecleado viaja para prellenar el alta. */
    borrador.pedirFicha("reserva");
    expect(borrador.loTecleado()).toEqual({
      nombre: "Familia Ramírez",
      telefono: "33 9988 7766",
      correo: "",
    });

    /* Se guarda la ficha y se vuelve. */
    const nueva = ficha("Familia Ramírez", "33 9988 7766", "ramirez@correo.mx");
    const vuelve = borrador.recibirFicha({
      cliente_id: nueva,
      nombre: "Familia Ramírez",
      telefono: "33 9988 7766",
      correo: "ramirez@correo.mx",
    });

    expect(vuelve).toBe("reserva");
    expect(borrador.reserva.cliente_id).toBe(nueva);
    expect(borrador.reserva.correo).toBe("ramirez@correo.mx");
    /* Y lo que se llevaba escrito NO se perdió: era el defecto a evitar. */
    expect(borrador.reserva.abierto).toBe(true);
    expect(borrador.reserva.personas).toBe("8");
    expect(borrador.reserva.hora).toBe("21:30");
    expect(borrador.reserva.acomodo).toBe(JSON.stringify(["m3", "m4"]));
    expect(borrador.esperandoFicha).toBeNull();
  });

  it("volver sin guardar tampoco borra lo tecleado", () => {
    borrador.reserva.nombre = "Familia Ramírez";
    borrador.reserva.personas = "8";
    borrador.pedirFicha("reserva");

    expect(borrador.cancelarViaje()).toBe("reserva");
    expect(borrador.reserva.nombre).toBe("Familia Ramírez");
    expect(borrador.reserva.personas).toBe("8");
    expect(borrador.reserva.cliente_id).toBeUndefined();
    expect(borrador.esperandoFicha).toBeNull();
  });

  it("la lista de espera hace el mismo viaje, y la ficha cae en SU formulario", () => {
    borrador.reserva.nombre = "Familia Ramírez";
    borrador.espera.nombre = "Ana";
    borrador.espera.personas = "4";
    borrador.pedirFicha("espera");

    const ana = ficha("Ana Ruiz", "33 5566 7788");
    expect(borrador.recibirFicha({ cliente_id: ana, nombre: "Ana Ruiz", telefono: "33 5566 7788" })).toBe(
      "espera",
    );

    expect(borrador.espera.cliente_id).toBe(ana);
    expect(borrador.espera.nombre).toBe("Ana Ruiz");
    expect(borrador.espera.telefono).toBe("33 5566 7788");
    expect(borrador.espera.personas).toBe("4");
    /* El alta de la reserva no se tocó: la ficha la pedía la lista de espera. */
    expect(borrador.reserva.cliente_id).toBeUndefined();
    expect(borrador.reserva.nombre).toBe("Familia Ramírez");
  });

  it("desde la ficha del comensal se aparta mesa con el cliente ya puesto", () => {
    const jose = ficha("José Pérez", "33 1122 3344", "jose@correo.mx");

    borrador.apartarPara({
      cliente_id: jose,
      nombre: "José Pérez",
      telefono: "33 1122 3344",
      correo: "jose@correo.mx",
    });

    expect(borrador.reserva.abierto).toBe(true);
    expect(borrador.reserva.cliente_id).toBe(jose);
    expect(borrador.reserva.telefono).toBe("33 1122 3344");

    const r = apartarComoLaPantalla({
      cliente_id: borrador.reserva.cliente_id,
      nombre: borrador.reserva.nombre,
      telefono: borrador.reserva.telefono,
    });
    expect(r.ok).toBe(true);
    expect(reservas.reservas[0]!.cliente_id).toBe(jose);
    expect(clientes.activos).toHaveLength(1);
  });

  it("al apartar se limpia el comensal, pero se queda el día y la hora", () => {
    borrador.reserva.abierto = true;
    borrador.reserva.nombre = "Familia Ramírez";
    borrador.reserva.telefono = "33 9988 7766";
    borrador.reserva.cliente_id = "cli-1";
    borrador.reserva.hora = "21:30";
    borrador.reserva.acomodo = JSON.stringify(["m3"]);

    borrador.limpiarReserva();

    expect(borrador.reserva.nombre).toBe("");
    expect(borrador.reserva.cliente_id).toBeUndefined();
    expect(borrador.reserva.abierto).toBe(false);
    /* Un viernes se anotan cinco reservas seguidas para la misma noche. */
    expect(borrador.reserva.hora).toBe("21:30");
    /* La mesa NO se queda: acaba de quedar apartada. */
    expect(borrador.reserva.acomodo).toBe("");
  });
});

describe("la ficha enseña sus reservas", () => {
  it("salen las ligadas y también las viejas que llevan su teléfono", () => {
    const jose = ficha("José Pérez", "33 1122 3344");

    /* La de antes de la 1.5.6: se apartó sin ficha, con su teléfono. */
    reservas.apartar({
      nombre: "Pérez",
      telefono: "+52 33 1122 3344",
      personas: 2,
      para_ts: VIERNES - 7 * 24 * 60 * 60_000,
    });
    /* Y la de ahora, que nace ligada. */
    apartarComoLaPantalla({ cliente_id: jose, nombre: "José Pérez", telefono: "33 1122 3344" });

    const suyas = reservas.deCliente(jose, "33 1122 3344");
    expect(suyas).toHaveLength(2);
    /* De la más próxima a la más vieja. */
    expect(suyas[0]!.para_ts).toBeGreaterThan(suyas[1]!.para_ts);
  });

  it("una reserva que ya es de OTRA ficha no se le cuelga por el teléfono", () => {
    const jose = ficha("José Pérez", "33 1122 3344");
    const ana = ficha("Ana Ruiz", "33 1122 3344");

    // El teléfono de la casa lo comparten, pero alguien ya decidió de quién es.
    apartarComoLaPantalla({ cliente_id: ana, nombre: "Ana Ruiz", telefono: "33 1122 3344" });

    expect(reservas.deCliente(ana, "33 1122 3344")).toHaveLength(1);
    expect(reservas.deCliente(jose, "33 1122 3344")).toHaveLength(0);
  });
});

describe("lo que llega del portal no cambia de dueño", () => {
  it("confirmar una solicitud conserva la ficha con la que llegó", () => {
    const fabrica = new FabricaEventos<EventoReserva>({
      device_id: "hub",
      empleado_id: "sistema",
      sucursal_id: SUCURSAL_ID,
    });
    const pedida = fabrica.crear("reserva_creada", streamReservas(SUCURSAL_ID), {
      reserva_id: "res-portal",
      nombre: "Ana Ruiz",
      telefono: "33 5566 7788",
      cliente_id: "cli-del-portal",
      personas: 2,
      para_ts: VIERNES,
      origen: "comensal",
    });
    reservas.hidratar([pedida]);
    expect(reservas.solicitadas).toHaveLength(1);

    const r = reservas.confirmar("res-portal");

    expect(r.ok).toBe(true);
    const confirmada = reservas.reservas[0]!;
    expect(confirmada.estado).toBe("apartada");
    expect(confirmada.cliente_id).toBe("cli-del-portal");
  });
});
