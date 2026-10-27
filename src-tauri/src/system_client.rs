//! Thin Settings adapter for the session's shared system service.
use serde_json::{Value, json};
use std::sync::{OnceLock, RwLock};
use futures::StreamExt;
use tauri::Emitter;
const NAME: &str = "org.bookos.System1";
const PATH: &str = "/org/bookos/System1";
static UPDATED: tokio::sync::Notify = tokio::sync::Notify::const_new();
static STATE: OnceLock<RwLock<Value>> = OnceLock::new();
fn storage() -> &'static RwLock<Value> { STATE.get_or_init(|| RwLock::new(Value::Null)) }
pub fn snapshot() -> Value { storage().read().unwrap_or_else(|e| e.into_inner()).clone() }
pub fn failure(e: impl ToString) -> String { json!({"ok":false,"error":e.to_string()}).to_string() }
async fn proxy(c: &zbus::Connection) -> Result<zbus::Proxy<'_>,String> {
    zbus::Proxy::new(c,NAME,PATH,NAME).await.map_err(|e|e.to_string())
}
async fn get_state() -> Result<Value,String> {
    let c = zbus::Connection::session().await.map_err(|e|e.to_string())?;
    let s: String = proxy(&c).await?.call("GetState",&()).await.map_err(|e|e.to_string())?;
    serde_json::from_str(&s).map_err(|e|e.to_string())
}
pub async fn domain(name: &str) -> Result<Value,String> {
    let work=async {
        loop {
            let changed=UPDATED.notified();
            let s = get_state().await?;
            if let Some(e)=s["errors"][name].as_str(){return Err(e.to_owned());}
            if !s[name].is_null(){return Ok(s[name].clone());}
            changed.await;
        }
    };
    tokio::time::timeout(std::time::Duration::from_secs(15),work).await.map_err(|_|"El servicio todavía no tiene datos".to_owned())?
}

pub async fn perform(op: Value) -> String {
    let work = async {
        let c = zbus::Connection::session().await.map_err(|e|e.to_string())?;
        proxy(&c).await?.call::<_,_,()>("Perform",&(op.to_string(),)).await.map_err(|e|e.to_string())
    };
    match tokio::time::timeout(std::time::Duration::from_secs(110),work).await {
        Ok(Ok(())) => json!({"ok":true}).to_string(),
        Ok(Err(e)) => failure(e), Err(_) => failure("Tiempo de espera agotado"),
    }
}
pub async fn details(kind: &str) -> String {
    let result = async {
        let c = zbus::Connection::session().await.map_err(|e|e.to_string())?;
        proxy(&c).await?.call::<_,_,String>("NetworkDetails",&(kind,)).await.map_err(|e|e.to_string())
    }.await;
    result.unwrap_or_else(failure)
}
pub async fn secret(ssid: &str) -> String {
    let result = async {
        let c = zbus::Connection::session().await.map_err(|e|e.to_string())?;
        proxy(&c).await?.call::<_,_,String>("WifiSecret",&(ssid,)).await.map_err(|e|e.to_string())
    }.await;
    match result { Ok(password)=>json!({"ok":true,"password":password,"needs_auth":false}).to_string(), Err(e)=>failure(e) }
}
#[tauri::command]
pub async fn system_answer_pairing(id:u64, accepted:bool, value:String) -> Result<(),String> {
    let c = zbus::Connection::session().await.map_err(|e|e.to_string())?;
    proxy(&c).await?.call::<_,_,()>("AnswerPairing",&(id,accepted,value)).await.map_err(|e|e.to_string())
}
#[tauri::command]
pub async fn pair_bluetooth(mac:String) -> String {
    perform(json!({"operation":"bluetooth_pair","address":mac})).await
}
#[tauri::command]
pub async fn forget_bluetooth(mac:String) -> String {
    perform(json!({"operation":"bluetooth_forget","address":mac})).await
}
#[tauri::command]
pub async fn set_audio_profile(card:String, profile:String) -> String {
    perform(json!({"operation":"audio_profile","card":card,"profile":profile})).await
}
/// `app` es la interfaz a la que avisar de cada cambio. El servicio
/// (`--hidden`) no tiene: solo mantiene `snapshot()` al día.
pub fn start(app: Option<tauri::AppHandle>) {
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(e) = listen(app.as_ref()).await {
                *storage().write().unwrap_or_else(|e| e.into_inner()) = Value::Null;
                if let Some(app) = &app { let _ = app.emit("bookos-system-error",e); }
            }
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        }
    });
}
async fn listen(app:Option<&tauri::AppHandle>) -> Result<(),String> {
    let c = zbus::Connection::session().await.map_err(|e|e.to_string())?;
    let p = proxy(&c).await?;
    let mut changes = p.receive_signal("StateChanged").await.map_err(|e|e.to_string())?;
    let mut pairing = p.receive_signal("PairingRequested").await.map_err(|e|e.to_string())?;
    let mut owners = p.receive_owner_changed().await.map_err(|e|e.to_string())?;
    let initial: String = p.call("GetState",&()).await.map_err(|e|e.to_string())?;
    publish(app,&initial)?;
    let prompt:String = p.call("GetPairing",&()).await.map_err(|e|e.to_string())?;
    if prompt != "null" { if let Some(app) = app { let _ = app.emit("bookos-pairing",&prompt); } }
    loop {
        tokio::select! {
            msg = changes.next() => {
                let msg = msg.ok_or("Servicio desconectado")?;
                let s:String = msg.body().deserialize().map_err(|e|e.to_string())?; publish(app,&s)?;
            },
            msg = pairing.next() => {
                let msg = msg.ok_or("Servicio desconectado")?;
                let s:String = msg.body().deserialize().map_err(|e|e.to_string())?;
                if let Some(app) = app { let _ = app.emit("bookos-pairing",s); }
            },
            _ = owners.next() => return Err("Servicio reiniciado".into()),
        }
    }
}
fn publish(app:Option<&tauri::AppHandle>, text:&str)->Result<(),String> {
    let s:Value = serde_json::from_str(text).map_err(|e|e.to_string())?;
    *storage().write().unwrap_or_else(|e|e.into_inner()) = s.clone();
    UPDATED.notify_waiters();
    match app { Some(app) => app.emit("bookos-system-changed",s).map_err(|e|e.to_string()), None => Ok(()) }
}

#[tauri::command]
pub async fn system_set_volume(input:bool, value:u32)->String {
    perform(json!({"operation":"volume","target":if input {"input"} else {"output"},"value":value})).await
}
#[tauri::command]
pub async fn system_set_mute(input:bool, muted:bool)->String {
    perform(json!({"operation":"mute","target":if input {"input"} else {"output"},"muted":muted})).await
}
