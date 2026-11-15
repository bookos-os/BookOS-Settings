//! Book Share: cliente de `org.bookos.BookShare`.
//!
//! El protocolo, la recepción en segundo plano, el descubrimiento y la isla
//! viven en el servicio `bookos-bookshare` (crate `bookshare/`). Aquí solo se
//! le pide cosas y se reenvía su estado a la página.

use futures::StreamExt;
use tauri::Emitter;
use tokio::sync::OnceCell;

const SERVICIO: &str = "org.bookos.BookShare";
const RUTA: &str = "/org/bookos/BookShare";

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
    // Mismo límite que el asistente: un servicio que no publica su nombre no
    // puede dejar la página esperando para siempre.
    tokio::time::timeout(std::time::Duration::from_secs(15), llamada)
        .await
        .map_err(|_| "Book Share no responde: tiempo agotado".to_string())?
        .map_err(|e| match e {
            zbus::Error::FDO(ref f) if matches!(**f, zbus::fdo::Error::ServiceUnknown(_)) => "no-instalado".to_string(),
            zbus::Error::MethodError(nombre, _, _) if nombre.as_str().ends_with("ServiceUnknown") => "no-instalado".to_string(),
            otro => format!("Book Share no responde: {otro}"),
        })
}

/// Lee el estado y, la primera vez, empieza a reenviar sus cambios a la página.
#[tauri::command]
pub async fn get_bookshare_estado(app: tauri::AppHandle) -> Result<String, String> {
    let estado = llamar("GetState", &()).await?;
    AVISOS
        .get_or_init(|| async {
            let Ok(p) = proxy().await else { return };
            let Ok(mut senales) = p.receive_signal("StateChanged").await else { return };
            tauri::async_runtime::spawn(async move {
                while let Some(m) = senales.next().await {
                    if let Ok(texto) = m.body().deserialize::<String>() {
                        let _ = app.emit("bookshare-estado", texto);
                    }
                }
            });
        })
        .await;
    Ok(estado)
}

#[tauri::command]
pub async fn get_bookshare_historial(limite: u32) -> Result<String, String> {
    llamar("GetHistory", &(limite,)).await
}

#[tauri::command]
pub async fn bookshare_activo(activo: bool) -> Result<String, String> {
    llamar("SetEnabled", &(activo,)).await
}

/// `visible`, `temporal` u `oculto`.
#[tauri::command]
pub async fn bookshare_visibilidad(modo: String) -> Result<String, String> {
    llamar("SetVisibility", &(modo,)).await
}

#[tauri::command]
pub async fn bookshare_nombre(nombre: String) -> Result<String, String> {
    llamar("SetName", &(nombre,)).await
}

/// El servicio busca mientras esta conexión siga en el bus: si Ajustes se
/// cierra o se cae, para solo.
#[tauri::command]
pub async fn bookshare_buscar() -> Result<String, String> {
    llamar("StartDiscovery", &()).await
}

#[tauri::command]
pub async fn bookshare_dejar_de_buscar() -> Result<String, String> {
    llamar("StopDiscovery", &()).await
}

#[tauri::command]
pub async fn bookshare_enviar(aparato: String, rutas: Vec<String>) -> Result<String, String> {
    llamar("SendFiles", &(aparato, rutas)).await
}

#[tauri::command]
pub async fn bookshare_enviar_texto(aparato: String, texto: String, url: bool) -> Result<String, String> {
    llamar("SendText", &(aparato, texto, url)).await
}

#[tauri::command]
pub async fn bookshare_aceptar(id: String) -> Result<String, String> {
    llamar("Accept", &(id,)).await
}

#[tauri::command]
pub async fn bookshare_rechazar(id: String) -> Result<String, String> {
    llamar("Reject", &(id,)).await
}

#[tauri::command]
pub async fn bookshare_cancelar(id: String) -> Result<String, String> {
    llamar("Cancel", &(id,)).await
}

#[tauri::command]
pub async fn bookshare_abrir_carpeta() -> Result<String, String> {
    llamar("OpenFolder", &()).await
}
