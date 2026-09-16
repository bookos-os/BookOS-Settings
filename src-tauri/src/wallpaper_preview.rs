//! Small, persistent previews: never send multi-megapixel originals to the grid.
use std::{hash::{Hash, Hasher}, path::PathBuf, time::Duration};
use tokio::{process::Command, sync::Semaphore};

static PREVIEWS: Semaphore = Semaphore::const_new(2);

#[tauri::command]
pub async fn wallpaper_preview(path: String, hero: bool) -> Result<String, String> {
    let cache = std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".cache"))
        .join("bookos-settings/wallpaper-previews-v1");
    create_preview(path, hero, cache).await
}

async fn create_preview(path: String, hero: bool, cache: PathBuf) -> Result<String, String> {
    let _permit = PREVIEWS.acquire().await.map_err(|e| e.to_string())?;
    let source = tokio::fs::canonicalize(&path).await.map_err(|e| e.to_string())?;
    let meta = tokio::fs::metadata(&source).await.map_err(|e| e.to_string())?;
    let size = if hero { 1280 } else { 480 };
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    source.hash(&mut hash);
    meta.len().hash(&mut hash);
    meta.modified().map_err(|e| e.to_string())?.hash(&mut hash);
    size.hash(&mut hash);
    tokio::fs::create_dir_all(&cache).await.map_err(|e| e.to_string())?;
    let output = cache.join(format!("{:016x}.jpg", hash.finish()));
    if tokio::fs::try_exists(&output).await.unwrap_or(false) {
        return Ok(output.to_string_lossy().into_owned());
    }
    // Output goes through memory so concurrent requests never read a partial JPEG.
    // Bound CPU usage and execution time; only the first frame of animated inputs.
    let input = format!("{}[0]", source.to_string_lossy());
    let geometry = format!("{size}x{size}>");
    let mut command = Command::new("magick");
    let args = ["-limit", "thread", "1", "-limit", "memory", "128MiB",
        "-limit", "map", "256MiB", "-define", "jpeg:size=1280x1280",
        &input, "-auto-orient", "-thumbnail", &geometry, "-background", "black",
        "-alpha", "remove", "-strip", "-quality", "85", "jpg:-"];
    command.args(args).kill_on_drop(true);
    let result = tokio::time::timeout(Duration::from_secs(20), async {
        match command.output().await {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Command::new("convert").args(args).kill_on_drop(true).output().await
            }
            other => other,
        }
    }).await.map_err(|_| "La previsualización tardó demasiado".to_string())?
        .map_err(|e| e.to_string())?;
    if !result.status.success() { return Err("No se pudo crear la previsualización".into()); }
    // Distinct temporary names also cover two requests for the same source.
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let temp = output.with_extension(format!("{}.{}.tmp", std::process::id(),
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    tokio::fs::write(&temp, result.stdout).await.map_err(|e| e.to_string())?;
    tokio::fs::rename(&temp, &output).await.map_err(|e| e.to_string())?;
    Ok(output.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn bounded_dimensions_cache_reuse_and_source_changes() {
        let root = std::env::temp_dir().join(format!("bookos-preview-test-{}", std::process::id()));
        tokio::fs::create_dir_all(&root).await.unwrap();
        let source = root.join("source.ppm");
        let write_source = |width: usize| {
            let mut bytes = format!("P6\n{width} 1600\n255\n").into_bytes();
            bytes.resize(bytes.len() + width * 1600 * 3, 120);
            std::fs::write(&source, bytes).unwrap();
        };
        write_source(2560);
        let path = source.to_string_lossy().into_owned();
        let cache = root.join("cache");
        let small = create_preview(path.clone(), false, cache.clone()).await.unwrap();
        let modified = std::fs::metadata(&small).unwrap().modified().unwrap();
        assert_eq!(small, create_preview(path.clone(), false, cache.clone()).await.unwrap());
        assert_eq!(modified, std::fs::metadata(&small).unwrap().modified().unwrap());
        let hero = create_preview(path.clone(), true, cache.clone()).await.unwrap();
        for (preview, expected) in [(&small, "480 300"), (&hero, "1280 800")] {
            let info = Command::new("magick").args(["identify", "-format", "%w %h", preview]).output().await.unwrap();
            assert!(info.status.success());
            assert_eq!(String::from_utf8_lossy(&info.stdout), expected);
        }
        write_source(2561);
        assert_ne!(small, create_preview(path, false, cache.clone()).await.unwrap());
        assert!(create_preview(root.join("missing").to_string_lossy().into_owned(), false, cache).await.is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
