/**
 * Semilla de usuarios del local.
 *
 * ## Lo que cambió, y por qué
 *
 * Antes el propietario venía con una **clave de fábrica idéntica en toda
 * instalación**, escrita en claro en este archivo, y con el hash de un PIN de
 * cuatro dígitos empaquetado en el instalador. La justificación era la analogía
 * del router que sale con una clave por defecto.
 *
 * La analogía no se sostiene: **un router moderno trae clave única por equipo**,
 * no una constante idéntica para todo el parque. Y el hash acompañaba al texto
 * claro en el mismo archivo, así que no protegía nada. Cualquier local que no la
 * cambiara —y se quitó el cambio obligatorio por molesto— quedaba accesible con
 * una credencial publicada en el repositorio.
 *
 * ## Cómo funciona ahora
 *
 * En producción el propietario se siembra **SIN credenciales**. El primer
 * arranque genera una contraseña y un PIN **únicos de ese restaurante**, los
 * guarda como hash, y los enseña **una sola vez**. Nada de lo que hay en este
 * repositorio sirve para entrar en ningún local.
 *
 * En desarrollo y en las pruebas (`MODO_DEMO`) siguen las credenciales conocidas
 * de siempre, para no tener que inventárselas en cada prueba.
 */
import { permisosDePlantilla, type Credencial, type RolId, type Usuario } from "@motrest/dominio";
import { MODO_DEMO, SUCURSAL_ID } from "../presentacion";

const AHORA = Date.now();

export interface UsuarioSembrado {
  usuario: Usuario;
  /**
   * Credencial principal: contraseña para administración, PIN para piso.
   *
   * **Opcional a propósito.** En producción el propietario nace sin ninguna, y
   * el primer arranque le genera las suyas. Un usuario sin credencial no puede
   * entrar hasta que se le asigne una, que es exactamente lo que se quiere.
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

/** El propietario. En producción, sin credenciales: se generan al arrancar. */
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
 * En producción, **solo el propietario y sin credenciales**: el primer arranque
 * le genera las suyas, únicas de ese restaurante.
 */
export const USUARIOS_SEMILLA: UsuarioSembrado[] = MODO_DEMO
  ? usuariosDemo()
  : [{ usuario: propietario() }];

/**
 * Con quién arranca el POS mientras no hay login.
 *
 * En demo entra directo como Lucía, que agiliza las pruebas. En producción es
 * `null` a propósito: el local abre en la pantalla de acceso y nadie opera sin
 * identificarse —arrancar ya dentro de una cuenta sería saltarse el login—.
 */
export const USUARIO_POR_DEFECTO: string | null = MODO_DEMO ? "usr-lucia" : null;

// --- Las credenciales que se generan en el primer arranque -----------------------------------

/**
 * Alfabeto sin caracteres que se confunden al dictarlos por teléfono.
 *
 * Sin `0/O`, sin `1/I/L`, sin `U` (se oye como `V`). Esta contraseña se apunta a
 * mano en un papel el día de la instalación y se dicta en llamadas de soporte:
 * que no haya dudas al leerla vale más que dos bits de entropía.
 */
const ALFABETO_CLARO = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Toma un símbolo sin sesgo de módulo (ver `rescate.ts`, misma técnica). */
function simboloSinSesgo(): string {
  const tope = 256 - (256 % ALFABETO_CLARO.length);
  const byte = new Uint8Array(1);
  do {
    crypto.getRandomValues(byte);
  } while (byte[0]! >= tope);
  return ALFABETO_CLARO[byte[0]! % ALFABETO_CLARO.length]!;
}

/**
 * La contraseña que se genera para el propietario de ESTE local.
 *
 * Doce símbolos en tres grupos de cuatro (`7KX9-MQ2P-4VN8`), ~58 bits. Los
 * guiones no son decorativos: un bloque de doce caracteres se copia mal a mano,
 * y esto se apunta en papel.
 *
 * Se comprueba contra `validarSecreto` antes de devolverla —exige letras y
 * dígitos— porque una tirada podría salir toda de letras.
 */
export function generarContrasenaDeLocal(): string {
  for (;;) {
    const grupos = [0, 1, 2].map(() =>
      [0, 1, 2, 3].map(() => simboloSinSesgo()).join(""),
    );
    const clave = grupos.join("-");
    if (/[A-Z]/.test(clave) && /\d/.test(clave)) return clave;
  }
}

/**
 * El PIN que se genera para el propietario.
 *
 * **Ocho dígitos, no cuatro.** No lo teclea nadie a diario —para eso está la
 * contraseña— y es el que firma autorizaciones: cancelar un renglón ya enviado,
 * un descuento, un retiro de caja. Que sea largo no cuesta nada aquí y sube de
 * diez mil a cien millones el espacio a probar.
 */
export function generarPinDeLocal(): string {
  const digitos = new Uint8Array(8);
  for (;;) {
    crypto.getRandomValues(digitos);
    const pin = [...digitos].map((b) => b % 10).join("");
    // Ni todo el mismo dígito, ni una escalera: `validarSecreto` rechaza lo
    // primero y lo segundo es igual de adivinable si alguien mira los dedos.
    if (!/^(\d)\1+$/.test(pin) && pin !== "12345678") return pin;
  }
}
