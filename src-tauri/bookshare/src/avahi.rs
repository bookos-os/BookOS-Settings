//! mDNS por Avahi (D-Bus del sistema): anunciarse y buscar a los demás.
//!
//! Avahi ya escucha en el 5353 en BookOS; abrir otro responder mDNS desde
//! aquí competiría con él por el mismo puerto.

use std::collections::HashMap;
use std::net::Ipv4Addr;

use futures::StreamExt;
use tokio::sync::mpsc;
use zbus::zvariant::{ObjectPath, OwnedObjectPath};
use zbus::{Connection, MatchRule, MessageStream, Proxy};

use crate::info::{self, TipoAparato};

pub const SERVICIO: &str = "_FC9F5ED42C8A._tcp";
const AVAHI: &str = "org.freedesktop.Avahi";
const IF_CUALQUIERA: i32 = -1;
/// Solo IPv4: Quick Share no anuncia ni conecta por IPv6 en la red local.
const PROTO_INET: i32 = 0;
const LOCAL: u32 = 8;
const PROPIO: u32 = 16;

async fn proxy(c: &Connection, ruta: ObjectPath<'static>, interfaz: &'static str) -> zbus::Result<Proxy<'static>> {
    zbus::proxy::Builder::new(c).destination(AVAHI)?.path(ruta)?.interface(interfaz)?.cache_properties(zbus::proxy::CacheProperties::No).build().await
}

fn raiz() -> ObjectPath<'static> {
    ObjectPath::from_static_str_unchecked("/")
}

/// El anuncio de este equipo. Se retira al soltarlo.
pub struct Anuncio {
    grupo: Proxy<'static>,
}

impl Anuncio {
    pub async fn nuevo(c: &Connection, id_extremo: &[u8; 4], nombre: &str, puerto: u16) -> zbus::Result<Self> {
        let servidor = proxy(c, raiz(), "org.freedesktop.Avahi.Server").await?;
        let ruta: OwnedObjectPath = servidor.call("EntryGroupNew", &()).await?;
        let grupo = proxy(c, ruta.into_inner(), "org.freedesktop.Avahi.EntryGroup").await?;
        let anuncio = Self { grupo };
        anuncio.publicar(id_extremo, nombre, puerto).await?;
        Ok(anuncio)
    }

    async fn publicar(&self, id_extremo: &[u8; 4], nombre: &str, puerto: u16) -> zbus::Result<()> {
        let txt = vec![format!("n={}", info::txt_aparato(nombre, TipoAparato::Portatil)).into_bytes()];
        self.grupo
            .call::<_, _, ()>(
                "AddService",
                &(IF_CUALQUIERA, PROTO_INET, 0u32, info::nombre_mdns(id_extremo), SERVICIO, "", "", puerto, txt),
            )
            .await?;
        self.grupo.call::<_, _, ()>("Commit", &()).await
    }

    /// Vuelve a anunciarse. Los Android solo buscan tras un aviso BLE y a
    /// veces no ven un servicio anunciado antes: un anuncio nuevo los despierta.
    pub async fn repetir(&self, id_extremo: &[u8; 4], nombre: &str, puerto: u16) -> zbus::Result<()> {
        self.grupo.call::<_, _, ()>("Reset", &()).await?;
        self.publicar(id_extremo, nombre, puerto).await
    }

    pub async fn retirar(self) {
        let _ = self.grupo.call::<_, _, ()>("Free", &()).await;
    }
}

#[derive(Debug, Clone)]
pub enum Visto {
    Aparece { clave: String, nombre: String, tipo: TipoAparato, ip: Ipv4Addr, puerto: u16 },
    Desaparece { clave: String },
}

/// Busca hasta que se suelte el canal. `clave` es el nombre mDNS, estable
/// mientras el otro no reinicie Quick Share.
pub async fn buscar(c: Connection, tx: mpsc::UnboundedSender<Visto>, propio: String) -> zbus::Result<()> {
    let servidor = proxy(&c, raiz(), "org.freedesktop.Avahi.Server").await?;
    // Con ServiceBrowserNew los primeros ItemNew salen antes de poder
    // suscribirse a su ruta, y el Avahi de Fedora no trae ServiceBrowserPrepare
    // (probado: «Method doesn't exist»). Así que primero se escucha a todos los
    // buscadores y luego se filtra por la ruta del nuestro.
    let regla = |miembro: &'static str| {
        MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            // Sin `sender`: las señales llegan con el nombre único de Avahi y
            // zbus las descarta al compararlas con «org.freedesktop.Avahi».
            .interface("org.freedesktop.Avahi.ServiceBrowser")
            .and_then(|r| r.member(miembro))
            .map(|r| r.build())
    };
    let mut nuevos = MessageStream::for_match_rule(regla("ItemNew")?, &c, Some(64)).await?;
    let mut quitados = MessageStream::for_match_rule(regla("ItemRemove")?, &c, Some(64)).await?;
    let ruta: OwnedObjectPath = servidor.call("ServiceBrowserNew", &(IF_CUALQUIERA, PROTO_INET, SERVICIO, "", 0u32)).await?;
    let buscador = proxy(&c, ruta.clone().into_inner(), "org.freedesktop.Avahi.ServiceBrowser").await?;
    let es_nuestro = |m: &zbus::Message| m.header().path().is_some_and(|p| p.as_str() == ruta.as_str());
    let mut vistos: HashMap<String, ()> = HashMap::new();
    loop {
        tokio::select! {
            Some(Ok(m)) = nuevos.next() => {
                if !es_nuestro(&m) {
                    continue;
                }
                let (iface, proto, nombre, tipo, dominio, flags): (i32, i32, String, String, String, u32) = m.body().deserialize()?;
                // Los de este equipo no son destinos. Avahi marca «propio» todo
                // lo publicado desde aquí, no solo lo de este proceso (probado
                // con dos servicios): para probar en un solo portátil,
                // BOOKSHARE_INCLUIR_LOCALES deja pasar los locales salvo el nuestro.
                let local = flags & (LOCAL | PROPIO) != 0;
                if nombre == propio || (local && std::env::var_os("BOOKSHARE_INCLUIR_LOCALES").is_none()) {
                    continue;
                }
                // Resolver puede tardar (o no responder): en su tarea, para no
                // atascar a los demás aparatos.
                let (servidor, tx, nombre_c) = (servidor.clone(), tx.clone(), nombre.clone());
                tokio::spawn(async move {
                    let r: zbus::Result<(i32, i32, String, String, String, String, i32, String, u16, Vec<Vec<u8>>, u32)> =
                        servidor.call("ResolveService", &(iface, proto, &nombre_c, &tipo, &dominio, PROTO_INET, 0u32)).await;
                    let Ok((_, _, _, _, _, _, _, direccion, puerto, txt, _)) = r else { return };
                    let Ok(ip) = direccion.parse::<Ipv4Addr>() else { return };
                    let n = txt.iter().filter_map(|t| t.strip_prefix(b"n=")).next();
                    let Some((tipo, nombre)) = n.and_then(|n| info::leer_txt_aparato(&String::from_utf8_lossy(n))) else { return };
                    let _ = tx.send(Visto::Aparece { clave: nombre_c, nombre, tipo, ip, puerto });
                });
                vistos.insert(nombre, ());
            }
            Some(Ok(m)) = quitados.next() => {
                if !es_nuestro(&m) {
                    continue;
                }
                let (_, _, nombre, _, _, _): (i32, i32, String, String, String, u32) = m.body().deserialize()?;
                if vistos.remove(&nombre).is_some() {
                    let _ = tx.send(Visto::Desaparece { clave: nombre });
                }
            }
            _ = tx.closed() => break,
        }
    }
    let _ = buscador.call::<_, _, ()>("Free", &()).await;
    Ok(())
}
