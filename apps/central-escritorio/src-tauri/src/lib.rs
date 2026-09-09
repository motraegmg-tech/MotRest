//! MotRest Central para Windows.
//!
//! Central firma licencias y manifiestos para toda la cartera, así que sus
//! privadas no pueden vivir en `localStorage` ni en el perfil sin cifrar de la
//! webview. Este módulo las protege con DPAPI antes de escribir un solo byte a
//! disco. DPAPI las liga al usuario de Windows de Gonzalo: copiar el archivo a
//! otra cuenta no permite descifrarlo.
//!
//! La firma Ed25519 se mantiene en WebCrypto porque Central comparte esa
//! implementación con el dominio. La privada solo se entrega al frontend de la
//! propia ventana, cuando éste la necesita para firmar; nunca se renderiza ni se
//! deja en el almacenamiento del navegador.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

const ARCHIVO_SECRETOS: &str = "secretos.dpapi";

fn ruta_secretos(app: &AppHandle) -> Result<PathBuf, String> {
    let carpeta = app
        .path()
        .app_local_data_dir()
        .map_err(|causa| format!("No se pudo resolver la carpeta segura de Central: {causa}"))?;
    fs::create_dir_all(&carpeta)
        .map_err(|causa| format!("No se pudo crear la carpeta segura de Central: {causa}"))?;
    Ok(carpeta.join(ARCHIVO_SECRETOS))
}

fn blob(bytes: &mut [u8]) -> Result<CRYPT_INTEGER_BLOB, String> {
    let longitud = u32::try_from(bytes.len())
        .map_err(|_| "El almacén de secretos excede el tamaño permitido por DPAPI".to_string())?;
    Ok(CRYPT_INTEGER_BLOB {
        cbData: longitud,
        pbData: bytes.as_mut_ptr(),
    })
}

fn copiar_y_liberar(salida: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    let bytes = if salida.pbData.is_null() || salida.cbData == 0 {
        Vec::new()
    } else {
        // CryptProtectData/CryptUnprotectData asignan esta memoria con LocalAlloc.
        unsafe { std::slice::from_raw_parts(salida.pbData, salida.cbData as usize).to_vec() }
    };
    if !salida.pbData.is_null() {
        unsafe {
            LocalFree(salida.pbData.cast());
        }
    }
    bytes
}

fn proteger(datos: &str) -> Result<Vec<u8>, String> {
    let mut entrada_bytes = datos.as_bytes().to_vec();
    let entrada = blob(&mut entrada_bytes)?;
    let mut salida = CRYPT_INTEGER_BLOB::default();
    let correcto = unsafe {
        CryptProtectData(
            &entrada,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut salida,
        )
    };
    entrada_bytes.fill(0);

    if correcto == 0 {
        return Err(format!(
            "Windows no pudo proteger las llaves con DPAPI: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(copiar_y_liberar(salida))
}

fn desproteger(cifrado: &[u8]) -> Result<String, String> {
    let mut entrada_bytes = cifrado.to_vec();
    let entrada = blob(&mut entrada_bytes)?;
    let mut salida = CRYPT_INTEGER_BLOB::default();
    let correcto = unsafe {
        CryptUnprotectData(
            &entrada,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut salida,
        )
    };
    entrada_bytes.fill(0);

    if correcto == 0 {
        return Err(format!(
            "Windows no pudo abrir las llaves protegidas con DPAPI: {}",
            std::io::Error::last_os_error()
        ));
    }

    String::from_utf8(copiar_y_liberar(salida))
        .map_err(|_| "El almacén DPAPI de Central no contiene texto UTF-8 válido".to_string())
}

fn validar_json(texto: &str) -> Result<(), String> {
    match serde_json::from_str::<serde_json::Value>(texto) {
        Ok(serde_json::Value::Object(_)) => Ok(()),
        _ => Err("El almacén de secretos debe contener un objeto JSON".to_string()),
    }
}

fn escribir_cifrado(app: &AppHandle, cifrado: &[u8]) -> Result<(), String> {
    let ruta = ruta_secretos(app)?;
    fs::write(&ruta, cifrado)
        .map_err(|causa| format!("No se pudo guardar el almacén DPAPI de Central: {causa}"))
}

/// Persiste el objeto de claves cifrado por Windows antes de tocar el disco.
#[tauri::command]
fn guardar_secretos(app: AppHandle, secretos: String) -> Result<(), String> {
    validar_json(&secretos)?;
    escribir_cifrado(&app, &proteger(&secretos)?)
}

/// Devuelve el objeto únicamente a la ventana de Central, para una firma puntual.
#[tauri::command]
fn cargar_secretos(app: AppHandle) -> Result<Option<String>, String> {
    let ruta = ruta_secretos(&app)?;
    if !ruta.exists() {
        return Ok(None);
    }
    let cifrado = fs::read(&ruta)
        .map_err(|causa| format!("No se pudo leer el almacén DPAPI de Central: {causa}"))?;
    desproteger(&cifrado).map(Some)
}

/// Copia el blob DPAPI, no las privadas. Solo restaura en el mismo perfil Windows.
#[tauri::command]
fn respaldo_de_secretos(app: AppHandle) -> Result<Option<Vec<u8>>, String> {
    let ruta = ruta_secretos(&app)?;
    if !ruta.exists() {
        return Ok(None);
    }
    fs::read(&ruta)
        .map(Some)
        .map_err(|causa| format!("No se pudo respaldar el almacén DPAPI de Central: {causa}"))
}

/// Restaura solo un blob que DPAPI pueda abrir y que contenga el JSON esperado.
#[tauri::command]
fn restaurar_secretos(app: AppHandle, respaldo: Vec<u8>) -> Result<(), String> {
    let texto = desproteger(&respaldo)?;
    validar_json(&texto)?;
    escribir_cifrado(&app, &respaldo)
}

/// Lo que la ventana recibe de una llamada a la nube. Sin cabeceras de más.
#[derive(serde::Serialize)]
struct RespuestaNube {
    estado: u16,
    cuerpo: String,
    /// Solo esta cabecera, y solo porque de ella sale el total de un conteo.
    content_range: Option<String>,
}

/// Habla con la nube de MotRest **desde Rust**, no desde la webview.
///
/// POR QUÉ EXISTE, y no es una preferencia de estilo: Supabase **rechaza** una
/// llave de servicio si la petición trae `User-Agent` de navegador. Contesta
/// `401 Forbidden use of secret API key in browser`. La interfaz de Central
/// corre en una webview, así que cada llamada suya llegaba con esa cabecera y
/// era rechazada.
///
/// Y el control tiene razón. Esa llave se salta **todas** las políticas RLS:
/// quien la tenga lee el padrón entero de MOTRAE y puede repartir licencias. No
/// tiene nada que hacer en un contexto donde el contenido web podría leerla.
///
/// Así que la llave se lee aquí, del almacén que ya protege DPAPI, y no viaja a
/// la ventana. La ventana dice **qué** quiere pedir; nunca **con qué**.
#[tauri::command]
async fn nube_peticion(
    app: AppHandle,
    metodo: String,
    ruta: String,
    cuerpo: Option<String>,
    // `bytes` es el instalador, cuando lo que se sube no es JSON.
    bytes: Option<Vec<u8>>,
    prefer: Option<String>,
    upsert: Option<bool>,
) -> Result<RespuestaNube, String> {
    /*
     * La ruta se comprueba contra una lista blanca.
     *
     * La ventana elige el camino, y aunque sea nuestra propia interfaz, esto
     * impide que un `../` o una ruta absoluta acaben mandando la llave de
     * servicio a otro sitio. Es la misma regla que el Hub aplica a la URL de un
     * manifiesto firmado: decir qué instalar no autoriza a pedirlo donde sea.
     */
    if !ruta.starts_with("/rest/v1/") && !ruta.starts_with("/storage/v1/") {
        return Err(format!("Ruta no permitida para la nube: {ruta}"));
    }
    if ruta.contains("..") {
        return Err("La ruta de la nube no puede subir de directorio".into());
    }

    let secretos = cargar_secretos(app)?.ok_or("Todavía no hay secretos guardados en Central")?;
    let json: serde_json::Value = serde_json::from_str(&secretos)
        .map_err(|causa| format!("El almacén de Central no es JSON: {causa}"))?;

    let base = json["nube_url"]
        .as_str()
        .unwrap_or("")
        .trim_end_matches('/')
        .to_string();
    let llave = json["nube_servicio"].as_str().unwrap_or("").to_string();
    if base.is_empty() || llave.is_empty() {
        return Err("Falta la dirección de la nube o su llave de servicio (ver Llaves)".into());
    }
    if !base.starts_with("https://") {
        return Err("La dirección de la nube tiene que ser https://".into());
    }

    let cliente = reqwest::Client::builder()
        // Explícito, y NO uno de navegador: es justo lo que distingue esta
        // llamada de la que Supabase rechaza.
        .user_agent("MotRest-Central")
        .build()
        .map_err(|causa| format!("No se pudo preparar la conexión: {causa}"))?;

    let verbo = reqwest::Method::from_bytes(metodo.as_bytes())
        .map_err(|_| format!("Método HTTP inválido: {metodo}"))?;

    let mut peticion = cliente
        .request(verbo, format!("{base}{ruta}"))
        .header("apikey", &llave)
        .bearer_auth(&llave);

    if let Some(p) = prefer {
        peticion = peticion.header("prefer", p);
    }
    if upsert == Some(true) {
        // Volver a publicar una versión reemplaza su archivo. Sin esto, un
        // segundo intento tras un fallo a medias daría «ya existe» y habría que
        // ir a borrarlo a mano al panel de Supabase.
        peticion = peticion.header("x-upsert", "true");
    }
    if let Some(b) = bytes {
        peticion = peticion
            .header("content-type", "application/octet-stream")
            .body(b);
    } else if let Some(c) = cuerpo {
        peticion = peticion.header("content-type", "application/json").body(c);
    }

    let respuesta = peticion
        .send()
        .await
        .map_err(|causa| format!("No se pudo hablar con la nube: {causa}"))?;

    let estado = respuesta.status().as_u16();
    let content_range = respuesta
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_string());
    let cuerpo = respuesta
        .text()
        .await
        .map_err(|causa| format!("No se pudo leer la respuesta de la nube: {causa}"))?;

    Ok(RespuestaNube {
        estado,
        cuerpo,
        content_range,
    })
}

pub fn ejecutar() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            guardar_secretos,
            cargar_secretos,
            respaldo_de_secretos,
            restaurar_secretos,
            nube_peticion,
        ])
        .run(tauri::generate_context!())
        .expect("No se pudo arrancar MotRest Central");
}
