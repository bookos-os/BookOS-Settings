//! Network, Bluetooth and audio commands: adapters only, no subprocesses.
use crate::system_client;

#[tauri::command]
pub async fn get_wifi_status() -> String {
    match system_client::domain("network").await {
        Ok(data) => (data).to_string(), Err(e) => system_client::failure(e)
    }
}

#[tauri::command]
pub async fn toggle_wifi(enable: bool) -> String {
    system_client::perform(serde_json::json!({"operation":"wifi_power","enabled":enable})).await
}

#[tauri::command]
pub async fn get_wifi_list() -> String {
    match system_client::domain("network").await {
        Ok(data) => (data["networks"]).to_string(), Err(e) => system_client::failure(e)
    }
}

#[tauri::command]
pub async fn connect_wifi(ssid: String, password: String) -> String {
    system_client::perform(serde_json::json!({"operation":"wifi_connect","ssid":ssid,"password":password})).await
}

#[tauri::command]
pub async fn wifi_rescan() -> String {
    system_client::perform(serde_json::json!({"operation":"wifi_scan"})).await
}

#[tauri::command]
pub async fn get_bluetooth_status() -> String {
    match system_client::domain("bluetooth").await {
        Ok(data) => (data).to_string(), Err(e) => system_client::failure(e)
    }
}

#[tauri::command]
pub async fn toggle_bluetooth(enable: bool) -> String {
    system_client::perform(serde_json::json!({"operation":"bluetooth_power","enabled":enable})).await
}

#[tauri::command]
pub async fn get_bluetooth_devices() -> String {
    match system_client::domain("bluetooth").await {
        Ok(data) => (data["devices"]).to_string(), Err(e) => system_client::failure(e)
    }
}

#[tauri::command]
pub async fn connect_bluetooth(mac: String) -> String {
    system_client::perform(serde_json::json!({"operation":"bluetooth_connect","address":mac})).await
}

#[tauri::command]
pub async fn disconnect_bluetooth(mac: String) -> String {
    system_client::perform(serde_json::json!({"operation":"bluetooth_disconnect","address":mac})).await
}

#[tauri::command]
pub async fn bluetooth_scan() -> String {
    let result = system_client::perform(serde_json::json!({"operation":"bluetooth_scan","enabled":true})).await;
    if serde_json::from_str::<serde_json::Value>(&result).ok().is_some_and(|v|v["ok"] == true) {
        tauri::async_runtime::spawn(async {
            tokio::time::sleep(std::time::Duration::from_secs(15)).await;
            system_client::perform(serde_json::json!({"operation":"bluetooth_scan","enabled":false})).await;
        });
    }
    result
}

#[tauri::command]
pub async fn get_airplane_mode() -> String {
    let s = system_client::snapshot();
    if s["network"].is_null() || s["bluetooth"].is_null() { return system_client::failure("Estado de radio no disponible"); }
    serde_json::json!({"enabled":s["network"]["enabled"] == false && s["bluetooth"]["enabled"] == false}).to_string()
}

#[tauri::command]
pub async fn toggle_airplane_mode(enable: bool) -> String {
    system_client::perform(serde_json::json!({"operation":"airplane","enabled":enable})).await
}

#[tauri::command]
pub async fn get_volume() -> String {
    match system_client::domain("audio").await {
        Ok(data) => (data["output"]).to_string(), Err(e) => system_client::failure(e)
    }
}

#[tauri::command]
pub async fn set_volume(value: u32) -> String {
    system_client::perform(serde_json::json!({"operation":"volume","target":"output","value":value})).await
}

#[tauri::command]
pub async fn toggle_mute() -> String {
    system_client::perform(serde_json::json!({"operation":"mute","target":"output","muted":null})).await
}

#[tauri::command]
pub async fn set_balance(balance: i32) -> String {
    system_client::perform(serde_json::json!({"operation":"audio_balance","balance":balance})).await
}

#[tauri::command]
pub async fn get_balance() -> String {
    match system_client::domain("audio").await {Ok(d)=>serde_json::json!({"balance":d["output"]["balance"]}).to_string(),Err(e)=>system_client::failure(e)}
}

#[tauri::command]
pub async fn set_mic_muted(muted: bool) -> String {
    system_client::perform(serde_json::json!({"operation":"microphone_power","enabled":!muted})).await
}

#[tauri::command]
pub async fn get_mic_muted() -> String {
    match system_client::domain("audio").await {
        Ok(data) => (data["input"]).to_string(), Err(e) => system_client::failure(e)
    }
}

#[tauri::command]
pub async fn forget_wifi(ssid: String) -> String {
    system_client::perform(serde_json::json!({"operation":"wifi_forget","ssid":ssid})).await
}

#[tauri::command]
pub async fn set_wifi_autoconnect(ssid: String, enabled: bool) -> String {
    system_client::perform(serde_json::json!({"operation":"wifi_autoconnect","ssid":ssid,"enabled":enabled})).await
}

#[tauri::command]
pub async fn get_wifi_details(ssid: String) -> String {
    let _=ssid;
    system_client::details("wifi").await
}

#[tauri::command]
pub async fn get_ethernet_status() -> String {
    match system_client::domain("network").await {
        Ok(data) => (data["ethernet"]).to_string(), Err(e) => system_client::failure(e)
    }
}

#[tauri::command]
pub async fn get_ethernet_details() -> String {
    system_client::details("ethernet").await
}

#[tauri::command]
pub async fn get_wifi_password(ssid: String, sudo_password: String) -> String {
    let _ = sudo_password; // NetworkManager applies its own authorization policy.
    system_client::secret(&ssid).await
}

#[tauri::command]
pub async fn get_audio_devices() -> String {
    match system_client::domain("audio").await {
        Ok(data) => (data).to_string(), Err(e) => system_client::failure(e)
    }
}

#[tauri::command]
pub async fn set_default_sink(name: String) -> String {
    system_client::perform(serde_json::json!({"operation":"audio_default","target":name,"input":false})).await
}

#[tauri::command]
pub async fn set_default_source(name: String) -> String {
    system_client::perform(serde_json::json!({"operation":"audio_default","target":name,"input":true})).await
}

#[tauri::command]
pub async fn get_app_audio() -> String {
    match system_client::domain("audio").await {
        Ok(data) => (data["apps"]).to_string(), Err(e) => system_client::failure(e)
    }
}

#[tauri::command]
pub async fn set_app_volume(index: u32, volume: u32) -> String {
    system_client::perform(serde_json::json!({"operation":"app_volume","index":index,"value":volume})).await
}

#[tauri::command]
pub async fn get_sink_descriptions() -> String {
    match system_client::domain("audio").await {
        Ok(data) => serde_json::Value::Array(data["sinks"].as_array().into_iter().flatten().map(|v| {
            let desc=v["description"].as_str().unwrap_or_default();
            let port=v["activePort"].as_str().unwrap_or_default();
            serde_json::json!({"name":v["name"],"desc":desc,"friendly":friendly_audio_name(desc,port,std::env::var("LANG").unwrap_or_default().starts_with("es"))})
        }).collect()).to_string(), Err(e)=>system_client::failure(e)
    }
}

fn friendly_audio_name(desc: &str, port: &str, lang_es: bool) -> String {
    let p = port.to_lowercase();
    let d = desc.to_lowercase();
    let pick = |es: &str, en: &str| if lang_es { es.to_string() } else { en.to_string() };
    // Bluetooth devices already have a clean name (the device name) — keep desc.
    if d.contains("bluez") || p.contains("bluetooth") { return desc.to_string(); }
    if p.contains("headphone") || d.contains("headphone") { return pick("Auriculares", "Headphones"); }
    if p.contains("headset")   || d.contains("headset")   { return pick("Auriculares con micrófono", "Headset"); }
    if p.contains("speaker")   || p.contains("internal")  { return pick("Altavoces internos", "Internal speakers"); }
    if p.contains("hdmi")      || p.contains("displayport") || d.contains("hdmi") { return pick("Salida HDMI / DisplayPort", "HDMI / DisplayPort"); }
    if p.contains("usb")       || d.contains("usb")       { return pick("Dispositivo USB", "USB device"); }
    if p.contains("mic")       || d.contains("microphone") { return pick("Micrófono interno", "Internal microphone"); }
    // Generic onboard codec names → "Audio interno"
    if d.contains("hd audio") || d.contains("hda ") || d.contains("alc") || d.contains("sof") || d.contains("controller") {
        return pick("Audio interno", "Built-in audio");
    }
    desc.to_string()
}
