// Sin consola detrás de la ventana en Windows: esto es la caja de un
// restaurante, no una herramienta de desarrollo.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    motrest_lib::ejecutar();
}
