//! Galaxy Buds: cliente de `bookos-budsd`.
//!
//! El protocolo SPP y la conexión viven en el servicio de sesión
//! `org.bookos.Buds` (bookos-desktop/crates/bookos-budsd), que abre el canal
//! de control él solo en cuanto BlueZ conecta unos Buds. Aquí solo quedan los
//! comandos de siempre, con los mismos nombres y el mismo JSON, para que la
//! página de los Buds no cambie.

use tokio::sync::OnceCell;

const SERVICIO: &str = "org.bookos.Buds";
const RUTA: &str = "/org/bookos/Buds";

// Un proxy para todas las llamadas: crear uno por llamada era trabajo de más
// en cada toque del selector de ANC.
static PROXY: OnceCell<zbus::Proxy<'static>> = OnceCell::const_new();

async fn llamar<B, R>(metodo: &str, cuerpo: &B) -> Result<R, String>
where
    B: serde::Serialize + zbus::zvariant::DynamicType,
    R: for<'d> serde::Deserialize<'d> + zbus::zvariant::Type,
{
    let p = PROXY
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
        .map_err(|e| e.to_string())?;
    p.call(metodo, cuerpo).await.map_err(|e| match e {
        // El motivo que escribe el servicio, sin el nombre del error D-Bus.
        zbus::Error::MethodError(_, Some(texto), _) => texto,
        zbus::Error::MethodError(nombre, None, _) => nombre.to_string(),
        otro => format!("El servicio de los Buds no responde: {otro}"),
    })
}

const OK: &str = r#"{"ok":true}"#;

#[tauri::command]
pub async fn buds_connect(mac: String) -> Result<String, String> {
    llamar("Connect", &(mac,)).await
}

#[tauri::command]
pub async fn buds_disconnect() -> Result<String, String> {
    llamar::<_, ()>("Disconnect", &()).await?;
    Ok(OK.into())
}

#[tauri::command]
pub async fn buds_get_status() -> Result<String, String> {
    llamar("GetStatus", &()).await
}

/// 0 apagado, 1 cancelación, 2 ambiente, 3 adaptativo.
#[tauri::command]
pub async fn buds_set_anc(mode: u8) -> Result<String, String> {
    llamar::<_, ()>("SetAnc", &(mode,)).await?;
    Ok(OK.into())
}

#[tauri::command]
pub async fn buds_set_eq(preset: u8, enabled: bool) -> Result<String, String> {
    llamar::<_, ()>("SetEq", &(preset, enabled)).await?;
    Ok(OK.into())
}

#[tauri::command]
pub async fn buds_set_touch_lock(locked: bool) -> Result<String, String> {
    llamar::<_, ()>("SetTouchLock", &(locked,)).await?;
    Ok(OK.into())
}

#[tauri::command]
pub async fn buds_fit_test_start() -> Result<String, String> {
    llamar::<_, ()>("FitTestStart", &()).await?;
    Ok(OK.into())
}

#[tauri::command]
pub async fn buds_fit_test_stop() -> Result<String, String> {
    llamar::<_, ()>("FitTestStop", &()).await?;
    Ok(OK.into())
}

#[tauri::command]
pub async fn buds_request_info() -> Result<String, String> {
    llamar::<_, ()>("RequestInfo", &()).await?;
    Ok(OK.into())
}

#[tauri::command]
pub async fn buds_set_easy_pairing(enable: bool) -> Result<String, String> {
    llamar::<_, ()>("SetEasyPairing", &(enable,)).await?;
    Ok(OK.into())
}

#[tauri::command]
pub async fn buds_set_auto_reconnect(mac: String, enable: bool) -> Result<String, String> {
    llamar::<_, ()>("SetAutoReconnect", &(mac, enable)).await?;
    Ok(OK.into())
}

#[tauri::command]
pub async fn buds_get_prefs(mac: String) -> Result<String, String> {
    llamar("GetPrefs", &(mac,)).await
}

// Audio-aware auto-switch: when PC plays audio, grab buds. When PC silent N seconds,
// release them so phone can take over. Returns one of:
//   {"action":"connect"}    — caller should connect
//   {"action":"disconnect"} — caller should disconnect
//   {"action":"none"}
#[tauri::command]
pub async fn buds_audio_switch_check(mac: String) -> String {
    let Ok(prefs) = llamar::<_, String>("GetPrefs", &(mac.as_str(),)).await else {
        return r#"{"action":"none"}"#.into();
    };
    let auto = serde_json::from_str::<serde_json::Value>(&prefs)
        .ok()
        .and_then(|v| v["auto_reconnect"].as_bool())
        .unwrap_or(false);
    if !auto { return r#"{"action":"none"}"#.into(); }

    // PipeWire/PulseAudio: any active sink-input means something is playing.
    // No stable system-bus API for this without module-dbus-protocol loaded
    // (not on by default), so this one stays a subprocess call.
    let playing = std::process::Command::new("pactl")
        .args(["list", "sink-inputs", "short"])
        .output()
        .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
        .unwrap_or(false);

    // BlueZ Connected state for our buds — via DBus, no subprocess.
    let connected = crate::bluez_profile::is_device_connected(&mac).await;

    // State tracked across calls (idle counter).
    use std::sync::Mutex as StdMutex;
    static IDLE_COUNT: StdMutex<u32> = StdMutex::new(0);
    let mut idle = IDLE_COUNT.lock().unwrap();

    if playing {
        *idle = 0;
        if !connected { return r#"{"action":"connect"}"#.into(); }
    } else {
        *idle += 1;
        // 6 ticks = ~30s with 5s polling
        if *idle >= 6 && connected {
            *idle = 0;
            return r#"{"action":"disconnect"}"#.into();
        }
    }
    r#"{"action":"none"}"#.into()
}

// ── GalaxyBudsClient DBus proxy (fallback when SPP fails) ────────────────────

fn gdbus_call(args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new("gdbus")
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[tauri::command]
pub async fn gbc_is_available() -> Result<bool, String> {
    tokio::task::spawn_blocking(|| {
        let r = std::process::Command::new("gdbus")
            .args([
                "call", "--session",
                "--dest", "org.freedesktop.DBus",
                "--object-path", "/org/freedesktop/DBus",
                "--method", "org.freedesktop.DBus.NameHasOwner",
                "me.timschneeberger.GalaxyBudsClient",
            ])
            .output();
        match r {
            Ok(o) => Ok(String::from_utf8_lossy(&o.stdout).contains("true")),
            Err(_) => Ok(false),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Returns JSON with device properties from GBC DBus, or error.
#[tauri::command]
pub async fn gbc_get_device() -> Result<String, String> {
    tokio::task::spawn_blocking(|| -> Result<String, String> {
        let raw = gdbus_call(&[
            "call", "--session",
            "--dest", "me.timschneeberger.GalaxyBudsClient",
            "--object-path", "/me/timschneeberger/galaxybudsclient/device",
            "--method", "org.freedesktop.DBus.Properties.GetAll",
            "me.timschneeberger.GalaxyBudsClient.Device",
        ])?;
        Ok(parse_gdbus_props(&raw))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn gbc_execute_action(action: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || -> Result<String, String> {
        let arg = format!("'{}'", action.replace('\'', "'\\''"));
        gdbus_call(&[
            "call", "--session",
            "--dest", "me.timschneeberger.GalaxyBudsClient",
            "--object-path", "/me/timschneeberger/galaxybudsclient",
            "--method", "me.timschneeberger.GalaxyBudsClient.Application.ExecuteAction",
            &arg,
        ])?;
        Ok(r#"{"ok":true}"#.into())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn gbc_activate() -> Result<String, String> {
    tokio::task::spawn_blocking(|| -> Result<String, String> {
        gdbus_call(&[
            "call", "--session",
            "--dest", "me.timschneeberger.GalaxyBudsClient",
            "--object-path", "/me/timschneeberger/galaxybudsclient",
            "--method", "me.timschneeberger.GalaxyBudsClient.Application.Activate",
        ])?;
        Ok(r#"{"ok":true}"#.into())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Very small parser for `gdbus call` output of GetAll: `({'Key': <value>, ...},)`
/// Values: `<99>`, `<'str'>`, `<0.0>`, `<true>`.
fn parse_gdbus_props(raw: &str) -> String {
    let trimmed = raw.trim();
    let inner = trimmed
        .strip_prefix("({").and_then(|s| s.rsplit_once("},"))
        .map(|(a, _)| a)
        .unwrap_or(trimmed);
    let mut map = serde_json::Map::new();
    let chars: Vec<char> = inner.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        while i < chars.len() && (chars[i] == ' ' || chars[i] == ',' || chars[i] == '\n') { i += 1; }
        if i >= chars.len() || chars[i] != '\'' { break; }
        i += 1;
        let key_start = i;
        while i < chars.len() && chars[i] != '\'' { i += 1; }
        let key: String = chars[key_start..i].iter().collect();
        if i < chars.len() { i += 1; }
        while i < chars.len() && chars[i] != '<' { i += 1; }
        if i >= chars.len() { break; }
        i += 1;
        let mut depth = 1;
        let mut val = String::new();
        while i < chars.len() && depth > 0 {
            let c = chars[i];
            if c == '<' { depth += 1; val.push(c); }
            else if c == '>' { depth -= 1; if depth > 0 { val.push(c); } }
            else { val.push(c); }
            i += 1;
        }
        let v = val.trim();
        let jv: serde_json::Value = if v.starts_with('\'') && v.ends_with('\'') && v.len() >= 2 {
            serde_json::Value::String(v[1..v.len()-1].to_string())
        } else if v == "true" || v == "false" {
            serde_json::Value::Bool(v == "true")
        } else if let Ok(n) = v.parse::<i64>() {
            serde_json::Value::Number(n.into())
        } else if let Ok(f) = v.parse::<f64>() {
            serde_json::Number::from_f64(f)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null)
        } else {
            serde_json::Value::String(v.to_string())
        };
        map.insert(key, jv);
    }
    serde_json::Value::Object(map).to_string()
}
