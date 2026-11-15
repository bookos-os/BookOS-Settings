//! UKEY2 (intercambio de claves con compromiso) y el canal cifrado que sale de
//! él: AES-256-CBC + HMAC-SHA256 con número de secuencia en cada sentido.
//!
//! El cliente es quien abre la conexión (el que envía); el servidor, quien la
//! acepta (el que recibe).

use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use libaes::Cipher;
use p256::ecdh::diffie_hellman;
use p256::elliptic_curve::rand_core::OsRng;
use p256::elliptic_curve::sec1::{FromEncodedPoint, ToEncodedPoint};
use p256::{EncodedPoint, PublicKey, SecretKey};
use prost::Message;
use rand::Rng;
use sha2::{Digest, Sha256, Sha512};
use tokio::io::{AsyncRead, AsyncWrite};

use crate::proto::conexion::OfflineFrame;
use crate::proto::securegcm::{
    self, ukey2_client_init::CipherCommitment, ukey2_message, DeviceToDeviceMessage, GcmMetadata,
    Ukey2ClientFinished, Ukey2ClientInit, Ukey2HandshakeCipher, Ukey2Message, Ukey2ServerInit,
};
use crate::proto::securemessage::{
    EcP256PublicKey, EncScheme, GenericPublicKey, Header, HeaderAndBody, PublicKeyType, SecureMessage, SigScheme,
};
use crate::{protocolo, trama, Error};

type HmacSha256 = Hmac<Sha256>;

const SIGUIENTE_PROTOCOLO: &str = "AES_256_CBC-HMAC_SHA256";
// Sales fijas del D2D de Google: las mismas en todos los aparatos.
const SAL_D2D: [u8; 32] = [
    0x82, 0xAA, 0x55, 0xA0, 0xD3, 0x97, 0xF8, 0x83, 0x46, 0xCA, 0x1C, 0xEE, 0x8D, 0x39, 0x09, 0xB9, 0x5F, 0x13, 0xFA,
    0x7D, 0xEB, 0x1D, 0x4A, 0xB3, 0x83, 0x76, 0xB8, 0x25, 0x6D, 0xA8, 0x55, 0x10,
];
const SAL_CLAVES: [u8; 32] = [
    0xBF, 0x9D, 0x2A, 0x53, 0xC6, 0x36, 0x16, 0xD7, 0x5D, 0xB0, 0xA7, 0x16, 0x5B, 0x91, 0xC1, 0xEF, 0x73, 0xE5, 0x37,
    0xF2, 0x42, 0x74, 0x05, 0xFA, 0x23, 0x61, 0x0A, 0x4B, 0xE6, 0x57, 0x64, 0x2E,
];

fn hkdf(sal: &[u8], entrada: &[u8], info: &[u8]) -> [u8; 32] {
    let mut salida = [0u8; 32];
    Hkdf::<Sha256>::new(Some(sal), entrada)
        .expand(info, &mut salida)
        .expect("32 bytes caben en HKDF-SHA256");
    salida
}

/// Coordenada en el formato de Java `BigInteger.toByteArray()`: con un 0
/// delante si el primer bit está a 1, para que no se lea como negativa.
fn coordenada(x: &[u8]) -> Vec<u8> {
    if x[0] & 0x80 != 0 {
        let mut v = vec![0];
        v.extend_from_slice(x);
        v
    } else {
        x.to_vec()
    }
}

/// Lo inverso: quita el 0 de signo o rellena por la izquierda hasta 32 bytes.
fn coordenada_32(x: &[u8]) -> Result<[u8; 32], Error> {
    let x = if x.len() > 32 { &x[x.len() - 32..] } else { x };
    let mut c = [0u8; 32];
    c[32 - x.len()..].copy_from_slice(x);
    Ok(c)
}

fn clave_publica(publica: &PublicKey) -> Vec<u8> {
    let punto = publica.to_encoded_point(false);
    GenericPublicKey {
        r#type: PublicKeyType::EcP256.into(),
        ec_p256_public_key: Some(EcP256PublicKey {
            x: coordenada(punto.x().expect("punto sin comprimir")),
            y: coordenada(punto.y().expect("punto sin comprimir")),
        }),
        ..Default::default()
    }
    .encode_to_vec()
}

fn leer_clave_publica(bytes: &[u8]) -> Result<PublicKey, Error> {
    let generica = GenericPublicKey::decode(bytes)?;
    let ec = generica.ec_p256_public_key.ok_or_else(|| protocolo("clave pública sin P-256"))?;
    let punto = EncodedPoint::from_affine_coordinates(
        (&coordenada_32(&ec.x)?).into(),
        (&coordenada_32(&ec.y)?).into(),
        false,
    );
    Option::from(PublicKey::from_encoded_point(&punto)).ok_or_else(|| protocolo("punto P-256 inválido"))
}

fn mensaje_ukey2(tipo: ukey2_message::Type, datos: Vec<u8>) -> Vec<u8> {
    Ukey2Message { message_type: Some(tipo.into()), message_data: Some(datos) }.encode_to_vec()
}

fn leer_ukey2(bytes: &[u8], esperado: ukey2_message::Type) -> Result<Vec<u8>, Error> {
    let m = Ukey2Message::decode(bytes)?;
    if m.message_type() != esperado {
        return Err(protocolo(format!("UKEY2: llegó {:?} en vez de {:?}", m.message_type(), esperado)));
    }
    Ok(m.message_data.unwrap_or_default())
}

/// Las claves de un lado: con qué cifra y firma lo que manda, con qué
/// descifra y comprueba lo que recibe.
struct Claves {
    cifrar: [u8; 32],
    firmar: [u8; 32],
    descifrar: [u8; 32],
    comprobar: [u8; 32],
}

fn derivar(secreta: &SecretKey, otra: &PublicKey, client_init: &[u8], server_init: &[u8], soy_cliente: bool) -> (Claves, String) {
    let compartido = diffie_hellman(secreta.to_nonzero_scalar(), otra.as_affine());
    let derivado = Sha256::digest(compartido.raw_secret_bytes());
    let mut info = client_init.to_vec();
    info.extend_from_slice(server_init);
    let auth = hkdf(b"UKEY2 v1 auth", &derivado, &info);
    let siguiente = hkdf(b"UKEY2 v1 next", &derivado, &info);
    let d2d_cliente = hkdf(&SAL_D2D, &siguiente, b"client");
    let d2d_servidor = hkdf(&SAL_D2D, &siguiente, b"server");
    let (cliente, servidor) = (
        (hkdf(&SAL_CLAVES, &d2d_cliente, b"ENC:2"), hkdf(&SAL_CLAVES, &d2d_cliente, b"SIG:1")),
        (hkdf(&SAL_CLAVES, &d2d_servidor, b"ENC:2"), hkdf(&SAL_CLAVES, &d2d_servidor, b"SIG:1")),
    );
    let (propias, ajenas) = if soy_cliente { (cliente, servidor) } else { (servidor, cliente) };
    let claves = Claves { cifrar: propias.0, firmar: propias.1, descifrar: ajenas.0, comprobar: ajenas.1 };
    (claves, crate::info::pin(&auth))
}

/// El canal ya cifrado. Los números de secuencia empiezan en 1 en cada
/// sentido y un mensaje fuera de orden corta la conexión.
pub struct Canal {
    claves: Claves,
    enviados: i32,
    recibidos: i32,
    pub pin: String,
}

impl Canal {
    pub fn cifrar(&mut self, marco: &OfflineFrame) -> Vec<u8> {
        self.enviados += 1;
        let d2d = DeviceToDeviceMessage { sequence_number: Some(self.enviados), message: Some(marco.encode_to_vec()) };
        let iv: [u8; 16] = rand::rng().random();
        let mut cifra = Cipher::new_256(&self.claves.cifrar);
        cifra.set_auto_padding(true);
        let cuerpo = cifra.cbc_encrypt(&iv, &d2d.encode_to_vec());
        let cabecera_y_cuerpo = HeaderAndBody {
            header: Header {
                signature_scheme: SigScheme::HmacSha256.into(),
                encryption_scheme: EncScheme::Aes256Cbc.into(),
                iv: Some(iv.to_vec()),
                public_metadata: Some(
                    GcmMetadata { r#type: securegcm::Type::DeviceToDeviceMessage.into(), version: Some(1) }
                        .encode_to_vec(),
                ),
                ..Default::default()
            },
            body: cuerpo,
        }
        .encode_to_vec();
        let mut mac = HmacSha256::new_from_slice(&self.claves.firmar).expect("HMAC admite claves de 32 bytes");
        mac.update(&cabecera_y_cuerpo);
        SecureMessage { header_and_body: cabecera_y_cuerpo, signature: mac.finalize().into_bytes().to_vec() }
            .encode_to_vec()
    }

    pub fn descifrar(&mut self, datos: &[u8]) -> Result<OfflineFrame, Error> {
        let seguro = SecureMessage::decode(datos)?;
        let mut mac = HmacSha256::new_from_slice(&self.claves.comprobar).expect("HMAC admite claves de 32 bytes");
        mac.update(&seguro.header_and_body);
        mac.verify_slice(&seguro.signature).map_err(|_| Error::Firma)?;
        let hb = HeaderAndBody::decode(&*seguro.header_and_body)?;
        let iv: [u8; 16] = hb.header.iv().try_into().map_err(|_| protocolo("IV que no mide 16 bytes"))?;
        let mut cifra = Cipher::new_256(&self.claves.descifrar);
        cifra.set_auto_padding(true);
        let claro = cifra.cbc_decrypt(&iv, &hb.body);
        let d2d = DeviceToDeviceMessage::decode(&*claro)?;
        self.recibidos += 1;
        if d2d.sequence_number() != self.recibidos {
            return Err(protocolo(format!("secuencia {} en vez de {}", d2d.sequence_number(), self.recibidos)));
        }
        Ok(OfflineFrame::decode(d2d.message())?)
    }
}

/// Lado de quien recibe: lee ClientInit, contesta ServerInit, lee y comprueba
/// ClientFinished contra el compromiso.
pub async fn servidor<S: AsyncRead + AsyncWrite + Unpin>(s: &mut S) -> Result<Canal, Error> {
    let client_init_bytes = trama::leer(s).await?;
    let ci = Ukey2ClientInit::decode(&*leer_ukey2(&client_init_bytes, ukey2_message::Type::ClientInit)?)?;
    if ci.version() != 1 || ci.random().len() != 32 {
        return Err(protocolo("UKEY2: ClientInit con versión o aleatorio inválidos"));
    }
    if ci.next_protocol() != SIGUIENTE_PROTOCOLO {
        return Err(protocolo(format!("UKEY2: protocolo {} no admitido", ci.next_protocol())));
    }
    let compromiso = ci
        .cipher_commitments
        .iter()
        .find(|c| c.handshake_cipher() == Ukey2HandshakeCipher::P256Sha512)
        .and_then(|c| c.commitment.clone())
        .ok_or_else(|| protocolo("UKEY2: el otro no ofrece P-256"))?;

    let secreta = SecretKey::random(&mut OsRng);
    let server_init_bytes = mensaje_ukey2(
        ukey2_message::Type::ServerInit,
        Ukey2ServerInit {
            version: Some(1),
            random: Some(rand::rng().random::<[u8; 32]>().to_vec()),
            handshake_cipher: Some(Ukey2HandshakeCipher::P256Sha512.into()),
            public_key: Some(clave_publica(&secreta.public_key())),
        }
        .encode_to_vec(),
    );
    trama::escribir(s, &server_init_bytes).await?;

    let finish_bytes = trama::leer(s).await?;
    // El compromiso ata el ClientFinished a lo que se prometió en el ClientInit:
    // sin esto, alguien en medio podría cambiar la clave pública.
    if Sha512::digest(&finish_bytes).as_slice() != compromiso.as_slice() {
        return Err(protocolo("UKEY2: el ClientFinished no corresponde al compromiso"));
    }
    let cf = Ukey2ClientFinished::decode(&*leer_ukey2(&finish_bytes, ukey2_message::Type::ClientFinish)?)?;
    let otra = leer_clave_publica(cf.public_key())?;
    let (claves, pin) = derivar(&secreta, &otra, &client_init_bytes, &server_init_bytes, false);
    Ok(Canal { claves, enviados: 0, recibidos: 0, pin })
}

/// Lado de quien envía.
pub async fn cliente<S: AsyncRead + AsyncWrite + Unpin>(s: &mut S) -> Result<Canal, Error> {
    let secreta = SecretKey::random(&mut OsRng);
    let finish_bytes = mensaje_ukey2(
        ukey2_message::Type::ClientFinish,
        Ukey2ClientFinished { public_key: Some(clave_publica(&secreta.public_key())) }.encode_to_vec(),
    );
    let client_init_bytes = mensaje_ukey2(
        ukey2_message::Type::ClientInit,
        Ukey2ClientInit {
            version: Some(1),
            random: Some(rand::rng().random::<[u8; 32]>().to_vec()),
            cipher_commitments: vec![CipherCommitment {
                handshake_cipher: Some(Ukey2HandshakeCipher::P256Sha512.into()),
                commitment: Some(Sha512::digest(&finish_bytes).to_vec()),
            }],
            next_protocol: Some(SIGUIENTE_PROTOCOLO.into()),
        }
        .encode_to_vec(),
    );
    trama::escribir(s, &client_init_bytes).await?;

    let server_init_bytes = trama::leer(s).await?;
    let si = Ukey2ServerInit::decode(&*leer_ukey2(&server_init_bytes, ukey2_message::Type::ServerInit)?)?;
    if si.version() != 1 || si.random().len() != 32 || si.handshake_cipher() != Ukey2HandshakeCipher::P256Sha512 {
        return Err(protocolo("UKEY2: ServerInit inválido"));
    }
    let otra = leer_clave_publica(si.public_key())?;
    trama::escribir(s, &finish_bytes).await?;
    let (claves, pin) = derivar(&secreta, &otra, &client_init_bytes, &server_init_bytes, true);
    Ok(Canal { claves, enviados: 0, recibidos: 0, pin })
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::marcos;

    #[tokio::test]
    async fn los_dos_lados_acuerdan_claves_y_pin() {
        let (mut a, mut b) = tokio::io::duplex(64 * 1024);
        let (srv, cli) = tokio::join!(servidor(&mut a), cliente(&mut b));
        let (mut srv, mut cli) = (srv.unwrap(), cli.unwrap());
        assert_eq!(srv.pin, cli.pin);

        let marco = marcos::keep_alive(false);
        let cifrado = cli.cifrar(&marco);
        assert_eq!(srv.descifrar(&cifrado).unwrap(), marco);
        let vuelta = srv.cifrar(&marcos::keep_alive(true));
        assert_eq!(cli.descifrar(&vuelta).unwrap(), marcos::keep_alive(true));
    }

    async fn par() -> (Canal, Canal) {
        let (mut a, mut b) = tokio::io::duplex(64 * 1024);
        let (srv, cli) = tokio::join!(servidor(&mut a), cliente(&mut b));
        (srv.unwrap(), cli.unwrap())
    }

    #[tokio::test]
    async fn un_mensaje_alterado_se_rechaza() {
        let (mut srv, mut cli) = par().await;
        let mut cifrado = cli.cifrar(&marcos::keep_alive(false));
        let ultimo = cifrado.len() - 1;
        cifrado[ultimo] ^= 1;
        assert!(matches!(srv.descifrar(&cifrado), Err(Error::Firma)));
    }

    #[tokio::test]
    async fn un_mensaje_repetido_se_rechaza() {
        let (mut srv, mut cli) = par().await;
        let bueno = cli.cifrar(&marcos::keep_alive(false));
        srv.descifrar(&bueno).unwrap();
        assert!(srv.descifrar(&bueno).is_err(), "repetido: secuencia vieja");
    }

    #[test]
    fn las_coordenadas_van_y_vuelven() {
        let mut x = [0x80u8; 32];
        x[31] = 7;
        assert_eq!(coordenada(&x).len(), 33);
        assert_eq!(coordenada_32(&coordenada(&x)).unwrap(), x);
        assert_eq!(coordenada_32(&[1, 2]).unwrap()[30..], [1, 2]);
    }
}
