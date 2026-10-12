// hardware_control.rs — BookOS hardware control (Intel Arc 140V / Lunar Lake, xe driver)
// Reverse engineered from Samsung Settings (Windows ProcMon + EC-Probe analysis)

use std::fs;

// ── Sysfs paths (verified on hardware) ───────────────────────────────────────
const RAPL_PL1: &str = "/sys/class/powercap/intel-rapl:0/constraint_0_power_limit_uw";
const RAPL_PL2: &str = "/sys/class/powercap/intel-rapl:0/constraint_1_power_limit_uw";
const PLATFORM_PROFILE: &str = "/sys/firmware/acpi/platform_profile";
const PLATFORM_PROFILE_MODERN: &str = "/sys/class/platform-profile/platform-profile-0/profile";
const BACKLIGHT: &str = "/sys/class/backlight/intel_backlight/brightness";
const BACKLIGHT_MAX: u32 = 400;

// ── Low-level helpers ─────────────────────────────────────────────────────────

fn write_sysfs(path: &str, value: &str) -> Result<(), String> {
    fs::write(path, value).map_err(|e| {
        let hint = if e.kind() == std::io::ErrorKind::PermissionDenied {
            if path.contains("powercap") {
                " → Instala el servicio y cierra sesión: sudo cp src-tauri/extra/bookos-hw-perms.service /etc/systemd/system/ && sudo systemctl enable --now bookos-hw-perms && sudo usermod -aG power $USER (luego cierra sesión)"
            } else if path.contains("backlight") {
                " → Cierra sesión para aplicar los grupos: sudo usermod -aG video $USER"
            } else if path.contains("power/control") {
                " → Cierra sesión para aplicar los grupos: sudo usermod -aG power $USER (el servicio bookos-hw-perms aplica permisos al arrancar)"
            } else {
                ""
            }
        } else {
            ""
        };
        format!("Error escribiendo {}: {}.{}", path, e, hint)
    })
}

/// Soft write — returns a concise one-line warning on failure, never propagates.
fn write_sysfs_soft(path: &str, value: &str) -> Option<String> {
    match fs::write(path, value) {
        Ok(_) => None,
        Err(e) => {
            let msg = if e.kind() == std::io::ErrorKind::PermissionDenied {
                if path.contains("powercap") {
                    "RAPL sin permisos — instala bookos-hw-perms.service"
                } else if path.contains("power/control") {
                    "GPU power sin permisos — instala bookos-hw-perms.service"
                } else if path.contains("backlight") {
                    "Brillo sin permisos — añade usuario al grupo video"
                } else {
                    "sin permisos"
                }
            } else {
                "error de escritura sysfs"
            };
            Some(msg.to_string())
        }
    }
}

/// Run command with 5 s timeout. Returns Err only if the command itself fails.
/// "already" messages are treated as success.






fn read_sysfs(path: &str) -> Option<String> {
    fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

// ── 1. Thermal profile ────────────────────────────────────────────────────────
// RAPL writes are non-fatal. Platform profile prefers power-profiles-daemon
// (DBus, no root) and falls back to direct sysfs.

async fn set_ppd_profile(profile: &str) -> Result<(), String> {
    let conn = zbus::Connection::system().await.map_err(|e| e.to_string())?;
    let props = zbus::Proxy::new(
        &conn,
        "net.hadess.PowerProfiles",
        "/net/hadess/PowerProfiles",
        "org.freedesktop.DBus.Properties",
    ).await.map_err(|e| e.to_string())?;
    props.call::<_, _, ()>(
        "Set",
        &("net.hadess.PowerProfiles", "ActiveProfile", zbus::zvariant::Value::from(profile)),
    ).await.map_err(|e| e.to_string())
}

/// Alias used by routines/labs frontend code. Same as `aplicar_perfil_termico`.
#[tauri::command]
pub async fn set_fan_mode(mode: String) -> Result<String, String> {
    aplicar_perfil_termico(mode).await
}

/// Quick snapshot of current thermal/performance state. Used by routines snapshot.
#[tauri::command]
pub fn check_book_hw() -> String {
    // Read PPD profile if available, else platform_profile sysfs.
    let ppd = std::process::Command::new("powerprofilesctl").arg("get").output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    let plat = std::fs::read_to_string("/sys/firmware/acpi/platform_profile")
        .unwrap_or_default().trim().to_string();
    let mode = if !ppd.is_empty() { match ppd.as_str() {
        "power-saver" => "ahorro",
        "balanced"    => "optimizado",
        "performance" => "rendimiento",
        _ => "optimizado",
    }} else { match plat.as_str() {
        "low-power"   => "ahorro",
        "quiet"       => "silencioso",
        "balanced"    => "optimizado",
        "performance" => "rendimiento",
        _ => "optimizado",
    }};
    format!(r#"{{"performance_mode":"{}","ppd":"{}","platform_profile":"{}"}}"#,
        mode, ppd, plat)
}

#[tauri::command]
pub async fn aplicar_perfil_termico(modo: String) -> Result<String, String> {
    // (pl1_uw, pl2_uw, platform_profile value, PPD value ("" = skip PPD))
    let (pl1, pl2, profile, ppd) = match modo.as_str() {
        "ahorro"      => (4_000_000u64,   5_000_000u64,  "low-power",   "power-saver"),  // PPD power-saver + RAPL override
        "silencioso"  => (8_000_000u64,  12_000_000u64,  "quiet",       "power-saver"),
        "optimizado"  => (15_000_000u64, 25_000_000u64,  "balanced",    "balanced"),
        "rendimiento" => (28_000_000u64, 45_000_000u64,  "performance", "performance"),
        other => return Err(format!("Modo desconocido: '{}'. Usa: ahorro, silencioso, optimizado, rendimiento", other)),
    };

    let mut warns: Vec<String> = Vec::new();

    // Platform profile FIRST — switching profile makes PPD/firmware reset RAPL.
    // Writing RAPL before profile change = profile change clobbers our values.
    let mut profile_ok = false;
    if !ppd.is_empty() {
        profile_ok = set_ppd_profile(ppd).await.is_ok();
    }
    if !profile_ok {
        profile_ok = write_sysfs_soft(PLATFORM_PROFILE_MODERN, profile).is_none();
    }
    if !profile_ok {
        profile_ok = write_sysfs_soft(PLATFORM_PROFILE, profile).is_none();
    }
    if !profile_ok {
        warns.push("perfil de plataforma sin permisos".to_string());
    }

    // Wait for PPD/firmware to settle, then write RAPL (twice, races against background daemons).
    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    // PL1 y PL2 fallan por el mismo permiso: sin dedup el aviso sale duplicado en el toast.
    for e in [write_sysfs_soft(RAPL_PL1, &pl1.to_string()), write_sysfs_soft(RAPL_PL2, &pl2.to_string())].into_iter().flatten() {
        if !warns.contains(&e) { warns.push(e); }
    }
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    let _ = write_sysfs_soft(RAPL_PL1, &pl1.to_string());
    let _ = write_sysfs_soft(RAPL_PL2, &pl2.to_string());

    let note = if warns.is_empty() {
        String::new()
    } else {
        format!(" ({})", warns.join("; "))
    };

    Ok(format!("Perfil '{}' aplicado{}", modo, note))
}

// ── ICC background helper ─────────────────────────────────────────────────────
// Spawns ICC application in a detached thread so toggles return immediately.

// ── 2. Vision Booster ─────────────────────────────────────────────────────────
// WCG and ICC are fire-and-forget (spawned threads) so the toggle returns
// as soon as the core backlight write succeeds. No more multi-second freeze.





// ── 3. HDR ────────────────────────────────────────────────────────────────────
// Las funciones de pantalla no disponibles en BookOS se mantienen ausentes.





// ── 4. Ahorro de pantalla ─────────────────────────────────────────────────────
// Hz change and GPU power management. GPU power write is non-fatal.





// ── 5. Color profile (internal + command) ────────────────────────────────────



// Los perfiles ICC se gestionan fuera de este módulo y no se anuncian como
// controles editables hasta que exista una API de BookOS.



// ── 6. Brillo ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn set_brillo(porcentaje: u32) -> Result<String, String> {
    let pct = porcentaje.clamp(5, 100);
    let raw = BACKLIGHT_MAX * pct / 100;
    write_sysfs(BACKLIGHT, &raw.to_string())?;
    Ok(format!("Brillo establecido al {}% (raw: {})", pct, raw))
}

// ── 7. Estado de pantalla ─────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct EstadoPantalla {
    pub brillo_porcentaje: u32,
    pub modo_termico: String,
    pub platform_profile: String,
    pub pl1_watts: u64,
    pub hdr_activo: bool,
}

#[tauri::command]
pub async fn obtener_estado_pantalla() -> Result<EstadoPantalla, String> {
    // Brillo
    let brillo_porcentaje = read_sysfs(BACKLIGHT)
        .and_then(|s| s.parse::<u32>().ok())
        .map(|raw| (raw * 100 / BACKLIGHT_MAX).clamp(0, 100))
        .unwrap_or(40);

    // PL1 → watts → modo
    let pl1_uw: u64 = read_sysfs(RAPL_PL1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(15_000_000);
    let pl1_watts = pl1_uw / 1_000_000;
    let modo_termico = match pl1_watts {
        0..=10  => "silencioso",
        11..=20 => "optimizado",
        _       => "rendimiento",
    }.to_string();

    // Platform profile — modern per-device path first, legacy fallback
    let platform_profile = read_sysfs(PLATFORM_PROFILE_MODERN)
        .or_else(|| read_sysfs(PLATFORM_PROFILE))
        .unwrap_or_else(|| "desconocido".to_string());

    let hdr_activo = false; // El compositor BookOS no anuncia HDR.

    Ok(EstadoPantalla { brillo_porcentaje, modo_termico, platform_profile, pl1_watts, hdr_activo })
}
