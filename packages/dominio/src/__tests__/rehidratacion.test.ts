/**
 * Rehidratación: reconstruir el estado visible a partir del log guardado.
 * Es lo que hace que recargar la aplicación no pierda la operación.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { uuidv7, type ID } from "../comun/ids.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import {
  agruparPorMesa,
  proyectarComanda,
  mesasConCuentaDuplicada,
  proyectarSentadas,
  renglonesActivos,
  ultimaSentada,
} from "../comanda/reducers.js";
import type { EventoComanda } from "../comanda/eventos.js";
import type { RenglonComanda } from "../comanda/renglon.js";
import { FabricaEventos } from "../evento.js";
import type { EventoIdentidad } from "../identidad/eventos.js";
import { proyectarIdentidad } from "../identidad/reducers.js";
import { permisosDePlantilla, type Usuario } from "../identidad/roles.js";

const CTX = { device_id: "dev-1", empleado_id: "usr-lucia", sucursal_id: "suc-1" };

function renglon(descripcion: string): RenglonComanda {
  return {
    id: uuidv7(),
    producto_id: "prod-x",
    descripcion,
    cantidad: 1,
    precio_unitario: pesos(100),
    costo_unitario: pesos(30),
    impuesto: snapshotTasas(IVA_16),
    estado: "capturado",
  };
}

describe("agrupar el log por mesa", () => {
  it("reparte los eventos según la mesa de cada orden", () => {
    const f = new FabricaEventos<EventoComanda>(CTX);
    const o1 = uuidv7();
    const o2 = uuidv7();

    const log: EventoComanda[] = [
      f.crear("orden_creada", o1, { orden_id: o1, mesa_id: "mesa-3", abierta_ts: Date.now() }),
      f.crear("orden_creada", o2, { orden_id: o2, mesa_id: "mesa-7", abierta_ts: Date.now() }),
      f.crear("item_agregado", o1, { orden_id: o1, renglon: renglon("Pasta") }),
      f.crear("item_agregado", o2, { orden_id: o2, renglon: renglon("Pizza") }),
      f.crear("item_agregado", o1, { orden_id: o1, renglon: renglon("Agua") }),
    ];

    const porMesa = agruparPorMesa(log);
    expect(Object.keys(porMesa).sort()).toEqual(["mesa-3", "mesa-7"]);
    expect(porMesa["mesa-3"]).toHaveLength(3);
    expect(porMesa["mesa-7"]).toHaveLength(2);

    expect(renglonesActivos(proyectarComanda(porMesa["mesa-3"]!))).toHaveLength(2);
  });

  it("varias sentadas de la misma mesa quedan en el mismo log y la última manda", () => {
    const f = new FabricaEventos<EventoComanda>(CTX);
    const primera = uuidv7();
    const segunda = uuidv7();

    const log: EventoComanda[] = [
      f.crear("orden_creada", primera, { orden_id: primera, mesa_id: "mesa-1", abierta_ts: 1 }),
      f.crear("item_agregado", primera, { orden_id: primera, renglon: renglon("Café") }),
      f.crear("cuenta_cerrada", primera, { orden_id: primera }),
      f.crear("orden_creada", segunda, { orden_id: segunda, mesa_id: "mesa-1", abierta_ts: 2 }),
      f.crear("item_agregado", segunda, { orden_id: segunda, renglon: renglon("Pizza") }),
    ];

    const deLaMesa = agruparPorMesa(log)["mesa-1"]!;

    /*
     * EL CANDADO. Proyectar el log de la mesa de corrido devolvía calladamente
     * solo la última sentada: el café cobrado desaparecía del reporte del
     * contador aunque el corte de caja sí lo hubiera cobrado. Ahora falla y
     * obliga a decir cuál de las dos cosas se quiere.
     */
    expect(() => proyectarComanda(deLaMesa)).toThrow(/sentadas/);

    // La cuenta que el mesero tiene enfrente: la pizza.
    const enCurso = ultimaSentada(deLaMesa)!;
    expect(enCurso.orden_id).toBe(segunda);
    expect(enCurso.cerrada).toBe(false);
    expect(renglonesActivos(enCurso)).toHaveLength(1);
    expect(renglonesActivos(enCurso)[0]!.descripcion).toBe("Pizza");

    // Lo que ven los reportes: LAS DOS, porque las dos son ventas del día.
    const todas = proyectarSentadas(deLaMesa);
    expect(todas.map((c) => c.orden_id)).toEqual([primera, segunda]);
    expect(renglonesActivos(todas[0]!)[0]!.descripcion).toBe("Café");
  });

  it("una mesa que nunca se abrió no tiene sentada en curso", () => {
    expect(ultimaSentada([])).toBeNull();
  });

  /*
   * DOS TERMINALES, LA MISMA MESA. Cada una la vio libre porque el
   * `orden_creada` de la otra no había llegado. Al sincronizar aparecen las dos
   * cuentas abiertas: no se fusionan solas —eso lo decide el restaurante— pero
   * tienen que VERSE. Antes, una desaparecía con todo lo que le habían pedido.
   */
  it("señala una mesa con dos cuentas abiertas a la vez", () => {
    const f = new FabricaEventos<EventoComanda>(CTX);
    const desdeCaja = uuidv7();
    const desdeMovil = uuidv7();

    const log: EventoComanda[] = [
      f.crear("orden_creada", desdeCaja, { orden_id: desdeCaja, mesa_id: "mesa-5", abierta_ts: 1 }),
      f.crear("item_agregado", desdeCaja, { orden_id: desdeCaja, renglon: renglon("Pizza") }),
      f.crear("orden_creada", desdeMovil, { orden_id: desdeMovil, mesa_id: "mesa-5", abierta_ts: 1 }),
      f.crear("item_agregado", desdeMovil, { orden_id: desdeMovil, renglon: renglon("Refresco") }),
    ];

    const sentadas = proyectarSentadas(agruparPorMesa(log)["mesa-5"]!);
    expect(sentadas).toHaveLength(2);
    expect(mesasConCuentaDuplicada(sentadas)).toEqual(["mesa-5"]);
  });

  it("una mesa servida y luego vuelta a sentar NO está duplicada", () => {
    const f = new FabricaEventos<EventoComanda>(CTX);
    const primera = uuidv7();
    const segunda = uuidv7();

    const sentadas = proyectarSentadas([
      f.crear("orden_creada", primera, { orden_id: primera, mesa_id: "mesa-6", abierta_ts: 1 }),
      f.crear("cuenta_cerrada", primera, { orden_id: primera }),
      f.crear("orden_creada", segunda, { orden_id: segunda, mesa_id: "mesa-6", abierta_ts: 2 }),
    ]);
    expect(mesasConCuentaDuplicada(sentadas)).toEqual([]);
  });

  /*
   * Un postre de la sentada anterior que cocina marca entregado tarde llega
   * DESPUÉS de que la mesa se volvió a abrir. Si la sentada en curso se
   * recortara por posición en el log, ese postre caería en la cuenta
   * equivocada y se le cobraría a quien no lo pidió.
   */
  it("un evento rezagado de la sentada anterior no se cuela en la nueva", () => {
    const f = new FabricaEventos<EventoComanda>(CTX);
    const primera = uuidv7();
    const segunda = uuidv7();
    const postre = renglon("Tiramisú");

    const log: EventoComanda[] = [
      f.crear("orden_creada", primera, { orden_id: primera, mesa_id: "mesa-9", abierta_ts: 1 }),
      f.crear("item_agregado", primera, { orden_id: primera, renglon: postre }),
      f.crear("cuenta_cerrada", primera, { orden_id: primera }),
      f.crear("orden_creada", segunda, { orden_id: segunda, mesa_id: "mesa-9", abierta_ts: 2 }),
      // Cocina lo marca entregado cuando la mesa ya se volvió a sentar.
      f.crear("item_entregado", primera, { orden_id: primera, renglon_id: postre.id }),
    ];

    const enCurso = ultimaSentada(agruparPorMesa(log)["mesa-9"]!)!;
    expect(enCurso.orden_id).toBe(segunda);
    expect(enCurso.renglones).toEqual([]);
  });

  it("descarta eventos huérfanos, sin su apertura", () => {
    const f = new FabricaEventos<EventoComanda>(CTX);
    const perdida = uuidv7();
    const log: EventoComanda[] = [
      f.crear("item_agregado", perdida, { orden_id: perdida, renglon: renglon("Fantasma") }),
    ];
    expect(agruparPorMesa(log)).toEqual({});
  });

  it("un log vacío no rompe nada", () => {
    expect(agruparPorMesa([])).toEqual({});
  });
});

describe("proyectar usuarios desde el log", () => {
  const semilla: Usuario[] = [
    {
      id: "usr-gonzalo",
      nombre: "Gonzalo DJA",
      iniciales: "G",
      rol_id: "propietario",
      puesto: "Dirección General",
      sucursal_id: "suc-1",
      permisos: permisosDePlantilla("propietario"),
      activo: true,
      debe_cambiar_credencial: true,
    },
  ];

  function fabrica() {
    return new FabricaEventos<EventoIdentidad>({ ...CTX, empleado_id: "usr-gonzalo" });
  }

  const STREAM: ID = "identidad:suc-1";

  it("sin eventos, queda la semilla tal cual", () => {
    const estado = proyectarIdentidad(semilla, []);
    expect(estado.usuarios).toHaveLength(1);
    expect(estado.bloqueados.size).toBe(0);
  });

  it("un alta persiste con su puesto y sus permisos", () => {
    const f = fabrica();
    const permisos = permisosDePlantilla("mesero");
    const estado = proyectarIdentidad(semilla, [
      f.crear("usuario_creado", STREAM, {
        usuario_id: "usr-nuevo",
        nombre: "Ana",
        puesto: "Mesera",
        rol_id: "mesero",
        permisos,
      }),
    ]);

    const ana = estado.usuarios.find((u) => u.id === "usr-nuevo");
    expect(ana?.nombre).toBe("Ana");
    expect(ana?.puesto).toBe("Mesera");
    expect(ana?.rol_id).toBe("mesero");
    expect(ana?.permisos).toEqual(permisos);
  });

  it("los cambios de permisos y de estado se acumulan", () => {
    const f = fabrica();
    const recortados = permisosDePlantilla("mesero").slice(0, 2);
    const estado = proyectarIdentidad(semilla, [
      f.crear("usuario_creado", STREAM, {
        usuario_id: "usr-a", nombre: "Ana", puesto: "Mesera",
        rol_id: "mesero", permisos: permisosDePlantilla("mesero"),
      }),
      f.crear("usuario_actualizado", STREAM, {
        usuario_id: "usr-a", cambios: { permisos: recortados },
      }),
      f.crear("usuario_actualizado", STREAM, {
        usuario_id: "usr-a", cambios: { activo: false },
      }),
    ]);

    const ana = estado.usuarios.find((u) => u.id === "usr-a");
    expect(ana?.permisos).toHaveLength(2);
    expect(ana?.activo).toBe(false);
  });

  it("el bloqueo y el desbloqueo se reflejan", () => {
    const f = fabrica();
    const bloqueado = proyectarIdentidad(semilla, [
      f.crear("usuario_bloqueado", STREAM, { usuario_id: "usr-gonzalo", intentos: 7 }),
    ]);
    expect(bloqueado.bloqueados.has("usr-gonzalo")).toBe(true);

    const liberado = proyectarIdentidad(semilla, [
      f.crear("usuario_bloqueado", STREAM, { usuario_id: "usr-gonzalo", intentos: 7 }),
      f.crear("usuario_desbloqueado", STREAM, {
        usuario_id: "usr-gonzalo", desbloqueado_por: "usr-gonzalo",
      }),
    ]);
    expect(liberado.bloqueados.has("usr-gonzalo")).toBe(false);
  });

  it("cambiar la credencial levanta la obligación de cambiarla", () => {
    const f = fabrica();
    const estado = proyectarIdentidad(semilla, [
      f.crear("credencial_cambiada", STREAM, {
        usuario_id: "usr-gonzalo", tipo_credencial: "contrasena",
      }),
    ]);
    expect(estado.usuarios[0]!.debe_cambiar_credencial).toBe(false);
  });

  it("los eventos de bitácora pura no alteran el estado", () => {
    const f = fabrica();
    const antes = proyectarIdentidad(semilla, []);
    const despues = proyectarIdentidad(semilla, [
      f.crear("sesion_iniciada", STREAM, { usuario_id: "usr-gonzalo", rol_id: "propietario" }),
      f.crear("acceso_rechazado", STREAM, { motivo: "credencial_invalida" }),
      f.crear("sesion_cerrada", STREAM, { usuario_id: "usr-gonzalo" }),
    ]);
    expect(despues.usuarios).toEqual(antes.usuarios);
  });

  it("un alta repetida no duplica al usuario", () => {
    const f = fabrica();
    const alta = f.crear("usuario_creado", STREAM, {
      usuario_id: "usr-a", nombre: "Ana", puesto: "Mesera",
      rol_id: "mesero", permisos: permisosDePlantilla("mesero"),
    });
    const estado = proyectarIdentidad(semilla, [alta, alta]);
    expect(estado.usuarios.filter((u) => u.id === "usr-a")).toHaveLength(1);
  });
});
