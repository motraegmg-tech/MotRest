/**
 * Rol de mesas: quién atiende qué, cada día de la semana.
 *
 * Lo que hay que dejar clavado con pruebas es la regla que NO es obvia: una mesa
 * sin nadie asignado es de todos, no de nadie. Si el silencio significara «de
 * nadie», un local que todavía no captura su rol dejaría de avisar de los
 * platillos listos y nadie sabría por qué.
 */
import { describe, expect, it } from "vitest";
import {
  alternarMesero,
  asignarMesa,
  atiendeLaMesa,
  copiarDia,
  depurar,
  diaDeLaSemana,
  meserosDeMesa,
  mesasDeMesero,
  nombreDia,
  rolDeMesasVacio,
  vaciarDia,
  type DiaSemana,
} from "../personal/asignaciones.js";

const LUNES: DiaSemana = 1;
const VIERNES: DiaSemana = 5;

describe("asignar y consultar", () => {
  it("una mesa recién asignada aparece para su mesero y solo ese día", () => {
    const rol = asignarMesa(rolDeMesasVacio(), "mesa-1", VIERNES, ["usr-lucia"]);

    expect(meserosDeMesa(rol, "mesa-1", VIERNES)).toEqual(["usr-lucia"]);
    expect(meserosDeMesa(rol, "mesa-1", LUNES)).toEqual([]);
    expect(mesasDeMesero(rol, "usr-lucia", VIERNES)).toEqual(["mesa-1"]);
  });

  it("dos meseros pueden compartir una mesa: pasa en un turno partido", () => {
    const rol = asignarMesa(rolDeMesasVacio(), "mesa-8", VIERNES, ["usr-lucia", "usr-marco"]);
    expect(meserosDeMesa(rol, "mesa-8", VIERNES)).toHaveLength(2);
  });

  it("asignar reemplaza, no acumula: es lo que espera quien corrige el rol", () => {
    let rol = asignarMesa(rolDeMesasVacio(), "mesa-1", VIERNES, ["usr-lucia"]);
    rol = asignarMesa(rol, "mesa-1", VIERNES, ["usr-marco"]);
    expect(meserosDeMesa(rol, "mesa-1", VIERNES)).toEqual(["usr-marco"]);
  });

  it("no guarda a la misma persona dos veces", () => {
    const rol = asignarMesa(rolDeMesasVacio(), "mesa-1", VIERNES, ["usr-lucia", "usr-lucia"]);
    expect(meserosDeMesa(rol, "mesa-1", VIERNES)).toEqual(["usr-lucia"]);
  });

  it("alternar pone y quita con el mismo toque", () => {
    let rol = alternarMesero(rolDeMesasVacio(), "mesa-3", LUNES, "usr-lucia");
    expect(meserosDeMesa(rol, "mesa-3", LUNES)).toEqual(["usr-lucia"]);

    rol = alternarMesero(rol, "mesa-3", LUNES, "usr-lucia");
    expect(meserosDeMesa(rol, "mesa-3", LUNES)).toEqual([]);
  });

  it("una mesa que se queda sin nadie no ocupa sitio en el catálogo", () => {
    let rol = asignarMesa(rolDeMesasVacio(), "mesa-3", LUNES, ["usr-lucia"]);
    rol = asignarMesa(rol, "mesa-3", LUNES, []);
    expect(rol.asignaciones).toEqual([]);
  });

  it("cada cambio sube la versión, para que se replique a las demás terminales", () => {
    const inicial = rolDeMesasVacio();
    const rol = asignarMesa(inicial, "mesa-1", LUNES, ["usr-lucia"]);
    expect(rol.version).toBe(inicial.version + 1);
  });
});

describe("de quién es la mesa", () => {
  /*
   * LA REGLA QUE PROTEGE AL LOCAL QUE NO CAPTURÓ SU ROL. Sin ella, instalar
   * MotRest y no llenar la tabla apagaría en silencio los avisos de cocina.
   */
  it("una mesa sin asignar es de TODOS, no de nadie", () => {
    const rol = rolDeMesasVacio();
    expect(atiendeLaMesa(rol, "mesa-1", "usr-quien-sea", LUNES)).toBe(true);
  });

  it("una mesa asignada es solo de quien la tiene ese día", () => {
    const rol = asignarMesa(rolDeMesasVacio(), "mesa-1", LUNES, ["usr-lucia"]);
    expect(atiendeLaMesa(rol, "mesa-1", "usr-lucia", LUNES)).toBe(true);
    expect(atiendeLaMesa(rol, "mesa-1", "usr-marco", LUNES)).toBe(false);
    // Pero el viernes no la tiene nadie, así que vuelve a ser de todos.
    expect(atiendeLaMesa(rol, "mesa-1", "usr-marco", VIERNES)).toBe(true);
  });
});

describe("copiar y vaciar días", () => {
  it("copiar un día REEMPLAZA el destino, no lo mezcla", () => {
    let rol = asignarMesa(rolDeMesasVacio(), "mesa-1", LUNES, ["usr-lucia"]);
    rol = asignarMesa(rol, "mesa-9", VIERNES, ["usr-marco"]);

    rol = copiarDia(rol, LUNES, VIERNES);

    expect(meserosDeMesa(rol, "mesa-1", VIERNES)).toEqual(["usr-lucia"]);
    // Lo que había en el viernes desaparece: copiar es copiar, no fusionar.
    expect(meserosDeMesa(rol, "mesa-9", VIERNES)).toEqual([]);
    // Y el origen queda intacto.
    expect(meserosDeMesa(rol, "mesa-1", LUNES)).toEqual(["usr-lucia"]);
  });

  it("copiar un día sobre sí mismo no hace nada", () => {
    const rol = asignarMesa(rolDeMesasVacio(), "mesa-1", LUNES, ["usr-lucia"]);
    expect(copiarDia(rol, LUNES, LUNES)).toBe(rol);
  });

  it("vaciar un día no toca los demás", () => {
    let rol = asignarMesa(rolDeMesasVacio(), "mesa-1", LUNES, ["usr-lucia"]);
    rol = asignarMesa(rol, "mesa-1", VIERNES, ["usr-lucia"]);

    rol = vaciarDia(rol, LUNES);
    expect(meserosDeMesa(rol, "mesa-1", LUNES)).toEqual([]);
    expect(meserosDeMesa(rol, "mesa-1", VIERNES)).toEqual(["usr-lucia"]);
  });
});

describe("depurar", () => {
  it("saca del rol a quien ya no trabaja aquí y a las mesas que se quitaron", () => {
    let rol = asignarMesa(rolDeMesasVacio(), "mesa-1", LUNES, ["usr-lucia", "usr-que-se-fue"]);
    rol = asignarMesa(rol, "mesa-borrada", LUNES, ["usr-lucia"]);

    const limpio = depurar(rol, new Set(["mesa-1"]), new Set(["usr-lucia"]));

    expect(meserosDeMesa(limpio, "mesa-1", LUNES)).toEqual(["usr-lucia"]);
    expect(meserosDeMesa(limpio, "mesa-borrada", LUNES)).toEqual([]);
  });

  it("un rol ya limpio se devuelve intacto, sin gastar una versión de más", () => {
    const rol = asignarMesa(rolDeMesasVacio(), "mesa-1", LUNES, ["usr-lucia"]);
    expect(depurar(rol, new Set(["mesa-1"]), new Set(["usr-lucia"]))).toBe(rol);
  });
});

describe("días de la semana", () => {
  it("numera igual que Date.getDay(), para no tener que traducir en ningún sitio", () => {
    // Domingo 26-jul-2026.
    expect(diaDeLaSemana(new Date(2026, 6, 26, 13).getTime())).toBe(0);
    expect(diaDeLaSemana(new Date(2026, 6, 27, 13).getTime())).toBe(1);
  });

  it("los nombra en español", () => {
    expect(nombreDia(5)).toBe("Viernes");
    expect(nombreDia(0)).toBe("Domingo");
  });
});
