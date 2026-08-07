/**
 * Permisos de verdad sobre las carpetas con secretos, en Windows.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * Todo el Hub escribe sus secretos con `{ mode: 0o600 }` —el CSD, su contraseña,
 * la llave TLS, el registro— y varios comentarios del código afirmaban que eso
 * los protege «de otro usuario del mismo equipo». **En Windows es falso.**
 * `fs.chmod` en Windows no toca las ACL de NTFS: lo único que hace es poner o
 * quitar el atributo de solo lectura. Los permisos reales siguen siendo los que
 * la carpeta heredó, que en `%APPDATA%` o en `C:\ProgramData` pueden incluir a
 * cualquier usuario de la máquina.
 *
 * Y MotRest solo se instala en Windows. Así que la protección que el código creía
 * tener no existía en la única plataforma donde corre.
 *
 * QUÉ HACE ESTO EN SU LUGAR
 *
 * Corta la herencia de permisos y deja dentro a tres, y a nadie más: SYSTEM, el
 * grupo de administradores y el usuario que corre el Hub. Se usa `icacls`, que
 * viene con Windows — nada de dependencias nuevas para esto; las de producción
 * del Hub siguen siendo dos.
 *
 * QUÉ SIGUE SIN PROTEGER, y conviene tenerlo escrito
 *
 * Nada de esto detiene a quien tenga administrador en la caja ni a quien se lleve
 * el disco. La contraseña del CSD vive al lado del CSD porque el Hub tiene que
 * poder sellar cuando el restaurante reinicia el equipo un sábado a las nueve de
 * la noche, sin que nadie teclee nada. Contra el disco robado lo que protege es
 * BitLocker, y por eso está en la guía de instalación.
 */
import { execFileSync } from "node:child_process";

/**
 * SID conocidos, en vez de nombres.
 *
 * `"Administrators"` no existe en un Windows en español —ahí es
 * `"Administradores"`— y el instalador de MotRest sale en español. Los SID son
 * los mismos en todos los idiomas.
 */
const SYSTEM = "*S-1-5-18";
const ADMINISTRADORES = "*S-1-5-32-544";

/**
 * Deja la carpeta al alcance de su dueño y de nadie más.
 *
 * No lanza: un fallo aquí no puede impedir que el restaurante venda. Devuelve
 * qué pasó para que quien llama lo registre — un local sin estos permisos es
 * algo que hay que poder ver en el registro, no algo que deba tirar el Hub.
 */
export function soloElDueno(carpeta: string): { ok: boolean; detalle: string } {
  if (process.platform !== "win32") {
    // En Linux y macOS el `mode: 0o600` con el que se escriben los archivos sí
    // significa lo que dice, así que no hay nada que arreglar.
    return { ok: true, detalle: "no hace falta fuera de Windows" };
  }

  const usuario = process.env.USERNAME?.trim();
  if (!usuario) return { ok: false, detalle: "no se pudo saber qué usuario corre el Hub" };

  try {
    execFileSync(
      "icacls",
      [
        carpeta,
        // `/inheritance:r` es la línea que importa: sin ella se añaden permisos
        // encima de los heredados y los heredados son justo el problema.
        "/inheritance:r",
        "/grant:r",
        `${SYSTEM}:(OI)(CI)F`,
        "/grant:r",
        `${ADMINISTRADORES}:(OI)(CI)F`,
        "/grant:r",
        `${usuario}:(OI)(CI)F`,
      ],
      { stdio: "pipe", windowsHide: true },
    );
    return { ok: true, detalle: `permisos restringidos a SYSTEM, administradores y ${usuario}` };
  } catch (causa) {
    return { ok: false, detalle: String(causa) };
  }
}
