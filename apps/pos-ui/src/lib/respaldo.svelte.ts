/**
 * Llevarse el restaurante a otra computadora, desde la pantalla.
 *
 * Habla con los dos extremos del Hub (`/respaldo/exportar` y
 * `/respaldo/restaurar`), que son los que tienen el registro completo y la
 * licencia con el permiso dentro. Aquí no se decide nada: solo se pide, se
 * enseña el resultado y se dice en castellano por qué algo no se pudo.
 *
 * ## Dónde vive cada mitad, y por qué no en el mismo sitio
 *
 * **Exportar** va en Administración: hace falta haber entrado, y el que se lleva
 * el respaldo es alguien de la casa.
 *
 * **Restaurar** va en la pantalla de bienvenida, junto al alta del responsable.
 * Es el único sitio donde sirve: en una computadora nueva no hay usuarios
 * todavía, así que nadie puede entrar a Administración a buscarlo. Ponerlo solo
 * ahí dentro habría sido tener la función y no poder usarla nunca.
 */
import { esLaCaja } from "./entorno";

class StoreRespaldo {
  exportando = $state(false);
  restaurando = $state(false);
  error = $state("");
  /** Lo que hay que contarle a quien acaba de restaurar. */
  resultado = $state<{ eventos: number; creado_ts: number } | null>(null);

  /** Solo la caja: el respaldo es el registro completo del negocio. */
  get disponible(): boolean {
    return esLaCaja();
  }

  /**
   * Descarga el respaldo cifrado.
   *
   * Se deja que el navegador lo guarde donde el usuario diga en vez de escribir
   * una ruta desde aquí: el destino normal es una USB o una carpeta de la nube,
   * y adivinarla no es cosa del programa.
   */
  async exportar(): Promise<boolean> {
    this.error = "";
    if (!this.disponible) {
      this.error = "El respaldo se saca desde la computadora del restaurante.";
      return false;
    }
    this.exportando = true;
    try {
      const respuesta = await fetch("/respaldo/exportar");
      if (!respuesta.ok) {
        const cuerpo = (await respuesta.json().catch(() => ({}))) as { error?: string };
        this.error = cuerpo.error ?? `El Hub respondió ${respuesta.status}`;
        return false;
      }
      const texto = await respuesta.text();
      const fecha = new Date().toISOString().slice(0, 10);
      const enlace = document.createElement("a");
      enlace.href = URL.createObjectURL(new Blob([texto], { type: "application/json" }));
      enlace.download = `motrest-respaldo-${fecha}.json`;
      enlace.click();
      URL.revokeObjectURL(enlace.href);
      return true;
    } catch (causa) {
      this.error = causa instanceof Error ? causa.message : "No se pudo contactar al Hub";
      return false;
    } finally {
      this.exportando = false;
    }
  }

  /**
   * Vuelca un respaldo en este equipo.
   *
   * El Hub comprueba lo que importa —permiso vigente, que el archivo sea de
   * este local y que la instalación esté vacía— y aquí solo se enseña lo que
   * conteste. La comprobación NO se duplica en la pantalla a propósito: una
   * regla escrita en dos sitios acaba diciendo cosas distintas.
   */
  async restaurar(archivo: File): Promise<boolean> {
    this.error = "";
    this.resultado = null;
    this.restaurando = true;
    try {
      const respuesta = await fetch("/respaldo/restaurar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: await archivo.text(),
      });
      const cuerpo = (await respuesta.json().catch(() => ({}))) as {
        error?: string;
        eventos?: number;
        creado_ts?: number;
      };
      if (!respuesta.ok) {
        this.error = cuerpo.error ?? `El Hub respondió ${respuesta.status}`;
        return false;
      }
      this.resultado = {
        eventos: cuerpo.eventos ?? 0,
        creado_ts: cuerpo.creado_ts ?? 0,
      };
      return true;
    } catch (causa) {
      this.error = causa instanceof Error ? causa.message : "No se pudo leer el archivo";
      return false;
    } finally {
      this.restaurando = false;
    }
  }
}

export const respaldo = new StoreRespaldo();
