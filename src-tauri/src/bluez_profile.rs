//! Lectura de `org.bluez.Device1` para el cambio automático de audio de los
//! Buds. El canal de control (perfil SPP de Samsung) vive en `bookos-budsd`.

use zbus::zvariant::{ObjectPath, OwnedObjectPath};
use zbus::Connection;

fn mac_to_path(mac: &str) -> String {
    format!("/org/bluez/hci0/dev_{}", mac.replace(':', "_"))
}

async fn device_proxy(mac: &str) -> Result<(Connection, OwnedObjectPath), String> {
    let conn = Connection::system().await.map_err(|e| e.to_string())?;
    let path = ObjectPath::try_from(mac_to_path(mac))
        .map_err(|e| e.to_string())?
        .into();
    Ok((conn, path))
}

/// Whether BlueZ currently reports the device as connected.
pub async fn is_device_connected(mac: &str) -> bool {
    async {
        let (conn, path) = device_proxy(mac).await.ok()?;
        let dev = zbus::Proxy::new(&conn, "org.bluez", path, "org.bluez.Device1")
            .await
            .ok()?;
        dev.get_property::<bool>("Connected").await.ok()
    }
    .await
    .unwrap_or(false)
}
