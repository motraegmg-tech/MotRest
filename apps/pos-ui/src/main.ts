// Tipografías empaquetadas localmente (@fontsource, sin CDN — exigencia TRD §8).
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";

// Estilos base + tokens de marca de MotRest.
import "@motrest/ui/base.css";

import { mount } from "svelte";
import App from "./App.svelte";
import { arranque } from "./lib/persistencia/arranque.svelte";
import { esWeb } from "./lib/entorno";
import { accesoWeb } from "./lib/web/acceso-web.svelte";
import { sync } from "./lib/sync.svelte";
import { sesion } from "./lib/sesion/sesion.svelte";

const target = document.getElementById("app");
if (!target) {
  throw new Error('No se encontró el contenedor #app en index.html');
}

/*
 * EN LA WEB (1.6.0) EL RESTAURANTE VA PRIMERO. Sin «Entra a tu restaurante» no
 * se sabe de quién son los datos ni a dónde sincronizar, así que el arranque
 * espera. Con el restaurante ya elegido, la sincronización usa el túnel o la
 * nube en vez de la red del salón, y en modalidad nube la licencia se lee de la
 * nube porque no hay caja que la sirva.
 */
async function arrancarWeb(): Promise<void> {
  if (!(await accesoWeb.restaurar())) return;
  const destino = accesoWeb.destino();
  if (destino) sync.usarDestinoWeb(destino);
  if (accesoWeb.restaurante?.modalidad === "nube") {
    sesion.usarFuenteDeLicencia(() => accesoWeb.licenciaDeLaNube());
  }
  await arranque.iniciar();
}

// Rehidrata desde el almacén local antes de que el usuario toque nada.
if (esWeb()) void arrancarWeb();
else void arranque.iniciar();

export default mount(App, { target });
