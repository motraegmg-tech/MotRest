//! MotRest para Windows: la caja del local.
//!
//! ## Por qué existe esta app, y no solo el navegador
//!
//! No es por rendimiento ni por estética. Los navegadores solo exponen
//! `crypto.subtle` —el motor criptográfico— en contextos seguros, y una
//! terminal abierta por la IP del local en `http://` no lo tiene. Sin él no se
//! pueden verificar contraseñas, ni cifrar el canal con el Hub, ni sellar el
//! corte de caja.
//!
//! Una app Tauri corre en un origen que el sistema considera seguro por
//! definición. El mismo POS, el mismo código, sin advertencias que saltarse.
//!
//! ## Qué hace
//!
//! Levanta el Hub del local como proceso hijo y muestra el punto de venta
//! apuntando a él. Un solo instalador deja la caja lista: es el criterio de
//! aceptación de la etapa 12.

use std::sync::Mutex;
use tauri::{Manager, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Puerto donde el Hub atiende sin certificado, solo desde este equipo.
const PUERTO_LOCAL: u16 = 8788;

/// El proceso del Hub, para poder cerrarlo al salir.
#[derive(Default)]
struct ProcesoHub(Mutex<Option<CommandChild>>);

#[derive(serde::Serialize)]
struct EstadoHub {
    corriendo: bool,
    url: String,
}

/// Dónde está el punto de venta que sirve el Hub de este equipo.
#[tauri::command]
fn estado_hub(proceso: State<ProcesoHub>) -> EstadoHub {
    EstadoHub {
        corriendo: proceso.0.lock().map(|p| p.is_some()).unwrap_or(false),
        url: format!("http://localhost:{PUERTO_LOCAL}/"),
    }
}

pub fn ejecutar() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ProcesoHub::default())
        .invoke_handler(tauri::generate_handler![estado_hub])
        .setup(|app| {
            arrancar_hub(app.handle());
            Ok(())
        })
        .on_window_event(|ventana, evento| {
            // Al cerrar la ventana se cierra el Hub. Dejarlo vivo tras cerrar
            // la caja mantendría el puerto ocupado y el siguiente arranque
            // fallaría sin explicación.
            if let tauri::WindowEvent::Destroyed = evento {
                if let Some(estado) = ventana.app_handle().try_state::<ProcesoHub>() {
                    if let Ok(mut proceso) = estado.0.lock() {
                        if let Some(hijo) = proceso.take() {
                            let _ = hijo.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar MotRest");
}

/// Levanta el Hub que viene dentro del instalador.
///
/// Si falla, la aplicación NO se cae: se abre igual y el punto de venta dirá
/// que no hay Hub. Un restaurante prefiere una caja que arranca con un aviso a
/// una que no arranca.
fn arrancar_hub(app: &tauri::AppHandle) {
    let comando = match app.shell().sidecar("motrest-hub") {
        Ok(c) => c,
        Err(causa) => {
            eprintln!("No se encontró el Hub en la instalación: {causa}");
            return;
        }
    };

    match comando.spawn() {
        Ok((_recibidor, hijo)) => {
            if let Some(estado) = app.try_state::<ProcesoHub>() {
                if let Ok(mut proceso) = estado.0.lock() {
                    *proceso = Some(hijo);
                }
            }
        }
        Err(causa) => eprintln!("No se pudo arrancar el Hub: {causa}"),
    }
}
