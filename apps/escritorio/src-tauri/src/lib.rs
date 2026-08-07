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
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
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

/// Cuánto se espera antes de volver a levantar un Hub que murió.
///
/// Creciente hasta un minuto. Si el Hub muere por algo que no se arregla solo
/// —un puerto ocupado, una base corrupta— reintentar cada segundo llena el
/// registro y no arregla nada; con la espera creciente, la caja sigue
/// intentándolo toda la noche sin quemar la máquina.
const ESPERAS_REINICIO: [u64; 5] = [1, 3, 10, 30, 60];

/// Levanta el Hub que viene dentro del instalador, y lo vigila.
///
/// Si falla, la aplicación NO se cae: se abre igual y el punto de venta dirá
/// que no hay Hub. Un restaurante prefiere una caja que arranca con un aviso a
/// una que no arranca.
///
/// ## Por qué hay que vigilarlo
///
/// Antes se lanzaba una vez y nadie miraba si seguía vivo. Un Hub que se moría
/// a media cena —y bastaba una petición malformada para matarlo— dejaba la caja
/// sin cobrar hasta que alguien cerrara y reabriera MotRest. Nadie en un
/// restaurante lleno sabe que eso es lo que hay que hacer.
fn arrancar_hub(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut intento = 0usize;

        loop {
            let comando = match app.shell().sidecar("motrest-hub") {
                Ok(c) => c,
                Err(causa) => {
                    eprintln!("No se encontró el Hub en la instalación: {causa}");
                    return;
                }
            };

            let (mut eventos, hijo) = match comando.spawn() {
                Ok(par) => par,
                Err(causa) => {
                    eprintln!("No se pudo arrancar el Hub: {causa}");
                    return;
                }
            };

            if let Some(estado) = app.try_state::<ProcesoHub>() {
                if let Ok(mut proceso) = estado.0.lock() {
                    *proceso = Some(hijo);
                }
            }

            /*
             * Se CONSUME la salida del Hub en vez de descartarla.
             *
             * Antes este receptor se tiraba con `_recibidor`, y con él todo lo
             * que el Hub registra: «dispositivo sin aprobar intentó
             * sincronizar», «terminal autorizada por», mensajes que no
             * descifran. Sin eso, cuando algo pasa no hay nada que revisar.
             */
            let mut termino = false;
            while let Some(evento) = eventos.recv().await {
                match evento {
                    CommandEvent::Stdout(linea) | CommandEvent::Stderr(linea) => {
                        print!("{}", String::from_utf8_lossy(&linea));
                    }
                    CommandEvent::Terminated(fin) => {
                        eprintln!("El Hub terminó con código {:?}", fin.code);
                        termino = true;
                        break;
                    }
                    _ => {}
                }
            }

            if !termino {
                // El canal se cerró sin `Terminated`: el proceso ya no está.
                eprintln!("Se perdió el contacto con el Hub.");
            }

            // Si la ventana ya se cerró, `apagar` dejó el estado en None: no se
            // resucita nada. Sin esta comprobación, cerrar MotRest relanzaría
            // el Hub una vez más y dejaría el puerto ocupado.
            let sigue_viva = app
                .try_state::<ProcesoHub>()
                .and_then(|estado| estado.0.lock().ok().map(|p| p.is_some()))
                .unwrap_or(false);
            if !sigue_viva {
                return;
            }

            let espera = ESPERAS_REINICIO[intento.min(ESPERAS_REINICIO.len() - 1)];
            intento += 1;
            eprintln!("Reintentando levantar el Hub en {espera} s (intento {intento}).");
            tokio::time::sleep(std::time::Duration::from_secs(espera)).await;
        }
    });
}
