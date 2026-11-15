//! Las transferencias en la isla de actividades de `org.bookos.Desktop`, con
//! su botón «Cancelar». Antes lo hacía Ajustes; aquí sale también con Ajustes
//! cerrado, que es cuando más hace falta.
//!
//! Sin sesión BookOS no hay isla: las llamadas fallan y se ignoran.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use futures::StreamExt;
use tokio::sync::Mutex;
use zbus::Connection;

use crate::{Direccion, Estado, Evento};

const APP_ID: &str = "com.bookos.bookshare";
const ESCRITORIO: &str = "org.bookos.Desktop";
const RUTA: &str = "/org/bookos/Desktop";

/// El progreso llega a diez por segundo; la barra se lee a dos.
const ENTRE_PUBLICACIONES: Duration = Duration::from_millis(500);

struct Muestra {
    instante: Instant,
    bytes: u64,
    /// Velocidad suavizada, bytes/s: sin suavizar salta en cada ráfaga.
    velocidad: f64,
    publicado: Option<Instant>,
}

#[derive(Default)]
pub struct Isla {
    /// La transferencia que se ve: a ella va «Cancelar».
    pub actual: Mutex<Option<String>>,
    muestras: Mutex<HashMap<String, Muestra>>,
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

async fn llamar<B>(c: &Connection, metodo: &str, cuerpo: &B)
where
    B: serde::Serialize + zbus::zvariant::DynamicType,
{
    let _ = c.call_method(Some(ESCRITORIO), RUTA, Some(ESCRITORIO), metodo, cuerpo).await;
}

impl Isla {
    pub async fn publicar(&self, c: &Connection, ev: &Evento) {
        if ev.estado.es_final() {
            self.muestras.lock().await.remove(&ev.id);
            let era = {
                let mut a = self.actual.lock().await;
                let era = a.as_deref() == Some(ev.id.as_str());
                if era {
                    *a = None;
                }
                era
            };
            if era {
                llamar(c, "CloseActivity", &(APP_ID,)).await;
            }
            return;
        }
        if ev.estado != Estado::Transfiriendo {
            return;
        }
        let ahora = Instant::now();
        let velocidad = {
            let mut mapa = self.muestras.lock().await;
            let m = mapa.entry(ev.id.clone()).or_insert(Muestra { instante: ahora, bytes: ev.hechos, velocidad: 0.0, publicado: None });
            let dt = ahora.duration_since(m.instante).as_secs_f64();
            if dt >= 0.25 {
                let inst = ev.hechos.saturating_sub(m.bytes) as f64 / dt;
                m.velocidad = if m.velocidad == 0.0 { inst } else { m.velocidad * 0.7 + inst * 0.3 };
                m.instante = ahora;
                m.bytes = ev.hechos;
            }
            if m.publicado.is_some_and(|p| ahora.duration_since(p) < ENTRE_PUBLICACIONES) {
                return;
            }
            m.publicado = Some(ahora);
            m.velocidad
        };
        *self.actual.lock().await = Some(ev.id.clone());

        let es = std::env::var("LANG").map(|l| l.starts_with("es")).unwrap_or(true);
        let titulo = match (&ev.texto, ev.elementos.as_slice()) {
            (Some(t), _) => t.titulo.chars().take(60).collect(),
            (None, []) => if es { "Archivos" } else { "Files" }.to_string(),
            (None, [uno]) => uno.nombre.clone(),
            (None, [uno, resto @ ..]) => {
                if es { format!("{} y {} más", uno.nombre, resto.len()) } else { format!("{} and {} more", uno.nombre, resto.len()) }
            }
        };
        let accion = match (es, ev.direccion) {
            (true, Direccion::Saliente) => "Enviando a",
            (true, Direccion::Entrante) => "Recibiendo de",
            (false, Direccion::Saliente) => "Sending to",
            (false, Direccion::Entrante) => "Receiving from",
        };
        let otro = if ev.aparato.is_empty() { if es { "otro dispositivo" } else { "another device" } } else { ev.aparato.as_str() };
        let rapidez = if velocidad > 0.0 { format!(" · {}/s", bytes_legibles(velocidad)) } else { String::new() };
        let total = ev.total.max(1);
        let restante_ms = if velocidad > 1.0 { (ev.total.saturating_sub(ev.hechos) as f64 / velocidad * 1000.0) as i64 } else { -1 };
        let estado = serde_json::json!({
            "activo": true,
            "titulo": titulo,
            "subtitulo": format!("{accion} {otro}{rapidez}"),
            "nivel": (ev.hechos as f64 / total as f64).clamp(0.0, 1.0),
            "restante_ms": restante_ms,
        });
        llamar(c, "PublishActivity", &(APP_ID, "transfer", estado.to_string())).await;
    }
}

/// Espera «Cancelar» en la isla y devuelve la transferencia a la que va.
pub async fn esperar_cancelar(c: &Connection, isla: &Isla, mut cancelar: impl FnMut(String)) {
    let Ok(p) = zbus::Proxy::new(c, ESCRITORIO, RUTA, ESCRITORIO).await else { return };
    let Ok(mut senales) = p.receive_signal("ActivityAction").await else { return };
    while let Some(m) = senales.next().await {
        let Ok((destino, accion, _)) = m.body().deserialize::<(String, String, String)>() else { continue };
        if destino == APP_ID && accion == "cancel" {
            if let Some(id) = isla.actual.lock().await.clone() {
                cancelar(id);
            }
        }
    }
}
