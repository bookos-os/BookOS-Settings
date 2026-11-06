//! Asistente de voz: cliente de `org.bookos.Assistant`.
//!
//! El asistente es el dueño del perfil, del micrófono y de la máquina de estados
//! del registro (bookos-ai/assistant/bookos_assistant/configuracion.py). Aquí no
//! se decide nada: cada comando devuelve el JSON del servicio y la página lo pinta.

use futures::StreamExt;
use tauri::Emitter;
use tokio::sync::OnceCell;

const SERVICIO: &str = "org.bookos.Assistant";
const RUTA: &str = "/org/bookos/Assistant";

static PROXY: OnceCell<zbus::Proxy<'static>> = OnceCell::const_new();
static AVISOS: OnceCell<()> = OnceCell::const_new();

async fn proxy() -> Result<&'static zbus::Proxy<'static>, String> {
    PROXY
        .get_or_try_init(|| async {
            let c = zbus::Connection::session().await?;
            zbus::proxy::Builder::<zbus::Proxy>::new(&c)
                .destination(SERVICIO)?
                .path(RUTA)?
                .interface(SERVICIO)?
                .cache_properties(zbus::proxy::CacheProperties::No)
                .build()
                .await
        })
        .await
        .map_err(|e| e.to_string())
}

async fn llamar<B>(metodo: &str, cuerpo: &B) -> Result<String, String>
where
    B: serde::Serialize + zbus::zvariant::DynamicType,
{
    let llamada = proxy().await?.call(metodo, cuerpo);
    // zbus espera sin límite. Si el proceso activado sale sin publicar el
    // nombre (otra instancia vieja tenía el socket), la página se quedaba en el
    // esqueleto para siempre. Arrancar y contestar GetState tarda ~1 s.
    tokio::time::timeout(std::time::Duration::from_secs(15), llamada)
        .await
        .map_err(|_| "El asistente no responde: tiempo agotado".to_string())?
        .map_err(|e| match e {
            // La página lo distingue de un fallo: pide instalarlo, no reintentar.
            zbus::Error::FDO(ref f) if matches!(**f, zbus::fdo::Error::ServiceUnknown(_)) => {
                "no-instalado".to_string()
            }
            zbus::Error::MethodError(nombre, _, _)
                if nombre.as_str().ends_with("ServiceUnknown") =>
            {
                "no-instalado".to_string()
            }
            otro => format!("El asistente no responde: {otro}"),
        })
}

/// Lee el estado y, la primera vez, empieza a reenviar sus cambios a la página.
#[tauri::command]
pub async fn get_asistente_estado(app: tauri::AppHandle) -> Result<String, String> {
    let estado = llamar("GetState", &()).await?;
    AVISOS
        .get_or_init(|| async {
            let Ok(p) = proxy().await else { return };
            let Ok(mut senales) = p.receive_signal("StateChanged").await else {
                return;
            };
            tauri::async_runtime::spawn(async move {
                while let Some(mensaje) = senales.next().await {
                    if let Ok(texto) = mensaje.body().deserialize::<String>() {
                        let _ = app.emit("asistente-estado", texto);
                    }
                }
            });
        })
        .await;
    Ok(estado)
}

#[tauri::command]
pub async fn asistente_nombre(nombre: String) -> Result<String, String> {
    llamar("SetName", &(nombre,)).await
}

#[tauri::command]
pub async fn asistente_escucha(activar: bool) -> Result<String, String> {
    llamar("SetListening", &(activar,)).await
}

/// Se identifica con su nombre en el bus para que el asistente cancele el
/// registro si este proceso muere con el micrófono abierto.
#[tauri::command]
pub async fn asistente_registro_empezar(nombre: String) -> Result<String, String> {
    let cliente = proxy()
        .await?
        .connection()
        .unique_name()
        .map(|n| n.to_string())
        .unwrap_or_default();
    llamar("StartEnrollment", &(nombre, cliente)).await
}

#[tauri::command]
pub async fn asistente_registro_preparar() -> Result<String, String> {
    llamar("PrepareModel", &()).await
}

#[tauri::command]
pub async fn asistente_registro_grabar() -> Result<String, String> {
    llamar("RecordTake", &()).await
}

#[tauri::command]
pub async fn asistente_registro_terminar_toma() -> Result<String, String> {
    llamar("FinishTake", &()).await
}

#[tauri::command]
pub async fn asistente_registro_cancelar_toma() -> Result<String, String> {
    llamar("CancelTake", &()).await
}

#[tauri::command]
pub async fn asistente_registro_repetir(toma: i32) -> Result<String, String> {
    llamar("RepeatTake", &(toma,)).await
}

#[tauri::command]
pub async fn asistente_registro_guardar() -> Result<String, String> {
    llamar("SaveEnrollment", &()).await
}

#[tauri::command]
pub async fn asistente_registro_cancelar() -> Result<String, String> {
    llamar("CancelEnrollment", &()).await
}

#[tauri::command]
pub async fn asistente_activar_microfono() -> Result<String, String> {
    llamar("UnmuteMicrophone", &()).await
}
