//! Cliente de `org.bookos.Desktop`: la gestión de pantallas de una sesión
//! BookOS.
//!
//! Los controles nativos requieren una sesión BookOS activa.
//!
//! Los tipos de aquí son la otra mitad del contrato que documenta
//! `bookos-comp/src/ajustes.rs`. Tienen que coincidir campo a campo y en orden:
//! D-Bus comprueba la firma, así que un desajuste falla al llamar y no en
//! silencio.

use serde::{Deserialize, Serialize};
use zbus::zvariant::Type;

const SERVICIO: &str = "org.bookos.Desktop";
const RUTA: &str = "/org/bookos/Desktop";
const INTERFAZ: &str = "org.bookos.Desktop";

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Modo {
    pub ancho: u32,
    pub alto: u32,
    pub refresco_mhz: u32,
    pub preferido: bool,
    pub actual: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Salida {
    pub id: String,
    pub conector: String,
    pub fabricante: String,
    pub modelo: String,
    pub serie: String,
    pub mm_ancho: u32,
    pub mm_alto: u32,
    pub activa: bool,
    pub modos: Vec<Modo>,
    pub escala: f64,
    pub escalas: Vec<f64>,
    pub x: i32,
    pub y: i32,
    pub transformacion: String,
    pub vrr_capaz: bool,
    pub vrr: bool,
    pub principal: bool,
    pub logico_ancho: i32,
    pub logico_alto: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Peticion {
    pub id: String,
    pub activa: bool,
    pub ancho: u32,
    pub alto: u32,
    pub refresco_mhz: u32,
    pub escala: f64,
    pub x: i32,
    pub y: i32,
    pub transformacion: String,
    pub vrr: bool,
    pub principal: bool,
}

async fn proxy<'a>(conn: &'a zbus::Connection) -> Result<zbus::Proxy<'a>, String> {
    zbus::Proxy::new(conn, SERVICIO, RUTA, INTERFAZ)
        .await
        .map_err(|e| e.to_string())
}

/// ¿Hay una sesión BookOS Desktop escuchando?
///
/// Se pregunta por el dueño del nombre y no se llama a un método: activar el
/// servicio por accidente fuera de una sesión BookOS sería justo lo que no
/// queremos, y `NameHasOwner` no arranca nada.
#[tauri::command]
pub async fn bookos_desktop_available() -> bool {
    let Ok(conn) = zbus::Connection::session().await else {
        return false;
    };
    let Ok(dbus) = zbus::fdo::DBusProxy::new(&conn).await else {
        return false;
    };
    let Ok(nombre) = SERVICIO.try_into() else {
        return false;
    };
    dbus.name_has_owner(nombre).await.unwrap_or(false)
}

/// Qué sabe hacer el compositor, como JSON. Las claves las documenta
/// `ajustes.rs`; aquí solo se traducen los tipos de D-Bus a JSON.
#[tauri::command]
pub async fn bookos_get_capabilities() -> Result<String, String> {
    use std::collections::HashMap;
    use zbus::zvariant::OwnedValue;

    let conn = zbus::Connection::session().await.map_err(|e| e.to_string())?;
    let p = proxy(&conn).await?;
    let caps: HashMap<String, OwnedValue> = p
        .call("GetCapabilities", &())
        .await
        .map_err(|e| e.to_string())?;

    let mut json = serde_json::Map::new();
    for (clave, valor) in caps {
        // Se traduce sobre el `Value` prestado: convertir a un tipo concreto
        // por prueba y error (`try_from` encadenados) obliga a clonar y en
        // zvariant clonar un `OwnedValue` puede fallar.
        let v = match &*valor {
            zbus::zvariant::Value::Bool(b) => serde_json::Value::Bool(*b),
            zbus::zvariant::Value::U32(n) => serde_json::Value::from(*n),
            zbus::zvariant::Value::I32(n) => serde_json::Value::from(*n),
            zbus::zvariant::Value::F64(n) => serde_json::Value::from(*n),
            zbus::zvariant::Value::Str(s) => serde_json::Value::String(s.to_string()),
            zbus::zvariant::Value::Array(a) => {
                let nums: Vec<f64> = a
                    .iter()
                    .filter_map(|v| match v {
                        zbus::zvariant::Value::F64(n) => Some(*n),
                        _ => None,
                    })
                    .collect();
                serde_json::Value::from(nums)
            }
            // Una capacidad de un tipo que esta versión de Settings no conoce
            // todavía: se anuncia como presente en vez de perderse, que es lo
            // que permite que el compositor crezca sin actualizar la interfaz.
            _ => serde_json::Value::Null,
        };
        json.insert(clave, v);
    }
    serde_json::to_string(&json).map_err(|e| e.to_string())
}

/// El censo de salidas, como JSON.
#[tauri::command]
pub async fn bookos_get_outputs() -> Result<String, String> {
    let conn = zbus::Connection::session().await.map_err(|e| e.to_string())?;
    let p = proxy(&conn).await?;
    let salidas: Vec<Salida> = p.call("GetOutputs", &()).await.map_err(|e| e.to_string())?;
    let pnp = std::fs::read_to_string("/usr/share/hwdata/pnp.ids").unwrap_or_default();
    let json: Vec<serde_json::Value> = salidas
        .iter()
        .map(|s| {
            let mut v = serde_json::to_value(s).map_err(|e| e.to_string())?;
            let (nombre, detalle) = nombre_legible(s, &pnp);
            v["nombre"] = nombre.into();
            v["detalle"] = detalle.into();
            // La portada de Pantallas dibuja un portátil o un monitor, y solo
            // el panel interno tiene brillo que mover.
            v["integrada"] = es_integrada(&conector_legible(&s.conector)).into();
            Ok(v)
        })
        .collect::<Result<_, String>>()?;
    serde_json::to_string(&json).map_err(|e| e.to_string())
}

/// Cómo se le llama a una pantalla en la interfaz, y la línea de debajo.
///
/// El EDID trae el fabricante como un código PNP de tres letras y el modelo en
/// un descriptor que muchos paneles de portátil no rellenan; entonces el
/// compositor manda el código de producto y salía «SDC 4189». El código se
/// traduce con `pnp.ids` de hwdata, que es la misma tabla que usan GNOME y KDE
/// y ya está instalada; el panel interno se llama por lo que es.
fn nombre_legible(s: &Salida, pnp: &str) -> (String, String) {
    let fabricante = pnp
        .lines()
        .find_map(|l| l.strip_prefix(s.fabricante.as_str())?.strip_prefix('\t'))
        .map(sin_razon_social)
        .unwrap_or_else(|| s.fabricante.clone());
    let conector = conector_legible(&s.conector);
    // Sin descriptor de nombre el compositor manda el código de producto en
    // hexadecimal, que no le dice nada a nadie.
    let modelo = (!s.modelo.is_empty() && !s.modelo.chars().all(|c| c.is_ascii_hexdigit()))
        .then_some(s.modelo.as_str());
    let integrada = es_integrada(&conector);
    let nombre = match (integrada, modelo) {
        (true, _) => "Pantalla integrada".to_string(),
        // Muchos monitores ya llevan la marca en el nombre: «DELL U2720Q».
        (false, Some(m)) if m.to_lowercase().starts_with(&fabricante.to_lowercase()) => m.into(),
        (false, Some(m)) if !fabricante.is_empty() => format!("{fabricante} {m}"),
        (false, Some(m)) => m.into(),
        (false, None) if !fabricante.is_empty() => format!("Monitor {fabricante}"),
        (false, None) => conector.clone(),
    };
    let pulgadas = (s.mm_ancho > 0 && s.mm_alto > 0).then(|| {
        let mm = (s.mm_ancho as f64).hypot(s.mm_alto as f64);
        format!("{:.1}″", mm / 25.4).replace('.', ",")
    });
    let detalle = [
        integrada.then_some(fabricante.clone()).filter(|f| !f.is_empty()),
        pulgadas,
        Some(conector),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" · ");
    (nombre, detalle)
}

fn es_integrada(conector: &str) -> bool {
    ["eDP", "LVDS", "DSI"].iter().any(|p| conector.starts_with(p))
}

/// «Samsung Display Corp.» → «Samsung Display». La razón social alarga el
/// nombre sin distinguir nada.
fn sin_razon_social(nombre: &str) -> String {
    const COLAS: &[&str] = &[
        " Electric Company", " Corporation", " Co., Ltd.", " Co., Ltd", " Co.,Ltd.", " Ltd.",
        " Ltd", " Inc.", " Inc", " Corp.", " Corp", " LLC", " GmbH", ",",
    ];
    let mut n = nombre.trim();
    while let Some(cola) = COLAS.iter().find(|c| n.ends_with(*c)) {
        n = n[..n.len() - cola.len()].trim_end();
    }
    n.to_string()
}

/// El nombre del conector como lo escribe el kernel. El compositor manda el
/// `Debug` del tipo de `drm` —«EmbeddedDisplayPort-1»—, que no es como se
/// llama en ningún otro sitio.
fn conector_legible(conector: &str) -> String {
    let (tipo, numero) = conector.rsplit_once('-').unwrap_or((conector, ""));
    let tipo = match tipo {
        "EmbeddedDisplayPort" => "eDP",
        "DisplayPort" => "DP",
        "HDMIA" => "HDMI-A",
        "HDMIB" => "HDMI-B",
        "DVII" => "DVI-I",
        "DVID" => "DVI-D",
        "DVIA" => "DVI-A",
        "VGA" => "VGA",
        "LVDS" => "LVDS",
        "DSI" => "DSI",
        "USB" => "USB",
        otro => otro,
    };
    if numero.is_empty() {
        tipo.to_string()
    } else {
        format!("{tipo}-{numero}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn salida(conector: &str, fabricante: &str, modelo: &str, mm: (u32, u32)) -> Salida {
        Salida {
            id: String::new(),
            conector: conector.into(),
            fabricante: fabricante.into(),
            modelo: modelo.into(),
            serie: String::new(),
            mm_ancho: mm.0,
            mm_alto: mm.1,
            activa: true,
            modos: Vec::new(),
            escala: 1.0,
            escalas: Vec::new(),
            x: 0,
            y: 0,
            transformacion: "normal".into(),
            vrr_capaz: false,
            vrr: false,
            principal: true,
            logico_ancho: 0,
            logico_alto: 0,
        }
    }

    const PNP: &str = "SDC\tSamsung Display Corp.\nDEL\tDell Inc.\nGSM\tLG Electronics\n";

    /// El panel de este portátil: sin descriptor de nombre, salía «SDC 4189».
    #[test]
    fn el_panel_interno_se_llama_por_lo_que_es() {
        let s = salida("EmbeddedDisplayPort-1", "SDC", "4189", (300, 190));
        assert_eq!(
            nombre_legible(&s, PNP),
            ("Pantalla integrada".into(), "Samsung Display · 14,0″ · eDP-1".into())
        );
    }

    #[test]
    fn un_monitor_con_nombre_no_repite_la_marca() {
        let s = salida("DisplayPort-2", "DEL", "DELL U2720Q", (600, 340));
        assert_eq!(nombre_legible(&s, PNP).0, "DELL U2720Q");
        let s = salida("HDMIA-1", "GSM", "27GL850", (0, 0));
        assert_eq!(nombre_legible(&s, PNP), ("LG Electronics 27GL850".into(), "HDMI-A-1".into()));
    }

    #[test]
    fn sin_nombre_ni_tabla_queda_algo_legible() {
        let s = salida("DisplayPort-1", "DEL", "A0B1", (0, 0));
        assert_eq!(nombre_legible(&s, PNP).0, "Monitor Dell");
        let s = salida("DisplayPort-1", "XYZ", "A0B1", (0, 0));
        assert_eq!(nombre_legible(&s, "").0, "Monitor XYZ");
    }
}

/// Aplica una configuración. Devuelve `{"ok":bool,"error":string}`.
///
/// El error del compositor se propaga tal cual: la interfaz **no** puede
/// enseñar un éxito cuando el modeset falló, y para eso hace falta el motivo.
#[tauri::command]
pub async fn bookos_apply_output_config(config: Vec<Peticion>) -> String {
    let fallo = |e: String| serde_json::json!({"ok": false, "error": e}).to_string();

    let conn = match zbus::Connection::session().await {
        Ok(c) => c,
        Err(e) => return fallo(e.to_string()),
    };
    let p = match proxy(&conn).await {
        Ok(p) => p,
        Err(e) => return fallo(e),
    };
    match p.call::<_, _, (bool, String)>("ApplyOutputConfig", &(config,)).await {
        Ok((true, _)) => serde_json::json!({"ok": true, "error": ""}).to_string(),
        Ok((false, err)) => fallo(err),
        Err(e) => fallo(e.to_string()),
    }
}

/// Pide releer `panel.conf`. Ya existía para la pantalla de bloqueo; aquí queda
/// expuesto para poder recargar el resto sin duplicar la llamada.
#[tauri::command]
pub async fn bookos_reload_config(section: String) -> bool {
    let Ok(conn) = zbus::Connection::session().await else {
        return false;
    };
    let Ok(p) = proxy(&conn).await else {
        return false;
    };
    p.call::<_, _, bool>("ReloadConfig", &(section,))
        .await
        .unwrap_or(false)
}

#[tauri::command]
pub async fn bookos_get_config() -> Result<String, String> {
    let c = zbus::Connection::session().await.map_err(|e| e.to_string())?;
    proxy(&c).await?.call("GetConfig", &()).await.map_err(|e|e.to_string())
}
#[tauri::command]
pub async fn bookos_apply_config(config: serde_json::Value) -> Result<String, String> {
    let c = zbus::Connection::session().await.map_err(|e| e.to_string())?;
    let (ok,error):(bool,String) = proxy(&c).await?.call("ApplyConfig",&(config.to_string(),)).await.map_err(|e|e.to_string())?;
    if !ok {return Err(error);}
    Ok(serde_json::json!({"ok":true}).to_string())
}

#[tauri::command]
pub async fn bookos_get_screensaver_preview(estilo: &str) -> Result<String, String> {
    let conn = zbus::Connection::session()
        .await
        .map_err(|e| e.to_string())?;
    proxy(&conn)
        .await?
        .call("GetScreensaverPreview", &(estilo,))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn bookos_preview_screensaver(estilo: &str) -> Result<(), String> {
    let conn = zbus::Connection::session()
        .await
        .map_err(|e| e.to_string())?;
    let (ok, error): (bool, String) = proxy(&conn)
        .await?
        .call("PreviewScreensaver", &(estilo,))
        .await
        .map_err(|e| e.to_string())?;
    if !ok {
        return Err(error);
    }
    Ok(())
}

pub async fn config_value() -> Result<serde_json::Value,String> {
    serde_json::from_str(&bookos_get_config().await?).map_err(|e|e.to_string())
}
pub async fn dnd(value:Option<bool>)->Result<bool,String> {
    let c=zbus::Connection::session().await.map_err(|e|e.to_string())?;
    let p=proxy(&c).await?;
    match value {
        Some(v)=>p.call("SetDoNotDisturb",&(v,)).await,
        None=>p.call("GetDoNotDisturb",&()).await,
    }.map_err(|e|e.to_string())
}
