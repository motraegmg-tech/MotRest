/**
 * Semilla de usuarios del local.
 *
 * ## Cómo funciona
 *
 * **En producción no hay semilla: un restaurante recién instalado no tiene ni un
 * usuario.** El primer arranque abre el alta del responsable —nombre y el PIN que
 * él elija— y esa es la primera cuenta del local (ver `AltaResponsable.svelte` y
 * `sesion.crearResponsableInicial`). A partir de ahí cada apertura pide
 * identificarse contra la lista de personal.
 *
 * ## Lo que hubo antes, para no repetirlo
 *
 * 1. Una **clave de fábrica idéntica en toda instalación**, escrita en claro en
 *    este archivo. La analogía del router que sale con clave por defecto no se
 *    sostiene: un router moderno trae clave única por equipo, no una constante
 *    para todo el parque.
 *
 * 2. Un propietario sembrado **sin credenciales** al que el primer arranque le
 *    generaba una contraseña y un PIN únicos y los enseñaba una sola vez. Mejor
 *    que lo anterior, pero seguía teniendo dos defectos en el restaurante real:
 *    la cuenta se llamaba «Gonzalo DJA» en un local que no es de Gonzalo, y si
 *    esa pantalla se cerraba sin apuntar las claves —o si la caja arrancaba
 *    esperando al Hub y no llegaba a mostrarla— el dueño se quedaba fuera de su
 *    propio sistema mirando un usuario cuya contraseña nadie había visto.
 *
 * Lo que se conserva de esa historia es el principio: **nada de lo que hay en
 * este repositorio sirve para entrar en ningún local.** Ahora se cumple por la
 * vía más simple, que es no traer ninguna cuenta.
 *
 * En desarrollo y en las pruebas (`MODO_DEMO`) siguen las credenciales conocidas
 * de siempre, para no tener que inventárselas en cada prueba.
 */
import {
  permisosDePlantilla,
  type Credencial,
  type RolId,
  type Usuario,
} from "@motrest/dominio";
import { MODO_DEMO, SUCURSAL_ID } from "../presentacion";

const AHORA = Date.now();

export interface UsuarioSembrado {
  usuario: Usuario;
  /**
   * Credencial principal: contraseña para administración, PIN para piso.
   *
   * **Opcional a propósito.** Un usuario sin credencial no puede entrar hasta
   * que se le asigne una, que es exactamente lo que se quiere.
   */
  credencial?: Credencial;
  /** PIN adicional para el cambio rápido y para firmar autorizaciones. */
  pin?: Credencial;
}

function usuario(
  id: string,
  nombre: string,
  iniciales: string,
  rol_id: RolId,
  puesto: string,
  extra: Partial<Usuario> = {},
): Usuario {
  return {
    id,
    nombre,
    iniciales,
    rol_id,
    puesto,
    sucursal_id: SUCURSAL_ID,
    permisos: permisosDePlantilla(rol_id),
    activo: true,
    ...extra,
  };
}

/** El propietario de la demostración. En producción NO se siembra a nadie. */
function propietario(): Usuario {
  return usuario("usr-gonzalo", "Gonzalo DJA", "G", "propietario", "Dirección General");
}

/**
 * Credenciales conocidas para desarrollo y pruebas. **NO van a producción.**
 *
 * Va dentro de una FUNCIÓN y no de constantes de módulo, y eso no es estilo: un
 * `export const` con el texto de la contraseña sobrevive al empaquetado aunque
 * el código de producción no lo lea, porque el empaquetador no puede probar que
 * nadie más lo importe. El cuerpo de una función que nadie llama se elimina
 * entero.
 *
 * Es la misma técnica que ya protegía a Marco y Lucía, y que se verificó sobre
 * el paquete compilado. Ahora protege también al propietario, que era el hueco.
 */
export function credencialesDeDemostracion(): {
  contrasena: string;
  pin: string;
  credencial: Credencial;
  credencialPin: Credencial;
} {
  return {
    contrasena: "MotRest.Inicio.2026",
    pin: "2468",
    credencial: {
      empleado_id: "usr-gonzalo",
      tipo: "contrasena",
      algoritmo: "PBKDF2-SHA256",
      iteraciones: 600_000,
      sal: "5RwxxK/p7ufI4DfOR+j6lg==",
      hash: "qdXfT5DaaNq5xERA7IfkZdzQcIUNqniHZDgSXiH2mGI=",
      creada_ts: AHORA,
    },
    credencialPin: {
      empleado_id: "usr-gonzalo",
      tipo: "pin",
      algoritmo: "PBKDF2-SHA256",
      iteraciones: 310_000,
      sal: "NT9741T4POvkZ2ds+7JLsA==",
      hash: "0uTMfxYldRSeyv6TYMj0yg4dJHXFcogA2NOsx19aPRw=",
      creada_ts: AHORA,
    },
  };
}

/**
 * Marco y Lucía: solo para probar sin dar de alta a nadie. NO van a producción.
 *
 * Misma técnica de función que la de arriba. Verificado sobre el bundle: sin el
 * `MODO_DEMO` no queda ni el nombre.
 */
function usuariosDemo(): UsuarioSembrado[] {
  const demo = credencialesDeDemostracion();
  return [
    {
      usuario: propietario(),
      credencial: demo.credencial,
      pin: demo.credencialPin,
    },
    {
      usuario: usuario("usr-marco", "Marco", "M", "gerente", "Gerente de sucursal"),
      credencial: {
        empleado_id: "usr-marco",
        tipo: "pin",
        algoritmo: "PBKDF2-SHA256",
        iteraciones: 310_000,
        sal: "mxvL4aRXAh9MUv+ZJGzphg==",
        hash: "cBPP+oKjskUtXf1hvsFLdTgW681486PzGP7RtexHfCY=",
        creada_ts: AHORA,
      },
    },
    {
      usuario: usuario("usr-lucia", "Lucía", "L", "mesero", "Mesera"),
      credencial: {
        empleado_id: "usr-lucia",
        tipo: "pin",
        algoritmo: "PBKDF2-SHA256",
        iteraciones: 310_000,
        sal: "J6SloW5AyxgPVGgM7itUqQ==",
        hash: "yssNRcmD6YzaOw+Y/Dx/mTxCblYi2lqcYzQUbum3wFY=",
        creada_ts: AHORA,
      },
    },
  ];
}

/**
 * Con qué usuarios arranca una instalación.
 *
 * En producción, **con ninguno**. El restaurante da de alta a su responsable en
 * el primer arranque y él da de alta a su personal. Sembrar aquí un propietario
 * llamado «Gonzalo DJA» en el local de otro no aportaba nada: la cuenta había que
 * renombrarla igual, y mientras nadie lo hacía la bitácora del restaurante
 * atribuía sus movimientos a un nombre que ahí no significa nada.
 */
export const USUARIOS_SEMILLA: UsuarioSembrado[] = MODO_DEMO ? usuariosDemo() : [];

/**
 * Con quién arranca el POS mientras no hay login.
 *
 * En demo entra directo como Lucía, que agiliza las pruebas. En producción es
 * `null` a propósito: el local abre en la pantalla de acceso y nadie opera sin
 * identificarse —arrancar ya dentro de una cuenta sería saltarse el login—.
 */
export const USUARIO_POR_DEFECTO: string | null = MODO_DEMO ? "usr-lucia" : null;

/*
 * AQUÍ VIVÍAN `generarContrasenaDeLocal` y `generarPinDeLocal`.
 *
 * Inventaban una contraseña y un PIN para el propietario en el primer arranque y
 * los enseñaban una sola vez. Se retiraron con el alta del responsable: ya no hay
 * ninguna clave que el restaurante tenga que apuntar de una pantalla que solo
 * aparece una vez, porque la elige él. Un secreto que el sistema genera y el
 * cliente no eligió es un secreto que el cliente pierde.
 */
