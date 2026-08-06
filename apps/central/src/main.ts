// Tipografías empaquetadas localmente (@fontsource, sin CDN — exigencia TRD §8).
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";

import { mount } from "svelte";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app")! });
