//! Lo que un aparato dice de sí mismo: en el TXT de mDNS, en la petición de
//! conexión y, de ahí, el PIN de comprobación.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::Rng;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TipoAparato {
    Desconocido = 0,
    Movil = 1,
    Tableta = 2,
    Portatil = 3,
}

impl TipoAparato {
    fn de_bits(bits: u8) -> Self {
        match bits {
            1 => TipoAparato::Movil,
            2 => TipoAparato::Tableta,
            3 => TipoAparato::Portatil,
            _ => TipoAparato::Desconocido,
        }
    }
}

/// Bytes de «endpoint info»:
/// `[versión:3|visibilidad:1|tipo:3|reservado:1] + 16 aleatorios + longitud + nombre UTF-8`.
pub fn info_aparato(nombre: &str, tipo: TipoAparato) -> Vec<u8> {
    // El nombre lleva un byte de longitud: se corta en una frontera de
    // carácter para no mandar UTF-8 roto.
    let mut fin = nombre.len().min(255);
    while !nombre.is_char_boundary(fin) {
        fin -= 1;
    }
    let mut bytes = Vec::with_capacity(18 + fin);
    bytes.push((tipo as u8) << 1);
    bytes.extend(rand::rng().random::<[u8; 16]>());
    bytes.push(fin as u8);
    bytes.extend_from_slice(&nombre.as_bytes()[..fin]);
    bytes
}

pub fn leer_info_aparato(bytes: &[u8]) -> Option<(TipoAparato, String)> {
    let largo = *bytes.get(17)? as usize;
    let nombre = bytes.get(18..18 + largo)?;
    Some((TipoAparato::de_bits((bytes[0] >> 1) & 0b111), String::from_utf8_lossy(nombre).into_owned()))
}

/// El TXT `n` del anuncio mDNS.
pub fn txt_aparato(nombre: &str, tipo: TipoAparato) -> String {
    URL_SAFE_NO_PAD.encode(info_aparato(nombre, tipo))
}

pub fn leer_txt_aparato(txt: &str) -> Option<(TipoAparato, String)> {
    leer_info_aparato(&URL_SAFE_NO_PAD.decode(txt).ok()?)
}

/// Nombre de la instancia mDNS: `0x23`, el id del extremo, el id del servicio
/// de Quick Share (`FC9F5E`) y dos bytes a cero, en base64 URL.
pub fn nombre_mdns(id_extremo: &[u8; 4]) -> String {
    let mut bytes = vec![0x23];
    bytes.extend_from_slice(id_extremo);
    bytes.extend_from_slice(&[0xFC, 0x9F, 0x5E, 0x00, 0x00]);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Lo más que admite Nearby de «endpoint info» en el nombre Bluetooth; más
/// largo, el otro lado lo corta y el byte de longitud del nombre miente.
const INFO_MAX_BLUETOOTH: usize = 131;

/// El nombre Bluetooth con el que un Android encuentra a este equipo sin red
/// común (`BluetoothDeviceName` de Nearby): versión 1 y estrategia punto a
/// punto (`0x23`), id del extremo, id del servicio, un byte de WebRTC a cero,
/// seis reservados, la longitud de la info y la info, en base64 URL sin relleno.
pub fn nombre_bluetooth(id_extremo: &[u8; 4], nombre: &str, tipo: TipoAparato) -> String {
    let mut fin = nombre.len().min(INFO_MAX_BLUETOOTH - 18);
    while !nombre.is_char_boundary(fin) {
        fin -= 1;
    }
    let info = info_aparato(&nombre[..fin], tipo);
    let mut bytes = vec![0x23];
    bytes.extend_from_slice(id_extremo);
    bytes.extend_from_slice(&[0xFC, 0x9F, 0x5E]);
    bytes.extend_from_slice(&[0; 7]);
    bytes.push(info.len() as u8);
    bytes.extend(info);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Si un nombre Bluetooth es de los de `nombre_bluetooth`: para devolver el
/// suyo al adaptador si el servicio murió sin hacerlo.
pub fn es_nombre_bluetooth(alias: &str) -> bool {
    URL_SAFE_NO_PAD.decode(alias).is_ok_and(|b| b.len() >= 16 && b[0] == 0x23 && b[5..8] == [0xFC, 0x9F, 0x5E])
}

/// Cuatro caracteres alfanuméricos: el id con el que se presenta este extremo.
pub fn id_extremo() -> [u8; 4] {
    let mut id = [0u8; 4];
    for (b, c) in id.iter_mut().zip(rand::rng().sample_iter(rand::distr::Alphanumeric)) {
        *b = c;
    }
    id
}

/// El PIN de cuatro cifras sale de la «auth string» de UKEY2 con el mismo
/// hash que usa Android: si los dos lados enseñan lo mismo, nadie se ha metido
/// en medio.
pub fn pin(auth: &[u8]) -> String {
    const MODULO: i32 = 9973;
    const BASE: i32 = 31;
    let mut hash = 0i32;
    let mut mult = 1i32;
    for &b in auth {
        hash = (hash + (b as i8 as i32) * mult) % MODULO;
        mult = (mult * BASE) % MODULO;
    }
    format!("{:04}", hash.abs())
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn el_txt_se_lee_como_se_escribe() {
        let txt = txt_aparato("Galaxy Book5 Pro", TipoAparato::Portatil);
        assert_eq!(leer_txt_aparato(&txt), Some((TipoAparato::Portatil, "Galaxy Book5 Pro".into())));
    }

    #[test]
    fn un_nombre_largo_no_rompe_el_utf8() {
        let nombre = "ñ".repeat(200); // 400 bytes
        let (_, leido) = leer_info_aparato(&info_aparato(&nombre, TipoAparato::Movil)).unwrap();
        assert!(leido.len() <= 255);
        assert!(leido.chars().all(|c| c == 'ñ'));
    }

    #[test]
    fn una_info_corta_no_revienta() {
        assert_eq!(leer_info_aparato(&[0; 10]), None);
        assert_eq!(leer_info_aparato(&[0; 18]), Some((TipoAparato::Desconocido, String::new())));
    }

    #[test]
    fn el_nombre_mdns_lleva_el_id_del_servicio() {
        let bytes = URL_SAFE_NO_PAD.decode(nombre_mdns(b"AbCd")).unwrap();
        assert_eq!(bytes, [0x23, b'A', b'b', b'C', b'd', 0xFC, 0x9F, 0x5E, 0, 0]);
    }

    #[test]
    fn el_nombre_bluetooth_sigue_el_formato_de_nearby() {
        let alias = nombre_bluetooth(b"AbCd", "Galaxy Book5 Pro", TipoAparato::Portatil);
        let b = URL_SAFE_NO_PAD.decode(&alias).unwrap();
        assert_eq!(&b[..16], &[0x23, b'A', b'b', b'C', b'd', 0xFC, 0x9F, 0x5E, 0, 0, 0, 0, 0, 0, 0, b[15]]);
        assert_eq!(b[15] as usize, b.len() - 16);
        assert_eq!(leer_info_aparato(&b[16..]), Some((TipoAparato::Portatil, "Galaxy Book5 Pro".into())));
        assert!(es_nombre_bluetooth(&alias));
        assert!(!es_nombre_bluetooth("galaxybook"));
    }

    #[test]
    fn el_nombre_bluetooth_cabe_con_un_nombre_largo() {
        let alias = nombre_bluetooth(b"AbCd", &"ñ".repeat(200), TipoAparato::Portatil);
        let b = URL_SAFE_NO_PAD.decode(&alias).unwrap();
        assert!(b.len() - 16 <= INFO_MAX_BLUETOOTH);
        // BlueZ y el estándar admiten 248 bytes de nombre.
        assert!(alias.len() <= 248);
        let (_, nombre) = leer_info_aparato(&b[16..]).unwrap();
        assert!(nombre.chars().all(|c| c == 'ñ'));
    }

    #[test]
    fn el_pin_tiene_cuatro_cifras() {
        assert_eq!(pin(&[]), "0000");
        assert_eq!(pin(&[0xff; 32]).len(), 4);
    }
}
