//! Desktop-independent XKB registry and avatar helpers.
#[derive(serde::Serialize)]
struct ThemeEntry { id: String, name: String }

#[tauri::command]
pub fn list_keymaps_pretty() -> String {
    let txt = std::fs::read_to_string("/usr/share/X11/xkb/rules/evdev.lst")
        .or_else(|_| std::fs::read_to_string("/usr/share/X11/xkb/rules/base.lst"))
        .unwrap_or_default();
    let mut out: Vec<ThemeEntry> = Vec::new();
    let mut in_layout = false;
    for line in txt.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('!') {
            in_layout = trimmed == "! layout";
            continue;
        }
        if !in_layout || trimmed.is_empty() {
            continue;
        }
        let mut parts = trimmed.splitn(2, char::is_whitespace);
        if let (Some(code), Some(name)) = (parts.next(), parts.next()) {
            out.push(ThemeEntry { id: code.to_string(), name: name.trim().to_string() });
        }
    }
    serde_json::to_string(&out).unwrap_or_else(|_| "[]".into())
}

#[tauri::command]
pub fn set_avatar_data(data: Vec<u8>) -> Result<String, String> {
    if data.is_empty() || data.len() > 5_000_000 {
        return Err("imagen inválida".into());
    }
    // PNG magic check — the crop dialog always exports PNG
    if !data.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Err("formato no soportado".into());
    }
    let home = std::env::var("HOME").map_err(|_| "no HOME")?;
    std::fs::write(format!("{home}/.face"), &data).map_err(|e| e.to_string())?;
    Ok(r#"{"ok":true}"#.into())
}
