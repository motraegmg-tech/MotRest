/*
 * Pantalla de arranque de la caja.
 *
 * VIVE EN SU PROPIO ARCHIVO, y no dentro del HTML, por una sola razón: mientras
 * estuvo en línea, la CSP de la aplicación tenía que llevar
 * `script-src 'unsafe-inline'` para poder ejecutarlo. Y esa CSP no solo cubre
 * esta pantalla: cubre también el POS que se carga desde el Hub. Es decir, un
 * `<script>` de doce líneas obligaba a permitir CUALQUIER script en línea en
 * toda la aplicación, que es justo lo que convierte un XSS en ejecución.
 *
 * Existe por una razón concreta: el punto de venta se carga DESDE el Hub,
 * no desde el paquete de la aplicación. Así la caja queda emparejada con
 * su propio Hub y toda la operación se guarda en el registro del local —
 * antes se guardaba en el almacenamiento del navegador interno y el
 * registro quedaba vacío.
 *
 * El Hub tarda un momento en levantar (genera su clave y su certificado
 * la primera vez), así que aquí se espera a que responda.
 */
const DESTINO = "http://localhost:8788/";
const SALUD = "http://localhost:8788/salud";
const LIMITE_MS = 30000;

const estado = document.getElementById("estado");
const barra = document.getElementById("barra");
const reintentar = document.getElementById("reintentar");
let desde = Date.now();

async function esperarAlHub() {
  try {
    /*
     * `no-cors` a propósito.
     *
     * La aplicación corre en el origen `tauri.localhost`, así que una
     * consulta normal al Hub sería de origen cruzado y el navegador la
     * bloquearía. Con `no-cors` la respuesta llega opaca —no se puede
     * leer— pero es todo lo que hace falta: si el Hub no está
     * escuchando, la promesa se rechaza; si responde, se cumple.
     *
     * La alternativa era abrir CORS en el Hub, y eso permitiría a
     * cualquier página que el usuario visite preguntarle cosas.
     */
    await fetch(SALUD, { cache: "no-store", mode: "no-cors" });
    estado.textContent = "Listo";
    location.replace(DESTINO);
    return;
  } catch {
    // Todavía no escucha; es lo normal en los primeros segundos.
  }

  if (Date.now() - desde > LIMITE_MS) {
    barra.hidden = true;
    estado.className = "estado fallo";
    estado.textContent =
      "El servicio del local no respondió. Cierra MotRest y vuelve a abrirlo; " +
      "si sigue igual, revisa que no haya otra copia abierta.";
    reintentar.hidden = false;
    return;
  }

  if (Date.now() - desde > 6000) {
    estado.textContent = "Preparando el local por primera vez…";
  }
  setTimeout(esperarAlHub, 400);
}

reintentar.addEventListener("click", () => {
  desde = Date.now();
  barra.hidden = false;
  reintentar.hidden = true;
  estado.className = "estado";
  estado.textContent = "Abriendo el local…";
  esperarAlHub();
});

esperarAlHub();
