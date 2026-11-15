//! Notificaciones del escritorio: la petición entrante con Aceptar/Rechazar
//! (con Ajustes cerrado es la única forma de contestar) y el resultado.

use std::collections::HashMap;
use std::sync::Mutex;

use zbus::zvariant::Value;
use zbus::Connection;

use crate::{Direccion, Estado, Evento};

const NOTIFICACIONES: &str = "org.freedesktop.Notifications";
const RUTA: &str = "/org/freedesktop/Notifications";

/// Notificación de resultado → qué abre su botón (carpeta, archivo o URL).
static ABRIR: Mutex<Option<HashMap<u32, String>>> = Mutex::new(None);

fn espanol() -> bool {
    std::env::var("LANG").map(|l| l.starts_with("es")).unwrap_or(true)
}

fn bytes_legibles(b: u64) -> String {
    const U: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = b as f64;
    let mut i = 0;
    while v >= 1024.0 && i < U.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 { format!("{b} B") } else { format!("{v:.1} {}", U[i]) }
}

fn que(ev: &Evento) -> String {
    let es = espanol();
    if let Some(t) = &ev.texto {
        return t.titulo.chars().take(80).collect();
    }
    match ev.elementos.as_slice() {
        [] => if es { "archivos" } else { "files" }.into(),
        [uno] => format!("{} ({})", uno.nombre, bytes_legibles(uno.bytes)),
        [uno, resto @ ..] => {
            if es {
                format!("{} y {} más ({})", uno.nombre, resto.len(), bytes_legibles(ev.total))
            } else {
                format!("{} and {} more ({})", uno.nombre, resto.len(), bytes_legibles(ev.total))
            }
        }
    }
}

async fn notificar(c: &Connection, titulo: &str, cuerpo: &str, acciones: &[&str], residente: bool) -> Option<u32> {
    let mut pistas: HashMap<&str, Value> = HashMap::new();
    pistas.insert("desktop-entry", Value::from("bookos-settings"));
    if residente {
        pistas.insert("resident", Value::from(true));
        pistas.insert("urgency", Value::from(2u8));
    }
    c.call_method(
        Some(NOTIFICACIONES),
        RUTA,
        Some(NOTIFICACIONES),
        "Notify",
        &("Book Share", 0u32, "folder-download", titulo, cuerpo, acciones, pistas, if residente { 0i32 } else { -1 }),
    )
    .await
    .ok()?
    .body()
    .deserialize::<u32>()
    .ok()
}

/// «Galaxy S25 quiere enviarte foto.jpg (3,2 MB) · PIN 1234», con Aceptar y Rechazar.
pub async fn pedir(c: &Connection, ev: &Evento) -> Option<u32> {
    let es = espanol();
    let quien = if ev.aparato.is_empty() { if es { "Un dispositivo cercano" } else { "A nearby device" } } else { ev.aparato.as_str() };
    let titulo = if es { format!("{quien} quiere compartir contigo") } else { format!("{quien} wants to share with you") };
    let pin = ev.pin.as_deref().map(|p| format!("\nPIN {p}")).unwrap_or_default();
    let cuerpo = format!("{}{pin}", que(ev));
    let acciones: &[&str] = if es { &["aceptar", "Aceptar", "rechazar", "Rechazar"] } else { &["aceptar", "Accept", "rechazar", "Decline"] };
    notificar(c, &titulo, &cuerpo, acciones, true).await
}

pub async fn cerrar(c: &Connection, id: u32) {
    let _ = c.call_method(Some(NOTIFICACIONES), RUTA, Some(NOTIFICACIONES), "CloseNotification", &(id,)).await;
}

pub async fn resultado(c: &Connection, ev: &Evento) {
    let es = espanol();
    let (titulo, abrir): (String, Option<String>) = match (&ev.direccion, &ev.estado) {
        (Direccion::Entrante, Estado::Terminada) => {
            let abrir = match &ev.texto {
                Some(t) if t.tipo == crate::TipoTexto::Url => t.contenido.clone(),
                Some(_) => None,
                None => ev.elementos.first().and_then(|e| e.ruta.as_ref()).and_then(|r| r.parent()).map(|p| p.display().to_string()),
            };
            (if es { format!("Recibido de {}", ev.aparato) } else { format!("Received from {}", ev.aparato) }, abrir)
        }
        (Direccion::Saliente, Estado::Terminada) => (if es { format!("Enviado a {}", ev.aparato) } else { format!("Sent to {}", ev.aparato) }, None),
        (Direccion::Saliente, Estado::Rechazada) => (if es { format!("{} no lo ha aceptado", ev.aparato) } else { format!("{} declined", ev.aparato) }, None),
        (_, Estado::Fallida(motivo)) => (if es { format!("No se pudo completar: {motivo}") } else { format!("Could not complete: {motivo}") }, None),
        // Rechazada o cancelada por quien la recibe aquí: lo acaba de pulsar, no hace falta avisar.
        _ => return,
    };
    let cuerpo = match &ev.texto {
        Some(t) => t.contenido.clone().unwrap_or_default().chars().take(300).collect(),
        None => que(ev),
    };
    let acciones: Vec<&str> = match &abrir {
        Some(_) if ev.texto.is_some() => vec!["abrir", if es { "Abrir enlace" } else { "Open link" }],
        Some(_) => vec!["abrir", if es { "Abrir carpeta" } else { "Open folder" }],
        None => vec![],
    };
    if let (Some(id), Some(a)) = (notificar(c, &titulo, &cuerpo, &acciones, false).await, abrir) {
        ABRIR.lock().expect("mapa de avisos").get_or_insert_with(HashMap::new).insert(id, a);
    }
}

/// El botón «Abrir» de una notificación de resultado.
pub async fn accion_resultado(id: u32, accion: &str) {
    if accion != "abrir" {
        return;
    }
    let destino = ABRIR.lock().expect("mapa de avisos").as_mut().and_then(|m| m.remove(&id));
    if let Some(d) = destino {
        let _ = tokio::process::Command::new("xdg-open").arg(d).spawn();
    }
}
