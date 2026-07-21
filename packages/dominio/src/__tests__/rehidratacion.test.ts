/**
 * Rehidratación: reconstruir el estado visible a partir del log guardado.
 * Es lo que hace que recargar la aplicación no pierda la operación.
 */
import { describe, expect, it } from "vitest";
import { pesos } from "../comun/dinero.js";
import { uuidv7, type ID } from "../comun/ids.js";
import { IVA_16, snapshotTasas } from "../comun/impuestos.js";
import { agruparPorMesa, proyectarComanda, renglonesActivos } from "../comanda/reducers.js";
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

    const estado = proyectarComanda(agruparPorMesa(log)["mesa-1"]!);
    // La segunda orden_creada reinicia la proyección: es una sentada nueva.
    expect(estado.orden_id).toBe(segunda);
    expect(estado.cerrada).toBe(false);
    expect(renglonesActivos(estado)).toHaveLength(1);
    expect(renglonesActivos(estado)[0]!.descripcion).toBe("Pizza");
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
