//! Dónde y cómo se escribe lo que llega.
//!
//! Lo que manda el otro aparato no es de fiar: el nombre se sanea, nada se
//! escribe antes de aceptar y cada archivo va a `nombre.part` hasta que está
//! completo.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

/// `~/Descargas/Book-Share`, con el nombre de la carpeta de descargas que dé
/// `xdg-user-dir` (cambia con el idioma).
pub fn carpeta_book_share() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    let descargas = std::process::Command::new("xdg-user-dir")
        .arg("DOWNLOAD")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        // xdg-user-dir devuelve $HOME si la carpeta no está configurada.
        .filter(|s| !s.is_empty() && *s != home)
        .unwrap_or_else(|| format!("{home}/Descargas"));
    PathBuf::from(descargas).join("Book-Share")
}

/// Un nombre que no pueda salirse de la carpeta ni romper nada.
pub fn sanear(nombre: &str) -> String {
    // Solo el último componente, venga con / o con \.
    let base = nombre.rsplit(['/', '\\']).next().unwrap_or("");
    let limpio: String = base.chars().filter(|c| !c.is_control()).collect();
    let limpio = limpio.trim().trim_start_matches('.').to_string();
    let limpio = if limpio.is_empty() { "archivo".to_string() } else { limpio };
    // 255 bytes es el límite de un nombre en ext4 y btrfs; se deja sitio a
    // « (99)» y a «.part».
    recortar(&limpio, 230)
}

fn recortar(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let (base, ext) = partir(s);
    let ext = if ext.len() > 20 { "" } else { ext };
    let mut fin = max.saturating_sub(ext.len());
    while !base.is_char_boundary(fin) {
        fin -= 1;
    }
    format!("{}{}", &base[..fin], ext)
}

/// `("foto", ".jpg")`; los nombres sin punto o que empiezan por él, sin extensión.
fn partir(nombre: &str) -> (&str, &str) {
    match nombre.rfind('.') {
        Some(i) if i > 0 => (&nombre[..i], &nombre[i..]),
        _ => (nombre, ""),
    }
}

/// La primera ruta libre: `foto.jpg`, `foto (1).jpg`, `foto (2).jpg`…
/// Cuenta también los `.part` de otras recepciones en curso.
/// Una foto o un PDF que llega solo se abre al terminar: es lo que se quiere
/// ver en el acto. Por extensión: el tipo MIME lo pone el otro móvil y el
/// archivo ya se guardó con este nombre.
pub fn se_abre_solo(ruta: &Path) -> bool {
    const TIPOS: [&str; 10] = ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "bmp", "pdf"];
    ruta.extension().and_then(|e| e.to_str()).is_some_and(|e| TIPOS.iter().any(|t| t.eq_ignore_ascii_case(e)))
}

pub fn ruta_libre(carpeta: &Path, nombre: &str) -> PathBuf {
    let (base, ext) = partir(nombre);
    (0u32..)
        .map(|n| if n == 0 { carpeta.join(nombre) } else { carpeta.join(format!("{base} ({n}){ext}")) })
        .find(|r| !r.exists() && !parte_de(r).exists())
        .expect("hay nombres libres")
}

fn parte_de(ruta: &Path) -> PathBuf {
    let mut s = ruta.as_os_str().to_owned();
    s.push(".part");
    PathBuf::from(s)
}

/// Un archivo a medio recibir.
pub struct Parcial {
    pub destino: PathBuf,
    parte: PathBuf,
    archivo: Option<File>,
    pub escritos: u64,
    pub total: u64,
}

impl Parcial {
    pub fn crear(carpeta: &Path, nombre: &str, total: u64) -> std::io::Result<Self> {
        fs::create_dir_all(carpeta)?;
        let destino = ruta_libre(carpeta, &sanear(nombre));
        let parte = parte_de(&destino);
        // create_new: si otro proceso creó el mismo .part entre medias, falla
        // en vez de escribir los dos en el mismo archivo.
        let archivo = OpenOptions::new().write(true).create_new(true).open(&parte)?;
        Ok(Self { destino, parte, archivo: Some(archivo), escritos: 0, total })
    }

    pub fn escribir(&mut self, datos: &[u8]) -> std::io::Result<()> {
        if self.escritos + datos.len() as u64 > self.total {
            return Err(std::io::Error::other("el archivo es más grande de lo anunciado"));
        }
        self.archivo.as_mut().expect("abierto hasta terminar").write_all(datos)?;
        self.escritos += datos.len() as u64;
        Ok(())
    }

    /// Cierra y le da su nombre. Si mientras tanto apareció otro archivo con
    /// el mismo nombre, busca uno libre otra vez en vez de pisarlo.
    pub fn terminar(mut self) -> std::io::Result<PathBuf> {
        if self.escritos != self.total {
            return Err(std::io::Error::other("faltan datos"));
        }
        let archivo = self.archivo.take().expect("abierto hasta terminar");
        archivo.sync_all()?;
        drop(archivo);
        let carpeta = self.destino.parent().expect("ruta dentro de la carpeta").to_path_buf();
        let nombre = self.destino.file_name().expect("con nombre").to_string_lossy().into_owned();
        let destino = if self.destino.exists() { ruta_libre(&carpeta, &nombre) } else { self.destino.clone() };
        fs::rename(&self.parte, &destino)?;
        self.destino = destino.clone();
        Ok(destino)
    }
}

impl Drop for Parcial {
    /// Lo que no llegó a terminar no se queda a medias en la carpeta.
    fn drop(&mut self) {
        if self.archivo.take().is_some() {
            let _ = fs::remove_file(&self.parte);
        }
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn solo_se_abren_fotos_y_pdf() {
        assert!(se_abre_solo(Path::new("/x/IMG_2041.JPG")));
        assert!(se_abre_solo(Path::new("/x/factura.pdf")));
        assert!(!se_abre_solo(Path::new("/x/video.mp4")));
        assert!(!se_abre_solo(Path::new("/x/sin_extension")));
    }

    #[test]
    fn el_nombre_no_sale_de_la_carpeta() {
        assert_eq!(sanear("../../.bashrc"), "bashrc");
        assert_eq!(sanear("/etc/passwd"), "passwd");
        assert_eq!(sanear("..\\..\\win.ini"), "win.ini");
        assert_eq!(sanear(".."), "archivo");
        assert_eq!(sanear(""), "archivo");
        assert_eq!(sanear("a\u{0}b\nc.txt"), "abc.txt");
        assert_eq!(sanear("Foto de verano.jpg"), "Foto de verano.jpg");
    }

    #[test]
    fn un_nombre_enorme_se_recorta_conservando_la_extension() {
        let largo = format!("{}.jpg", "ñ".repeat(300));
        let s = sanear(&largo);
        assert!(s.len() <= 230);
        assert!(s.ends_with(".jpg"));
    }

    #[test]
    fn los_nombres_repetidos_no_se_pisan() {
        let dir = std::env::temp_dir().join(format!("bookshare-prueba-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let mut a = Parcial::crear(&dir, "foto.jpg", 3).unwrap();
        let mut b = Parcial::crear(&dir, "foto.jpg", 3).unwrap();
        a.escribir(b"abc").unwrap();
        b.escribir(b"xyz").unwrap();
        assert_eq!(a.terminar().unwrap(), dir.join("foto.jpg"));
        assert_eq!(b.terminar().unwrap(), dir.join("foto (1).jpg"));
        assert_eq!(fs::read(dir.join("foto (1).jpg")).unwrap(), b"xyz");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn lo_que_no_termina_no_deja_rastro() {
        let dir = std::env::temp_dir().join(format!("bookshare-prueba-b-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let mut a = Parcial::crear(&dir, "video.mp4", 10).unwrap();
        a.escribir(b"12345").unwrap();
        assert!(a.escribir(b"1234567").is_err(), "más de lo anunciado");
        drop(a);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        fs::remove_dir_all(&dir).unwrap();
    }
}
