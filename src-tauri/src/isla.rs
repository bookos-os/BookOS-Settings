//! Publica las transferencias de Book Share en la isla de actividades de
//! `org.bookos.Desktop` y atiende su botón «Cancelar».
//!
//! Sin sesión BookOS no hay isla: las llamadas fallan y se ignoran, la
//! transferencia sigue igual.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures::StreamExt;
use rqs_lib::channel::{ChannelDirection, ChannelMessage, TransferType};
use rqs_lib::State as Estado;
use tauri::{AppHandle, Manager};

const APP_ID: &str = "com.bookos.settings";
const SERVICIO: &str = "org.bookos.Desktop";
const RUTA: &str = "/org/bookos/Desktop";
const INTERFAZ: &str = "org.bookos.Desktop";

/// rqs_lib manda un mensaje por paquete: a esa cadencia la isla repintaría
/// cientos de veces por segundo para mover una barra que el ojo lee a 2 Hz.
const ENTRE_PUBLICACIONES: Duration = Duration::from_millis(500);

struct Muestra {
    instante: Instant,
    bytes: u64,
    /// Velocidad suavizada, bytes/s. Sin suavizar, la cifra salta en cada
    /// ráfaga del canal y no se puede leer.
    velocidad: f64,
    publicado: Instant,
}

/// La transferencia viva: de la que se publica y a la que va «Cancelar».
static ACTUAL: Mutex<Option<String>> = Mutex::new(None);
static MUESTRAS: Mutex<Option<HashMap<String, Muestra>>> = Mutex::new(None);

pub fn hay_transferencia() -> bool {
    ACTUAL.lock().expect("bloqueo de la transferencia viva").is_some()
}

async fn conexion() -> Result<zbus::Connection, String> {
    zbus::Connection::session().await.map_err(|e| e.to_string())
}

async fn llamar<B>(metodo: &'static str, cuerpo: &B) -> Result<(), String>
where
    B: serde::Serialize + zbus::zvariant::DynamicType,
{
    let c = conexion().await?;
    let p = zbus::Proxy::new(&c, SERVICIO, RUTA, INTERFAZ).await.map_err(|e| e.to_string())?;
    p.call_method(metodo, cuerpo).await.map_err(|e| e.to_string())?;
    Ok(())
}

fn bytes_legibles(b: f64) -> String {
    const U: [&str; 4] = ["B", "KB", "MB", "GB"];
    let (mut v, mut i) = (b, 0);
    while v >= 1024.0 && i < U.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 { format!("{v:.0} {}", U[i]) } else { format!("{v:.1} {}", U[i]) }
}

/// Se llama con cada `ChannelMessage` que sale de rqs_lib.
pub async fn transferencia(msg: &ChannelMessage) {
    if msg.direction != ChannelDirection::LibToFront {
        return;
    }
    let (Some(estado), Some(meta)) = (msg.state.as_ref(), msg.meta.as_ref()) else { return };
    match estado {
        Estado::ReceivingFiles | Estado::SendingFiles => {}
        Estado::Finished | Estado::Cancelled | Estado::Rejected | Estado::Disconnected => {
            let era_la_viva = {
                let mut a = ACTUAL.lock().expect("bloqueo de la transferencia viva");
                let es = a.as_deref() == Some(msg.id.as_str());
                if es { *a = None; }
                es
            };
            if let Some(m) = MUESTRAS.lock().expect("bloqueo de muestras").as_mut() {
                m.remove(&msg.id);
            }
            if era_la_viva {
                let _ = llamar("CloseActivity", &(APP_ID.to_string(),)).await;
            }
            return;
        }
        // El resto son pasos del apretón de manos: aún no hay nada que enseñar.
        _ => return,
    }

    let ahora = Instant::now();
    let velocidad = {
        let mut mapa = MUESTRAS.lock().expect("bloqueo de muestras");
        let mapa = mapa.get_or_insert_with(HashMap::new);
        let m = mapa.entry(msg.id.clone()).or_insert(Muestra {
            instante: ahora,
            bytes: meta.ack_bytes,
            velocidad: 0.0,
            // Hace más de un periodo: la primera publicación sale sin esperar.
            publicado: ahora - ENTRE_PUBLICACIONES,
        });
        let dt = ahora.duration_since(m.instante).as_secs_f64();
        if dt >= 0.25 {
            let inst = meta.ack_bytes.saturating_sub(m.bytes) as f64 / dt;
            m.velocidad = if m.velocidad == 0.0 { inst } else { m.velocidad * 0.7 + inst * 0.3 };
            m.instante = ahora;
            m.bytes = meta.ack_bytes;
        }
        if ahora.duration_since(m.publicado) < ENTRE_PUBLICACIONES {
            return;
        }
        m.publicado = ahora;
        m.velocidad
    };
    *ACTUAL.lock().expect("bloqueo de la transferencia viva") = Some(msg.id.clone());

    let enviando = msg.rtype == Some(TransferType::Outbound);
    let espanol = crate::idioma_interfaz() == "es";
    let archivos = meta.files.as_deref().unwrap_or(&[]);
    let titulo = match archivos {
        [] => if espanol { "Archivos" } else { "Files" }.to_string(),
        [uno] => uno.clone(),
        [uno, resto @ ..] => if espanol {
            format!("{uno} y {} más", resto.len())
        } else {
            format!("{uno} and {} more", resto.len())
        },
    };
    let otro = if enviando {
        meta.destination.clone().unwrap_or_default()
    } else {
        meta.source.as_ref().map(|s| s.name.clone()).unwrap_or_default()
    };
    let subtitulo = format!(
        "{} {}{}{}",
        match (espanol, enviando) {
            (true, true) => "Enviando a",
            (true, false) => "Recibiendo de",
            (false, true) => "Sending to",
            (false, false) => "Receiving from",
        },
        if otro.is_empty() {
            if espanol { "otro dispositivo" } else { "another device" }
        } else { otro.as_str() },
        if velocidad > 0.0 { " · " } else { "" },
        if velocidad > 0.0 { format!("{}/s", bytes_legibles(velocidad)) } else { String::new() },
    );
    let total = meta.total_bytes.max(1);
    let nivel = (meta.ack_bytes as f64 / total as f64).clamp(0.0, 1.0);
    let restante_ms = if velocidad > 1.0 {
        (meta.total_bytes.saturating_sub(meta.ack_bytes) as f64 / velocidad * 1000.0) as i64
    } else {
        -1
    };
    let estado = serde_json::json!({
        "activo": true,
        "titulo": titulo,
        "subtitulo": subtitulo,
        "nivel": nivel,
        "restante_ms": restante_ms,
    });
    let _ = llamar("PublishActivity", &(APP_ID.to_string(), "transfer".to_string(), estado.to_string())).await;
}

/// Escucha «Cancelar» de la isla y lo convierte en `CancelTransfer`.
pub fn escuchar(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let Ok(c) = conexion().await else { return };
        let Ok(p) = zbus::Proxy::new(&c, SERVICIO, RUTA, INTERFAZ).await else { return };
        let Ok(mut senales) = p.receive_signal("ActivityAction").await else { return };
        while let Some(m) = senales.next().await {
            let Ok((destino, accion, _)) = m.body().deserialize::<(String, String, String)>() else { continue };
            if destino != APP_ID || accion != "cancel" {
                continue;
            }
            let id = ACTUAL.lock().expect("bloqueo de la transferencia viva").clone();
            if let Some(id) = id {
                let estado = app.state::<crate::quickshare::QsState>();
                let _ = crate::quickshare::qs_cancel(id, estado).await;
            }
        }
    });
}
