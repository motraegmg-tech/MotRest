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

pub fn ejecutar() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            guardar_secretos,
            cargar_secretos,
            respaldo_de_secretos,
            restaurar_secretos,
        ])
        .run(tauri::generate_context!())
        .expect("No se pudo arrancar MotRest Central");
}
