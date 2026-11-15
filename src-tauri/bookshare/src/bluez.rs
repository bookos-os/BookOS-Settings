//! Bluetooth por BlueZ (D-Bus del sistema).
//!
//! Los Android no buscan por mDNS todo el rato: lo hacen al ver un aviso BLE
//! con el servicio `FE2C` de Quick Share. Al buscar, este equipo emite ese
//! aviso; al recibir, escucha los de otros para volver a anunciarse.
//!
//! Sin red común, Nearby encuentra a los aparatos por Bluetooth clásico: por
//! su nombre, que lleva los datos del extremo, y se conecta por RFCOMM. Es lo
//! que hace ChromeOS al ser visible para todos, y aquí también.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use futures::StreamExt;
use tokio::sync::mpsc;
use zbus::zvariant::{self, ObjectPath, OwnedObjectPath, OwnedValue, Value};
use zbus::{Connection, MatchRule, MessageStream, Proxy};

const BLUEZ: &str = "org.bluez";
pub const UUID_QUICK_SHARE: &str = "0000fe2c-0000-1000-8000-00805f9b34fb";
const RUTA_AVISO: &str = "/org/bookos/BookShare/aviso";
/// Los datos que emite un Android al empezar a compartir: con ellos los demás
/// se ponen a buscar por la red.
const DATOS_AVISO: [u8; 24] = [252, 18, 142, 1, 66, 0, 0, 0, 0, 0, 0, 0, 0, 0, 191, 45, 91, 160, 225, 216, 117, 36, 202, 0];

async fn adaptador(c: &Connection) -> zbus::Result<OwnedObjectPath> {
    let om = Proxy::new(c, BLUEZ, "/", "org.freedesktop.DBus.ObjectManager").await?;
    let objetos: HashMap<OwnedObjectPath, HashMap<String, HashMap<String, OwnedValue>>> = om.call("GetManagedObjects", &()).await?;
    let mut rutas: Vec<_> = objetos.into_iter().filter(|(_, i)| i.contains_key("org.bluez.LEAdvertisingManager1")).map(|(r, _)| r).collect();
    rutas.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    rutas.into_iter().next().ok_or_else(|| zbus::Error::Failure("no hay adaptador Bluetooth".into()))
}

struct Aviso;

#[zbus::interface(name = "org.bluez.LEAdvertisement1")]
impl Aviso {
    fn release(&self) {}

    #[zbus(property, name = "Type")]
    fn tipo(&self) -> String {
        "broadcast".into()
    }

    #[zbus(property)]
    fn service_data(&self) -> HashMap<String, OwnedValue> {
        let datos: Value = DATOS_AVISO.to_vec().into();
        HashMap::from([(UUID_QUICK_SHARE.to_string(), datos.try_into().expect("un array de bytes se clona"))])
    }
}

/// El aviso BLE mientras se busca. Se retira al soltarlo.
pub struct Emision {
    c: Connection,
    adaptador: OwnedObjectPath,
}

impl Emision {
    pub async fn empezar(c: &Connection) -> zbus::Result<Self> {
        let adaptador = adaptador(c).await?;
        c.object_server().at(RUTA_AVISO, Aviso).await?;
        let gestor = Proxy::new(c, BLUEZ, adaptador.as_str(), "org.bluez.LEAdvertisingManager1").await?;
        let opciones: HashMap<&str, Value> = HashMap::new();
        if let Err(e) = gestor.call::<_, _, ()>("RegisterAdvertisement", &(ObjectPath::try_from(RUTA_AVISO)?, opciones)).await {
            let _ = c.object_server().remove::<Aviso, _>(RUTA_AVISO).await;
            return Err(e);
        }
        Ok(Self { c: c.clone(), adaptador })
    }

    pub async fn parar(self) {
        if let Ok(g) = Proxy::new(&self.c, BLUEZ, self.adaptador.as_str(), "org.bluez.LEAdvertisingManager1").await {
            let _ = g.call::<_, _, ()>("UnregisterAdvertisement", &(ObjectPath::try_from(RUTA_AVISO).expect("ruta válida"),)).await;
        }
        let _ = self.c.object_server().remove::<Aviso, _>(RUTA_AVISO).await;
    }
}

/// Escucha avisos de Quick Share ajenos y manda un `()` como mucho cada 30 s.
/// Termina cuando se suelta el canal.
pub async fn escuchar(c: Connection, tx: mpsc::UnboundedSender<()>) -> zbus::Result<()> {
    let ruta = adaptador(&c).await?;
    let adapt = Proxy::new(&c, BLUEZ, ruta.as_str(), "org.bluez.Adapter1").await?;
    let filtro: HashMap<&str, Value> = HashMap::from([
        ("UUIDs", Value::from(vec![UUID_QUICK_SHARE])),
        ("Transport", Value::from("le")),
        ("DuplicateData", Value::from(true)),
    ]);
    adapt.call::<_, _, ()>("SetDiscoveryFilter", &(filtro,)).await?;
    // Al rehacer la escucha, la anterior puede estar aún cerrándose en esta
    // misma conexión, y BlueZ contesta «InProgress» hasta que termina.
    let mut intentos = 0;
    loop {
        match adapt.call::<_, _, ()>("StartDiscovery", &()).await {
            Err(zbus::Error::MethodError(nombre, _, _)) if nombre.as_str() == "org.bluez.Error.InProgress" && intentos < 5 => {
                intentos += 1;
                tokio::time::sleep(Duration::from_millis(300)).await;
            }
            otro => break otro?,
        }
    }

    let regla = MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        // Sin `sender` (llegan con el nombre único de bluetoothd): basta la ruta.
        .interface("org.freedesktop.DBus.Properties")?
        .member("PropertiesChanged")?
        .path_namespace("/org/bluez")?
        .build();
    let mut senales = MessageStream::for_match_rule(regla, &c, Some(16)).await?;
    let mut ultimo: Option<Instant> = None;
    loop {
        tokio::select! {
            Some(Ok(m)) = senales.next() => {
                let Ok((interfaz, cambios, _)) = m.body().deserialize::<(String, HashMap<String, OwnedValue>, Vec<String>)>() else { continue };
                let comparte = interfaz == "org.bluez.Device1"
                    && cambios.get("ServiceData").is_some_and(|v| format!("{v:?}").contains(UUID_QUICK_SHARE));
                if comparte && ultimo.is_none_or(|t| t.elapsed() > Duration::from_secs(30)) {
                    ultimo = Some(Instant::now());
                    let _ = tx.send(());
                }
            }
            _ = tx.closed() => break,
        }
    }
    let _ = adapt.call::<_, _, ()>("StopDiscovery", &()).await;
    Ok(())
}

/// UUID del servicio RFCOMM de Quick Share: el UUID v3 (MD5) de
/// «NearbySharing», como `java.util.UUID.nameUUIDFromBytes`. Calculado aparte
/// con hashlib de Python: no hay MD5 entre las dependencias para uno solo.
pub const UUID_RFCOMM: &str = "a82efa21-ae5c-3dde-9bbc-f16da7b16c5a";
const RUTA_PERFIL: &str = "/org/bookos/BookShare/rfcomm";

async fn adaptador1<'a>(c: &Connection, ruta: &'a OwnedObjectPath) -> zbus::Result<Proxy<'a>> {
    // Sin caché: el nombre se cambia y se vuelve a leer en seguida.
    zbus::proxy::Builder::<Proxy>::new(c)
        .destination(BLUEZ)?
        .path(ruta.as_str())?
        .interface("org.bluez.Adapter1")?
        .cache_properties(zbus::proxy::CacheProperties::No)
        .build()
        .await
}

/// BlueZ entrega aquí cada conexión RFCOMM ya aceptada.
struct Perfil {
    tx: mpsc::UnboundedSender<std::os::unix::net::UnixStream>,
}

#[zbus::interface(name = "org.bluez.Profile1")]
impl Perfil {
    fn release(&self) {}

    fn new_connection(
        &self,
        _aparato: OwnedObjectPath,
        fd: zvariant::OwnedFd,
        _opciones: HashMap<String, OwnedValue>,
    ) -> zbus::fdo::Result<()> {
        // Un socket RFCOMM es un socket de flujo: read y write valen igual que
        // en uno de Unix, y así tokio lo puede vigilar sin más.
        let s = std::os::unix::net::UnixStream::from(std::os::fd::OwnedFd::from(fd));
        s.set_nonblocking(true).map_err(|e| zbus::fdo::Error::Failed(e.to_string()))?;
        self.tx.send(s).map_err(|_| zbus::fdo::Error::Failed("Book Share ya no escucha".into()))
    }

    fn request_disconnection(&self, _aparato: OwnedObjectPath) {}
}

/// Visible por Bluetooth clásico con el nombre de Nearby y escuchando por
/// RFCOMM. Al pararlo, el adaptador vuelve a su nombre y a como estaba.
pub struct Clasico {
    c: Connection,
    adaptador: OwnedObjectPath,
    alias: String,
    visible: bool,
    plazo: u32,
}

impl Clasico {
    pub async fn empezar(
        c: &Connection,
        nombre: &str,
        tx: mpsc::UnboundedSender<std::os::unix::net::UnixStream>,
    ) -> zbus::Result<Self> {
        let ruta = adaptador(c).await?;
        let a = adaptador1(c, &ruta).await?;
        if !a.get_property::<bool>("Powered").await? {
            return Err(zbus::Error::Failure("Bluetooth apagado".into()));
        }
        let alias: String = a.get_property("Alias").await?;
        let yo = Self {
            c: c.clone(),
            alias: if crate::info::es_nombre_bluetooth(&alias) { String::new() } else { alias },
            visible: a.get_property("Discoverable").await?,
            plazo: a.get_property("DiscoverableTimeout").await?,
            adaptador: ruta.clone(),
        };
        c.object_server().at(RUTA_PERFIL, Perfil { tx }).await?;
        let gestor = Proxy::new(c, BLUEZ, "/org/bluez", "org.bluez.ProfileManager1").await?;
        let opciones: HashMap<&str, Value> = HashMap::from([
            ("Name", Value::from("Book Share")),
            ("Role", Value::from("server")),
            // Nearby conecta sin emparejar (socket «inseguro»): lo protege UKEY2.
            ("RequireAuthentication", Value::from(false)),
            ("RequireAuthorization", Value::from(false)),
        ]);
        if let Err(e) = gestor.call::<_, _, ()>("RegisterProfile", &(ObjectPath::try_from(RUTA_PERFIL)?, UUID_RFCOMM, opciones)).await {
            let _ = c.object_server().remove::<Perfil, _>(RUTA_PERFIL).await;
            return Err(e);
        }
        let puesto = async {
            a.set_property("Alias", nombre).await?;
            // Sin plazo de BlueZ (180 s por defecto): el de «Temporal» es nuestro.
            a.set_property("DiscoverableTimeout", 0u32).await?;
            a.set_property("Discoverable", true).await
        };
        if let Err(e) = puesto.await {
            yo.parar().await;
            return Err(e.into());
        }
        Ok(yo)
    }

    pub async fn parar(self) {
        if let Ok(g) = Proxy::new(&self.c, BLUEZ, "/org/bluez", "org.bluez.ProfileManager1").await {
            let _ = g.call::<_, _, ()>("UnregisterProfile", &(ObjectPath::try_from(RUTA_PERFIL).expect("ruta válida"),)).await;
        }
        let _ = self.c.object_server().remove::<Perfil, _>(RUTA_PERFIL).await;
        if let Ok(a) = adaptador1(&self.c, &self.adaptador).await {
            // Alias vacío: BlueZ vuelve al nombre del sistema.
            let _ = a.set_property("Alias", self.alias.as_str()).await;
            // El plazo antes: BlueZ, si lo recibe justo después de apagar la
            // visibilidad, aún se cree visible y la vuelve a encender (pasó).
            let _ = a.set_property("DiscoverableTimeout", self.plazo).await;
            let _ = a.set_property("Discoverable", self.visible).await;
        }
    }
}

/// Si el servicio murió siendo visible, el adaptador sigue con el nombre de
/// Nearby: se le devuelve el suyo al arrancar.
pub async fn reparar_nombre(c: &Connection) -> zbus::Result<()> {
    let ruta = adaptador(c).await?;
    let a = adaptador1(c, &ruta).await?;
    let alias: String = a.get_property("Alias").await?;
    if crate::info::es_nombre_bluetooth(&alias) {
        a.set_property("Alias", "").await?;
        a.set_property("Discoverable", false).await?;
    }
    Ok(())
}

/// Los aparatos que BlueZ ve ahora mismo (con RSSI, que se borra al dejar
/// de verlos) emitiendo los servicios de Quick Share por BLE: su nombre.
pub async fn cerca(c: &Connection) -> zbus::Result<Vec<String>> {
    let om = Proxy::new(c, BLUEZ, "/", "org.freedesktop.DBus.ObjectManager").await?;
    let objetos: HashMap<OwnedObjectPath, HashMap<String, HashMap<String, OwnedValue>>> = om.call("GetManagedObjects", &()).await?;
    let mut nombres: Vec<String> = objetos
        .values()
        .filter_map(|i| i.get("org.bluez.Device1"))
        .filter(|d| d.contains_key("RSSI"))
        .filter(|d| {
            let datos = d.get("ServiceData").and_then(|v| HashMap::<String, OwnedValue>::try_from(v.try_clone().ok()?).ok());
            datos.is_some_and(|m| m.keys().any(|k| k == UUID_QUICK_SHARE))
        })
        .filter_map(|d| String::try_from(d.get("Alias")?.try_clone().ok()?).ok())
        .collect();
    nombres.sort();
    nombres.dedup();
    Ok(nombres)
}
