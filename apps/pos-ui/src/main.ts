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

const target = document.getElementById("app");
if (!target) {
  throw new Error('No se encontró el contenedor #app en index.html');
}

export default mount(App, { target });
