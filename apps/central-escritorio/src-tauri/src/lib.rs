//! MOTRAE Central para Windows.
//!
//! ## Por qué es una app y no una pestaña del navegador
//!
//! Dos razones, y la segunda pesa más que la primera:
//!
//! 1. **Necesita `crypto.subtle`.** Aquí se firman licencias y manifiestos de
//!    actualización, y se derivan hashes PBKDF2 de la contraseña de soporte. El
//!    motor criptográfico del navegador solo existe en contextos seguros.
//!
//! 2. **Los secretos viven en el almacenamiento de la app, no en el navegador
//!    de diario.** En una pestaña compartirían espacio con toda la navegación
//!    normal: cualquier extensión instalada podría leerlos, y bastaría con
//!    "borrar datos de navegación" para perder las llaves con las que se firman
//!    TODAS las licencias. En una app tienen su propio almacén, aislado.
//!
//! ## Lo que esta app NO hace
//!
//! No arranca procesos, no abre puertos y no habla con la red del local. Es un
//! panel de lectura y firma. Por eso no lleva `tauri-plugin-shell` ni ninguna
//! capacidad remota: la app que guarda las llaves de todos los restaurantes se
//! queda con el mínimo de permisos que le permita funcionar.
//!
//! ## Dónde NO se instala
//!
//! En ninguna computadora de restaurante. Es de MOTRAE y solo de MOTRAE.

pub fn ejecutar() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("No se pudo arrancar MOTRAE Central");
}
