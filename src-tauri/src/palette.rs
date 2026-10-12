//! Color dinámico al estilo Material You: del fondo de pantalla salen unas
//! cuantas semillas, de cada semilla sale una paleta tonal completa, y de ahí
//! las variables CSS que consumen las apps de BookOS.
//!
//! Por qué OkLCh y no HCT (lo que usa Android): HCT es CAM16 + L*, unas 600
//! líneas de tablas y matrices con dependencias que este binario no tiene.
//! OkLCh es perceptualmente equivalente para lo que hace falta aquí —tono
//! estable al cambiar la luminosidad, croma comparable entre tonos— en 60
//! líneas y sin dependencias. El eje de "tono" (0-100) sí se mantiene en L*
//! como en Material, para que los contrastes salgan donde se esperan.

// ── sRGB ↔ OkLab ─────────────────────────────────────────────────────────

fn srgb_to_linear(c: f64) -> f64 {
    if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
}
fn linear_to_srgb(c: f64) -> f64 {
    if c <= 0.0031308 { c * 12.92 } else { 1.055 * c.powf(1.0 / 2.4) - 0.055 }
}

fn linear_to_oklab(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    let l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    let m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    let s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    let (l, m, s) = (l.cbrt(), m.cbrt(), s.cbrt());
    (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
     1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
     0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)
}

fn oklab_to_linear(l: f64, a: f64, b: f64) -> (f64, f64, f64) {
    let l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    let m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    let s_ = l - 0.0894841775 * a - 1.2914855480 * b;
    let (l3, m3, s3) = (l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_);
    ( 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
     -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
     -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3)
}

/// (L, C, H°) desde un sRGB de 8 bits.
pub fn rgb_to_oklch(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
    let (rl, gl, bl) = (srgb_to_linear(r as f64 / 255.0),
                        srgb_to_linear(g as f64 / 255.0),
                        srgb_to_linear(b as f64 / 255.0));
    let (l, a, bb) = linear_to_oklab(rl, gl, bl);
    let c = (a * a + bb * bb).sqrt();
    let mut h = bb.atan2(a).to_degrees();
    if h < 0.0 { h += 360.0; }
    (l, c, h)
}

fn oklch_to_rgb_raw(l: f64, c: f64, h: f64) -> (f64, f64, f64) {
    let hr = h.to_radians();
    let (rl, gl, bl) = oklab_to_linear(l, c * hr.cos(), c * hr.sin());
    (linear_to_srgb(rl), linear_to_srgb(gl), linear_to_srgb(bl))
}

fn in_gamut(l: f64, c: f64, h: f64) -> bool {
    let (r, g, b) = oklch_to_rgb_raw(l, c, h);
    let lo = -0.0005;
    let hi = 1.0005;
    r >= lo && r <= hi && g >= lo && g <= hi && b >= lo && b <= hi
}

/// Baja el croma hasta que el color entra en sRGB. Recortar los canales a
/// pelo (clamp 0-1) desplaza el tono —un rojo saturado se vuelve naranja—,
/// que es justo lo que arruina una paleta generada.
fn oklch_to_hex(l: f64, c: f64, h: f64) -> String {
    let mut c = c.max(0.0);
    if !in_gamut(l, c, h) {
        let (mut lo, mut hi) = (0.0, c);
        for _ in 0..24 {
            let mid = (lo + hi) / 2.0;
            if in_gamut(l, mid, h) { lo = mid } else { hi = mid }
        }
        c = lo;
    }
    let (r, g, b) = oklch_to_rgb_raw(l, c, h);
    format!("#{:02X}{:02X}{:02X}",
        (r * 255.0).round().clamp(0.0, 255.0) as u8,
        (g * 255.0).round().clamp(0.0, 255.0) as u8,
        (b * 255.0).round().clamp(0.0, 255.0) as u8)
}

/// Tono Material (0 = negro, 100 = blanco) → L de OkLab. Se pasa por L* de
/// CIELAB a propósito: los tonos de Material están calibrados en esa escala,
/// así que reutilizarla deja los contrastes donde deben estar.
fn tone_to_okl(t: f64) -> f64 {
    let t = t.clamp(0.0, 100.0);
    let fy = (t + 16.0) / 116.0;
    let y = if t > 8.0 { fy * fy * fy } else { t / 903.2963 };
    linear_to_oklab(y, y, y).0
}

// ── Paleta tonal ─────────────────────────────────────────────────────────

/// Una rampa de un solo tono: mismo hue y croma, la luminosidad la pide quien
/// la usa. Es la pieza con la que se montan primary / secondary / neutral…
#[derive(Clone, Copy)]
pub struct Tonal { hue: f64, chroma: f64 }

impl Tonal {
    pub fn tone(&self, t: f64) -> String { oklch_to_hex(tone_to_okl(t), self.chroma, self.hue) }
    /// Igual que `tone`, pero devolviendo los canales para poder componer
    /// rgba() con alfa (los divisores y hovers de las apps son translúcidos).
    fn tone_rgb(&self, t: f64) -> (u8, u8, u8) {
        let hex = self.tone(t);
        (u8::from_str_radix(&hex[1..3], 16).unwrap_or(0),
         u8::from_str_radix(&hex[3..5], 16).unwrap_or(0),
         u8::from_str_radix(&hex[5..7], 16).unwrap_or(0))
    }
}

/// Los cuatro estilos que se ofrecen, con el mismo papel que en Android:
/// cambian cuánto croma se conserva y cuánto se giran los tonos secundarios.
#[derive(Clone, Copy, PartialEq)]
pub enum Style { Vibrant, Expressive, Muted, Neutral }

impl Style {
    pub fn from_str(s: &str) -> Style {
        match s {
            "expressive" => Style::Expressive,
            "muted"      => Style::Muted,
            "neutral"    => Style::Neutral,
            _            => Style::Vibrant,
        }
    }
    pub fn id(&self) -> &'static str {
        match self { Style::Vibrant => "vibrant", Style::Expressive => "expressive",
                     Style::Muted => "muted", Style::Neutral => "neutral" }
    }
}

pub struct Scheme {
    pub primary: Tonal,
    pub secondary: Tonal,
    pub tertiary: Tonal,
    pub neutral: Tonal,
    pub neutral_variant: Tonal,
}

/// Construye las cinco rampas a partir de una semilla y un estilo.
pub fn scheme_from_seed(seed_hex: &str, style: Style) -> Scheme {
    let (r, g, b) = hex_to_rgb(seed_hex).unwrap_or((0, 122, 255));
    let (_, seed_c, seed_h) = rgb_to_oklch(r, g, b);

    // Una semilla casi gris no tiene tono utilizable: el atan2 devuelve ruido.
    // El matiz de referencia es estable; el croma de la semilla conserva el gris.
    let h = if seed_c < 0.001 { 250.0 } else { seed_h };
    let saturacion = (seed_c / 0.16).min(1.0);

    let (pc, sc, tc, nc, nvc, t_rot, s_rot) = match style {
        Style::Vibrant    => (0.155, 0.075, 0.140, 0.013, 0.030,  60.0,   0.0),
        Style::Expressive => (0.130, 0.100, 0.140, 0.012, 0.028, 120.0,  35.0),
        Style::Muted      => (seed_c.min(0.085), 0.042, 0.055, 0.009, 0.020, 60.0, 0.0),
        Style::Neutral    => (0.030, 0.020, 0.022, 0.005, 0.011,  30.0,   0.0),
    };

    let pc = seed_c.min(pc);
    let sc = sc * saturacion;
    let tc = tc * saturacion;
    let nc = seed_c.min(nc);
    let nvc = seed_c.min(nvc);

    Scheme {
        primary:         Tonal { hue: h,                     chroma: pc },
        secondary:       Tonal { hue: (h + s_rot) % 360.0,   chroma: sc },
        tertiary:        Tonal { hue: (h + t_rot) % 360.0,   chroma: tc },
        neutral:         Tonal { hue: h,                     chroma: nc },
        neutral_variant: Tonal { hue: h,                     chroma: nvc },
    }
}

pub fn hex_to_rgb(hex: &str) -> Option<(u8, u8, u8)> {
    let h = hex.trim_start_matches('#');
    if h.len() != 6 || !h.chars().all(|c| c.is_ascii_hexdigit()) { return None; }
    Some((u8::from_str_radix(&h[0..2], 16).ok()?,
          u8::from_str_radix(&h[2..4], 16).ok()?,
          u8::from_str_radix(&h[4..6], 16).ok()?))
}

// ── Roles → variables CSS de las apps de BookOS ──────────────────────────
//
// Las apps (Ajustes, Reloj, Notas, Store, Player, Viewer, Shell) comparten el
// mismo vocabulario de variables: --bg --card --tx --tx2 --div --brd --hov
// --act --blue --sbg --toff. Teñirlas es lo que hace que TODA la app siga al
// fondo de pantalla sin tocar una sola regla de sus hojas de estilo.
//
// --green/--red/--orange/--yellow se dejan como están: son semánticos (error,
// éxito, aviso). Material hace lo mismo con su paleta de error.

pub struct Roles { pub pairs: Vec<(&'static str, String)> }

fn rgba(c: (u8, u8, u8), a: f64) -> String {
    format!("rgba({},{},{},{})", c.0, c.1, c.2, a)
}

pub fn roles(s: &Scheme, dark: bool) -> Roles {
    let p = &s.primary;
    let n = &s.neutral;
    let nv = &s.neutral_variant;
    let t = &s.tertiary;

    // El acento sobre el que se componen divisores, hovers y bordes: teñirlos
    // con el primario (en vez de con negro/blanco puro) es lo que da el aspecto
    // "toda la interfaz sabe de qué color es el fondo".
    let (accent, overlay, pairs): (String, (u8, u8, u8), Vec<(&'static str, String)>) = if dark {
        let acc = p.tone(80.0);
        let ov = p.tone_rgb(80.0);
        (acc.clone(), ov, vec![
            ("--bg",     n.tone(6.0)),
            ("--card",   n.tone(12.0)),
            ("--sbg",    rgba(ov, 0.10)),
            ("--tx",     n.tone(96.0)),
            ("--tx2",    nv.tone(68.0)),
            ("--blue",   acc.clone()),
            ("--toff",   n.tone(30.0)),
            ("--div",    rgba(ov, 0.13)),
            ("--brd",    rgba(ov, 0.10)),
            ("--hov",    rgba(ov, 0.09)),
            ("--act",    rgba(ov, 0.16)),
            // Extras para quien los quiera: contenedor del acento y su texto.
            ("--accent-container",    p.tone(30.0)),
            ("--on-accent",           p.tone(20.0)),
            ("--on-accent-container", p.tone(90.0)),
            ("--accent-2",            s.secondary.tone(80.0)),
            ("--accent-3",            t.tone(80.0)),
        ])
    } else {
        let acc = p.tone(42.0);
        let ov = p.tone_rgb(42.0);
        (acc.clone(), ov, vec![
            ("--bg",     n.tone(96.0)),
            ("--card",   n.tone(100.0)),
            ("--sbg",    rgba(ov, 0.08)),
            ("--tx",     n.tone(12.0)),
            ("--tx2",    nv.tone(45.0)),
            ("--blue",   acc.clone()),
            ("--toff",   n.tone(86.0)),
            ("--div",    rgba(ov, 0.14)),
            ("--brd",    rgba(ov, 0.12)),
            ("--hov",    rgba(ov, 0.07)),
            ("--act",    rgba(ov, 0.13)),
            ("--accent-container",    p.tone(90.0)),
            ("--on-accent",           "#FFFFFF".to_string()),
            ("--on-accent-container", p.tone(20.0)),
            ("--accent-2",            s.secondary.tone(42.0)),
            ("--accent-3",            t.tone(42.0)),
        ])
    };
    let _ = (accent, overlay);
    Roles { pairs }
}

/// Hoja que se carga DESPUÉS de la de cada app. Misma especificidad y más
/// tarde en la cascada = gana, sin tener que tocar las reglas originales.
pub fn css(s: &Scheme) -> String {
    let light = roles(s, false);
    let dark = roles(s, true);
    let fmt = |r: &Roles| r.pairs.iter()
        .map(|(k, v)| format!("{}:{}", k, v))
        .collect::<Vec<_>>().join(";");
    let l = fmt(&light);
    let d = fmt(&dark);
    format!(
"/* Generado por BookOS Settings — color dinámico del fondo de pantalla.\n\
   No editar: se reescribe cada vez que se aplica una paleta. */\n\
:root,:root.light-mode{{{l}}}\n\
:root.dark-mode{{{d}}}\n\
@media(prefers-color-scheme:dark){{:root:not(.light-mode){{{d}}}}}\n")
}

/// El mismo contenido en JSON, para el front (previsualización de las fichas)
/// y para que otras piezas del sistema puedan leer la paleta sin parsear CSS.
pub fn json(seed: &str, style: Style, s: &Scheme) -> String {
    let one = |r: &Roles| r.pairs.iter()
        .map(|(k, v)| format!("\"{}\":\"{}\"", k.trim_start_matches("--"), v))
        .collect::<Vec<_>>().join(",");
    let tones = |t: &Tonal| [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 95.0]
        .iter().map(|x| format!("\"{}\"", t.tone(*x))).collect::<Vec<_>>().join(",");
    format!(
        "{{\"seed\":\"{}\",\"style\":\"{}\",\"light\":{{{}}},\"dark\":{{{}}},\
          \"tones\":{{\"primary\":[{}],\"secondary\":[{}],\"tertiary\":[{}],\"neutral\":[{}]}}}}",
        seed, style.id(), one(&roles(s, false)), one(&roles(s, true)),
        tones(&s.primary), tones(&s.secondary), tones(&s.tertiary), tones(&s.neutral))
}

// ── Semillas del fondo de pantalla ───────────────────────────────────────

pub fn seeds_from_image(path: &str) -> Result<Vec<String>, String> {
    use std::process::Command;
    let magick = if Command::new("magick").arg("-version").output().is_ok() {
        "magick"
    } else {
        "convert"
    };
    let out = Command::new(magick)
        // `[0]` evita decodificar todos los fotogramas de un fondo animado.
        .args([
            &format!("{path}[0]"),
            "-resize",
            "160x160!",
            "-colorspace",
            "sRGB",
            "-colors",
            "48",
            "-depth",
            "8",
            "-format",
            "%c",
            "histogram:info:",
        ])
        .output()
        .map_err(|e| format!("ImageMagick no disponible: {}", e))?;
    if !out.status.success() {
        return Err("ImageMagick falló al leer la imagen".into());
    }
    semillas_del_histograma(&String::from_utf8_lossy(&out.stdout))
}

fn semillas_del_histograma(texto: &str) -> Result<Vec<String>, String> {
    struct Color {
        semilla: String,
        puntuacion: f64,
        a: f64,
        b: f64,
    }
    let mut colores: Vec<Color> = texto
        .lines()
        .filter_map(|linea| {
            let cantidad: f64 = linea.trim().split(':').next()?.trim().parse().ok()?;
            let semilla: String = linea.split('#').nth(1)?.chars().take(6).collect();
            let (r, g, b) = hex_to_rgb(&semilla)?;
            let (_, c, h) = rgb_to_oklch(r, g, b);
            Some(Color {
                semilla: format!("#{semilla}"),
                puntuacion: cantidad * (0.20 + c * 6.0).min(1.6),
                a: c * h.to_radians().cos(),
                b: c * h.to_radians().sin(),
            })
        })
        .collect();
    colores.sort_by(|a, b| b.puntuacion.total_cmp(&a.puntuacion));

    let mut grupos: Vec<Color> = Vec::new();
    for color in colores {
        // La paleta fija la luminosidad por contraste; distinguir solo por
        // luminosidad ofrecería varias fichas con la misma paleta.
        if let Some(grupo) = grupos
            .iter_mut()
            .find(|grupo| (grupo.a - color.a).hypot(grupo.b - color.b) < 0.008)
        {
            grupo.puntuacion += color.puntuacion;
        } else {
            grupos.push(color);
        }
    }
    grupos.sort_by(|a, b| b.puntuacion.total_cmp(&a.puntuacion));
    let semillas: Vec<String> = grupos
        .into_iter()
        .take(4)
        .map(|color| color.semilla)
        .collect();
    if semillas.is_empty() {
        return Err("sin colores utilizables en la imagen".into());
    }
    Ok(semillas)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un color de ida y vuelta por OkLCh no debe moverse: si esto falla, toda
    /// la paleta sale desviada sin que se note de dónde viene.
    #[test]
    fn roundtrip_srgb() {
        for hex in ["#007AFF", "#FF3B30", "#34C759", "#8E8E93", "#000000", "#FFFFFF"] {
            let (r, g, b) = hex_to_rgb(hex).unwrap();
            let (l, c, h) = rgb_to_oklch(r, g, b);
            assert_eq!(oklch_to_hex(l, c, h), hex, "roundtrip de {}", hex);
        }
    }

    /// La rampa tonal tiene que ser monótona en luminosidad y quedar dentro de
    /// sRGB; sin el recorte de croma un rojo saturado se volvería naranja.
    #[test]
    fn tonal_ramp_is_monotonic_and_in_gamut() {
        let s = scheme_from_seed("#B3261E", Style::Vibrant);
        let mut prev = -1.0;
        for t in [0.0, 10.0, 20.0, 40.0, 60.0, 80.0, 95.0, 100.0] {
            let hex = s.primary.tone(t);
            let (r, g, b) = hex_to_rgb(&hex).unwrap();
            let (l, _, _) = rgb_to_oklch(r, g, b);
            assert!(l > prev, "tono {} no sube en luminosidad", t);
            prev = l;
        }
    }

    #[test]
    fn gray_seed_falls_back() {
        let s = scheme_from_seed("#808080", Style::Vibrant);
        assert!((s.primary.hue - 250.0).abs() < 0.001);
    }

    #[test]
    fn conserva_colores_distintos_del_fondo() {
        let semillas =
            semillas_del_histograma("100: #FF0000\n100: #00FF00\n100: #0000FF\n100: #FFFF00")
                .expect("histograma con cuatro colores válidos");
        assert_eq!(semillas.len(), 4);
        for color in ["#FF0000", "#00FF00", "#0000FF", "#FFFF00"] {
            assert!(semillas.iter().any(|seed| seed == color), "falta {color}");
        }
    }

    #[test]
    fn no_inventa_semillas_en_un_fondo_monocromo() {
        let semillas =
            semillas_del_histograma("100: #79715C").expect("histograma con un beige válido");
        assert_eq!(semillas, ["#79715C"]);
        assert!(semillas_del_histograma("").is_err());
    }

    #[test]
    fn distingue_saturaciones_del_mismo_matiz() {
        let semillas = semillas_del_histograma("100: #F5E6D2\n100: #79715C")
            .expect("histograma con dos beiges válidos");
        assert_eq!(semillas.len(), 2);
    }

    #[test]
    fn fondo_gris_conserva_una_paleta_neutra() {
        let semillas = semillas_del_histograma("100: #000000\n100: #808080\n100: #FFFFFF")
            .expect("histograma con grises válidos");
        assert_eq!(semillas.len(), 1);
        let esquema = scheme_from_seed(&semillas[0], Style::Expressive);
        for rampa in [esquema.primary, esquema.secondary, esquema.tertiary] {
            assert!(
                rampa.chroma < 0.001,
                "el gris debe conservarse sin saturación"
            );
        }
    }

    #[test]
    fn un_fondo_apagado_no_genera_acentos_chillones() {
        let (_, croma, _) = rgb_to_oklch(121, 113, 92);
        for estilo in [
            Style::Vibrant,
            Style::Expressive,
            Style::Muted,
            Style::Neutral,
        ] {
            let esquema = scheme_from_seed("#79715C", estilo);
            for rampa in [esquema.primary, esquema.secondary, esquema.tertiary] {
                assert!(
                    rampa.chroma <= croma,
                    "el acento no debe saturarse más que el fondo"
                );
            }
        }
    }

    #[test]
    fn un_marron_poco_saturado_conserva_su_matiz() {
        let (_, _, matiz) = rgb_to_oklch(48, 43, 39);
        let esquema = scheme_from_seed("#302B27", Style::Expressive);
        assert!((esquema.primary.hue - matiz).abs() < 0.001);
    }

    #[test]
    fn lee_svg_sin_confundir_canales_de_16_bits() {
        let ruta = std::env::temp_dir().join(format!("bookos-paleta-{}.svg", std::process::id()));
        std::fs::write(&ruta, r##"<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#79715C"/></svg>"##)
            .expect("directorio temporal disponible para el SVG de prueba");
        let resultado = seeds_from_image(ruta.to_str().expect("ruta temporal UTF-8"));
        std::fs::remove_file(ruta).expect("SVG temporal creado por esta prueba");
        let semillas = resultado.expect("ImageMagick disponible para leer el SVG");
        assert_eq!(semillas, ["#79715C"]);
    }
}
