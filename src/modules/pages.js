import * as desktop from './pages/desktop.js';
import{setupWallpaperPreviews}from'./pages/wallpaper-previews.js';
import{
    tauriInvoke,getAssetUrl,t,
    getSetting,setSetting,primeSetting,ci,_icInvalidate,getCachedHwState,invalidateHwCache,
    esc,addInterval,addSystemListener,toast,showDialog,showRootAuth,promptSudo,invokeWithAuth,
    renderSkeleton,renderSkeletonChart,renderLoading,renderCard,renderInfoItem,renderServiceError,
    renderError,renderEmptyState,renderNavRow,
    _tr,renderRowItem,renderToggle,renderSlider,renderHeader,renderSection,
    popoverSelect,themeColor,setupToggle,setupSlider,wifiIcon,btIcon,chevron,lockIcon,
    appIconUrl,
}from'./pages/_common.js';
// Routines engine lives in its own light module (loaded by main.js at startup);
// the page renderers below consume it for the Modos/automation UI.
import{getRoutines,saveRoutines,getRoutineSnapshot,deleteRoutineSnapshot,saveRoutineSnapshot,executeRoutine,snapshotForRoutine,restoreSnapshot,_getSnap,_deleteSnap}from'./routines-engine.js';
// Re-export shared helpers so existing importers of pages.js keep working.
export{invalidateHwCache};
// Editor de la pantalla de inicio: módulo aparte por tamaño y porque solo se
// carga cuando el usuario entra en él.
import{renderSddmEditor}from'./pages/sddm-editor.js';
export{renderSddmEditor};
import{installPaletteCss,previewPaletteCss,paletteToCss}from'./dynamic-color.js';
export{getRoutines,saveRoutines,getRoutineSnapshot,deleteRoutineSnapshot,saveRoutineSnapshot,executeRoutine,snapshotForRoutine,restoreSnapshot};

function parseServiceResult(raw){
    const value=typeof raw==='string'?JSON.parse(raw):raw;
    if(value?.ok===false)throw new Error(value.error||'Servicio BookOS no disponible');
    return value;
}

// ── Conexiones main page ──
export async function renderConexiones(c){
    c.innerHTML=renderHeader(t('hdr_connections'))+renderSkeleton(3);
    let w={enabled:false,ssid:''},bt={enabled:false},air={enabled:false},eth={present:false,connected:false};
    try{[w,bt,air,eth]=await Promise.all([
        tauriInvoke('get_wifi_status').then(parseServiceResult).catch(()=>null),
        tauriInvoke('get_bluetooth_status').then(parseServiceResult).catch(()=>null),
        tauriInvoke('get_airplane_mode').then(parseServiceResult).catch(()=>null),
        tauriInvoke('get_ethernet_status').then(parseServiceResult).catch(()=>null)
    ]);}catch(e){toast(String(e),'❌');return;}
    if(!w||!bt||!air||!eth){c.innerHTML=renderHeader(t('hdr_connections'))+renderServiceError('Servicio BookOS no disponible','conectividad');return;}

    let h=renderHeader(t('hdr_connections'));
    // Ethernet (wired) — only shown when an interface exists
    const ethCard = eth.present ? `
        <div class="conn-main-row">
            <div class="conn-main-clickable" id="go-eth">
                <div class="conn-main-left">
                    <span class="conn-main-title">${_tr('Cable')}</span>
                    <span class="conn-main-sub ${eth.connected?'conn-sub-active':''}" id="conn-eth-sub">${eth.connected?(eth.connection?esc(eth.connection):_tr('Conectado')):_tr('Desconectado')}</span>
                </div>
                ${chevron()}
            </div>
        </div>` : '';
    h+=`<div class="detail-card">
        ${ethCard}
        <div class="conn-main-row">
            <div class="conn-main-clickable" id="go-wifi">
                <div class="conn-main-left">
                    <span class="conn-main-title">Wi-Fi</span>
                    <span class="conn-main-sub ${w.enabled&&w.ssid?'conn-sub-active':''}" id="conn-wifi-sub">${w.enabled?(w.ssid?esc(w.ssid):t('enabled')):t('disabled')}</span>
                </div>
                ${chevron()}
            </div>
            ${renderToggle('wifi',w.enabled)}
        </div>
        <div class="conn-main-row">
            <div class="conn-main-clickable" id="go-bt">
                <div class="conn-main-left">
                    <span class="conn-main-title">Bluetooth</span>
                    <span class="conn-main-sub" id="conn-bt-sub">${bt.enabled?t('enabled'):t('disabled')}</span>
                </div>
                ${chevron()}
            </div>
            ${renderToggle('bt',bt.enabled)}
        </div>
    </div>`;
    h+=renderCard([renderRowItem('Modo Avión','',renderToggle('air',air.enabled))]);
    c.innerHTML=h;

    document.getElementById('go-wifi')?.addEventListener('click',()=>{if(window.pushSubNav)window.pushSubNav(()=>renderConexiones(c));window.clearPageIntervals?.();renderWifiPage(c);});
    document.getElementById('go-bt')?.addEventListener('click',()=>{if(window.pushSubNav)window.pushSubNav(()=>renderConexiones(c));window.clearPageIntervals?.();renderBTPage(c);});
    document.getElementById('go-eth')?.addEventListener('click',()=>{if(window.pushSubNav)window.pushSubNav(()=>renderConexiones(c));window.clearPageIntervals?.();renderEthernetDetailPage(c);});

    setupToggle('wifi',async a=>{
        await tauriInvoke('toggle_wifi',{enable:a});
        const sub=document.getElementById('conn-wifi-sub');
        if(sub){sub.textContent=a?t('enabled'):t('disabled');sub.classList.remove('conn-sub-active');}
        toast(a?'Wi-Fi activado':'Wi-Fi desactivado');
    });
    setupToggle('bt',async a=>{
        await tauriInvoke('toggle_bluetooth',{enable:a});
        const sub=document.getElementById('conn-bt-sub');
        if(sub)sub.textContent=a?t('enabled'):t('disabled');
        toast(a?'Bluetooth activado':'Bluetooth desactivado');
    });
    setupToggle('air',async a=>{await tauriInvoke('toggle_airplane_mode',{enable:a});toast(a?'Modo Avión activado':'Modo Avión desactivado');});

    // Synchronize controls on service events, including external changes.
    addSystemListener(async()=>{
        const sub=document.getElementById('conn-wifi-sub');if(!sub)return;
        try{
            const [w2,bt2,air2]=await Promise.all([
                tauriInvoke('get_wifi_status').then(parseServiceResult).catch(()=>null),
                tauriInvoke('get_bluetooth_status').then(parseServiceResult).catch(()=>null),
                tauriInvoke('get_airplane_mode').then(parseServiceResult).catch(()=>null)
            ]);
            if(w2){
                sub.textContent=w2.enabled?(w2.ssid?esc(w2.ssid):t('enabled')):t('disabled');
                sub.classList.toggle('conn-sub-active',!!(w2.enabled&&w2.ssid));
                const wt=document.querySelector('[data-toggle="wifi"]');
                if(wt)wt.classList.toggle('active',!!w2.enabled);
            }
            if(bt2){
                const bsub=document.getElementById('conn-bt-sub');
                if(bsub)bsub.textContent=bt2.enabled?t('enabled'):t('disabled');
                const btt=document.querySelector('[data-toggle="bt"]');
                if(btt)btt.classList.toggle('active',!!bt2.enabled);
            }
            if(air2){
                const at=document.querySelector('[data-toggle="air"]');
                if(at)at.classList.toggle('active',!!air2.enabled);
            }
            const esub=document.getElementById('conn-eth-sub');
            if(esub){
                try{
                    const e2=parseServiceResult(await tauriInvoke('get_ethernet_status'));
                    esub.textContent=e2.connected?(e2.connection||_tr('Conectado')):_tr('Desconectado');
                    esub.classList.toggle('conn-sub-active',!!e2.connected);
                }catch(e){toast(String(e),'❌');return;}
            }
        }catch(e){toast(String(e),'❌');return;}
    },5000);
}

// ── Ethernet (wired) detail subpage ──
async function renderEthernetDetailPage(c){
    window.clearPageIntervals?.();
    if(window.pushSubNav)window.pushSubNav(()=>renderConexiones(c));
    const wireIcon=`<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="9" width="20" height="11" rx="2"/><path d="M6 9V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3"/><path d="M7 13h.01M11 13h.01M15 13h.01"/></svg>`;
    c.innerHTML=renderHeader(_tr('Conexión por cable'))+
        `<div class="wifi-detail-hero">
            <div class="wifi-detail-icon">${wireIcon}</div>
            <div class="wifi-detail-ssid" id="eth-title">Ethernet</div>
            <div class="wifi-detail-status" id="eth-status">${_tr('Comprobando...')}</div>
        </div>`+
        `<div class="detail-card" id="eth-details">${renderLoading(_tr('Obteniendo detalles...'))}</div>`;

    const load=async()=>{
        let d;
        try{ d=parseServiceResult(await tauriInvoke('get_ethernet_details')); }
        catch(e){ document.getElementById('eth-details').innerHTML=renderInfoItem(_tr('No se pudieron cargar los detalles')); return; }
        const statusEl=document.getElementById('eth-status');
        if(!d.present){
            if(statusEl){statusEl.textContent=_tr('Sin cable conectado');statusEl.style.color='var(--tx2)';}
            document.getElementById('eth-details').innerHTML=renderInfoItem(_tr('No hay ninguna interfaz de cable disponible'));
            return;
        }
        const connected = (d.state||'').includes('connected') && !(d.state||'').includes('disconnected') || !!d.ip;
        if(statusEl){statusEl.textContent=connected?_tr('Conectado'):_tr('Desconectado');statusEl.style.color=connected?'var(--blue)':'var(--tx2)';}
        const titleEl=document.getElementById('eth-title');
        if(titleEl&&d.iface)titleEl.textContent=`Ethernet (${d.iface})`;
        const ipFull=d.ip?(d.prefix?`${d.ip}/${d.prefix}`:d.ip):'';
        const rows=[
            ['Interfaz', d.iface||'—', false],
            ['Dirección IP', ipFull||'—', !!ipFull],
            ['Puerta de enlace', d.gateway||'—', !!d.gateway],
            ['DNS', d.dns||'—', !!d.dns],
            ['IPv6', d.ip6||'—', !!d.ip6],
            ['MTU', d.mtu||'—', false],
            ['Dirección MAC', d.mac||'—', !!d.mac],
        ];
        document.getElementById('eth-details').innerHTML=rows.map(([l,v,copyable])=>
            `<div class="wifi-detail-row"${copyable?` data-copy="${esc(v)}" title="${_tr('Copiar')}"`:''}>
                <span class="wifi-detail-label">${_tr(l)}</span>
                <span class="wifi-detail-val"><span class="wd-val-txt">${esc(v)}</span>${copyable?'<svg class="wd-copy-hint" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>':''}</span>
            </div>`
        ).join('');
        document.querySelectorAll('#eth-details .wifi-detail-row[data-copy]').forEach(r=>{
            r.addEventListener('click',()=>{
                const v=r.getAttribute('data-copy');
                navigator.clipboard?.writeText(v).then(()=>toast(_tr('Copiado'),'📋')).catch(()=>{});
            });
        });
    };
    await load();
    addSystemListener(()=>{if(!document.getElementById('eth-details'))return;load();},5000);
}

// ── Wi-Fi subpage ──
export async function renderWifiPage(c,subscribe=true){
    if(subscribe)addSystemListener(()=>document.getElementById('wl')?loadWifi():renderWifiPage(c,false));
    // Con caché se pinta la página entera de una vez y se refresca por detrás:
    // esqueleto → página → «Buscando…» → lista eran cuatro repintados por visita
    // y con ellos las animaciones de tarjeta se reiniciaban (el parpadeo).
    let w=_wifiCache;
    if(!w){
        c.innerHTML=renderHeader(t('hdr_wifi'))+renderSkeleton(2);
        try{w=parseServiceResult(await tauriInvoke('get_wifi_status'));}catch(e){c.innerHTML=renderHeader('Wi-Fi')+renderServiceError(e,'Wi-Fi');return;}
    }

    let h=renderHeader(t('hdr_wifi'));
    // Toggle card
    h+=`<div class="detail-card">
        <div class="conn-main-row">
            <span class="conn-main-title" style="font-size:17px;font-weight:700;color:var(--blue)">${w.enabled?t('enabled'):t('disabled')}</span>
            ${renderToggle('wifi-page',w.enabled)}
        </div>
    </div>`;
    h+=renderSection(t('sec_current_net'));
    h+=`<div class="detail-card" id="wifi-current">${renderLoading('Obteniendo red...')}</div>`;
    h+=`<div class="section-header-row"><p class="section-header" style="margin:0">Redes disponibles</p><button class="refresh-btn" id="btn-wifi-refresh" title="Buscar redes"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>Buscar</button></div>`;
    h+=`<div class="detail-card" id="wl">${renderLoading('Buscando...')}</div>`;
    c.innerHTML=h;
    if(_wifiCache)paintWifi(_wifiCache);

    const rescanAndLoad=async()=>{
        const btn=document.getElementById('btn-wifi-refresh');
        if(btn){btn.disabled=true;btn.classList.add('spinning');}
        try{await tauriInvoke('wifi_rescan');await loadWifi();}catch(e){toast(String(e),'❌');}finally{if(btn){btn.disabled=false;btn.classList.remove('spinning');}}
    };
    const loadAll=()=>{loadWifi();tauriInvoke('wifi_rescan').catch(()=>{});};
    if(w.enabled)loadAll();else loadWifi();
    document.getElementById('btn-wifi-refresh')?.addEventListener('click',()=>rescanAndLoad());

    setupToggle('wifi-page',async a=>{
        await tauriInvoke('toggle_wifi',{enable:a});
        const label=document.querySelector('[data-toggle="wifi-page"]')?.previousElementSibling;
        if(label)label.textContent=a?t('enabled'):t('disabled');
        if(a)loadAll();
        else{
            const cur=document.getElementById('wifi-current');const el=document.getElementById('wl');
            if(cur)cur.innerHTML=renderInfoItem('Dispositivo Wi-Fi apagado','Activa Wi-Fi para buscar redes');
            if(el)el.innerHTML='';
        }
        toast(a?'Wi-Fi activado':'Wi-Fi desactivado');
    });


}

// ── Bluetooth subpage ──
export async function renderBTPage(c,subscribe=true){
    if(subscribe)addSystemListener(()=>document.getElementById('bl')?loadBT():renderBTPage(c,false));
    let bt=_btCache;
    if(!bt)try{c.innerHTML=renderHeader(t('hdr_bluetooth'))+renderSkeleton(2);bt=parseServiceResult(await tauriInvoke('get_bluetooth_status'));}catch(e){c.innerHTML=renderHeader('Bluetooth')+renderServiceError(e,'Bluetooth');return;}

    let h=renderHeader(t('hdr_bluetooth'));
    h+=`<div class="detail-card">
        <div class="conn-main-row">
            <span class="conn-main-title" style="font-size:17px;font-weight:700;color:${bt.enabled?'var(--blue)':'var(--tx2)'}">${bt.enabled?t('enabled'):t('disabled')}</span>
            ${renderToggle('bt-page',bt.enabled)}
        </div>
    </div>`;
    if(bt.enabled)h+=`<p class="conn-bt-hint">Busca dispositivos cercanos para emparejarlos con este equipo.</p>`;
    h+=`<div class="section-header-row"><p class="section-header" style="margin:0">Dispositivos vinculados</p>${`<button class="refresh-btn" id="btn-bt-scan" title="Buscar dispositivos"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>Escanear</button>`}</div>`;
    h+=`<div class="detail-card" id="bl">${renderLoading('Cargando...')}</div>`;
    c.innerHTML=h;
    if(_btCache)paintBT(_btCache);
    loadBT();
    document.getElementById('btn-bt-scan')?.addEventListener('click',async()=>{
        const btn=document.getElementById('btn-bt-scan');
        if(btn){btn.disabled=true;btn.classList.add('spinning');}
        try{await tauriInvoke('bluetooth_scan');await loadBT();}catch(e){toast(String(e),'❌');}finally{if(btn){btn.disabled=false;btn.classList.remove('spinning');}}
    });

    setupToggle('bt-page',async a=>{
        await tauriInvoke('toggle_bluetooth',{enable:a});
        const label=document.querySelector('[data-toggle="bt-page"]')?.previousElementSibling;
        if(label){label.textContent=a?t('enabled'):t('disabled');label.style.color=a?'var(--blue)':'var(--tx2)';}
        if(a)loadBT();
        toast(a?'Bluetooth activado':'Bluetooth desactivado');
    });


}

let _wifiCache=null,_wifiSig='';
async function loadWifi(){
    if(!document.getElementById('wl'))return;
    try{paintWifi(parseServiceResult(await tauriInvoke('get_wifi_status')));}
    catch(e){const el=document.getElementById('wl');if(el)el.innerHTML=renderServiceError(e,'redes Wi-Fi');}
}
function paintWifi(status){
    const cur=document.getElementById('wifi-current'),el=document.getElementById('wl');
    if(!el)return;
    // Los listeners del sistema llaman cada pocos segundos; repintar sin cambios
    // reiniciaba la animación de las filas.
    const sig=JSON.stringify(status);
    _wifiCache=status;
    if(sig===_wifiSig&&!el.querySelector('.loading'))return;
    _wifiSig=sig;
    try{
        const toggle=document.querySelector('[data-toggle="wifi-page"]');
        if(toggle&&!toggle.dataset.pending){toggle.classList.toggle('active',status.enabled);toggle.setAttribute('aria-checked',String(status.enabled));const label=toggle.previousElementSibling;if(label)label.textContent=status.enabled?t('enabled'):t('disabled');}
        if(!status.enabled){if(cur)cur.innerHTML=renderInfoItem('Dispositivo Wi-Fi apagado','Activa Wi-Fi para buscar redes');el.innerHTML='';return;}
        const nets=status.networks;
        const active=nets.find(n=>n.active);
        if(cur){
            cur.innerHTML=active
                ?`<div class="conn-net-item">
                    ${wifiIcon(active.band,true)}
                    <div class="conn-net-info">
                        <span class="conn-net-name" style="color:var(--blue)">${esc(active.ssid)}</span>
                        <span class="conn-net-sub">Conectado · ${esc(active.security||'Abierta')}</span>
                    </div>
                    <button class="conn-gear-btn" id="detail-btn" data-ssid="${esc(active.ssid)}" data-sec="${esc(active.security||'')}" data-band="${esc(active.band||'')}">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--tx2)" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                    </button>
                  </div>`
                :renderInfoItem('Sin conexión activa','Selecciona una red abajo');
            cur.querySelector('#detail-btn')?.addEventListener('click',e=>{
                e.stopPropagation();
                const b=e.currentTarget;
                // Find the container to render into — go up to the #app element
                const app=document.getElementById('app');
                if(app)renderWifiDetailPage(app,{ssid:b.dataset.ssid,security:b.dataset.sec,band:b.dataset.band});
            });
        }
        const others=nets.filter(n=>!n.active);
        el.innerHTML=others.length?others.map(n=>`
            <div class="conn-net-item" data-ssid="${esc(n.ssid)}" data-sec="${esc(n.security||'')}">
                ${wifiIcon(n.band,false)}
                <div class="conn-net-info">
                    <span class="conn-net-name">${esc(n.ssid)}</span>
                    <span class="conn-net-sub">${esc(n.security||'Abierta')}</span>
                </div>
                ${n.security&&n.security!=='--'?lockIcon():''}
            </div>`).join(''):renderInfoItem('No se encontraron redes');
        el.querySelectorAll('.conn-net-item[data-ssid]').forEach(row=>{
            row.addEventListener('click',()=>{
                const ssid=row.dataset.ssid,sec=row.dataset.sec;
                if(!sec||sec==='--'){cWifi(ssid,'');return;}
                document.getElementById('wd')?.remove();
                const d=document.createElement('div');d.id='wd';d.className='wifi-dialog';
                d.innerHTML=`<span class="dt">Conectar a ${esc(ssid)}</span><input type="password" id="wp" placeholder="Contraseña" autofocus><div class="wifi-dialog-btns"><button class="btn btn-secondary btn-sm" id="wc">Cancelar</button><button class="btn btn-primary btn-sm" id="wo">Conectar</button></div>`;
                row.insertAdjacentElement('afterend',d);
                document.getElementById('wc').onclick=()=>d.remove();
                document.getElementById('wo').onclick=()=>{cWifi(ssid,document.getElementById('wp').value);d.remove();};
                document.getElementById('wp').addEventListener('keydown',e=>{if(e.key==='Enter'){cWifi(ssid,document.getElementById('wp').value);d.remove();}});
            });
        });
    }catch(e){el.innerHTML=renderServiceError(e,'redes Wi-Fi');}
}
async function cWifi(s,p){
    toast('Conectando...','📶');
    try{await tauriInvoke('connect_wifi',{ssid:s,password:p});toast('Conectado a '+s,'📶');loadWifi();}
    catch(e){toast('Error al conectar','❌');}
}

let _btCache=null,_btSig='';
async function loadBT(){
    if(!document.getElementById('bl'))return;
    try{paintBT(parseServiceResult(await tauriInvoke('get_bluetooth_status')));}
    catch(e){
        console.error('[BT] loadBT parse error',e);
        const el=document.getElementById('bl');if(el)el.innerHTML=renderServiceError(e,'dispositivos Bluetooth');
    }
}
// Igual que paintWifi: sin cambios no se repinta, o las filas pierden hover y foco.
function paintBT(status){
    const el=document.getElementById('bl');if(!el)return;
    const sig=JSON.stringify(status);
    _btCache=status;
    if(sig===_btSig&&!el.querySelector('.loading'))return;
    _btSig=sig;
    {
        const toggle=document.querySelector('[data-toggle="bt-page"]');
        if(toggle&&!toggle.dataset.pending){toggle.classList.toggle('active',status.enabled);toggle.setAttribute('aria-checked',String(status.enabled));const label=toggle.previousElementSibling;if(label){label.textContent=status.enabled?t('enabled'):t('disabled');label.style.color=status.enabled?'var(--blue)':'var(--tx2)';}}
        const scan=document.getElementById('btn-bt-scan');if(scan)scan.disabled=!status.enabled;
        if(!status.enabled){el.innerHTML=renderInfoItem('Dispositivo Bluetooth apagado','Activa Bluetooth para buscar dispositivos');return;}
        const devs=status.devices;
        if(!devs.length){el.innerHTML=renderInfoItem('No hay dispositivos vinculados','Activa el modo vinculación en el otro dispositivo');return;}
        el.innerHTML=devs.map(d=>`
            <div class="conn-bt-item ${d.connected?'conn-bt-connected':''}">
                <div class="conn-bt-icon">${btIcon(d.icon||'',d.name)}</div>
                <div class="conn-bt-info">
                    <span class="conn-bt-name">${esc(d.name)}</span>
                    <span class="conn-bt-sub">${d.connected?'Conectado':'Desconectado'}</span>
                </div>
                <button class="conn-gear-btn conn-bt-action" data-mac="${esc(d.mac)}" data-c="${d.connected}" data-paired="${d.paired}">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--tx2)" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </button>
            </div>`).join('');
        el.querySelectorAll('.conn-bt-action').forEach(b=>{
            b.addEventListener('click',async()=>{
                // En los dispositivos de audio, el engranaje abre sus
                // controles propios; no debe intentar conectar/desconectar.
                const device=devs.find(d=>d.mac===b.dataset.mac);
                const name=(device?.name||'').toLowerCase();
                const icon=(device?.icon||'').toLowerCase();
                const isAudio=icon.includes('headset')||icon.includes('headphone')||
                    icon.includes('audio')||name.includes('buds')||name.includes('airpods')||
                    name.includes('headset')||name.includes('earphone')||name.includes('beats');
                if(isAudio&&device){
                    const mac=esc(device.mac||'—');
                    showDialog(esc(device.name||'Dispositivo Bluetooth'),
                        `<div style="display:flex;flex-direction:column;gap:10px">
                            <div style="font-size:12px;color:var(--tx2)">MAC: <span style="color:var(--tx)">${mac}</span></div>
                            <button class="bk-dbtn" id="bt-dialog-disconnect">${device.connected?'Desconectar':'Conectar'}</button>
                            <button class="bk-dbtn danger" id="bt-dialog-forget">Olvidar dispositivo</button>
                        </div>`,{confirmText:'Cerrar',onConfirm:()=>{}});
                    const ov=document.querySelector('.bk-overlay:last-of-type');
                    ov?.querySelector('#bt-dialog-disconnect')?.addEventListener('click',async()=>{
                        try{
                            if(device.connected)await tauriInvoke('disconnect_bluetooth',{mac:device.mac});
                            else {if(device.paired!==true&&device.paired!=='true')await tauriInvoke('pair_bluetooth',{mac:device.mac});await tauriInvoke('connect_bluetooth',{mac:device.mac});}
                            ov.remove();toast(device.connected?'Desconectado':'Conectando…','🔵');setTimeout(loadBT,1200);
                        }catch(e){toast('No se pudo modificar el dispositivo','❌');}
                    });
                    ov?.querySelector('#bt-dialog-forget')?.addEventListener('click',()=>showDialog('Olvidar dispositivo',`¿Quieres olvidar ${esc(device.name||'este dispositivo')}?`,{confirmText:'Olvidar',confirmClass:'danger',onConfirm:async()=>{try{await tauriInvoke('forget_bluetooth',{mac:device.mac});toast('Dispositivo olvidado');loadBT();}catch(e){toast('No se pudo olvidar','❌');}}}));
                    return;
                }
                try{
                    if(b.dataset.c==='true')await tauriInvoke('disconnect_bluetooth',{mac:b.dataset.mac});
                    else {if(b.dataset.paired!=='true')await tauriInvoke('pair_bluetooth',{mac:b.dataset.mac});await tauriInvoke('connect_bluetooth',{mac:b.dataset.mac});}
                    loadBT();toast(b.dataset.c==='true'?'Desconectado':'Conectado','🔵');
                }catch(e){toast('Error','❌');}
            });
        });
        // La fila completa es la acción rápida: al pulsar un dispositivo
        // desvinculado/desconectado se intenta conectar sin obligar al usuario
        // a acertar con un botón pequeño.
        // Por posición y no por nombre: dos auriculares del mismo modelo se
        // llaman igual y find() conectaba siempre el primero.
        el.querySelectorAll('.conn-bt-item').forEach((row,i)=>{
            row.addEventListener('click',async e=>{
                if(e.target.closest('.conn-bt-action'))return;
                const device=devs[i];
                if(!device||device.connected)return;
                row.style.opacity='.6';
                try{
                    if(device.paired!==true&&device.paired!=='true')await tauriInvoke('pair_bluetooth',{mac:device.mac});
                    await tauriInvoke('connect_bluetooth',{mac:device.mac});
                    toast('Conectando…','🔵');
                    setTimeout(loadBT,1200);
                }catch(e){row.style.opacity='';toast('No se pudo conectar','❌');}
            });
        });
    }
}

// ── WiFi network detail page ─────────────────────────────────────────────
async function renderWifiDetailPage(c,{ssid,security,band}){
    // Clear current page intervals and register sub-nav back callback
    window.clearPageIntervals?.();
    if(window.pushSubNav)window.pushSubNav(()=>renderWifiPage(c));
    const bigIcon=`<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="#fff" stroke="none"/></svg>`;
    c.innerHTML=renderHeader(t('hdr_wifi_details'))+
        `<div class="wifi-detail-hero">
            <div class="wifi-detail-icon">${bigIcon}</div>
            <div class="wifi-detail-ssid">${esc(ssid)}</div>
            <div class="wifi-detail-status" id="wd-status">${_tr('Conectado')}</div>
        </div>`+
        `<div class="detail-card" id="wd-details">${renderLoading(_tr('Obteniendo detalles...'))}</div>`+
        `<div class="detail-card" id="wd-pw-card">
            <div class="wifi-detail-row wifi-pw-row">
                <span class="wifi-detail-label">${_tr('Contraseña')}</span>
                <div class="wifi-pw-actions">
                    <span class="wifi-pw-val" id="wd-pw">••••••••</span>
                    <button class="wifi-eye-btn" id="wd-eye" title="${_tr('Mostrar contraseña')}">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                    <button class="wifi-eye-btn" id="wd-copy-pw" title="${_tr('Copiar')}" style="display:none">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                </div>
            </div>
        </div>`+
        `<div style="padding:0 0 16px"><button class="btn-forget" id="wd-forget">${_tr('Olvidar red')}</button></div>`;

    // Load network details
    try{
        const d=JSON.parse(await tauriInvoke('get_wifi_details',{ssid}));
        const ipFull = d.ip ? (d.prefix ? `${d.ip}/${d.prefix}` : d.ip) : '';
        const rows=[
            ['Seguridad', security||_tr('Abierta'), false],
            ['Frecuencia', band||'—', false],
            ['Dirección IP', ipFull||'—', !!ipFull],
            ['Puerta de enlace', d.gateway||'—', !!d.gateway],
            ['DNS', d.dns||'—', !!d.dns],
            ['IPv6', d.ip6||'—', !!d.ip6],
            ['MTU', d.mtu||'—', false],
            ['Dirección MAC', d.mac||'—', !!d.mac],
        ];
        document.getElementById('wd-details').innerHTML=rows.map(([l,v,copyable])=>
            `<div class="wifi-detail-row"${copyable?` data-copy="${esc(v)}" title="${_tr('Copiar')}"`:''}>
                <span class="wifi-detail-label">${_tr(l)}</span>
                <span class="wifi-detail-val"><span class="wd-val-txt">${esc(v)}</span>${copyable?'<svg class="wd-copy-hint" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>':''}</span>
            </div>`
        ).join('');
        // Click-to-copy on rows with data-copy
        document.querySelectorAll('#wd-details .wifi-detail-row[data-copy]').forEach(r=>{
            r.addEventListener('click',()=>{
                const v=r.getAttribute('data-copy');
                navigator.clipboard?.writeText(v).then(()=>toast(_tr('Copiado'),'📋')).catch(()=>{});
            });
        });
    }catch(e){
        document.getElementById('wd-details').innerHTML=renderInfoItem(_tr('No se pudieron cargar los detalles'));
    }

    // Password reveal — try without sudo first, then ask
    let _pw=null;
    const _showPw=()=>{
        const el=document.getElementById('wd-pw');
        const cpy=document.getElementById('wd-copy-pw');
        if(el){el.textContent=_pw;el.classList.add('revealed');}
        if(cpy)cpy.style.display='flex';
    };
    document.getElementById('wd-eye')?.addEventListener('click',async()=>{
        const el=document.getElementById('wd-pw');
        const cpy=document.getElementById('wd-copy-pw');
        if(!el)return;
        if(_pw!==null){
            const hidden=el.textContent==='••••••••';
            el.textContent=hidden?_pw:'••••••••';
            el.classList.toggle('revealed',hidden);
            if(cpy)cpy.style.display=hidden?'flex':'none';
            return;
        }
        try{
            const res=JSON.parse(await tauriInvoke('get_wifi_password',{ssid,sudoPassword:''}));
            if(res.ok&&res.password){_pw=res.password;_showPw();}
            else el.textContent='—';
        }catch(e){toast(String(e),'❌');}
    });
    document.getElementById('wd-copy-pw')?.addEventListener('click',()=>{
        if(_pw==null)return;
        navigator.clipboard?.writeText(_pw).then(()=>toast(_tr('Copiado'),'📋')).catch(()=>{});
    });

    // Forget network
    document.getElementById('wd-forget')?.addEventListener('click',()=>{
        showDialog(`Olvidar "${esc(ssid)}"`,
            'El equipo no se conectará automáticamente a esta red.',
            {confirmText:'Olvidar',confirmClass:'danger',onConfirm:async()=>{
                try{await tauriInvoke('forget_wifi',{ssid});toast('Red olvidada');renderWifiPage(c);}
                catch(e){toast('Error al olvidar la red','❌');}
            }});
    });
}


// ════════════════════════════════════════════════════════════════════════
// ── Pantallas gestionadas por BookOS Desktop ────────────────────────────
// ════════════════════════════════════════════════════════════════════════
// Las acciones van siempre por la API del compositor BookOS.
//
// El contrato de la interfaz D-Bus lo documenta bookos-comp/src/ajustes.rs.

// La disponibilidad se cachea para la vida de la página: el escritorio no
// cambia de compositor a media sesión, y preguntarlo en cada render sería una
// ida y vuelta al bus por cada popover que se abre.



async function bkCapabilities(){
    try{return JSON.parse(await tauriInvoke('bookos_get_capabilities'));}
    catch(e){return {};}
}

async function bkGetOutputs(){
    try{return JSON.parse(await tauriInvoke('bookos_get_outputs'));}
    catch(e){console.error('[Pantalla] bookos_get_outputs',e);return [];}
}

/// El modo que una salida tiene puesto ahora mismo.
function bkModoActual(o){
    return (o.modos||[]).find(m=>m.actual)||(o.modos||[]).find(m=>m.preferido)||(o.modos||[])[0]||null;
}
const bkHz=m=>m?Math.round(m.refresco_mhz/1000):0;
const bkRes=m=>m?`${m.ancho}x${m.alto}`:'';

/// Convierte el censo en la petición equivalente: es el punto de partida al que
/// se le aplican los cambios de una sola salida. Se manda **siempre la
/// configuración completa** porque una posición o una pantalla principal solo
/// tienen sentido respecto de las demás.
function bkPeticiones(outs,id,cambios){
    return outs.map(o=>{
        const m=bkModoActual(o);
        const base={
            id:o.id,activa:o.activa,
            ancho:m?m.ancho:0,alto:m?m.alto:0,refresco_mhz:m?m.refresco_mhz:0,
            escala:o.escala,x:o.x,y:o.y,
            transformacion:o.transformacion,vrr:o.vrr,principal:o.principal,
        };
        return o.id===id?{...base,...cambios}:base;
    });
}

/// Aplica y devuelve `{ok,error}` **sin adornar**: si el compositor dice que no,
/// la interfaz tiene que enseñar el motivo y no un «aplicado» que no ocurrió.
async function bkApply(peticiones){
    try{
        const r=JSON.parse(await tauriInvoke('bookos_apply_output_config',{config:peticiones}));
        return {ok:!!r.ok,error:r.error||''};
    }catch(e){return {ok:false,error:String(e)};}
}

/// Marcar sólo la principal es un cambio del conjunto: la que lo era deja de
/// serlo, así que se reescriben todas.
function bkPeticionesPrincipal(outs,id){
    return bkPeticiones(outs,null,null).map(p=>({...p,principal:p.id===id}));
}

/// Estados que la interfaz enseña. Que sean cuatro y no dos es lo que evita el
/// «parece que funcionó»: `pendiente` mientras el compositor contesta,
/// `reinicio` para lo que se guarda pero no se ve hasta la próxima sesión.
const BK_ESTADO={aplicado:'✓',pendiente:'…',reinicio:'↻',error:'❌'};
function bkToast(estado,texto){
    toast(texto,BK_ESTADO[estado]||'✓');
}

/// ¿Esta combinación va a ir a tirones?
///
/// Con escala fraccional el compositor tiene que reescalar cada superficie que
/// no dibuje directamente a esa escala, y a 120 Hz eso son 8,3 ms de
/// presupuesto por fotograma para hacer un trabajo extra que a 60 tiene 16,6.
/// No se prohíbe —se ve bien en máquinas holgadas— pero se avisa.
function bkAvisoFluidez(escala,hz){
    const fraccional=Math.abs(escala-Math.round(escala))>0.001;
    if(fraccional&&hz>=90)
        return _tr('Escala fraccional a')+' '+hz+' Hz: '+_tr('puede notarse menos fluido que con una escala entera');
    return '';
}

// ════════════════════════════════════════════════════════════════════════
// ── Pantalla ────────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════
export async function renderPantalla(c){
await renderPantallasBookOS(c);
}

// ── Pantalla sub-pages ──────────────────────────────────────────────────
function _ckmark(){
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--blue)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
}













// ════════════════════════════════════════════════════════════════════════
// ── Sonido ──────────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════
export async function renderSonido(c){
await desktop.sound(c); addSystemListener(()=>{if(c.querySelector('.audio-page :focus'))return;return desktop.sound(c);});
}

// ════════════════════════════════════════════════════════════════════════
// ── Batería (real-time, per-app, predictive) ─────────────────────────────
// ════════════════════════════════════════════════════════════════════════

// Calculate human-readable time string for charging/discharging
function _batTimeText(bat, gb){
    const pct=parseInt(bat.percentage)||0;
    const erate=parseFloat((bat.energy_rate||'0').split(' ')[0].replace(',','.'))||0;
    const ef=parseFloat((bat.energy_full||'').replace(',','.'))||0;
    if(bat.state==='charging'&&erate>0&&ef>0){
        const limit=Math.min(100,Math.max(50,parseInt((gb&&gb.charge_limit)||'80')||80));
        if(pct>=limit)return'Límite de carga alcanzado';
        const whNeeded=(limit-pct)/100*ef;
        const h=whNeeded/erate;
        if(h<(1/60))return'Casi completo';
        if(h<1){const m=Math.round(h*60);return`${m} min para completar la carga`;}
        const hh=Math.floor(h),mm=Math.round((h-hh)*60);
        return mm>0?`${hh}h ${mm}min para completar la carga`:`${hh}h para completar la carga`;
    }
    if(bat.state==='discharging'&&erate>0&&ef>0){
        const whLeft=(pct/100)*ef;
        const h=whLeft/erate;
        if(h<(1/60))return'Batería casi agotada';
        if(h<1){const m=Math.round(h*60);return`${m} min de batería restante`;}
        const hh=Math.floor(h),mm=Math.round((h-hh)*60);
        return mm>0?`${hh}h ${mm}min de batería restante`:`${hh}h de batería restante`;
    }
    // Fallback to UPower string
    let t=(bat.time||'').replace('hours','horas').replace('minutes','minutos').replace('hour','hora').replace('minute','minuto');
    if(!t)return'';
    return bat.state==='charging'?`${t} para completar la carga`:`${t} de batería restante`;
}

// ── IPC con el applet de batería ──────────────────────────────────────────
// Escribe el estado actual al archivo compartido /tmp/bookos-state.json
// para que el widget de la bandeja lo lea y se actualice al instante.
function _emitIpcState(profile,chargeLimit){
    const state=JSON.stringify({power_profile:profile,charge_limit:chargeLimit,source:'settings',ts:Date.now()});
    tauriInvoke('write_ipc_state',{state}).catch(()=>{});
}

export async function renderBateria(c){
    c.innerHTML=renderHeader(t('hdr_battery'))+renderSkeleton(2)+renderSkeletonChart();
    await _renderBateriaContent(c);
    // Re-render on window resize so the chart re-fits its bar count when the
    // window is resized / un-maximized. Debounced; self-removes when the page
    // is no longer mounted.
    let _rzT;
    const _onResize=()=>{
        clearTimeout(_rzT);
        _rzT=setTimeout(()=>{
            if(!document.querySelector('.bat-chart')){window.removeEventListener('resize',_onResize);return;}
            _renderBateriaContent(c);
        },200);
    };
    window.addEventListener('resize',_onResize);
    // Auto-refresh every 5s — updates live data and syncs state with the battery applet
    let _lastIpcTs=0;
    addInterval(async()=>{
        if(!document.querySelector('.bat-time-big'))return;
        try{
            const [bat,bprot2,savedLimit2,hw2,ipcRaw]=await Promise.all([
                tauriInvoke('get_battery_status').then(JSON.parse).catch(()=>null),
                getSetting('BatteryProtection','false').then(v=>v==='true'),
                getSetting('ChargeLimit','80').then(v=>Math.min(100,Math.max(50,parseInt(v)||80))),
                tauriInvoke('check_hw_features').then(JSON.parse).catch(()=>null),
                tauriInvoke('read_ipc_state').catch(()=>''),
            ]);
            if(!bat)return;
            const pct=parseInt(bat.percentage)||0;
            const states={'charging':'⚡ Cargando','discharging':'En uso','fully-charged':'✓ Completa','not charging':'No cargando','unknown':''};
            const effectiveLimit=bprot2?savedLimit2:100;
            // At the protection limit, "not charging" really means full
            if(bat.state==='not charging'&&pct>=effectiveLimit-1)bat.state='fully-charged';
            const timeText=_batTimeText(bat,{charge_limit:String(effectiveLimit)});
            const bigEl=document.querySelector('.bat-time-big');
            const subEl=document.querySelector('.bat-sub');
            const fillEl=document.querySelector('.bat-level-fill');
            const rateEl=document.querySelector('.bat-full-info');
            if(bigEl){
                const numEl=bigEl.querySelector('.bat-time-num');
                const lblEl=bigEl.querySelector('.bat-time-label');
                if(timeText){
                    const _split=(t)=>{const m=t.match(/^(.+?)\s+(para\s+|de\s+)(.+)$/i);return m?{num:m[1],label:m[2]+m[3]}:{num:t,label:''};};
                    const {num,label}=_split(timeText);
                    if(numEl)numEl.textContent=num;
                    if(lblEl)lblEl.textContent=label;
                    else if(label&&numEl){const s=document.createElement('span');s.className='bat-time-label';s.textContent=label;bigEl.appendChild(s);}
                } else {
                    if(numEl)numEl.textContent=`${pct}%`;
                    if(lblEl)lblEl.textContent='';
                }
            }
            if(subEl)subEl.textContent=timeText?`${pct}% disponible`:(states[bat.state]||'Batería');
            if(fillEl){fillEl.style.width=pct+'%';}
            const erate=parseFloat((bat.energy_rate||'0').split(' ')[0].replace(',','.'))||0;
            const chargingLbl2=bprot2&&savedLimit2<100?`Cargando hasta el ${savedLimit2}%`:(bat.state==='charging'?'Cargando':'');
            if(rateEl)rateEl.textContent=`${chargingLbl2?chargingLbl2+' · ':''}${erate>0?`Consumo: ${erate.toFixed(1)} W`:''}`;

            // ── Sync desde el sistema (detecta cambios del applet) ──────
            if(hw2){
                const sysProfile=hw2.performance_mode||'balanced';
                document.querySelectorAll('.perf-mode-card').forEach(x=>
                    x.classList.toggle('active',x.dataset.mode===sysProfile));
                // Sync límite de carga si no lo está arrastrando el usuario
                const sliderEl=document.getElementById('cl');
                if(sliderEl&&document.activeElement!==sliderEl){
                    const sysLimit=hw2.charge_limit?parseInt(hw2.charge_limit):100;
                    if(parseInt(sliderEl.value)!==sysLimit){
                        sliderEl.value=sysLimit;
                        const lbl=document.getElementById('cl-l');
                        if(lbl)lbl.textContent=sysLimit+'%';
                        const fill=((sysLimit-50)/(100-50))*100;
                        sliderEl.style.setProperty('--fill',fill+'%');
                    }
                }
            }

            // ── Leer eventos IPC del applet ─────────────────────────────
            // El applet escribe {"power_profile":"...","source":"applet"} en /tmp/bookos-state.json
            if(ipcRaw){
                try{
                    const ipc=JSON.parse(ipcRaw);
                    if(ipc.source==='applet'&&ipc.ts&&ipc.ts!==_lastIpcTs){
                        _lastIpcTs=ipc.ts;
                        if(ipc.power_profile){
                            document.querySelectorAll('.perf-mode-card').forEach(x=>
                                x.classList.toggle('active',x.dataset.mode===ipc.power_profile));
                        }
                    }
                }catch(e){}
            }
        }catch(e){}
    },5000);
}

// Charge-limit writes need the same authentication path as the other hardware
// controls. Cache the password only for this running Settings process so a
// slider does not open a password dialog for every pixel of movement.
let _chargeLimitPassword=null;
let _chargeLimitAuthPromise=null;
async function applyChargeLimit(limit){
    const args={limit:Number(limit)};
    if(_chargeLimitPassword)args.password=_chargeLimitPassword;
    let result=JSON.parse(await tauriInvoke('set_charge_limit',args));
    if(!result.needs_auth)return result;
    if(!_chargeLimitAuthPromise){
        _chargeLimitAuthPromise=(async()=>{
            const auth=await window.promptAuth?.({
                title:'Permisos para proteger la batería',
                description:'BookOS necesita autorización para escribir el límite de carga del firmware.',
                confirmLabel:'Autorizar',verifyPassword:false,allowFingerprint:true,
            });
            if(auth?.method==='password'&&auth.password){_chargeLimitPassword=auth.password;return auth.password;}
            return null;
        })().finally(()=>{_chargeLimitAuthPromise=null;});
    }
    const password=await _chargeLimitAuthPromise;
    if(!password)return result;
    return JSON.parse(await tauriInvoke('set_charge_limit',{limit:Number(limit),password}));
}

// Two-phase render: phase 1 paints immediately with the cheap reads (status,
// settings, history); the heavy statistics (CSV charts, app usage, thermal,
// ML prediction — seconds of Python/CSV work) load in the background and the
// page re-renders once they arrive. `heavy` carries phase-2 data on re-entry.
async function _renderBateriaContent(c, heavy=null){
    let bat={percentage:'0',state:'unknown',time:'',energy_rate:'',energy_full:'',energy_full_design:''};
    let gb={perf_supported:false,charge_limit_supported:false,performance_mode:'balanced',charge_limit:''};
    let hist=[];
    let bprot=false,dimlow=false,showpct=true,psMode='balanced';
    let appUsage=[];
    let savedChargeLimit=80;
    let csvData={ok:false,rows:[]},adaptivePreds={ok:false,predictions:[]};
    let adaptiveEnabled=false;
    let thermalData={ok:false,rows:[]};
    let chargingInfo={ok:false};
    try{
        const _heavyFetch=()=>Promise.all([
            tauriInvoke('get_app_power_usage').then(JSON.parse).catch(()=>[]),
            tauriInvoke('get_adaptive_predictions').then(JSON.parse).catch(()=>({ok:false,predictions:[]})),
            tauriInvoke('get_thermal_csv_data').then(JSON.parse).catch(()=>({ok:false,rows:[]})),
            tauriInvoke('predict_battery_runtime').then(JSON.parse).catch(()=>({ok:false})),
        ]);
        // CSV chart data is a cheap file read — fetch it in phase 1 so the
        // chart paints immediately instead of waiting for the heavy stats.
        const [settingsBatch, batRaw, gbRaw, histRaw, chgRaw, csvRaw] = await Promise.all([
            tauriInvoke('get_settings_batch',{keys:['BatteryProtection','DimLowBattery','ShowBatteryPercent','PowerSaver','ChargeLimit','AdaptiveCharging']}).then(JSON.parse).catch(()=>({})),
            tauriInvoke('get_battery_status').then(JSON.parse).catch(()=>({percentage:'0',state:'unknown',time:'',energy_rate:'',energy_full:'',energy_full_design:''})),
            ci('check_hw_features').then(JSON.parse).catch(()=>({perf_supported:false,charge_limit_supported:false,performance_mode:'balanced',charge_limit:''})),
            ci('get_battery_history').then(JSON.parse).catch(()=>[]),
            tauriInvoke('get_charging_info').then(JSON.parse).catch(()=>({ok:false})),
            tauriInvoke('get_battery_csv_data').then(JSON.parse).catch(()=>({ok:false,rows:[]})),
        ]);
        chargingInfo=chgRaw;
        bat=batRaw; gb=gbRaw; hist=histRaw; csvData=csvRaw;
        if(heavy){
            const [appRaw, predsRaw, thermRaw, mlPredRaw]=heavy;
            appUsage=appRaw; adaptivePreds=predsRaw; thermalData=thermRaw;
            c.dataset.mlPred=JSON.stringify(mlPredRaw||{ok:false});
        }else{
            c.dataset.mlPred=JSON.stringify({ok:false});
            // Load the heavy stats in the background and re-render in place when
            // ready — unless the user already navigated away (epoch guard).
            const _ep=window.navEpoch?window.navEpoch():0;
            _heavyFetch().then(hv=>{
                if(window.isStale&&window.isStale(_ep))return;
                if(!document.getElementById('bat-stats-btn'))return;   // page swapped
                const _scroller=document.querySelector('.detail-view')||c;
                const _scroll=_scroller.scrollTop;
                _renderBateriaContent(c,hv).then(()=>{_scroller.scrollTop=_scroll;});
            }).catch(()=>{});
        }
        const s=settingsBatch;
        bprot=(s.BatteryProtection??'false')==='true';
        dimlow=(s.DimLowBattery??'false')==='true';
        showpct=(s.ShowBatteryPercent??'true')!=='false';
        psMode=s.PowerSaver??'balanced';
        savedChargeLimit=Math.min(100,Math.max(50,parseInt(s.ChargeLimit)||80));
        adaptiveEnabled=(s.AdaptiveCharging??'false')==='true';
        if(adaptiveEnabled) bprot=false; // mutually exclusive — adaptive takes priority
        // Keep _sc in sync with batch results
        Object.entries(s).forEach(([k,v])=>{if(v!=null)primeSetting(k,v);});
    }catch(e){console.error('[Batería] Error:',e);}

    // Effective charge limit: prefer saved slider value (user's intent) over raw hardware value
    const chargeLimit=bprot?savedChargeLimit:100;

    // Re-apply hardware limit when sysfs lost it (it resets on boot). Solo si
    // no coincide: escribirlo en cada visita es una orden de escritura, y
    // cada escritura vacía la caché de lecturas de toda la app, así que la
    // página siguiente volvía a pedirlo todo al backend.
    if(bprot && gb.charge_limit_supported && savedChargeLimit<100 && parseInt(gb.charge_limit)!==savedChargeLimit){
        tauriInvoke('set_charge_limit',{limit:savedChargeLimit}).catch(()=>{});
    }

    const states={'charging':'⚡ Cargando','discharging':'En uso','fully-charged':'✓ Completa','not charging':'No cargando','unknown':''};
    const pct=parseInt(bat.percentage)||0;
    // At the protection limit, "not charging" really means full
    if(bat.state==='not charging'&&pct>=chargeLimit-1)bat.state='fully-charged';
    // Pass chargeLimit explicitly so text always uses the right target
    const timeText=_batTimeText(bat,{charge_limit:String(chargeLimit)})||'';
    const ef=parseFloat((bat.energy_full||'').replace(',','.'))||0;
    // energy_full_design can sometimes be lower than energy_full due to UPower calibration — use max as denominator
    const efdRaw=parseFloat((bat.energy_full_design||'').replace(',','.'))||0;
    const efd=efdRaw>0?Math.max(efdRaw,ef):ef||1;
    const capacityVal=parseFloat((bat.capacity||'').replace('%','').replace(',','.'))||(efd>0?Math.min(100,Math.round(ef/efd*100)):100);
    const health=Math.min(100,Math.round(capacityVal));
    // Kebab (3-dot) menu in the header opens a stats popup instead of inline chips.
    const _statsBtn=`<button class="icon-btn" id="bat-stats-btn" title="${_tr('Más opciones')}" aria-label="${_tr('Más opciones')}">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
    </button>`;
    let h=renderHeader(t('hdr_battery'), _statsBtn);
    h+=`<div class="bat-page-wrap">`; // max-width wrapper — evita que el chart se estire en pantalla completa

    // Hero — número grande + label más pequeño en la misma línea
    const _splitTime=(t)=>{const m=t.match(/^(.+?)\s+(para\s+|de\s+)(.+)$/i);return m?{num:m[1],label:m[2]+m[3]}:{num:t,label:''};};
    h+=`<div class="bat-hero">`;
    if(timeText){
        const {num,label}=_splitTime(timeText);
        h+=`<div class="bat-time-big"><span class="bat-time-num">${num}</span>${label?` <span class="bat-time-label">${label}</span>`:''}</div>`;
        h+=`<span class="bat-sub">${pct}% disponible</span>`;
    } else {
        h+=`<div class="bat-time-big"><span class="bat-time-num">${pct}%</span></div>`;
        h+=`<span class="bat-sub">${states[bat.state]||'Batería'}</span>`;
    }
    // Battery bar: siempre verde (#30CF00), marcador de límite si hay protección
    const isCharging=bat.state==='charging';
    const fillColor='green';
    const limitMarker=bprot&&chargeLimit<100?`<div class="bat-limit-marker" style="left:${chargeLimit}%" title="Límite: ${chargeLimit}%"></div>`:'';
    h+=`<div class="bat-level-bar">${limitMarker}<div class="bat-level-fill ${fillColor}" style="width:${pct}%"></div></div>`;
    h+=`</div>`;
    let erate=parseFloat((bat.energy_rate||'0').split(' ')[0].replace(',','.'))||0;
    const chargingLabel=bprot&&chargeLimit<100?`Cargando hasta el ${chargeLimit}%`:(isCharging?'Cargando':'');
    // ML prediction line (when available and discharging)
    let mlLine='';
    try{
        const ml=JSON.parse(c.dataset.mlPred||'{"ok":false}');
        if(ml.ok && !isCharging && ml.minutes>0 && pct>(ml.target_level||20)){
            const mins=Math.round(ml.minutes);
            const mh=Math.floor(mins/60),mm=mins%60;
            const text=mh>0?`${mh}h${mm>0?` ${mm}m`:''}`:`${mm}m`;
            mlLine=`<span style="color:var(--blue)">IA: ${text} hasta ${ml.target_level}%</span>`;
        }
    }catch(e){}
    const lineParts=[
        chargingLabel,
        erate>0?`Consumo: ${erate.toFixed(1)} W`:'',
        mlLine,
    ].filter(Boolean);
    h+=`<div class="bat-full-info" style="color:var(--tx2)">${lineParts.join(' · ')}</div>`;

    // Ajustes ANTES del gráfico
    {
        const bprotLabel=bprot?(chargeLimit>=100?'Máxima':`Hasta el ${chargeLimit}%`):'';
        const bprotDisabled=adaptiveEnabled;
        h+=renderCard([
            renderRowItem('Ahorro de energía','Limita CPU y procesos en segundo plano',renderToggle('ps',psMode==='power-saver')),
            renderRowItem('Carga adaptativa',`<span style="color:var(--${adaptiveEnabled?'blue':'tx2'})">${adaptiveEnabled?(chargeLimit<100?`Activa — límite ${chargeLimit}%`:'Activa — carga completa'):'Inactiva'}</span>`,renderToggle('adaptive-charging',adaptiveEnabled)),
            renderRowItem('Protección de la batería',bprotDisabled?`<span style="color:var(--tx2);opacity:0.45">No disponible con carga adaptativa</span>`:(bprotLabel?`<span style="color:var(--blue)">${bprotLabel}</span>`:'Limita carga para alargar vida útil'),`<span style="opacity:${bprotDisabled?0.35:1};pointer-events:${bprotDisabled?'none':'auto'}">${renderToggle('bprot',bprot&&!bprotDisabled)}</span>`),
            `<div id="bprot-limit-section"${(bprot&&!bprotDisabled)?'':' style="display:none"'} style="padding:2px 20px 12px">${renderSlider('cl',savedChargeLimit,50,100)}</div>`,
        ]);
    }

    // ── Stats for the popup (opened from the 3-dot header button) ───────────
    const _statRows=(()=>{
        const _jsDayCSV2=(d)=>d===0?7:d;
        const _todayCSV2=_jsDayCSV2(new Date().getDay());
        const todayRows2=csvData.ok?csvData.rows.filter(r=>r.day===_todayCSV2):[];
        const healthColor=health>=80?'var(--green)':health>=60?'#ff9500':'var(--red)';
        const rows=[{label:_tr('Salud'),val:`${health}%`,color:healthColor}];
        rows.push({label:_tr('Nivel actual'),val:`${pct}%`});
        if(todayRows2.length>1){
            const levels=todayRows2.map(r=>r.level);
            rows.push({label:_tr('Hoy'),val:`${Math.min(...levels)}%–${Math.max(...levels)}%`});
            const dischCount=todayRows2.filter(r=>(r.state||'').toLowerCase()==='discharging').length;
            const dischMin=Math.round(dischCount*0.5);
            if(dischMin>0){
                const dh=Math.floor(dischMin/60),dm=dischMin%60;
                rows.push({label:_tr('En uso'),val:[dh>0?`${dh}h`:'',dm>0?`${dm}m`:''].filter(Boolean).join(' ')||'0m'});
            }
        }
        if(erate>0) rows.push({label:_tr('Consumo actual'),val:`${erate.toFixed(1)} W`});
        if(ef>0&&efd>0){
            rows.push({label:_tr('Capacidad'),val:`${Math.min(ef,efd).toFixed(0)} Wh`});
            rows.push({label:_tr('Capacidad de diseño'),val:`${efd.toFixed(0)} Wh`});
        }
        return rows;
    })();
    c.dataset.batStats=JSON.stringify(_statRows);

    // Chart + app usage — combined block
    h+=`<div style="background:var(--card);border-radius:25px;overflow:hidden;margin-bottom:16px">`;
    // Chart — prefer CSV (per-minute, normalized) over hourly history
    {
        const _jsDayToCSV=(d)=>d===0?7:d;
        const _todayCSV=_jsDayToCSV(new Date().getDay());
        // Prefer timestamp filtering (new Android-style log format) — avoids
        // mixing in week-old samples from the same weekday.
        const _midnight=new Date();_midnight.setHours(0,0,0,0);
        const _midnightTs=Math.floor(_midnight.getTime()/1000);
        const _hasTs=csvData.ok&&csvData.rows.length>0&&(csvData.rows[csvData.rows.length-1].ts||0)>0;
        const todayRows=csvData.ok?(_hasTs
            ?csvData.rows.filter(r=>(r.ts||0)>=_midnightTs)
            :csvData.rows.filter(r=>r.day===_todayCSV)):[];

        const _r=document.documentElement;
        const _dark=_r.classList.contains('dark-mode')||(!_r.classList.contains('light-mode')&&window.matchMedia('(prefers-color-scheme:dark)').matches);
        const _c={
            charge:'#30CF00',
            discharge:_dark?'#5A5A5A':'#D0D0D0',
            full:'#0a84ff',
            powerSaver:_dark?'#4FDFFF':'#7BE7FF',
            estimated:_dark?'#4A4A4A':'#CBCBCB',
            tx:_dark?'#FFFFFF':'#000000',
            label:_dark?'rgba(255,255,255,0.45)':'rgba(0,0,0,0.4)',
            labelFaint:_dark?'rgba(255,255,255,0.25)':'rgba(0,0,0,0.25)',
            line80:_dark?'rgba(255,255,255,0.18)':'rgba(0,0,0,0.13)',
        };

        // Prediction label (energy_rate based)
        const erate2=parseFloat((bat.energy_rate||'0').split(' ')[0].replace(',','.'))||0;
        const ef2=parseFloat((bat.energy_full||'0').split(' ')[0].replace(',','.'))||1;
        let predLabel='';
        if(erate2>0&&!isCharging){
            const hoursLeft=ef2*(pct/100)/erate2;
            const hInt=Math.floor(hoursLeft),mInt=Math.round((hoursLeft-hInt)*60);
            predLabel=hInt>0?`~${hInt}h${mInt>0?` ${mInt}m`:''} restante`:`~${mInt}m restante`;
        } else if(erate2>0&&isCharging&&pct<chargeLimit){
            const remaining=ef2*((chargeLimit/100)-(pct/100));
            const hoursToLimit=remaining/erate2;
            const hInt=Math.floor(hoursToLimit),mInt=Math.round((hoursToLimit-hInt)*60);
            predLabel=`~${hInt>0?`${hInt}h `:''} ${mInt>0?`${mInt}m`:''} hasta ${chargeLimit}%`;
        }
        const predColor=isCharging?_c.charge:'#8899FF';

        const CHART_H=190;
        // Helper: compute 80% reference line position within normalized range
        const refLine=(minV,maxV)=>{
            if(80<=minV||80>=maxV)return'';
            const pos=Math.round((1-(80-minV)/(maxV-minV))*100);
            // Label on the right only when far enough from top/bottom ticks —
            // 18% keeps the 10px labels from overlapping the min/max % ticks
            const labelRight=pos>18&&pos<82
                ?`<div style="position:absolute;right:0;top:${pos}%;transform:translateY(-50%);font-size:10px;color:${_c.label}">80%</div>`:'';
            // Line always stops at the 28px right gutter so it never strikes
            // through the min/max % tick labels.
            return`<div style="position:absolute;left:0;right:28px;top:${pos}%;height:1.5px;background:${_c.line80};pointer-events:none"></div>${labelRight}`;
        };

        if(todayRows.length>0){
            // ── CSV chart (per-minute, normalized, wider bars) ──
            // Bar count adapts to the available width so the chart looks right
            // both maximized and windowed (≈7px per bar, clamped).
            const _chartW=(c&&c.clientWidth)||600;
            const maxBars=Math.max(48,Math.min(160,Math.floor(_chartW/7)));
            const step=Math.max(1,Math.floor(todayRows.length/maxBars));
            const sampled=todayRows.filter((_,i)=>i%step===0||i===todayRows.length-1);
            const levels=sampled.map(r=>r.level);
            const minL=Math.max(0,Math.min(...levels)-3);
            const maxL=Math.min(100,Math.max(...levels));
            const norm=(v)=>Math.max(3,Math.round(((v-minL)/(maxL-minL||1))*96));
            let bars='';
            sampled.forEach((r,i)=>{
                const s=r.state.toLowerCase();
                const isLast=i===sampled.length-1;
                // With charge protection, "full" is the limit (e.g. 80%): plugged
                // at/above the limit and not discharging counts as full.
                const isFull=s==='full'||(r.level>=chargeLimit-1&&s!=='discharging');
                const c=isFull?_c.full:s==='charging'?_c.charge:_c.discharge;
                const hPct=norm(r.level);
                const outline=isLast?`outline:2px solid ${c};outline-offset:2px;`:'';
                const pW=r.power_uw?(r.power_uw/1e6).toFixed(1)+'W':'';
                bars+=`<div class="bat-bar" style="flex:1;min-width:2px;max-width:7px;height:${hPct}%;background:${c};border-radius:3px 3px 1px 1px;${outline}" data-tip="${String(r.h).padStart(2,'0')}:${String(r.m).padStart(2,'0')} · ${r.level}%${r.state==='charging'?' ⚡':''}${pW?' · '+pW:''}"></div>`;
            });
            // x-axis: first, mid, last sample times
            const tFmt=(r)=>`${String(r.h).padStart(2,'0')}:${String(r.m).padStart(2,'0')}`;
            const midRow=sampled[Math.floor(sampled.length/2)];
            const xLabels=`
                <span style="position:absolute;left:0;font-size:10px;color:${_c.label}">${tFmt(sampled[0])}</span>
                <span style="position:absolute;left:50%;transform:translateX(-50%);font-size:10px;color:${_c.label}">${tFmt(midRow)}</span>
                <span style="position:absolute;right:28px;font-size:10px;color:${_c.label}">Ahora</span>`;
            const tickTop=`<div style="position:absolute;right:0;top:0;font-size:10px;color:${_c.label}">${maxL}%</div>`;
            const tickBot=`<div style="position:absolute;right:0;bottom:0;font-size:10px;color:${_c.labelFaint}">${minL}%</div>`;
            h+=`<div class="bat-chart" style="background:transparent;border-radius:0;margin-bottom:0">
                <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
                    <span class="chart-title" style="color:${_c.tx}">Hoy · ${todayRows.length} registros</span>
                </div>
                <div style="position:relative;padding-right:28px">
                    <div style="display:flex;align-items:flex-end;height:${CHART_H}px;gap:1.5px">${bars}</div>
                    ${tickTop}${tickBot}${refLine(minL,maxL)}
                </div>
                <div style="position:relative;height:18px;margin-top:4px;padding-right:28px">${xLabels}</div>
                <div class="bat-chart-legend" style="margin-top:6px">
                    <span><span class="chart-legend-dot" style="background:${_c.discharge}"></span>${_tr("Nivel de la batería")}</span>
                    <span><span class="chart-legend-dot" style="background:${_c.charge}"></span>${_tr("Cargando")}</span>
                    <span><span class="chart-legend-dot" style="background:${_c.full}"></span>${_tr("Completa")}</span>
                </div>
            </div>`;
        } else {
            // ── History fallback (hourly buckets, normalized) ──
            const HOURS=24, BUCKET=3600;
            const nowTs=Math.floor(Date.now()/1000);
            const buckets=Array.from({length:HOURS},(_,i)=>({
                t:nowTs-(HOURS-1-i)*BUCKET, pSum:0, n:0, charging:0, powerSaver:0, known:false
            }));
            hist.forEach(r=>{
                const age=(nowTs-r.t)/BUCKET;
                const bi=Math.floor(HOURS-1-age);
                if(bi>=0&&bi<HOURS){
                    buckets[bi].pSum+=r.p; buckets[bi].n++;
                    buckets[bi].known=true;
                    if(r.s==='charging')buckets[bi].charging++;
                    if(r.ps)buckets[bi].powerSaver++;
                }
            });
            buckets[HOURS-1].pSum=pct; buckets[HOURS-1].n=1; buckets[HOURS-1].known=true;
            if(bat.state==='charging') buckets[HOURS-1].charging=1;
            if(psMode==='power-saver') buckets[HOURS-1].powerSaver=1;
            const knownIdx=[];
            for(let i=0;i<HOURS;i++)if(buckets[i].known)knownIdx.push(i);
            if(knownIdx.length>=2){
                for(let k=0;k<knownIdx.length-1;k++){
                    const a=knownIdx[k],b=knownIdx[k+1];
                    const va=buckets[a].pSum/buckets[a].n,vb=buckets[b].pSum/buckets[b].n;
                    for(let i=a+1;i<b;i++){const t=(i-a)/(b-a);buckets[i].pSum=va+(vb-va)*t;buckets[i].n=1;}
                }
            } else if(knownIdx.length===1){
                const ki=knownIdx[0],kv=buckets[ki].pSum/buckets[ki].n;
                for(let i=0;i<HOURS;i++){if(!buckets[i].known){buckets[i].pSum=kv;buckets[i].n=1;}}
            }
            const avgs=buckets.map(b=>b.n>0?Math.min(100,b.pSum/b.n):null);
            const knownAvgs=avgs.filter(v=>v!==null);
            const minA=knownAvgs.length?Math.max(0,Math.min(...knownAvgs)-3):0;
            const maxA=knownAvgs.length?Math.min(100,Math.round(Math.max(...knownAvgs))):100;
            const normH=(v)=>Math.max(3,Math.round(((v-minA)/(maxA-minA||1))*96));
            let barDivs='';
            buckets.forEach((b,i)=>{
                const avg=avgs[i]??0;
                const isChargingBar=b.charging>b.n*0.5;
                const isPsBar=b.powerSaver>b.n*0.5;
                const isCurrent=i===HOURS-1;
                let color;
                if(!b.known&&knownIdx.length<2) color=_c.estimated;
                else if(isChargingBar||(isCurrent&&isCharging)) color=_c.charge;
                else if(isPsBar||(isCurrent&&psMode==='power-saver')) color=_c.powerSaver;
                else color=_c.discharge;
                const d=new Date(b.t*1000);
                const hh=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
                const outline=isCurrent?`outline:2px solid ${color};outline-offset:2px;`:'';
                // La envoltura necesita altura propia: con align-items:flex-end
                // del padre quedaba a altura automática y el height:% de la barra daba 0.
                barDivs+=`<div style="flex:1;height:100%;display:flex;align-items:flex-end" title="${hh} — ${Math.round(avg)}%">
                    <div style="height:${normH(avg)}%;background:${color};border-radius:5px 5px 2px 2px;${outline}transition:height .4s ease;width:100%"></div>
                </div>`;
            });
            const tickTop=`<div style="position:absolute;right:0;top:0;font-size:10px;color:${_c.label}">${maxA}%</div>`;
            const tickBot=`<div style="position:absolute;right:0;bottom:0;font-size:10px;color:${_c.labelFaint}">${minA}%</div>`;
            const labelIndices=[0,4,8,12,16,20,HOURS-1];
            const xLabels=labelIndices.map(hi=>{
                const d=new Date(buckets[hi].t*1000);
                const label=hi===HOURS-1?'Ahora':d.getHours().toString();
                const xPct=(hi/(HOURS-1)*100).toFixed(1);
                return`<span style="position:absolute;left:${xPct}%;transform:translateX(-50%);font-size:10px;color:${_c.label};white-space:nowrap">${label}</span>`;
            }).join('');
            h+=`<div class="bat-chart" style="background:transparent;border-radius:0;margin-bottom:0">
                <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
                    <span class="chart-title" style="color:${_c.tx}">${_tr("Hoy")}</span>
                </div>
                <div style="position:relative;height:${CHART_H}px;padding-right:30px">
                    <div style="display:flex;align-items:flex-end;height:100%;gap:3px">${barDivs}</div>
                    ${tickTop}${tickBot}${refLine(minA,maxA)}
                </div>
                <div style="position:relative;height:18px;margin-top:4px;padding-right:30px">${xLabels}</div>
                <div class="bat-chart-legend" style="margin-top:6px">
                    <span><span class="chart-legend-dot" style="background:${_c.discharge}"></span>${_tr("Nivel de la batería")}</span>
                    <span><span class="chart-legend-dot" style="background:${_c.estimated}"></span>Nivel de batería estimado</span>
                    <span><span class="chart-legend-dot" style="background:${_c.charge}"></span>${_tr("Cargando")}</span>
                    <span><span class="chart-legend-dot" style="background:${_c.powerSaver}"></span>Ahorro de energía</span>
                </div>
            </div>`;
        }
    }

    // Per-app power usage — icon + name + % right-aligned
    {
        const allApps=appUsage.filter(a=>(parseFloat(a.cpu)||0)>0||(parseFloat(a.mem)||0)>0);
        const userApps=allApps.filter(a=>!a.is_system);
        // ||0 en cada item para que NaN no contamine la suma (NaN||1 = 1 → porcentajes rotos)
        const totalCpuAll=allApps.reduce((s,a)=>s+(parseFloat(a.cpu)||0),0)||1;
        if(allApps.length){
            const mkAppRow=(a)=>{
                const cpu=parseFloat(a.cpu)||0;
                const sharePct=Math.min(100,cpu/totalCpuAll*100);
                const _ic=appIconUrl(a.id,a.icon);
                const iconHtml=_ic?`<img src="${_ic}" width="32" height="32" style="border-radius:10px;object-fit:contain" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`:'';
                const fallbackHtml=`<span class="bat-app-icon-fallback" style="width:32px;height:32px;font-size:11px;${_ic?'display:none':''}">${a.name.slice(0,2).toUpperCase()}</span>`;
                const rightLabel=`${sharePct.toFixed(1).replace('.',',')}%`;
                return`<div class="bat-app-item" style="padding:12px 20px">
                    <div class="bat-app-icon-wrap" style="width:32px;height:32px;flex-shrink:0">${iconHtml}${fallbackHtml}</div>
                    <span class="bat-app-name" style="flex:1;padding:0 12px;font-size:14px">${esc(a.name)}</span>
                    <span style="font-size:14px;font-weight:500;color:var(--tx2);min-width:52px;text-align:right">${rightLabel}</span>
                </div>`;
            };
            const totalSharePct=Math.min(100,userApps.slice(0,6).reduce((s,a)=>s+(parseFloat(a.cpu)||0)/totalCpuAll*100,0));
            const top=userApps.slice(0,6);
            h+=`<div style="border-top:1px solid var(--div);padding:10px 20px 4px;font-size:13px;font-weight:600;color:var(--tx2)">Uso de la batería: ${totalSharePct.toFixed(0)}%</div>`;
            if(top.length){
                h+=top.map(mkAppRow).join('');
                h+=`<div style="padding:12px;text-align:center;border-top:1px solid var(--div)"><span id="bat-sys-toggle" style="font-size:13px;font-weight:500;color:var(--blue);cursor:pointer">Ver detalles</span></div>`;
            } else {
                h+=`<div style="padding:14px 20px;color:var(--tx2);font-size:13px">Sin actividad significativa</div>`;
            }
        }
    }
    h+=`</div>`; // close chart+apps combined card

    // ── USB-C charging + adaptive-charging predictions → moved into the stats
    // popup (header 3-dot button). We build the HTML here and stash it. ─────────
    let _usbcHtml='';
    if(chargingInfo.ok && (chargingInfo.charging || chargingInfo.ac_online)){
        const pW=(chargingInfo.power_uw/1e6).toFixed(1);
        const vV=(chargingInfo.voltage_uv/1e6).toFixed(1);
        const iA=(chargingInfo.current_ua/1e6).toFixed(2);
        const peakW=(chargingInfo.peak_uw||0)/1e6;
        const adapterW=chargingInfo.adapter_w>0 ? chargingInfo.adapter_w : (peakW>0 ? Math.ceil(peakW/5)*5 : 0);
        const protocol=chargingInfo.protocol||'';
        const speedLabel=chargingInfo.charging
            ? `${pW} W · ${vV}V @ ${iA}A`
            : (chargingInfo.ac_online ? _tr('Conectado · sin carga') : _tr('Desconectado'));
        const speedColor=chargingInfo.power_uw>30e6?'var(--green)':
                         chargingInfo.power_uw>15e6?'var(--blue)':
                         chargingInfo.power_uw>0?'var(--orange)':'var(--tx2)';
        const protoLine=[protocol,adapterW>0?`${_tr('Cargador')} ${adapterW} W`:''].filter(Boolean).join(' · ');
        let rows=`<div class="bat-stat-pop-row"><span class="bat-stat-pop-label">${_tr('Potencia actual')}</span><span class="bat-stat-pop-val" style="color:${speedColor}">${esc(speedLabel)}</span></div>`;
        if(protoLine) rows+=`<div class="bat-stat-pop-row"><span class="bat-stat-pop-label">${_tr('Protocolo')}</span><span class="bat-stat-pop-val">${esc(protoLine)}</span></div>`;
        _usbcHtml=`<div class="bat-pop-section-title">${_tr('Carga USB-C')}</div><div class="bat-stat-pop">${rows}</div>`;
    }
    c.dataset.batUsbc=_usbcHtml;

    let _predHtml='';
    {
        const days=[_tr('Lun'),_tr('Mar'),_tr('Mié'),_tr('Jue'),_tr('Vie'),_tr('Sáb'),_tr('Dom')];
        const jsDayToCSV=(d)=>d===0?7:d;
        const todayCSV=jsDayToCSV(new Date().getDay());
        if(adaptivePreds.ok&&adaptivePreds.predictions.length>0){
            const predsMap=new Map(adaptivePreds.predictions.map(p=>[p.day,p]));
            let predRows='';
            for(let d=1;d<=7;d++){
                const p=predsMap.get(d);
                const isToday=d===todayCSV;
                const time=p?`${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}`:`<span style="color:var(--tx2)">${_tr('Sin datos')}</span>`;
                const samples=p?`<span class="bat-pred-samples">${p.samples} ${_tr('datos')}</span>`:'';
                predRows+=`<div class="bat-pred-row${isToday?' today':''}">
                    <span class="bat-pred-day">${days[d-1]}${isToday?` <span class="bat-pred-today">${_tr('hoy')}</span>`:''}</span>
                    <span class="bat-pred-time">${time} ${samples}</span>
                </div>`;
            }
            _predHtml=`<div class="bat-pop-section-title">${_tr('Hora predicha de desconexión')}</div><div class="bat-pred-list">${predRows}</div>`;
        } else if(csvData.ok){
            _predHtml=`<div class="bat-pop-section-title">${_tr('Hora predicha de desconexión')}</div><div class="bat-pop-empty">${_tr('Necesita más datos para predecir patrones.')}</div>`;
        }
    }
    c.dataset.batPred=_predHtml;

    // Performance mode — shown when power-profiles-daemon is available (generic Linux)
    if(gb.perf_supported){
        const rawPm=gb.performance_mode||'balanced';
        // Samsung platform-profile values → internal card keys
        const pm={'low-power':'power-saver','quiet':'power-saver','balanced':'balanced','performance':'performance'}[rawPm]||rawPm;
        const perfIcons={'power-saver':'./assets/power-saver.svg','balanced':'./assets/optimized.svg','performance':'./assets/performance.svg'};
        const perfNames={'power-saver':'Silencioso','balanced':'Optimizado','performance':'Rendimiento'};
        const perfDescs={'power-saver':'Ahorra batería','balanced':'Equilibrado','performance':'Máximo poder'};
        const modes=['power-saver','balanced','performance'];
        h+=renderSection(t('sec_perf_mode'))+`<div class="perf-modes">${modes.map(m=>`<div class="perf-mode-card ${pm===m?'active':''}" data-mode="${m}"><div class="perf-mode-icon"><img src="${perfIcons[m]}" width="32" height="32" class="perf-icon-img"></div><div class="perf-mode-name">${perfNames[m]}</div><div class="perf-mode-desc">${perfDescs[m]}</div></div>`).join('')}</div>`;
    }
    // ── Opciones avanzadas de energía (tapa, suspensión, crítica) ─────────────
    h+=renderCard([`<div class="detail-item detail-item-row" style="cursor:pointer" id="go-power-adv"><div class="detail-texts"><span class="dt">${_tr('Opciones avanzadas de energía')}</span><span class="ds">${_tr('Tapa, suspensión y batería crítica')}</span></div>${chevron()}</div>`]);
    h+=`</div>`; // cierre bat-page-wrap
    c.innerHTML=h;
    document.getElementById('go-power-adv')?.addEventListener('click',()=>{
        if(window.pushSubNav)window.pushSubNav(()=>renderBateria(c));
        window.clearPageIntervals?.();
        renderEnergyAdvanced(c);
    });

    // System process toggle (same mkAppRow as above)
    {
        let showingSys=false;
        const allApps2=appUsage.filter(a=>(parseFloat(a.cpu)||0)>0||(parseFloat(a.mem)||0)>0);
        const userApps2=allApps2.filter(a=>!a.is_system);
        const totalCpuAll2=allApps2.reduce((s,a)=>s+(parseFloat(a.cpu)||0),0)||1;
        const mkAppRow2=(a)=>{
            const cpu=parseFloat(a.cpu)||0;
            const sharePct2=Math.min(100,cpu/totalCpuAll2*100);
            const _ic=appIconUrl(a.id,a.icon);
                const iconHtml=_ic?`<img src="${_ic}" width="32" height="32" style="border-radius:10px;object-fit:contain" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`:'';
            const fallbackHtml=`<span class="bat-app-icon-fallback" style="width:32px;height:32px;font-size:11px;${_ic?'display:none':''}">${a.name.slice(0,2).toUpperCase()}</span>`;
            const rightLabel=`${sharePct2.toFixed(1).replace('.',',')}%`;
            return`<div class="bat-app-item" style="padding:12px 20px">
                <div class="bat-app-icon-wrap" style="width:32px;height:32px;flex-shrink:0">${iconHtml}${fallbackHtml}</div>
                <span class="bat-app-name" style="flex:1;padding:0 12px;font-size:14px">${esc(a.name)}</span>
                <span style="font-size:14px;font-weight:500;color:var(--tx2);min-width:52px;text-align:right">${rightLabel}</span>
            </div>`;
        };
        document.getElementById('bat-sys-toggle')?.addEventListener('click',function(){
            showingSys=!showingSys;
            this.textContent=showingSys?'Ver menos':'Ver detalles';
            const card=document.getElementById('bat-app-list');
            if(card){
                const list=showingSys?allApps2:userApps2;
                const items=list.slice(0,6).map(mkAppRow2).join('');
                // keep the "Ver detalles" footer row
                const footer=card.querySelector('[style*="text-align:center"]');
                card.innerHTML=items+(footer?footer.outerHTML:`<div style="padding:12px;text-align:center;border-top:1px solid var(--div)"><span id="bat-sys-toggle" style="font-size:13px;font-weight:500;color:var(--blue);cursor:pointer">${showingSys?'Ver menos':'Ver detalles'}</span></div>`);
                document.getElementById('bat-sys-toggle')?.addEventListener('click',arguments.callee);
            }
        });
    }

    setupToggle('ps',async a=>{
        const m=a?'power-saver':'balanced';
        const modoTermico=a?'silencioso':'optimizado';
        setSetting('PowerSaver',m);
        let ok=false;
        try{await tauriInvoke('set_performance_mode',{mode:m});_icInvalidate('check_hw_features');ok=true;}catch(e){}
        try{await tauriInvoke('aplicar_perfil_termico',{modo:modoTermico});}catch(e){}
        // Real background throttling: powersave governor + renice + ionice idle on bg tasks
        try{await tauriInvoke('set_background_throttle',{enable:a});}catch(e){}
        toast(a?'Ahorro activado · procesos en segundo plano limitados':'Rendimiento normal', ok?'✓':'⚠');
    });
    setupToggle('bprot',async a=>{
        if(a){
            // Disable adaptive charging if active (mutually exclusive)
            const adaptiveToggle=document.querySelector('[data-toggle="adaptive-charging"]');
            if(adaptiveToggle?.classList.contains('on')){
                adaptiveToggle.classList.remove('on');
                adaptiveToggle.setAttribute('aria-checked','false');
                setSetting('AdaptiveCharging','false');
                await invokeWithAuth('set_adaptive_charging',{enabled:false});
            }
        }
        const section=document.getElementById('bprot-limit-section');
        if(section)section.style.display=a?'':'none';
        const currentLimit=parseInt(document.getElementById('cl')?.value)||80;
        await Promise.all([
            setSetting('BatteryProtection',a?'true':'false'),
            setSetting('ChargeLimit',String(currentLimit)),
        ]);
        if(a){
            try{
                const r=await applyChargeLimit(currentLimit);
                if(!r.ok){
                    await setSetting('BatteryProtection','false');
                    if(section)section.style.display='none';
                    const toggle=document.querySelector('[data-toggle="bprot"]');
                    toggle?.classList.remove('active');
                    toggle?.setAttribute('aria-checked','false');
                    throw new Error(r.needs_auth?'Autorización cancelada':(r.error||'No se pudo aplicar el límite'));
                }
                toast(`Protección activa: hasta el ${currentLimit}%`,'✓');
            }catch(e){toast('No se pudo aplicar el límite de carga','❌');}
        } else {
            try{
                const r=await applyChargeLimit(100);
                toast(r.ok?'Carga ilimitada':(r.needs_auth?'No se cambió el límite: autorización cancelada':`No se pudo quitar el límite (${r.error||'error'})`),r.ok?'✓':'❌');
            }catch(e){toast('No se pudo quitar el límite de carga','❌');}
        }
    });
    // Se registran al abrir el diálogo ⋮ (ver abajo): los interruptores viven allí.
    const _setupPopToggles=()=>{
    setupToggle('dim-low',async a=>{dimlow=a;setSetting('DimLowBattery',a?'true':'false');toast(a?'Atenuación automática activada':'Atenuación automática desactivada');});
    setupToggle('show-pct',async a=>{
        showpct=a;
        setSetting('ShowBatteryPercent',a?'true':'false');
        // Notify applet via IPC state so it reacts immediately
        const curProfile=document.querySelector('.perf-mode-card.active')?.dataset?.mode||'balanced';
        const savedLim=parseInt(await getSetting('ChargeLimit','80').catch(()=>'80'))||80;
        const state=JSON.stringify({power_profile:curProfile,charge_limit:savedLim,show_percent:a,source:'settings',ts:Date.now()});
        tauriInvoke('write_ipc_state',{state}).catch(()=>{});
        toast(a?'Porcentaje visible en el widget':'Porcentaje oculto en el widget');
    });
    };

    document.querySelectorAll('.perf-mode-card').forEach(b=>{b.addEventListener('click',async()=>{
        const mode=b.dataset.mode;
        const modoTermico={'ahorro':'ahorro','power-saver':'silencioso','balanced':'optimizado','performance':'rendimiento'}[mode]||'optimizado';
        try{await tauriInvoke('set_performance_mode',{mode})}catch(e){}
        try{
            const res=await tauriInvoke('aplicar_perfil_termico',{modo:modoTermico});
            toast(`${b.querySelector('.perf-mode-name')?.textContent}: ${res}`);
        }catch(e){
            toast(`Modo activado (${e})`,'⚠️');
        }
        document.querySelectorAll('.perf-mode-card').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        // Notifica al applet de batería via IPC
        const savedLim=parseInt(await getSetting('ChargeLimit','80').catch(()=>'80'))||80;
        _emitIpcState(mode,savedLim);
    });});
    if(gb.charge_limit_supported){
        setupSlider('cl',async v=>{
            const lim=parseInt(v);
            // Keep umbral text in sync while dragging
            const umbral=document.getElementById('umbral-val');
            if(umbral)umbral.textContent=lim<100?`${lim}% (protección activa)`:'100% (sin límite)';
            try{
                const r=await applyChargeLimit(lim);
                if(!r.ok)throw new Error(r.needs_auth?'Autorización cancelada':(r.error||'error'));
                await setSetting('ChargeLimit',String(lim));
                toast(`Límite de carga: ${lim}%`,'🔋');
                // Notifica al applet vía IPC
                const curProfile=document.querySelector('.perf-mode-card.active')?.dataset?.mode||'balanced';
                _emitIpcState(curProfile,lim);
            }catch(e){toast('Error al aplicar límite de carga','❌');}
        });
    }

    setupToggle('adaptive-charging',async a=>{
        const toggle=document.querySelector('[data-toggle="adaptive-charging"]');
        const restoreOff=()=>{
            toggle?.classList.remove('active');
            toggle?.setAttribute('aria-checked','false');
            setSetting('AdaptiveCharging','false');
        };
        if(a){
            // Disable battery protection if active (mutually exclusive)
            const bprotToggle=document.querySelector('[data-toggle="bprot"]');
            if(bprotToggle?.classList.contains('active')){
                bprotToggle.classList.remove('active');
                bprotToggle.setAttribute('aria-checked','false');
                const section=document.getElementById('bprot-limit-section');
                if(section)section.style.display='none';
                setSetting('BatteryProtection','false');
                try{await applyChargeLimit(100);}catch(e){}
            }
            // Pre-emptively turn off until user confirms — setupToggle already
            // flipped it on optimistically.
            toggle?.classList.remove('active');
            showDialog(
                'Activar carga adaptativa',
                `<p style="margin:0 0 10px">La carga adaptativa aprende cuándo usas el equipo y detiene la carga antes de que llegue al 100%, completándola justo a tiempo.</p><p style="margin:0;font-size:12px;opacity:0.6">Para obtener mejores predicciones, deja el equipo enchufado durante la noche.</p>`,
                {
                    confirmText:t('activate'),
                    onConfirm:async()=>{
                        toggle?.classList.add('active');
                        toggle?.setAttribute('aria-checked','true');
                        setSetting('AdaptiveCharging','true');
                        const r=await invokeWithAuth('set_adaptive_charging',{enabled:true});
                        if(!r||!r.ok){restoreOff();return;}
                        toast('Carga adaptativa activada','🔋');
                    },
                    onCancel:()=>{restoreOff();}
                }
            );
        } else {
            setSetting('AdaptiveCharging','false');
            const r=await invokeWithAuth('set_adaptive_charging',{enabled:false});
            if(r&&r.ok)toast('Carga adaptativa desactivada');
            else if(r===null){
                // user cancelled auth — restore on
                toggle?.classList.add('active');
                toggle?.setAttribute('aria-checked','true');
                setSetting('AdaptiveCharging','true');
            }
        }
    });
    // ── Chart bar tooltip ────────────────────────────────────────────────
    // Single shared tip + delegated listeners bound ONCE. Per-bar listeners
    // died on every chart re-render (the bar under the cursor got replaced,
    // so mouseleave never fired and the tip stayed stuck), and each render
    // appended yet another tip div.
    {
        let tip=document.querySelector('.bat-bar-tip');
        if(!tip){
            tip=document.createElement('div');
            tip.className='bat-bar-tip';
            document.body.appendChild(tip);
            document.addEventListener('mouseover',e=>{
                const bar=e.target instanceof Element?e.target.closest('.bat-bar'):null;
                if(!bar||!document.contains(bar)){tip.style.display='none';return;}
                tip.textContent=bar.dataset.tip||'';
                tip.style.display='block';
                const r=bar.getBoundingClientRect();
                tip.style.left=Math.max(4,r.left+r.width/2-tip.offsetWidth/2)+'px';
                tip.style.top=(r.top-tip.offsetHeight-6)+'px';
            });
            // Cursor leaving the window also hides it
            document.documentElement.addEventListener('mouseleave',()=>{tip.style.display='none';});
        }
        tip.style.display='none';   // re-render: start hidden
    }

    // ── Stats popup (opened from the header 3-dot button) ───────────────────
    document.getElementById('bat-stats-btn')?.addEventListener('click',()=>{
        let rows=[];
        try{rows=JSON.parse(c.dataset.batStats||'[]');}catch(e){}
        const statsRows=rows.map(r=>
            `<div class="bat-stat-pop-row"><span class="bat-stat-pop-label">${r.label}</span><span class="bat-stat-pop-val"${r.color?` style="color:${r.color}"`:''}>${r.val}</span></div>`
        ).join('')||`<div class="bat-stat-pop-row"><span class="bat-stat-pop-label">${_tr('Sin datos disponibles')}</span></div>`;
        const optRow=(label,id,on)=>`<div class="bat-stat-pop-row"><span class="bat-stat-pop-label">${_tr(label)}</span>${renderToggle(id,on)}</div>`;
        const optsSection=`<div class="bat-pop-section-title">${_tr('Opciones')}</div><div class="bat-stat-pop">${
            optRow('Atenuar pantalla automáticamente','dim-low',dimlow)}${optRow('Mostrar porcentaje batería','show-pct',showpct)}</div>`;
        const statsSection=`<div class="bat-pop-section-title">${_tr('Estado')}</div><div class="bat-stat-pop">${statsRows}</div>`;
        const usbc=c.dataset.batUsbc||'';
        const pred=c.dataset.batPred||'';
        const body=`<div class="bat-pop">${optsSection}${statsSection}${usbc}${pred}</div>`;
        showDialog(_tr('Más opciones'), body,
            {confirmText:null,cancelText:_tr('Cerrar'),onCancel:()=>{}});
        _setupPopToggles();
    });
} // end _renderBateriaContent

// ════════════════════════════════════════════════════════════════════════
// ── Notificaciones ─────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════
export async function renderNotificaciones(c){
    const enabled=(await getSetting('UpdateNotifications','true'))!=='false';
    let dnd;
    try{dnd=JSON.parse(await tauriInvoke('get_dnd_status'));if(dnd.ok===false)throw new Error(dnd.error);}catch(e){dnd={error:String(e)};}
    c.innerHTML=renderHeader('Notificaciones')+renderCard([
        renderRowItem('Avisos de actualizaciones','',renderToggle('native-updates',enabled)),
        dnd.error?renderInfoItem('No molestar no disponible',esc(dnd.error)):renderRowItem('No molestar','Silenciar avisos del escritorio',renderToggle('native-dnd',dnd.dnd_active)),
        renderInfoItem('El historial de notificaciones está en la campana del panel.')]);
    setupToggle('native-updates',active=>setSetting('UpdateNotifications',String(active)));
    setupToggle('native-dnd',async enable=>{const result=JSON.parse(await tauriInvoke('toggle_dnd',{enable}));if(result.ok===false)throw new Error(result.error);});
}

// ════════════════════════════════════════════════════════════════════════
// ── Seguridad ──────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════
export async function renderSeguridad(c){
return desktop.security(c);
}

// ════════════════════════════════════════════════════════════════════════
// ── Temas (schedule uses actual selected themes, not hardcoded) ────────
// ════════════════════════════════════════════════════════════════════════
export async function renderTemas(c){
return desktop.appearance(c,()=>renderTintedIcons(c));
}
// Save schedule. When `from` (a schedule object) is given, use its times/themes;
// otherwise read them from the sub-page's inputs (with sane fallbacks).


// ── Dark/Light mode settings sub-page (automatic schedule) ──


// ── Tinted icons customization sub-page ──
// Dual tint: Light and Dark icon variants each keep their own hue + strength.
// Selecting a preview loads that variant into the sliders; editing recolours
// only that variant. (Visual mock — persisted locally.)
export async function renderTintedIcons(c){
    // s = slider value. LEFT (s low) = strong/saturated, RIGHT (s high) = white-ish.
    const _tintColor=(h,s)=>{
        const sat=Math.round(90-(s/100)*55);           // s0→90% (strong) … s100→35% (washed)
        const light=Math.round(42+(s/100)*38);         // s0→42% (deep) … s100→80% (light)
        return `hsl(${h},${sat}%,${light}%)`;
    };
    const termGlyph=`<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;
    // Per-variant defaults (fall back to the fixed icon colours' rough hue).
    const get=(k,d)=>parseInt(localStorage.getItem(k)||String(d),10);
    const variants={
        light:{hue:get('bookos_tint_light_hue',210),str:get('bookos_tint_light_strength',45),lhue:get('bookos_tint_light_logohue',210)},
        dark :{hue:get('bookos_tint_dark_hue',210), str:get('bookos_tint_dark_strength',70), lhue:get('bookos_tint_dark_logohue',210)},
    };
    let selected=localStorage.getItem('bookos_tint_mode')||'light';

    const swatch=(m,label,tileBg)=>{
        const v=variants[m];
        return `<div class="ti-preview-swatch ${m===selected?'active':''}" data-tmode="${m}">
            <div class="ti-preview-tile" style="background:${tileBg}"><div class="ti-preview-glyph" id="ti-pg-${m}" style="background:${_tintColor(v.hue,v.str)}">${termGlyph}</div></div>
            <span class="ti-preview-label">${_tr(label)}</span>
            <div class="mode-radio ${m===selected?'on':''}"></div>
        </div>`;
    };

    c.innerHTML=renderHeader('Iconos tintados')+
        `<div class="theme-block ti-page-block">
            <div class="ti-preview-row">
                ${swatch('light','Claro','#ffffff')}
                ${swatch('dark','Oscuro','#1c1c2e')}
            </div>
            <div class="ti-controls">
                <div class="ti-slider-row">
                    <span class="ti-slider-label">${_tr('Color')}</span>
                    <div class="ti-slider ti-hue"><input type="range" id="ti-hue" min="0" max="360"></div>
                </div>
                <div class="ti-slider-row">
                    <span class="ti-slider-label">${_tr('Intensidad')}</span>
                    <div class="ti-slider ti-strength"><input type="range" id="ti-strength" min="0" max="100"></div>
                </div>
            </div>
        </div>
        <div class="theme-block ti-page-block">
            ${renderRowItem('Pintar la base','El cuadrado de fondo toma el color del tinte',renderToggle('tintbase',localStorage.getItem('bookos_tint_base')!=='0'))}
            ${renderRowItem('Pintar el logo','Recolorea el logo de cada app con su propio color',renderToggle('tintlogo',localStorage.getItem('bookos_tint_logo')==='1'))}
            <div id="ti-logo-hue-row" class="ti-controls" style="display:${localStorage.getItem('bookos_tint_logo')==='1'?'block':'none'}">
                <div class="ti-slider-row">
                    <span class="ti-slider-label">${_tr('Color del logo')}</span>
                    <div class="ti-slider ti-hue"><input type="range" id="ti-logo-hue" min="0" max="360"></div>
                </div>
            </div>
        </div>`;

    const hueEl=document.getElementById('ti-hue');
    const strEl=document.getElementById('ti-strength');

    // Load the selected variant's values into the sliders + recolour tracks.
    const lhueEl=document.getElementById('ti-logo-hue');
    const loadSliders=()=>{
        const v=variants[selected];
        hueEl.value=v.hue; strEl.value=v.str; lhueEl.value=v.lhue;
        hueEl.style.setProperty('--thumb',_tintColor(v.hue,0));
        strEl.style.setProperty('--c0',_tintColor(v.hue,0));    // left = strong
        strEl.style.setProperty('--c1',_tintColor(v.hue,100));  // right = white-ish
        strEl.style.setProperty('--thumb',_tintColor(v.hue,v.str));
        lhueEl.style.setProperty('--thumb',_tintColor(v.lhue,0));
    };
    // Recolour only the selected variant's glyph as the sliders move.
    const onSlide=()=>{
        const h=parseInt(hueEl.value,10), s=parseInt(strEl.value,10);
        variants[selected]={hue:h,str:s};
        const g=document.getElementById('ti-pg-'+selected);
        if(g)g.style.background=_tintColor(h,s);
        strEl.style.setProperty('--c0',_tintColor(h,0));    // left = strong
        strEl.style.setProperty('--c1',_tintColor(h,100));  // right = white-ish
        strEl.style.setProperty('--thumb',_tintColor(h,s));
        hueEl.style.setProperty('--thumb',_tintColor(h,0));
        localStorage.setItem(`bookos_tint_${selected}_hue`,String(h));
        localStorage.setItem(`bookos_tint_${selected}_strength`,String(s));
    };
    hueEl.addEventListener('input',onSlide);
    strEl.addEventListener('input',onSlide);
    lhueEl.addEventListener('input',()=>{
        const lh=parseInt(lhueEl.value,10);
        variants[selected].lhue=lh;
        lhueEl.style.setProperty('--thumb',_tintColor(lh,0));
        localStorage.setItem(`bookos_tint_${selected}_logohue`,String(lh));
    });
    // On release (not every pixel — regenerating the pack is heavy), apply the
    // tinted icon theme with the new hue/strength.
    const applyTint=async()=>{
        const h=parseInt(hueEl.value,10), s=parseInt(strEl.value,10);
        // `selected` is the variant being edited ('light' or 'dark') → that's the base.
        const isDark=selected==='dark';
        toast(_tr('Aplicando iconos…'),'🔄');
        try{
            const tintBase=localStorage.getItem('bookos_tint_base')!=='0';
            const tintLogo=localStorage.getItem('bookos_tint_logo')==='1';
            const logoHue=parseInt(lhueEl.value,10);
            const r=JSON.parse(await tauriInvoke('set_icon_style',{mode:'tinted',hue:h,strength:s,dark:isDark,tintBase,tintLogo,logoHue}));
            toast(r.ok?_tr('Iconos aplicados'):(_tr('Error')+': '+(r.error||'')), r.ok?'✅':'❌');
        }catch(e){toast(_tr('No se pudieron aplicar los iconos'),'❌');}
    };
    hueEl.addEventListener('change',applyTint);
    strEl.addEventListener('change',applyTint);
    lhueEl.addEventListener('change',applyTint);
    setupToggle('tintbase',a=>{localStorage.setItem('bookos_tint_base',a?'1':'0');applyTint();});
    setupToggle('tintlogo',a=>{
        localStorage.setItem('bookos_tint_logo',a?'1':'0');
        document.getElementById('ti-logo-hue-row').style.display=a?'block':'none';
        applyTint();
    });
    document.querySelectorAll('.ti-preview-swatch').forEach(sw=>sw.addEventListener('click',()=>{
        document.querySelectorAll('.ti-preview-swatch').forEach(x=>{x.classList.remove('active');x.querySelector('.mode-radio').classList.remove('on');});
        sw.classList.add('active');sw.querySelector('.mode-radio').classList.add('on');
        selected=sw.dataset.tmode;
        localStorage.setItem('bookos_tint_mode',selected);
        loadSliders();
    }));
    loadSliders();
}

// Fingerprint draw-in animation — strokes materialize center→outward via stroke-dashoffset
 // outermost→innermost (index matches DOM order)




export async function renderBloqueo(c){
return desktop.lockscreen(c);
}

// ════════════════════════════════════════════════════════════════════════
// ── Actualizaciones (Apple + Windows Hybrid — OS card + progress bar) ──
// ════════════════════════════════════════════════════════════════════════
// ── Recovery / snapshots sub-page (below Updates) ───────────────────────
export async function renderSnapshots(c){
    c.innerHTML=renderHeader('Recuperación')+renderSkeleton(2);
    const [support,snapRes]=await Promise.all([
        tauriInvoke('get_snapshot_support').then(JSON.parse).catch(()=>({supported:false,fs:''})),
        tauriInvoke('list_bookos_snapshots').then(JSON.parse).catch(()=>({ok:false,error:'error',snapshots:[]})),
    ]);
    const snaps=snapRes.snapshots||[];
    const needsAccess=snapRes.error==='permission';
    const policy=await getSetting('SnapshotPolicy','osupdate');
    const opt=(val,label,sub)=>`<div class="detail-item detail-item-row" data-snappol="${val}" style="cursor:pointer">
        <div class="detail-texts"><span class="dt">${_tr(label)}</span><span class="ds">${_tr(sub)}</span></div>
        ${policy===val?_ckmark():''}
    </div>`;

    let h=renderHeader('Recuperación');
    h+=renderSection('Tomar captura al actualizar');
    h+=renderCard([
        opt('packages','Al actualizar paquetes','Antes de cada actualización de paquetes'),
        opt('osupdate','Al actualizar el sistema','Solo antes de subir de versión BookOS'),
        opt('never','Nunca','No crear capturas automáticamente'),
    ]);
    if(!support.supported){
        // En Btrfs lo que falta es snapper; decir «requiere Btrfs» a quien ya lo tiene confundía.
        const why=support.fs==='btrfs'
            ?_tr('Snapper no está instalado. Instálalo y crea la configuración «root» para usar las capturas.')
            :_tr('Las instantáneas requieren un sistema de archivos Btrfs.')+(support.fs?` (${esc(support.fs)})`:'');
        h+=`<div class="detail-card" style="padding:16px 20px;margin-top:4px"><span class="ds">${why}</span></div>`;
    }
    // Sistema soportado pero snapper no deja leer al usuario todavía
    if(support.supported && needsAccess){
        h+=`<div class="detail-card" style="padding:16px 20px;margin-top:4px">
            <span class="dt" style="display:block;margin-bottom:4px">${_tr('Acceso a instantáneas no habilitado')}</span>
            <span class="ds" style="display:block;margin-bottom:12px">${_tr('Btrfs y Snapper están listos, pero falta permitir que tu usuario lea los puntos de restauración.')}</span>
            <button class="btn btn-primary btn-sm" id="snap-enable">${_tr('Habilitar acceso')}</button>
        </div>`;
    }

    // Cabecera de puntos de restauración con botón de crear (si hay acceso)
    if(support.supported && !needsAccess){
        h+=`<div class="section-header-row"><p class="section-header" style="margin:0">${_tr('Puntos de restauración')}</p>
            <button class="refresh-btn" id="snap-create">+ ${_tr('Crear ahora')}</button></div>`;
    }else{
        h+=renderSection('Puntos de restauración');
    }
    if(needsAccess){
        h+=renderCard([`<div class="detail-item"><span class="ds">${_tr('Habilita el acceso para ver tus puntos de restauración.')}</span></div>`]);
    }else if(!snaps.length){
        h+=renderCard([`<div class="detail-item"><span class="ds">${_tr('No hay capturas todavía.')}</span></div>`]);
    }else{
        h+=renderCard(snaps.map(s=>`<div class="detail-item detail-item-row">
            <div class="detail-texts"><span class="dt">#${esc(s.number)} · ${esc(s.description||_tr('Captura'))}</span><span class="ds">${esc(s.date)}</span></div>
            <button class="upd-recheck" data-rollback="${esc(s.number)}">${_tr('Revertir')}</button>
        </div>`));
    }
    c.innerHTML=h;

    document.getElementById('snap-enable')?.addEventListener('click',async()=>{
        const pwd=await promptUpdatePassword('BookOS'); if(!pwd)return;
        const r=JSON.parse(await tauriInvoke('enable_snapshot_access',{password:pwd}).catch(()=>({ok:false})));
        if(r.ok){toast(_tr('Acceso habilitado'),'✅');renderSnapshots(c);}
        else toast(_tr('Error')+': '+(r.error||''),'❌');
    });
    document.getElementById('snap-create')?.addEventListener('click',async()=>{
        toast(_tr('Creando punto de restauración…'),'⏳');
        const r=JSON.parse(await tauriInvoke('create_snapshot',{description:'Punto manual desde Ajustes'}).catch(()=>({ok:false,error:'error'})));
        if(r.ok){toast(_tr('Punto de restauración creado'),'✅');renderSnapshots(c);}
        else if(r.error==='permission'){toast(_tr('Habilita el acceso primero'),'ℹ');renderSnapshots(c);}
        else toast(_tr('Error al crear el punto'),'❌');
    });

    c.querySelectorAll('[data-snappol]').forEach(el=>el.addEventListener('click',()=>{
        setSetting('SnapshotPolicy',el.dataset.snappol);
        renderSnapshots(c);
        toast(_tr('Política de capturas actualizada'),'✓');
    }));
    c.querySelectorAll('[data-rollback]').forEach(btn=>btn.addEventListener('click',()=>{
        const num=btn.dataset.rollback;
        showDialog(_tr('Revertir el sistema'),_tr('Se restaurará la captura')+' #'+num+'. '+_tr('Necesitarás reiniciar para aplicarla. ¿Continuar?'),{confirmText:_tr('Revertir'),confirmClass:'danger',onConfirm:async()=>{
            const pwd=await promptUpdatePassword('BookOS'); if(!pwd)return;
            const r=JSON.parse(await tauriInvoke('rollback_bookos_snapshot',{password:pwd,number:num}).catch(()=>({ok:false})));
            toast(r.ok?_tr('Revertido — reinicia para aplicar'):(_tr('Error')+': '+(r.error||'')),r.ok?'✅':'❌');
        }});
    }));
}

export async function renderActualizacion(c){
    c.innerHTML=renderHeader(t('hdr_updates'))+
        `<div class="upd-searching">
            <div class="upd-spinner-wrap"><div class="upd-spinner"></div></div>
            <span class="upd-searching-text">Buscando actualizaciones...</span>
        </div>`;
    await _doCheckUpdates(c);
}

// Sub-page: list of packages grouped by source (Sistema / Flatpak / AUR)
async function renderUpdatesPackages(c, sys, flat, aur, sysInfo){
    window.pushSubNav(()=>renderActualizacion(c));
    let activeTab='sys';
    // Hide AUR tab on non-pacman distros + Flatpak tab if not installed.
    let _isArch=true, _hasFlat=true;
    try{_isArch=(JSON.parse(localStorage.getItem('__pkg_mgr__')||'{}').manager==='pacman');}catch{}
    try{_hasFlat=(JSON.parse(localStorage.getItem('__has_flatpak__')||'{}').available!==false);}catch{}
    function renderTab(){
        const tabs=[
            {id:'sys',label:_tr('Sistema'),count:sys.count,pkgs:sys.packages,hasVer:true},
        ];
        if(_hasFlat) tabs.push({id:'flat',label:'Flatpak',count:flat.count,pkgs:flat.packages,hasVer:false});
        if(_isArch)  tabs.push({id:'aur',label:'AUR',count:aur.count,pkgs:aur.packages,hasVer:true});
        const active=tabs.find(t=>t.id===activeTab)||tabs[0];
        const pkgRows=active.pkgs.map((p,i)=>{
            const verText=active.hasVer?(p.old&&p.new?`${esc(p.old)} → ${esc(p.new)}`:(esc(p.old||p.version||''))):(esc(p.version||''));
            return `<div class="upd-pkg-row" data-pkg-idx="${i}" data-pkg-src="${active.id}">
                <div class="upd-pkg-row-info">
                    <span class="upd-pkg-row-name">${esc(p.name)}</span>
                    ${verText?`<span class="upd-pkg-row-ver">${verText}</span>`:''}
                </div>
                <svg class="upd-pkg-row-chev" viewBox="0 0 8 14" width="8" height="14" fill="none"><path d="M1 1l6 6-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>`;
        }).join('');
        return `
        ${renderHeader(t('sec_update_packages'))}
        <div class="upd-tabs-wrap">
            ${tabs.map(t=>`<button class="upd-tab${t.id===activeTab?' active':''}" data-tab="${t.id}">${t.label}${t.count?` <span class="pkg-count-badge">${t.count}</span>`:''}</button>`).join('')}
        </div>
        <div class="upd-pkg-list detail-card">
            ${active.pkgs.length
                ? pkgRows
                : `<div class="upd-pkg-empty">${_tr('Sin paquetes pendientes')}</div>`}
        </div>
        <div class="upd-install-actions">
            <button class="upd-btn-now" id="upd-install-all" ${active.count===0?'disabled':''}>${_tr(active.id==='sys'?'Actualizar sistema ahora':active.id==='flat'?'Actualizar Flatpak ahora':'Actualizar AUR ahora')}</button>
        </div>`;
    }
    function mount(){
        c.innerHTML=renderTab();
        c.querySelectorAll('.upd-tab').forEach(btn=>btn.addEventListener('click',()=>{
            activeTab=btn.dataset.tab; c.innerHTML=renderTab(); mount();
        }));
        c.querySelectorAll('.upd-pkg-row').forEach(row=>row.addEventListener('click',()=>{
            const src=row.dataset.pkgSrc;
            const idx=parseInt(row.dataset.pkgIdx,10);
            const srcMap={sys:sys.packages,flat:flat.packages,aur:aur.packages};
            renderUpdateDetail(c,srcMap[src][idx],src,sysInfo,()=>{renderUpdatesPackages(c,sys,flat,aur,sysInfo);});
        }));
        // The button updates ONLY the currently active tab's source — system
        // updates system, Flatpak updates Flatpak, AUR updates AUR.
        document.getElementById('upd-install-all')?.addEventListener('click',async()=>{
            if(activeTab==='flat'){
                if(flat.count===0)return;
                toast(_tr('Actualizando Flatpak...'),'⬇');
                tauriInvoke('run_flatpak_update').catch(()=>{}).then(()=>toast(_tr('Flatpak actualizado'),'✅'));
                renderActualizacion(c);
                return;
            }
            if(activeTab==='aur'){
                if(aur.count===0)return;
                toast(_tr('Actualizando AUR...'),'⬇');
                tauriInvoke('run_aur_update').catch(()=>{}).then(()=>toast(_tr('AUR actualizado'),'✅'));
                renderActualizacion(c);
                return;
            }
            // System (needs auth)
            if(sys.count===0)return;
            const pwd=await promptUpdatePassword(sysInfo.distro);
            if(!pwd)return;
            try{
                const started=JSON.parse(await tauriInvoke('run_pacman_update_silent',{password:pwd}));
                if(!started.ok&&!started.started)throw new Error(started.error||_tr('Contraseña incorrecta'));
                toast(_tr('Descargando e instalando actualizaciones...'),'⬇');
                renderActualizacion(c);
            }catch(e){toast('Error: '+(e.message||'Fallo'),'✕');}
        });
    }
    mount();
}

// Detail view for a single package
async function renderUpdateDetail(c, pkg, src, sysInfo, onBack){
    window.pushSubNav(onBack);
    const srcLabel={sys:'Sistema',flat:'Flatpak',aur:'AUR'}[src]||src;
    const verArrow=pkg.old&&pkg.new?`${esc(pkg.old)} → ${esc(pkg.new)}`:(esc(pkg.version||pkg.new||''));
    c.innerHTML=renderHeader(esc(pkg.name))+
    `<div class="upd-detail-card">
        <div class="upd-detail-icon-wrap">
            <svg viewBox="0 0 40 40" width="40" height="40" fill="none"><rect width="40" height="40" rx="10" fill="var(--blue)" opacity=".15"/><path d="M20 10v14M20 24l-5-5M20 24l5-5" stroke="var(--blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 30h16" stroke="var(--blue)" stroke-width="2" stroke-linecap="round"/></svg>
        </div>
        <div class="upd-detail-meta">
            <span class="upd-detail-name">${esc(pkg.name)}</span>
            <span class="upd-detail-ver">${verArrow}</span>
        </div>
    </div>
    <div class="upd-detail-actions">
        <button class="upd-night-btn" id="upd-night">${_tr('Actualizar por la noche')}</button>
        <button class="upd-btn-now" id="upd-now">${_tr('Actualizar ahora')}</button>
    </div>
    ${renderSection(t('sec_info'))}
    ${renderCard([
        renderRowItem('Fuente',srcLabel,''),
        pkg.old?renderRowItem('Instalado',esc(pkg.old),''):'',
        pkg.new?renderRowItem('Disponible',esc(pkg.new),''):'',
        renderRowItem('Sistema',esc(sysInfo.distro||'BookOS'),''),
        renderRowItem('Kernel',esc(sysInfo.kernel||''),''),
    ].filter(Boolean))}`;

    document.getElementById('upd-night')?.addEventListener('click',()=>{
        setSetting('NightUpdate_'+esc(pkg.name),'true');
        toast(_tr('Programado para esta noche'),'🌙');
    });
    document.getElementById('upd-now')?.addEventListener('click',async()=>{
        try{
            if(src==='flat'){
                toast(_tr('Actualizando ')+pkg.name+'...','⬇');
                tauriInvoke('run_flatpak_update').catch(()=>{}).then(()=>toast(_tr('Flatpak actualizado'),'✅'));
                onBack(); return;
            }
            if(src==='aur'){
                toast(_tr('Actualizando ')+pkg.name+' (AUR)...','⬇');
                tauriInvoke('run_aur_update').catch(()=>{}).then(()=>toast(_tr('AUR actualizado'),'✅'));
                onBack(); return;
            }
            const pwd=await promptUpdatePassword(sysInfo.distro);
            if(!pwd)return;
            const started=JSON.parse(await tauriInvoke('run_pacman_update_silent',{password:pwd}));
            if(!started.ok&&!started.started)throw new Error(started.error||_tr('Contraseña incorrecta'));
            toast(_tr('Actualizando ')+pkg.name+'...','⬇');
            onBack();
        }catch(e){toast('Error: '+(e.message||'Fallo'),'✕');}
    });
}

// macOS-style password prompt for updates
/**
 * Generalized authentication prompt.
 *
 * Resolves with:
 *   - {ok:true, method:'password', password:'...'}   — user entered their password
 *   - {ok:true, method:'fingerprint'}                  — fprintd matched a finger
 *   - null                                             — user cancelled
 *
 * @param {Object} opts
 * @param {string} opts.title          Big heading. Defaults to "Se requiere autenticación"
 * @param {string} opts.description    Body text shown above the field
 * @param {string} [opts.confirmLabel] Defaults to "OK"
 * @param {boolean} [opts.allowFingerprint=true]  If false, hides the fingerprint hint
 * @param {boolean} [opts.verifyPassword=true]    Pre-validates the password via verify_password
 *                                                  and re-prompts on failure inside the dialog
 */
async function promptAuth(opts={}){
    const {
        title='Se requiere autenticación',
        description='Confirma tu identidad para autorizar esta acción.',
        confirmLabel='OK',
        allowFingerprint=true,
        verifyPassword=true,
    }=opts;

    // Probe fingerprint availability once
    let fpAvail=false;
    if(allowFingerprint){
        try{
            const fp=JSON.parse(await tauriInvoke('check_fingerprint'));
            fpAvail=fp.available&&fp.enrolled;
        }catch(e){}
    }

    return new Promise(resolve=>{
        if(window._sudoModal)window._sudoModal.remove();
        const d=document.createElement('div');
        d.className='sudo-modal-overlay';
        const fpHint=fpAvail
            ? `<div class="upd-auth-fp" id="upd-auth-fp">
                <div class="upd-auth-fp-icon" id="upd-auth-fp-icon">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M2 12C2 6.5 6.5 2 12 2s10 4.5 10 10"/>
                        <path d="M5 19.5C3.7 17.7 3 15.4 3 13"/>
                        <path d="M21 13c0 4-1 6-2 8"/>
                        <path d="M8 19c-1-1-2-3-2-6 0-3.3 2.7-6 6-6s6 2.7 6 6c0 4-1 6-2 8"/>
                        <path d="M11 21c-1-2-1-4-1-7 0-1.1.9-2 2-2s2 .9 2 2c0 3 0 5-1 7"/>
                    </svg>
                </div>
                <span class="upd-auth-fp-text" id="upd-auth-fp-text">O toca el sensor de huella</span>
              </div>`
            : '';
        d.innerHTML=`
        <div class="upd-auth-modal">
            <div class="upd-auth-lock">
                <svg viewBox="0 0 44 44" width="44" height="44" fill="none">
                    <rect x="10" y="20" width="24" height="18" rx="4" fill="currentColor" opacity="0.15"/>
                    <rect x="10" y="20" width="24" height="18" rx="4" stroke="currentColor" stroke-width="2"/>
                    <path d="M16 20v-5a6 6 0 0 1 12 0v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <circle cx="22" cy="29" r="3" fill="currentColor"/>
                    <line x1="22" y1="32" x2="22" y2="35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
            </div>
            <div class="upd-auth-content">
                <h3 class="upd-auth-title">${esc(title)}</h3>
                <p class="upd-auth-desc">${description}</p>
                <div class="upd-auth-field">
                    <label class="upd-auth-label">Contraseña</label>
                    <input type="password" class="upd-auth-input" id="upd-pwd" autocomplete="current-password" placeholder="••••••••">
                </div>
                ${fpHint}
                <p class="upd-auth-error" id="upd-auth-err" style="display:none">Contraseña incorrecta. Inténtalo de nuevo.</p>
            </div>
            <div class="upd-auth-btns">
                <button class="upd-auth-btn cancel" id="upd-cancel">Cancelar</button>
                <button class="upd-auth-btn ok" id="upd-ok">${esc(confirmLabel)}</button>
            </div>
        </div>`;
        document.body.appendChild(d);
        window._sudoModal=d;

        let fpAbort=null;        // controller for in-flight verify_fingerprint
        let resolved=false;
        const errBox=()=>document.getElementById('upd-auth-err');
        const finish=(v)=>{
            if(resolved)return;
            resolved=true;
            if(fpAbort)fpAbort.abort();
            d.remove();window._sudoModal=null;
            resolve(v);
        };
        const showErr=(msg)=>{
            const e=errBox();if(!e)return;
            e.textContent=msg;e.style.display='';
            const inp=document.getElementById('upd-pwd');
            if(inp){inp.value='';inp.focus();}
        };

        document.getElementById('upd-cancel').onclick=()=>finish(null);
        const okBtn=document.getElementById('upd-ok');
        const submit=async()=>{
            const v=document.getElementById('upd-pwd').value;
            if(!v)return;
            if(!verifyPassword){finish({ok:true,method:'password',password:v});return;}
            okBtn.disabled=true;okBtn.textContent='Verificando…';
            try{
                const r=JSON.parse(await tauriInvoke('verify_password',{password:v}));
                if(r.ok){finish({ok:true,method:'password',password:v});}
                else{showErr('Contraseña incorrecta. Inténtalo de nuevo.');okBtn.disabled=false;okBtn.textContent=confirmLabel;}
            }catch(e){showErr('Error al verificar.');okBtn.disabled=false;okBtn.textContent=confirmLabel;}
        };
        okBtn.onclick=submit;
        document.getElementById('upd-pwd').addEventListener('keydown',e=>{if(e.key==='Enter')submit();});
        requestAnimationFrame(()=>document.getElementById('upd-pwd')?.focus());

        // Listen for fingerprint in parallel
        if(fpAvail){
            const fpIcon=document.getElementById('upd-auth-fp-icon');
            const fpText=document.getElementById('upd-auth-fp-text');
            const setFpState=(state,msg)=>{
                if(!fpIcon)return;
                fpIcon.classList.remove('scanning','success','error');
                if(state)fpIcon.classList.add(state);
                if(fpText&&msg)fpText.textContent=msg;
            };
            const startListen=async()=>{
                if(resolved)return;
                setFpState('scanning','Toca el sensor…');
                try{
                    const r=JSON.parse(await tauriInvoke('verify_fingerprint'));
                    if(resolved)return;
                    if(r.ok){
                        setFpState('success','Huella reconocida');
                        setTimeout(()=>finish({ok:true,method:'fingerprint'}),400);
                    } else {
                        setFpState('error','Huella no reconocida — reintentando');
                        setTimeout(startListen,1200);
                    }
                }catch(e){
                    if(resolved)return;
                    setFpState('error','Sensor no disponible');
                }
            };
            startListen();
        }
    });
}

// _common.js enruta sus propios diálogos (showRootAuth, invokeWithAuth) aquí:
// el módulo no puede importar de pages.js sin ciclo, así que el puente es global.
if(typeof window!=='undefined')window.promptAuth=promptAuth;

// Backwards-compat shim: existing call-sites that just want a password string.
async function promptUpdatePassword(distro){
    const r=await promptAuth({
        title:_tr('Se requiere contraseña'),
        description:`<strong>${esc(distro||'BookOS')}</strong> ${_tr('quiere realizar cambios en el sistema. Introduce tu contraseña para autorizar la acción.')}`,
        verifyPassword:false,  // legacy callers verify themselves via sudo -S
    });
    return r&&r.method==='password'?r.password:null;
}

// ── Channel picker dialog (3-dot menu on Updates page) ──────────────────
function _openChannelDialog(c, currentChannel){
    const channels=[
        {id:'stable', label:_tr('Estable'),   desc:_tr('Versiones probadas y recomendadas'), badge:'STABLE', banner:'./assets/channel-stable.png'},
        {id:'beta',   label:_tr('Beta'),      desc:_tr('Nuevas funciones en pruebas'),       badge:'BETA',   banner:'./assets/channel-beta.png'},
        {id:'dev',    label:_tr('Developer'), desc:_tr('Actualizaciones más recientes, inestables'), badge:'DEV', banner:'./assets/channel-dev.png'},
    ];
    let selected = currentChannel;
    const overlay=document.createElement('div');
    overlay.className='sudo-modal-overlay';
    overlay.innerHTML=`
        <div class="channel-dialog">
            <h3>${_tr('Canal de actualizaciones')}</h3>
            <p class="ch-sub">${_tr('Elige qué tan recientes quieres las actualizaciones de BookOS.')}</p>
            <div class="channel-list">
                ${channels.map(ch=>`
                    <div class="channel-opt ${ch.id===selected?'active':''}" data-ch="${ch.id}">
                        <div class="channel-opt-icon ${ch.id}" style="background-image:url('${ch.banner}')"></div>
                        <div class="channel-opt-body">
                            <div class="channel-opt-name">
                                ${ch.label}
                                ${ch.id===currentChannel?`<span class="ch-current-pill">${_tr('Actual')}</span>`:''}
                            </div>
                            <div class="channel-opt-desc">${ch.desc}</div>
                        </div>
                        <div class="channel-opt-radio"></div>
                    </div>
                `).join('')}
            </div>
            <div class="channel-dialog-actions">
                <button class="btn-close" id="ch-close">${_tr('Cancelar')}</button>
                <button class="btn btn-primary" id="ch-save">${_tr('Aplicar')}</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const onKey=e=>{ if(e.key==='Escape'){ e.preventDefault(); close(); } };
    const close=()=>{ document.removeEventListener('keydown',onKey); overlay.remove(); };
    document.addEventListener('keydown',onKey);
    overlay.addEventListener('click',e=>{ if(e.target===overlay) close(); });
    overlay.querySelectorAll('.channel-opt').forEach(opt=>opt.addEventListener('click',()=>{
        overlay.querySelectorAll('.channel-opt').forEach(o=>o.classList.remove('active'));
        opt.classList.add('active');
        selected=opt.dataset.ch;
    }));
    overlay.querySelector('#ch-close').addEventListener('click',close);
    overlay.querySelector('#ch-save').addEventListener('click',async()=>{
        close();
        if(selected===currentChannel) return;
        let saved=false;
        try{
            const r=JSON.parse(await tauriInvoke('set_update_channel',{channel:selected}));
            saved=r&&r.ok!==false;
        }catch(e){}
        if(!saved){ toast(_tr('No se pudo cambiar el canal'),'❌'); return; }
        // Refresh manifest for the new channel; best-effort (may fail offline).
        try{await tauriInvoke('refresh_bookos_release',{lang:(localStorage.getItem('bookos_lang')||'es')});}catch(e){}
        toast(_tr('Canal cambiado a')+' '+selected.charAt(0).toUpperCase()+selected.slice(1),'🔄');
        renderActualizacion(c);
    });
}

async function _doCheckUpdates(c){
    // Fast path: if update already running, skip checkupdates (would block on pacman lock)
    // and jump straight to progress UI
    try{
        const p=JSON.parse(await tauriInvoke('get_update_progress'));
        if(p.running){_renderUpdateRunning(c,p);return;}
    }catch(e){}

    let sys={count:0,packages:[]},flat={count:0,packages:[]},aur={count:0,packages:[]},sysInfo={distro:'BookOS',kernel:''};
    let autoupd=false;
    let release={available:false,name:'BookOS',version:'',size:'',channel:'stable',changelog:'',description:'',installed:''};
    const force=window.__forceUpdCheck===true;
    window.__forceUpdCheck=false;
    // Refresh BookOS release manifest from upstream when forced or on entry if cache empty.
    // Best-effort; doesn't block UI.
    try{
        if(force) await tauriInvoke('refresh_bookos_release',{lang:(localStorage.getItem('bookos_lang')||'es')});
    }catch(e){}
    let repoSt={supported:false,enabled:false};
    try{[sys,flat,aur,sysInfo,autoupd,release,repoSt]=await Promise.all([
        tauriInvoke('check_system_updates',{force}).then(JSON.parse).catch(()=>({count:0,packages:[]})),
        tauriInvoke('check_flatpak_updates',{force}).then(JSON.parse).catch(()=>({count:0,packages:[]})),
        tauriInvoke('check_aur_updates',{force}).then(JSON.parse).catch(()=>({count:0,packages:[]})),
        tauriInvoke('get_system_info').then(JSON.parse).catch(()=>({distro:'BookOS',kernel:''})),
        getSetting('AutoUpdate','false').then(v=>v==='true'),
        tauriInvoke('get_bookos_release',{lang:(localStorage.getItem('bookos_lang')||'es')}).then(JSON.parse).catch(()=>({available:false,channel:'stable'})),
        tauriInvoke('get_bookos_repo_status').then(JSON.parse).catch(()=>({supported:false,enabled:false}))
    ]);}catch(e){}
    // BookOS dnf repo row (custom system packages: libfprint modificado, apps)
    const _repoRow=repoSt.supported
        ?renderRowItem('Repositorio BookOS','Paquetes del sistema personalizados (libfprint, apps BookOS)',renderToggle('bookos-repo',repoSt.enabled))
        :'';
    const _setupRepoToggle=()=>setupToggle('bookos-repo',async a=>{
        try{
            const r=JSON.parse(await tauriInvoke('set_bookos_repo',{enable:a}));
            if(!r.ok)throw new Error(r.error||'Fallo');
            toast(a?'Repositorio BookOS activado':'Repositorio BookOS desactivado','✓');
        }catch(e){
            // revert optimistic flip
            const tg=document.querySelector('[data-toggle="bookos-repo"]');
            tg?.classList.toggle('active',!a);
            toast('Error: '+(e.message||'Fallo'),'✕');
        }
    });
    const total=sys.count+flat.count+aur.count;

    // The active channel = the *persisted* setting (set_update_channel), which is
    // authoritative even when the manifest in `release` lags behind (e.g. offline).
    // Fall back to the manifest's channel only if the setting can't be read.
    const _activeChannel=(await tauriInvoke('get_update_channel')
        .then(JSON.parse).catch(()=>({channel:release.channel||'stable'}))).channel || release.channel || 'stable';
    release.channel=_activeChannel;

    // Pick release banner background per channel + theme
    const _isDark=document.documentElement.classList.contains('dark-mode');
    const _bannerBg = _activeChannel==='dev'  ? './assets/update-dev.svg'
                    : _activeChannel==='beta' ? './assets/update-beta.svg'
                    : (_isDark ? './assets/update-stable-dark.svg' : './assets/update-stable-light.svg');

    // ── Helper: BookOS release hero card (big banner with version + desc) ──
    const _releaseDesc = esc(release.description||t('upd_includes'))
        .replace(/\\n\\n/g,'</p><p class="release-desc">')
        .replace(/\\n/g,'<br>');
    // Botón fijo al changelog online de BookOS (el backend valida el dominio).
    const _changelogUrl='https://bookos.es/changelog';
    const _changelogP = `<button class="release-changelog-link" id="rel-changelog">${_tr('Ver el registro de cambios')} ↗</button>`;
    const _releaseCard = release.available ? `
        <div class="bookos-release-card">
            <div class="release-hero" style="background-image:url('${_bannerBg}')">
                <div class="release-hero-row">
                    <img src="./assets/bookos-logo.png" class="release-hero-logo" alt="BookOS">
                    <div class="release-hero-meta">
                        <span class="release-hero-name">${esc(release.name)}${release.channel!=='stable'?` <span class="release-channel-chip release-channel-${esc(release.channel)}">${(release.channel||'').toUpperCase()}</span>`:''}</span>
                        <span class="release-hero-sub">${esc(release.version)}${release.size?' &nbsp;·&nbsp; '+esc(release.size):''}</span>
                    </div>
                    <div class="release-hero-spacer"></div>
                    <div class="release-hero-actions">
                        <button class="release-btn release-btn-ghost" id="rel-night">${t('upd_night')||'Actualizar por la noche'}</button>
                        <button class="release-btn release-btn-primary" id="rel-now">${t('upd_now')||'Actualizar ahora'}</button>
                    </div>
                </div>
            </div>
            <div class="release-body">
                <p class="release-desc">${_releaseDesc}</p>
                ${_changelogP}
                <div class="release-divider"></div>
                <p class="release-install-note">${_tr('Una vez completada la descarga, la instalación tardará aproximadamente 10 minutos.')}</p>
            </div>
        </div>
    ` : '';

    // ── Up to date — but maybe BookOS release pending ──
    if(total===0 && !release.available){
        const _menuBtnOk = `<button class="icon-btn" id="upd-menu-btn" title="${_tr('Canal de actualizaciones')}">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
        </button>`;
        c.innerHTML=renderHeader(t('hdr_updates'),_menuBtnOk)+
        `<div class="upd-ok">
            <div class="upd-ok-icon">
                <svg viewBox="0 0 56 56" width="56" height="56" fill="none">
                    <circle cx="28" cy="28" r="27" stroke="var(--green)" stroke-width="2"/>
                    <path d="M17 28l8 8 14-16" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>
            <span class="upd-ok-title">${t('upd_up_to_date')}</span>
            <span class="upd-ok-sub">${t('upd_last_check')}</span>
            <button class="upd-recheck" id="re-check">${t('upd_recheck')}</button>
        </div>`+
        renderSection(t('sec_software_installed'))+
        renderCard([renderRowItem(t('label_system')||'Sistema',esc(sysInfo.distro||'BookOS'),''),renderRowItem(t('label_kernel')||'Kernel',esc(sysInfo.kernel||''),'')])+
        renderSection(t('sec_options'))+
        renderCard([renderRowItem(t('upd_auto'),t('upd_auto_sub'),renderToggle('auto-upd',autoupd)),_repoRow].filter(Boolean));
        _setupRepoToggle();
        document.getElementById('re-check')?.addEventListener('click',()=>{window.__forceUpdCheck=true;renderActualizacion(c);});
        document.getElementById('upd-menu-btn')?.addEventListener('click',async()=>{
            const cur=(await tauriInvoke('get_update_channel').then(JSON.parse).catch(()=>({channel:'stable'}))).channel;
            _openChannelDialog(c, cur);
        });
        setupToggle('auto-upd',async a=>{
            setSetting('AutoUpdate',a?'true':'false');
            try{await tauriInvoke('configure_auto_update',{enable:a});}catch(e){}
            toast(a?t('upd_auto_on'):t('upd_auto_off'));
        });
        return;
    }

    // ── BookOS release OR package updates available ──
    const _menuBtn = `<button class="icon-btn" id="upd-menu-btn" title="${_tr('Canal de actualizaciones')}" aria-label="${_tr('Canal de actualizaciones')}">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
    </button>`;
    let h=renderHeader(t('hdr_updates'), _menuBtn);

    // 1) BookOS release card (hero) when available
    h += _releaseCard;

    h+=renderSection(t('sec_software_installed'));
    h+=renderCard([
        renderRowItem(t('label_system')||'Sistema',esc(sysInfo.distro||'BookOS'),''),
        renderRowItem(t('label_kernel')||'Kernel',esc(sysInfo.kernel||''),'')
    ]);


    // ── Auto-update + install packages combined card ──
    const _autoRow = renderRowItem(t('upd_auto'),t('upd_auto_sub'),renderToggle('auto-upd',autoupd));
    const _pkgsRow = total>0 ? `<div class="detail-item detail-item-row upd-install-row" id="upd-goto-pkgs" style="cursor:pointer">
                <div style="display:flex;flex-direction:column;gap:2px">
                    <span class="dt">${t('upd_install_packages')}</span>
                    <span style="font-size:12px;color:var(--tx2)">${total} ${total>1?t('upd_n_avail'):t('upd_n_avail_one')}</span>
                </div>
                <svg viewBox="0 0 8 14" width="8" height="14" fill="none" style="color:var(--tx2);flex-shrink:0"><path d="M1 1l6 6-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>` : '';
    h+=renderCard([_autoRow, _repoRow, _pkgsRow].filter(Boolean));

    c.innerHTML=h;
    _setupRepoToggle();

    document.getElementById('upd-goto-pkgs')?.addEventListener('click',()=>{
        renderUpdatesPackages(c,sys,flat,aur,sysInfo);
    });
    // Menu button (3 dots) → open channel picker dialog.
    // Read the *persisted* channel (set_update_channel) rather than release.channel,
    // which reflects the last fetched manifest and may lag when offline.
    document.getElementById('upd-menu-btn')?.addEventListener('click',async()=>{
        const cur=(await tauriInvoke('get_update_channel').then(JSON.parse).catch(()=>({channel:release.channel||'stable'}))).channel;
        _openChannelDialog(c, cur);
    });
    // ── BookOS release actions ──
    document.getElementById('rel-changelog')?.addEventListener('click',()=>{
        tauriInvoke('open_external_url',{url:_changelogUrl}).catch(()=>{});
    });
    document.getElementById('rel-night')?.addEventListener('click',()=>{
        setSetting('NightRelease',release.version||'1');
        toast(t('upd_scheduled_night')||'Programado para esta noche');
    });
    document.getElementById('rel-now')?.addEventListener('click',async()=>{
        const pwd=await promptUpdatePassword(release.name||'BookOS');
        if(!pwd)return;
        try{
            const started=JSON.parse(await tauriInvoke('apply_bookos_release',{password:pwd}));
            if(!started.ok&&!started.started)throw new Error(started.error||'Falló');
            toast(_tr('Descargando e instalando actualizaciones...'),'⬇');
            renderActualizacion(c);
        }catch(e){toast('Error: '+(e.message||'Fallo'),'✕');}
    });

    setupToggle('auto-upd',async a=>{setSetting('AutoUpdate',a?'true':'false');try{await tauriInvoke('configure_auto_update',{enable:a});}catch(e){}toast(a?t('upd_auto_on'):t('upd_auto_off'));});

    const progressWrap=document.getElementById('upd-progress');
    const bar=document.getElementById('upd-bar');
    const text=document.getElementById('upd-text');

    document.getElementById('upd-cancel')?.addEventListener('click',async()=>{
        try{await tauriInvoke('cancel_update');}catch(e){}
        progressWrap.style.display='none';
        if(bar){bar.classList.remove('indeterminate');bar.style.width='0';bar.style.background='';}
        toast('Actualización cancelada','✕');
    });
}

// Renders a dedicated "installing" screen — used when update is already running on page load
function _renderUpdateRunning(c, initialProgress){
    c.innerHTML=renderHeader(t('hdr_updates'))+
    `<div class="upd-card">
        <div class="upd-card-icon"><img src="assets/book-os.svg" alt="BookOS"></div>
        <div class="upd-card-body">
            <div class="upd-card-top">
                <div class="upd-card-info">
                    <span class="upd-card-name">Instalando actualizaciones</span>
                    <span class="upd-card-ver">No cierres la aplicación</span>
                </div>
            </div>
            <div class="upd-progress-wrap" id="upd-progress">
                <div class="upd-progress-track"><div class="upd-progress-fill indeterminate" id="upd-bar"></div></div>
                <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
                    <span class="upd-progress-label" id="upd-text">Instalando...</span>
                    <button class="bk-dbtn cancel" id="upd-cancel" style="padding:4px 14px;font-size:12px;margin-left:12px">Cancelar</button>
                </div>
            </div>
        </div>
    </div>`;
    const bar=document.getElementById('upd-bar');
    const text=document.getElementById('upd-text');
    const progressWrap=document.getElementById('upd-progress');
    document.getElementById('upd-cancel')?.addEventListener('click',async()=>{
        try{await tauriInvoke('cancel_update');}catch(e){}
        toast('Actualización cancelada','✕');
        renderActualizacion(c);
    });
    _startUpdatePolling(c,bar,text,progressWrap,null);
}

function _startUpdatePolling(c,bar,text,progressWrap,sysInfo){
    if(bar) bar.classList.add('indeterminate');
    let dots=0;
    const poll=setInterval(async()=>{
        try{
            if(!document.getElementById('upd-bar')){clearInterval(poll);return;}
            const p=JSON.parse(await tauriInvoke('get_update_progress'));
            dots=(dots+1)%4;
            if(p.running){
                if(text) text.textContent=(p.output?p.output.split('\n').pop().substring(0,40):'Instalando')+'.'.repeat(dots+1);
            }
            if(p.done){
                clearInterval(poll);
                if(p.ok){
                    if(bar){bar.classList.remove('indeterminate');bar.style.width='100%';}
                    if(text) text.textContent='✓ Completado';
                    toast('Sistema actualizado correctamente','🎉');
                    setTimeout(()=>renderActualizacion(c),1500);
                }else{
                    throw new Error(p.output||'Error al actualizar');
                }
            }
        }catch(e){
            clearInterval(poll);
            if(bar){bar.classList.remove('indeterminate');bar.style.background='var(--red)';bar.style.width='100%';}
            if(text) text.textContent='Error: '+(e.message||'Fallo');
            setTimeout(()=>{if(progressWrap)progressWrap.style.display='none';if(bar)bar.style.background='';},3000);
        }
    },500);
}

// ════════════════════════════════════════════════════════════════════════
// ── Acerca ──────────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════
export async function renderAcerca(c){
    c.innerHTML=renderHeader(t('hdr_about'))+renderSkeleton(4);
    let i={hostname:'--',kernel:'--',distro:'--',cpu:'--',ram:'--',gpu:'--',desktop:'--',model:'--'};
    try{i=JSON.parse(await tauriInvoke('get_system_info'));}catch(e){}

    // Samsung-style: device image + name + rename + info sections
    let h=renderHeader(t('hdr_about'));

    h+=`<div class="about-hero">
        <div class="about-device-img-wrap">
            <img src="./assets/generic_book2.svg" class="about-device-img" alt="Device">
        </div>
        <div class="about-hero-name" id="about-hostname-display">${esc(i.hostname)}</div>
        ${i.model&&i.model!=='--'?`<div class="about-hero-model">${esc(i.model)}</div>`:''}
        <button class="about-rename-btn" id="btn-rename-device">Cambiar nombre</button>
        <div class="about-rename-row" id="about-rename-row" style="display:none">
            <input type="text" class="about-rename-input" id="about-rename-input" value="${esc(i.hostname)}" placeholder="Nombre del equipo">
            <button class="btn btn-primary btn-sm" id="about-rename-ok">${_tr("Guardar")}</button>
            <button class="btn btn-secondary btn-sm" id="about-rename-cancel">Cancelar</button>
        </div>
    </div>`;

    // Info rows (Samsung About phone style)
    h+=renderSection(t('sec_software'));
    h+=renderCard([
        renderInfoItem('Sistema operativo','BookOS · '+esc(i.distro)),
        renderInfoItem('Entorno de escritorio','BookOS'),
        renderInfoItem('Kernel de Linux',esc(i.kernel)),
    ]);

    h+=renderSection(t('sec_hardware'));
    h+=renderCard([
        renderInfoItem('Modelo',esc(i.model)),
        renderInfoItem('Procesador',esc(i.cpu)),
        renderInfoItem('Memoria RAM',esc(i.ram)),
        renderInfoItem('Tarjeta gráfica',esc(i.gpu)),
    ]);


    c.innerHTML=h;

    // Rename device
    document.getElementById('btn-rename-device')?.addEventListener('click',()=>{
        document.getElementById('about-rename-row').style.display='flex';
        document.getElementById('about-rename-input')?.focus();
    });
    document.getElementById('about-rename-cancel')?.addEventListener('click',()=>{
        document.getElementById('about-rename-row').style.display='none';
    });
    document.getElementById('about-rename-ok')?.addEventListener('click',async()=>{
        const val=document.getElementById('about-rename-input')?.value?.trim();
        if(!val)return;
        try{await tauriInvoke('set_hostname',{name:val});}catch(e){}
        document.getElementById('about-hostname-display').textContent=val;
        document.getElementById('about-rename-row').style.display='none';
        toast('Nombre del equipo actualizado');
    });
}

// ════════════════════════════════════════════════════════════════════════
// ── Administración General ─────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════
export async function renderGeneral(c){
    c.innerHTML=renderHeader(t('hdr_general'))+renderSkeleton(2);
    let loc={locale:'',keymap:''},locales=[],keymaps=[],auto={enabled:false},autostartApps=[];
    let dt={timezone:'',ntp:false,synced:false},timezones=[];
    try{[loc,locales,keymaps,auto,autostartApps,dt,timezones]=await Promise.all([
        tauriInvoke('get_locale_info').then(JSON.parse),
        tauriInvoke('get_available_locales').then(JSON.parse),
        tauriInvoke('get_available_keymaps').then(JSON.parse),
        tauriInvoke('get_autostart_bookos').then(JSON.parse).catch(()=>({enabled:false})),
        tauriInvoke('get_autostart_apps').then(JSON.parse).catch(()=>[]),
        tauriInvoke('get_datetime_info').then(JSON.parse).catch(()=>({timezone:'',ntp:false,synced:false})),
        tauriInvoke('list_timezones').then(JSON.parse).catch(()=>[])
    ]);}catch(e){}
    
    // Inline SVG flags (no emoji — render consistently across fonts/platforms).
    const _FLAGS={
        es:`<svg class="lang-flag" width="20" height="14" viewBox="0 0 20 14" aria-hidden="true"><rect width="20" height="14" rx="2" fill="#c60b1e"/><rect y="3.5" width="20" height="7" fill="#ffc400"/></svg>`,
        us:`<svg class="lang-flag" width="20" height="14" viewBox="0 0 20 14" aria-hidden="true"><rect width="20" height="14" rx="2" fill="#fff"/><g fill="#b22234"><rect width="20" height="2"/><rect y="4" width="20" height="2"/><rect y="8" width="20" height="2"/><rect y="12" width="20" height="2"/></g><rect width="9" height="8" fill="#3c3b6e"/></svg>`,
        fr:`<svg class="lang-flag" width="20" height="14" viewBox="0 0 20 14" aria-hidden="true"><rect width="20" height="14" rx="2" fill="#fff"/><rect width="6.67" height="14" fill="#0055a4"/><rect x="13.33" width="6.67" height="14" fill="#ef4135"/></svg>`
    };
    // «es_MX.UTF-8» → «Español (México)», cada idioma escrito en su propio
    // idioma, que es como lo busca quien no entiende el actual. Antes solo
    // había nombre para tres y el resto salía como el código crudo.
    const flagOf={es_ES:'es',en_US:'us',fr_FR:'fr'};
    const prettyLocale=l=>{
        const tag=String(l).split('.')[0].replace('_','-');
        try{
            const n=new Intl.DisplayNames([tag],{type:'language'}).of(tag);
            return n&&n!==tag?n.charAt(0).toLocaleUpperCase(tag)+n.slice(1):l;
        }catch{return l;}
    };
    // HTML seguro: bandera (si la hay) + nombre escapado.
    const getLangName = l => {
        if(!l) return '';
        const f=_FLAGS[flagOf[String(l).split('.')[0]]];
        return `<span class="lang-label">${f||''}<span>${esc(prettyLocale(l))}</span></span>`;
    };

    const _curAppLang=(localStorage.getItem('bookos_lang')||'auto');
    const _appLangOpts=[['auto','Automático'],['es','Español'],['en','English']];
    // Mismos controles que el resto de páginas: un botón con menú emergente
    // en vez de listas que se desplegaban dentro de la tarjeta.
    const pick=(id,label)=>`<button type="button" class="bk-select" id="${id}" aria-haspopup="listbox"><span>${label}</span></button>`;
    const link=(id,title,sub)=>`<div class="detail-item detail-item-row gen-link" id="${id}" role="button" tabindex="0"><div class="detail-texts"><span class="dt">${_tr(title)}</span>${sub?`<span class="ds">${_tr(sub)}</span>`:''}</div>${chevron()}</div>`;
    c.innerHTML=renderHeader(t('hdr_general'))
    + renderSection(_tr('Idioma y región')) + renderCard([
        renderRowItem(t('label_app_lang'),'',pick('pick-applang',esc(_appLangOpts.find(o=>o[0]===_curAppLang)?.[1]||'Automático'))),
        renderRowItem(t('label_system_lang'),'Se aplica al volver a iniciar sesión',pick('pick-lang',getLangName(loc.locale)||'—')),
        link('go-keyboard','Teclado','Distribución del teclado'),
    ])
    + renderSection(_tr('Fecha y hora')) + renderCard([
        renderRowItem('Hora automática','Sincroniza el reloj por internet',renderToggle('ntp',dt.ntp)),
        `<div class="detail-item detail-item-row gen-link" id="btn-tz" role="button" tabindex="0" aria-expanded="false">
            <div class="detail-texts"><span class="dt">${_tr('Zona horaria')}</span><span class="ds" id="tz-cur">${esc(dt.timezone||_tr('No configurada'))}</span></div>
            ${chevron()}
        </div>`,
        `<div id="tz-list" class="tz-panel" hidden>
            <input type="search" id="tz-filter" class="tz-filter" placeholder="${_tr('Buscar zona…')}" aria-label="${_tr('Buscar zona…')}">
            <div class="tz-res" id="tz-res"></div>
        </div>`
    ])
    + renderSection(_tr('Inicio')) + renderCard([
        renderRowItem(t('label_launch_at_login'),t('label_launch_at_login_sub'),renderToggle('autostart',auto.enabled)),
        ...(autostartApps.length===0
            ?[renderInfoItem(t('label_no_autostart'),t('label_no_autostart_sub'))]
            :autostartApps.map(a=>`<div class="detail-item detail-item-row">
                <div class="detail-texts"><span class="dt">${esc(a.name)}</span><span class="ds gen-exec">${esc(a.exec)}</span></div>
                ${renderToggle('ast-'+esc(a.filename),a.enabled)}
            </div>`)),
    ])
    + renderSection(_tr('Dispositivos')) + renderCard([
        link('open-printers','Impresoras y escáneres','Añadir y configurar impresoras'),
    ]);

    const menu=(btnId,title,options,current,onSelect)=>{
        const btn=document.getElementById(btnId);
        btn?.addEventListener('click',()=>popoverSelect(btn.closest('.detail-item'),{title,options,current,onSelect}));
    };
    menu('pick-applang',t('label_app_lang'),_appLangOpts.map(([val,label])=>({val,label:esc(label)})),_curAppLang,v=>{
        if(v==='auto')localStorage.removeItem('bookos_lang');else localStorage.setItem('bookos_lang',v);
        toast(t('tst_app_lang_changed'),'🌐');
        // Recargar para que todas las páginas salgan en el idioma nuevo.
        setTimeout(()=>location.reload(),400);
    });
    let curLocale=loc.locale;
    menu('pick-lang',t('label_system_lang'),[...locales].sort((x,y)=>prettyLocale(x).localeCompare(prettyLocale(y))).map(l=>({val:l,label:getLangName(l)})),curLocale,async v=>{
        if(v===curLocale)return;
        try{
            if(!await promptSudo('cambiar el idioma del sistema','localectl',['set-locale',`LANG=${v}`]))return;
            curLocale=v;
            document.querySelector('#pick-lang span').innerHTML=getLangName(v);
            toast(t('tst_lang_changed'));
        }catch(e){toast(String(e),'❌');}
    });
    const onActivate=(id,fn)=>{const el=document.getElementById(id);el?.addEventListener('click',fn);el?.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fn();}});};
    onActivate('go-keyboard',()=>window.openPage?.('teclado'));

    // ── Fecha y hora ──
    setupToggle('ntp',async on=>{
        const r=JSON.parse(await tauriInvoke('set_ntp',{enable:on}));
        if(!r.ok)throw new Error(_tr('No se pudo cambiar'));
        toast(on?_tr('Hora automática activada'):_tr('Hora automática desactivada'),'🕐');
    });
    // Las ~600 zonas se pintan al abrir la lista, no con la página: eran la
    // mitad de sus 1344 nodos —medido— y casi nadie cambia de zona horaria.
    const tzRes=document.getElementById('tz-res'),tzList=document.getElementById('tz-list'),tzBtn=document.getElementById('btn-tz');
    onActivate('btn-tz',()=>{
        if(!tzRes.childElementCount)tzRes.innerHTML=timezones.map(z=>`<div class="tz-item ${z===dt.timezone?'active':''}" data-tz="${esc(z)}">${esc(z.replace(/_/g,' '))}</div>`).join('');
        tzList.hidden=!tzList.hidden;
        tzBtn.setAttribute('aria-expanded',String(!tzList.hidden));
        if(!tzList.hidden)document.getElementById('tz-filter')?.focus();
    });
    document.getElementById('tz-filter')?.addEventListener('input',e=>{
        const q=e.target.value.toLowerCase().replace(/ /g,'_');
        tzRes.querySelectorAll('.tz-item').forEach(it=>{it.hidden=!it.dataset.tz.toLowerCase().includes(q);});
    });
    // Un solo escuchador para toda la lista en vez de uno por zona.
    tzRes?.addEventListener('click',async e=>{
        const b=e.target.closest('[data-tz]');
        if(!b)return;
        const tz=b.dataset.tz;
        try{
            const r=JSON.parse(await tauriInvoke('set_timezone',{timezone:tz}));
            if(!r.ok){toast(_tr('No se pudo cambiar'),'❌');return;}
            tzRes.querySelector('.active')?.classList.remove('active');
            b.classList.add('active');
            document.getElementById('tz-cur').textContent=tz;
            tzList.hidden=true;tzBtn.setAttribute('aria-expanded','false');
            toast(_tr('Zona horaria actualizada'),'🌍');
        }catch(e){toast(_tr('No se pudo cambiar'),'❌');}
    });
    onActivate('open-printers',async()=>{
        try{await tauriInvoke('open_printers');}catch(e){toast(String(e),'❌');}
    });

    setupToggle('autostart', async a => {
        await tauriInvoke('toggle_autostart_bookos',{enable:a}); toast(a?t('tst_autostart_on'):t('tst_autostart_off'));
    });
    autostartApps.forEach(a=>{
        setupToggle('ast-'+a.filename, async enabled=>{
            await tauriInvoke('toggle_autostart_app',{filename:a.filename,enabled}); toast((enabled?t('enabled'):t('disabled'))+': '+a.name);
        });
    });
}

// ════════════════════════════════════════════════════════════════════════
// ── Cuentas ────────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════
export async function renderCuentas(c){
    c.innerHTML=renderHeader(t('hdr_accounts'))+renderSkeleton(3);
    let u={username:'',display_name:'',hostname:''}, users=[], autoLogin={enabled:false,user:''};
    try{[u, users, autoLogin]=await Promise.all([
        tauriInvoke('get_user_info').then(JSON.parse).catch(()=>({username:'',display_name:'',hostname:''})),
        tauriInvoke('get_system_users').then(JSON.parse).catch(()=>[]),
        tauriInvoke('get_autologin_status').then(JSON.parse).catch(()=>({enabled:false,user:''}))
    ]);}catch(e){}

    const currentUser = users.find(x => x.username === u.username) || {display_name: u.display_name, has_avatar: false, avatar_data: u.avatar_data};
    const ini = (currentUser.display_name || u.username || 'U').charAt(0).toUpperCase();
    const avSrc = currentUser.avatar_data || (currentUser.has_avatar ? getAssetUrl(currentUser.avatar_path) : '');
    const av = avSrc ? `<img src="${avSrc}" class="acc-avatar-big">` : `<div class="acc-avatar-big-ph">${ini}</div>`;

    const otherUsers = users.filter(us => us.username !== u.username);
    let userListHtml = otherUsers.map(us => {
        const sIni = (us.display_name || us.username).charAt(0).toUpperCase();
        const sSrc = us.avatar_data || (us.has_avatar ? getAssetUrl(us.avatar_path) : '');
        const sAv = sSrc ? `<img src="${sSrc}" class="sys-user-av">` : `<div class="sys-user-av-ph">${sIni}</div>`;
        return `<div class="sys-user-item" data-username="${esc(us.username)}">
            ${sAv}
            <div class="sys-user-info">
                <span class="sys-user-name">${esc(us.display_name||us.username)}</span>
                <span class="sys-user-id">@${esc(us.username)}</span>
            </div>
            <button class="btn btn-danger btn-sm sys-user-del" data-del="${esc(us.username)}" title="Eliminar cuenta">Eliminar</button>
        </div>`;
    }).join('');
    if(otherUsers.length===0){
        userListHtml=`<div class="detail-item"><span class="ds" style="color:var(--tx2)">No hay otros usuarios en este equipo.</span></div>`;
    }

    c.innerHTML=renderHeader(t('hdr_accounts')) + `
        <div class="acc-hero">
            <div style="position:relative;cursor:pointer;flex-shrink:0" id="acc-avatar-btn" title="${_tr('Cambiar foto')}">
                ${av}
                <div style="position:absolute;right:-2px;bottom:-2px;width:26px;height:26px;border-radius:50%;background:var(--blue);display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.25);border:2px solid var(--card)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                </div>
            </div>
            <div class="acc-hero-info">
                <span class="acc-hero-name" id="acc-hero-name">${esc(currentUser.display_name || u.username)}</span>
                <span class="acc-hero-sub">${_tr('Administrador de BookOS')} · @${esc(u.username)}</span>
            </div>
        </div>
    ` + renderSection(t('sec_local_data')) + renderCard([
        `<div class="detail-item detail-item-row" style="cursor:pointer" id="acc-edit-dn">
            <div class="detail-texts"><span class="dt">${_tr('Nombre visible')}</span><span class="ds" id="acc-dn-cur">${esc(u.display_name||'—')}</span></div>
            ${chevron()}
        </div>`,
        `<div class="detail-item detail-item-row" style="cursor:pointer" id="acc-edit-hn">
            <div class="detail-texts"><span class="dt">${_tr('Nombre del equipo')}</span><span class="ds" id="acc-hn-cur">${esc(u.hostname||'—')}</span></div>
            ${chevron()}
        </div>`
    ]) + renderSection(t('sec_security')) + renderCard([
        renderRowItem('Contraseña','Cambia la contraseña de tu cuenta',`<button class="btn btn-secondary btn-sm" id="acc-change-pw">Cambiar</button>`),
        renderRowItem(
            'Inicio de sesión automático',
            autoLogin.enabled
                ? `<span style="color:var(--blue)">Activo para <strong>${esc(autoLogin.user)}</strong></span>`
                : 'Omite la pantalla de inicio de sesión al encender',
            renderToggle('autologin', autoLogin.enabled)
        ),
    ]) + renderSection(t('sec_other_users')) + `<div class="detail-card"><div class="sys-users-list">${userListHtml}</div></div>`
      + `<div style="display:flex;justify-content:flex-end;margin:12px 4px 0">
            <button class="btn btn-primary btn-sm" id="acc-create-user">+ Crear cuenta nueva</button>
         </div>`;

    // Diálogo de edición de texto (One UI-style, mismo overlay que showDialog)
    const promptText=(title,val)=>new Promise(res=>{
        const ov=document.createElement('div');ov.className='bk-overlay';
        ov.innerHTML=`<div class="bk-dialog"><div class="bk-dialog-title">${title}</div>
            <input type="text" id="pt-in" class="sel" style="width:100%;margin:14px 0;box-sizing:border-box" value="${esc(val||'')}">
            <div class="bk-dialog-btns"><button class="bk-dbtn cancel" id="pt-c">${t('cancel')}</button><button class="bk-dbtn confirm" id="pt-o">${t('save')}</button></div></div>`;
        document.body.appendChild(ov);
        const inp=ov.querySelector('#pt-in');setTimeout(()=>{inp.focus();inp.select();},50);
        const done=v=>{ov.remove();res(v);};
        ov.querySelector('#pt-c').onclick=()=>done(null);
        ov.querySelector('#pt-o').onclick=()=>done(inp.value.trim());
        inp.addEventListener('keydown',e=>{if(e.key==='Enter')done(inp.value.trim());if(e.key==='Escape')done(null);});
        ov.addEventListener('click',e=>{if(e.target===ov)done(null);});
    });

    // Cambiar foto de perfil: selector → diálogo de recorte (zoom + arrastre) → PNG 256px
    const avatarCropDialog=(path)=>{
        const SIZE=260;
        const ov=document.createElement('div');ov.className='bk-overlay';
        ov.innerHTML=`<div class="bk-dialog" style="width:330px">
            <div class="bk-dialog-title">${_tr('Ajustar foto')}</div>
            <div id="av-vp" style="width:${SIZE}px;height:${SIZE}px;border-radius:50%;overflow:hidden;margin:14px auto 6px;position:relative;background:#111;cursor:grab;touch-action:none">
                <img id="av-img" style="position:absolute;user-select:none;-webkit-user-drag:none;pointer-events:none" draggable="false">
            </div>
            <p style="color:var(--tx2);font-size:12px;text-align:center;margin:0 0 8px">${_tr('Arrastra para encuadrar')}</p>
            <input type="range" id="av-zoom" min="100" max="300" value="100" style="width:100%;margin:0 0 14px">
            <div class="bk-dialog-btns"><button class="bk-dbtn cancel" id="av-c">${t('cancel')}</button><button class="bk-dbtn confirm" id="av-o">${t('apply')}</button></div>
        </div>`;
        document.body.appendChild(ov);
        const vp=ov.querySelector('#av-vp'),img=ov.querySelector('#av-img'),zoom=ov.querySelector('#av-zoom');
        let W=0,H=0,s0=1,z=1,tx=0,ty=0;
        const clamp=()=>{
            const s=s0*z,iw=W*s,ih=H*s;
            tx=Math.min(0,Math.max(SIZE-iw,tx));
            ty=Math.min(0,Math.max(SIZE-ih,ty));
        };
        const paint=()=>{
            const s=s0*z;
            img.style.width=(W*s)+'px';img.style.height=(H*s)+'px';
            img.style.left=tx+'px';img.style.top=ty+'px';
        };
        img.onload=()=>{
            W=img.naturalWidth;H=img.naturalHeight;
            if(!W||!H){ov.remove();toast(_tr('Error al seleccionar imagen'),'❌');return;}
            s0=Math.max(SIZE/W,SIZE/H);   // cover
            tx=(SIZE-W*s0)/2;ty=(SIZE-H*s0)/2;   // centrado
            paint();
        };
        img.onerror=()=>{ov.remove();toast(_tr('Error al seleccionar imagen'),'❌');};
        img.crossOrigin='anonymous';   // asset:// es otro origen; sin esto el canvas queda tainted
        img.src=getAssetUrl(path);
        zoom.addEventListener('input',()=>{
            // zoom manteniendo el centro del viewport fijo
            const zNew=parseInt(zoom.value)/100,sOld=s0*z,sNew=s0*zNew;
            const cx=(SIZE/2-tx)/sOld,cy=(SIZE/2-ty)/sOld;
            z=zNew;tx=SIZE/2-cx*sNew;ty=SIZE/2-cy*sNew;
            clamp();paint();
        });
        let drag=null;
        vp.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,tx,ty};vp.setPointerCapture(e.pointerId);vp.style.cursor='grabbing';});
        vp.addEventListener('pointermove',e=>{
            if(!drag)return;
            tx=drag.tx+(e.clientX-drag.x);ty=drag.ty+(e.clientY-drag.y);
            clamp();paint();
        });
        vp.addEventListener('pointerup',()=>{drag=null;vp.style.cursor='grab';});
        const closeDlg=()=>ov.remove();
        ov.querySelector('#av-c').onclick=closeDlg;
        ov.addEventListener('click',e=>{if(e.target===ov)closeDlg();});
        ov.querySelector('#av-o').onclick=async()=>{
            try{
                const OUT=256,k=OUT/SIZE,s=s0*z;
                const cv=document.createElement('canvas');cv.width=OUT;cv.height=OUT;
                const ctx=cv.getContext('2d');
                ctx.drawImage(img,tx*k,ty*k,W*s*k,H*s*k);
                const blob=await new Promise(res=>cv.toBlob(res,'image/png'));
                const data=Array.from(new Uint8Array(await blob.arrayBuffer()));
                const r=JSON.parse(await tauriInvoke('set_avatar_data',{data}));
                if(r.ok){closeDlg();toast(_tr('Foto actualizada'));renderCuentas(c);}
                else toast(_tr('Error al aplicar'),'❌');
            }catch(e){
                // Canvas tainted u otro fallo del recorte → copiar la imagen tal cual
                try{
                    const r2=JSON.parse(await tauriInvoke('set_avatar',{sourcePath:path}));
                    if(r2.ok!==false){closeDlg();toast(_tr('Foto actualizada'));renderCuentas(c);return;}
                }catch(e2){}
                toast(_tr('Error al aplicar'),'❌');
            }
        };
    };
    document.getElementById('acc-avatar-btn')?.addEventListener('click',async()=>{
        try{
            const {open}=window.__TAURI__.dialog;
            const file=await open({multiple:false,filters:[{name:'Imágenes',extensions:['png','jpg','jpeg','webp']}]});
            if(!file)return;
            avatarCropDialog(file);
        }catch(e){toast(_tr('Error al seleccionar imagen'),'❌');}
    });

    document.getElementById('acc-edit-dn')?.addEventListener('click',async()=>{
        const v=await promptText(_tr('Nombre visible'),u.display_name);
        if(v===null||v===''||v===u.display_name)return;
        const ok=await promptSudo('cambiar el nombre visible','chfn',['-f',v,u.username]);
        if(ok){
            tauriInvoke('set_display_name',{name:v}).catch(()=>{});
            u.display_name=v;
            const ds=document.getElementById('acc-dn-cur');if(ds)ds.textContent=v;
            const hn=document.getElementById('acc-hero-name');if(hn)hn.textContent=v;
            toast('Nombre guardado');
        }
    });
    document.getElementById('acc-edit-hn')?.addEventListener('click',async()=>{
        const v=await promptText(_tr('Nombre del equipo'),u.hostname);
        if(v===null||v===''||v===u.hostname)return;
        const ok=await promptSudo('cambiar el nombre del equipo','hostnamectl',['set-hostname',v]);
        if(ok){
            tauriInvoke('set_hostname',{name:v}).catch(()=>{});
            u.hostname=v;
            const ds=document.getElementById('acc-hn-cur');if(ds)ds.textContent=v;
            toast('Hostname guardado');
        }
    });

    // ── Autologin toggle ──
    setupToggle('autologin', async enable=>{
        const auth=await promptAuth({
            title: enable?'Activar inicio automático':'Desactivar inicio automático',
            description: enable
                ? `Cualquier persona con acceso al equipo iniciará sesión como <strong>${esc(u.username)}</strong> sin contraseña. Confirma para continuar.`
                : 'Volverás a necesitar contraseña al encender el equipo.',
            confirmLabel: enable?'Activar':'Desactivar',
            allowFingerprint: true,
        });
        if(!auth || auth.method==='fingerprint' || !auth.password){
            // Roll back UI
            const tg=document.querySelector('[data-toggle="autologin"]');
            if(enable){tg?.classList.remove('active');tg?.setAttribute('aria-checked','false');}
            else{tg?.classList.add('active');tg?.setAttribute('aria-checked','true');}
            if(auth?.method==='fingerprint')toast('Esta acción requiere contraseña','ℹ');
            return;
        }
        const r=JSON.parse(await tauriInvoke('set_autologin',{
            enabled:enable, username:u.username, sudoPassword:auth.password
        }));
        if(r.ok)toast(enable?'Inicio automático activado':'Inicio automático desactivado','✓');
        else toast('Error: '+(r.error||'no se pudo aplicar'),'❌');
    });

    // ── Delete user ──
    document.querySelectorAll('[data-del]').forEach(btn=>btn.addEventListener('click',async()=>{
        const target=btn.dataset.del;
        showDialog(
            `Eliminar cuenta "${esc(target)}"`,
            `<p>Se borrarán los archivos personales del usuario <strong>${esc(target)}</strong> y no se podrá recuperar.</p><p style="color:var(--red);font-size:13px">Esta acción es permanente.</p>`,
            {
                confirmText:'Eliminar', confirmClass:'danger',
                onConfirm: async()=>{
                    const auth=await promptAuth({
                        title:'Confirmar eliminación',
                        description:`Introduce tu contraseña para borrar la cuenta <strong>${esc(target)}</strong>.`,
                        confirmLabel:'Eliminar',
                    });
                    if(!auth || !auth.password){
                        if(auth?.method==='fingerprint')toast('Esta acción requiere contraseña','ℹ');
                        return;
                    }
                    const r=JSON.parse(await tauriInvoke('delete_user',{
                        username:target, sudoPassword:auth.password, removeHome:true
                    }));
                    if(r.ok){toast('Cuenta eliminada','🗑');renderCuentas(c);}
                    else toast('Error: '+(r.error||'no se pudo borrar'),'❌');
                }
            }
        );
    }));

    // ── Create user dialog ──
    document.getElementById('acc-create-user')?.addEventListener('click',()=>{
        const ov=document.createElement('div');
        ov.className='bk-overlay';
        ov.innerHTML=`<div class="bk-dialog" style="min-width:380px;max-width:420px">
            <div class="bk-dialog-title">Crear cuenta nueva</div>
            <div style="padding:0 4px 12px;display:flex;flex-direction:column;gap:12px">
                <div style="display:flex;flex-direction:column;gap:10px;align-items:center;padding:8px 0">
                    <div id="new-av-preview" class="acc-avatar-big-ph" style="width:72px;height:72px;font-size:28px">?</div>
                    <button class="btn btn-secondary btn-sm" id="new-av-pick">Elegir foto</button>
                </div>
                <div><label class="ds" style="display:block;margin-bottom:4px">Nombre completo</label>
                    <input type="text" id="new-fullname" class="sel" placeholder="p. ej. María García"></div>
                <div><label class="ds" style="display:block;margin-bottom:4px">Nombre de usuario</label>
                    <input type="text" id="new-username" class="sel" placeholder="maria" autocomplete="off" pattern="[a-z0-9_-]+"></div>
                <div><label class="ds" style="display:block;margin-bottom:4px">Contraseña</label>
                    <input type="password" id="new-pwd" class="sel" placeholder="Mínimo 8 caracteres" autocomplete="new-password"></div>
                <div><label class="ds" style="display:block;margin-bottom:4px">Confirmar contraseña</label>
                    <input type="password" id="new-pwd2" class="sel" placeholder="Repite la contraseña" autocomplete="new-password"></div>
                <label style="display:flex;align-items:center;gap:8px;font-size:14px"><input type="checkbox" id="new-admin"> Permitir privilegios de administrador (sudo)</label>
                <div id="new-err" style="font-size:12px;color:var(--red,#e53935);display:none"></div>
            </div>
            <div class="bk-dialog-btns">
                <button class="bk-dbtn cancel" id="new-cancel">Cancelar</button>
                <button class="bk-dbtn confirm" id="new-ok">Crear</button>
            </div>
        </div>`;
        document.body.appendChild(ov);
        const close=()=>ov.remove();
        let avatarPath='';
        ov.querySelector('#new-cancel').onclick=close;
        ov.addEventListener('click',e=>{if(e.target===ov)close();});

        // Auto-fill username from full name
        ov.querySelector('#new-fullname').addEventListener('input',e=>{
            const unEl=ov.querySelector('#new-username');
            if(unEl.dataset.touched)return;
            unEl.value=e.target.value.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g,'').slice(0,16);
        });
        ov.querySelector('#new-username').addEventListener('input',e=>{e.target.dataset.touched='1';});

        ov.querySelector('#new-av-pick').onclick=async()=>{
            try{
                const result=await window.__TAURI__.dialog.open({
                    multiple:false,
                    filters:[{name:'Imágenes',extensions:['png','jpg','jpeg','webp']}]
                });
                if(result){
                    avatarPath=result;
                    const prev=ov.querySelector('#new-av-preview');
                    prev.outerHTML=`<img id="new-av-preview" src="${getAssetUrl(result)}" style="width:72px;height:72px;border-radius:50%;object-fit:cover">`;
                }
            }catch(e){}
        };

        ov.querySelector('#new-ok').onclick=async()=>{
            const fullname=ov.querySelector('#new-fullname').value.trim();
            const username=ov.querySelector('#new-username').value.trim();
            const pwd=ov.querySelector('#new-pwd').value;
            const pwd2=ov.querySelector('#new-pwd2').value;
            const admin=ov.querySelector('#new-admin').checked;
            const err=ov.querySelector('#new-err');
            const showErr=(m)=>{err.textContent=m;err.style.display='block';};
            if(!username)return showErr('El nombre de usuario es obligatorio');
            if(!/^[a-z][a-z0-9_-]{0,31}$/.test(username))return showErr('Usuario inválido (solo minúsculas, números, _ y -, debe empezar por letra)');
            if(pwd.length<8)return showErr('La contraseña debe tener al menos 8 caracteres');
            if(pwd!==pwd2)return showErr('Las contraseñas no coinciden');
            // Need sudo password
            close();
            const auth=await promptAuth({
                title:'Confirmar creación de cuenta',
                description:`Introduce tu contraseña de administrador para crear la cuenta <strong>${esc(username)}</strong>.`,
                confirmLabel:'Crear',
            });
            if(!auth || !auth.password){
                if(auth?.method==='fingerprint')toast('Esta acción requiere contraseña','ℹ');
                return;
            }
            const r=JSON.parse(await tauriInvoke('create_user',{
                username, fullName:fullname, password:pwd, isAdmin:admin,
                avatarPath:avatarPath||null, sudoPassword:auth.password
            }));
            if(r.ok){toast(`Cuenta "${username}" creada`,'✓');renderCuentas(c);}
            else toast('Error: '+(r.error||'no se pudo crear'),'❌');
        };
        ov.querySelector('#new-fullname').focus();
    });

    document.getElementById('acc-change-pw')?.addEventListener('click',()=>{
        const ov=document.createElement('div');
        ov.className='bk-overlay';
        ov.innerHTML=`<div class="bk-dialog" style="min-width:320px">
            <div class="bk-dialog-title">Cambiar contraseña</div>
            <div style="padding:0 4px 12px;display:flex;flex-direction:column;gap:10px">
                <div><label class="ds" style="display:block;margin-bottom:4px">Contraseña actual</label>
                    <input type="password" id="pw-current" class="sel" placeholder="Contraseña actual" autocomplete="current-password"></div>
                <div><label class="ds" style="display:block;margin-bottom:4px">Nueva contraseña</label>
                    <input type="password" id="pw-new" class="sel" placeholder="Nueva contraseña" autocomplete="new-password"></div>
                <div><label class="ds" style="display:block;margin-bottom:4px">Confirmar nueva</label>
                    <input type="password" id="pw-confirm" class="sel" placeholder="Confirmar contraseña" autocomplete="new-password"></div>
                <div id="pw-err" style="font-size:12px;color:var(--red,#e53935);display:none"></div>
            </div>
            <div class="bk-dialog-btns">
                <button class="bk-dbtn cancel" id="pw-cancel">Cancelar</button>
                <button class="bk-dbtn confirm" id="pw-ok">Cambiar</button>
            </div>
        </div>`;
        document.body.appendChild(ov);
        const close=()=>ov.remove();
        ov.querySelector('#pw-cancel').onclick=close;
        ov.querySelector('#pw-ok').onclick=async()=>{
            const cur=ov.querySelector('#pw-current').value;
            const nw=ov.querySelector('#pw-new').value;
            const cf=ov.querySelector('#pw-confirm').value;
            const err=ov.querySelector('#pw-err');
            if(!cur||!nw){err.textContent='Rellena todos los campos';err.style.display='block';return;}
            if(nw!==cf){err.textContent='Las contraseñas no coinciden';err.style.display='block';return;}
            if(nw.length<8){err.textContent='La contraseña debe tener al menos 8 caracteres';err.style.display='block';return;}
            try{
                const result=JSON.parse(await tauriInvoke('change_password',{username:u.username,oldPwd:cur,newPwd:nw}));
                if(!result.ok){err.textContent='Contraseña actual incorrecta';err.style.display='block';return;}
                close();toast('Contraseña cambiada con éxito','🔑');
            }catch(e){err.textContent='Error al cambiar contraseña';err.style.display='block';}
        };
        ov.addEventListener('click',e=>{if(e.target===ov)close();});
        ov.querySelector('#pw-current').focus();
    });
}

// ════════════════════════════════════════════════════════════════════════
// ── Mantenimiento ──────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════
export async function renderMantenimiento(c){
    c.innerHTML=renderHeader(t('hdr_maintenance'))+renderSection(t('sec_cleanup'))+renderCard([
        renderRowItem('Limpiar Flatpak','Elimina aplicaciones sin uso',`<button class="btn btn-secondary btn-sm" id="m-flat">Limpiar</button>`),
        renderRowItem('Limpiar caché de paquetes','Limpia archivos de Paru/Pacman',`<button class="btn btn-secondary btn-sm" id="m-pkg">Limpiar</button>`),
        renderRowItem('Miniaturas temporales','Borra caché de thumbnails',`<button class="btn btn-secondary btn-sm" id="m-cache">Borrar</button>`)
    ])+renderSection(t('sec_bookos_management'))+renderCard([
        renderRowItem('Exportar a JSON','Exportar configuración de BookOS',`<button class="btn btn-secondary btn-sm" id="m-exp">Exportar</button>`),
        renderRowItem('Importar JSON','Importar configuración (requiere elegir archivo)',`<button class="btn btn-secondary btn-sm" id="m-imp">Importar</button>`)
    ]);
    const run=(id,target)=>{
        const b=document.getElementById(id);if(!b)return;
        b.onclick=async()=>{
            const origText=b.textContent;
            b.textContent='…';b.disabled=true;
            try{await tauriInvoke('run_maintenance',{target});b.textContent='✓';toast('Limpieza completada','🧹');}
            catch(e){b.textContent='Error';toast('Error en limpieza','❌');}
            setTimeout(()=>{b.textContent=origText;b.disabled=false;},2000);
        };
    };
    run('m-flat','flatpak');run('m-pkg','packages');run('m-cache','cache');
    
    document.getElementById('m-exp')?.addEventListener('click', async()=>{
        try {
            const dest = await window.__TAURI__.dialog.save({defaultPath:'bookos_settings.json', filters:[{name:'JSON',extensions:['json']}]});
            if(dest) { await tauriInvoke('export_settings', {dest}); toast('Ajustes exportados a '+dest); }
        } catch(e){ toast('No se pudieron exportar los ajustes','❌'); }
    });
    document.getElementById('m-imp')?.addEventListener('click', async()=>{
        try {
            const src = await window.__TAURI__.dialog.open({filters:[{name:'JSON',extensions:['json']}]});
            if(src) { await tauriInvoke('import_settings', {src}); toast('Ajustes importados'); setTimeout(()=>location.reload(), 1500); }
        } catch(e){ toast('No se pudieron importar los ajustes','❌'); }
    });
}

// ════════════════════════════════════════════════════════════════════════
// ── Fondo de Pantalla (NEW) ────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════
// «Dark/purple_dark.png» → «Purple». La pareja clara/oscura es un solo fondo
// para quien lo mira; el sufijo y la extensión son cosa del disco.
function nombreFondo(path){
    const base=String(path).split('/').pop().replace(/\.[^.]+$/,'').replace(/[_-](dark|light|oscuro|claro)$/i,'').replace(/[_-]+/g,' ').trim();
    return base?base.charAt(0).toLocaleUpperCase()+base.slice(1):_tr('Fondo de pantalla');
}
export async function renderFondos(c){
    const pageEpoch=window._navEpoch;
    c.innerHTML=renderHeader(t('hdr_wallpaper_style'))+renderSkeleton(2);
    let current='';
    try{current=JSON.parse(await tauriInvoke('get_current_wallpaper')).path||'';}catch(e){}

    let wallpapers=[];
    const currentWp={path:current,name:nombreFondo(current)};

    const desktopPreview=()=>`        <div class="wp-desktop-screen" id="wp-screen">
            <img data-preview-path="${esc(currentWp.path)}" class="wp-desktop-bg" id="wp-screen-img" alt="" decoding="async" onerror="this.style.opacity='0'">
        </div>
`;

    let h=renderHeader(t('hdr_wallpaper_style'));
    // The current name and controls are cheap; previews are created on demand.
    h += `<div class="wp-hero-card">
        <div id="wp-preview-host"></div>
        <button class="wp-change-btn" id="btn-change-wp">${_tr("Cambiar fondo de pantalla")}</button>
        <div id="wp-grid" class="wp-grid-panel" style="display:none"></div>
    </div>`;

    // ── Paleta de colores dinámica de BookOS (Material-You-like) ──
    // Antes vivía en Temas; tiene más sentido aquí porque la paleta sale
    // del fondo de pantalla, no del tema claro/oscuro. Elegir NO aplica:
    // solo repinta las maquetas de arriba. Solo se guarda con "Aplicar".
    h += `<div class="theme-block dyn-off" id="dyn-block">
        <div class="dyn-mockups" id="dyn-mockups"></div>
        ${renderRowItem('Paleta dinámica de BookOS','Tiñe las apps y el acento del escritorio con los colores de tu fondo',renderToggle('dyncolor',false))}
        <div id="dyn-body" style="display:none">
            ${renderRowItem('Aplicar paleta a los iconos','Recolorea los iconos de las apps con el tono elegido',renderToggle('dyniconos',false))}
            <div class="dyn-tabs">
                <button class="dyn-tab on" data-tab="wall">${_tr('Colores del fondo')}</button>
                <button class="dyn-tab" data-tab="basic">${_tr('Colores básicos')}</button>
            </div>
            <div class="dyn-strips" id="dyn-strips"></div>
            <div class="dyn-label">${_tr('Estilo')}</div>
            <div class="dyn-styles" id="dyn-styles"></div>
            <button class="dyn-apply" id="dyn-apply" disabled>${_tr('Aplicar')}</button>
        </div>
    </div>`;


    if(window._navEpoch!==pageEpoch)return;
    c.innerHTML=h;

    // La vista previa con el fondo va desde el principio: antes solo salía al
    // abrir la galería y la tarjeta enseñaba nada más que el nombre del archivo.
    c.querySelector('#wp-preview-host').innerHTML=desktopPreview();
    let updatePreview=setupWallpaperPreviews(c,tauriInvoke,getAssetUrl);

    const pageGrid=c.querySelector('#wp-grid');

    // Drop any leftover FAB from a previous render of this page.
    document.getElementById('wp-add-fab')?.remove();

    // Add new wallpapers from disk → copy into ~/.local/share/wallpapers.
    const _addWallpapers=async()=>{
        try{
            const {open}=window.__TAURI__.dialog;
            const sel=await open({multiple:true,filters:[{name:'Imágenes',extensions:['png','jpg','jpeg','webp']}]});
            if(!sel)return;
            const paths=Array.isArray(sel)?sel:[sel];
            if(!paths.length)return;
            const res=JSON.parse(await tauriInvoke('add_wallpapers',{paths}));
            if(res.ok){
                toast(res.added>1?`${res.added} fondos añadidos`:'Fondo añadido','🖼️');
                if(!pageGrid.isConnected||window._navEpoch!==pageEpoch)return;
                await renderFondos(c); // re-render so new wallpapers appear
                document.getElementById('btn-change-wp')?.click(); // keep grid open
            }else{toast('Error al añadir fondo','❌');}
        }catch(e){toast('Error al añadir fondo','❌');}
    };

    // The "+" FAB must stay fixed to the viewport, but #app's page-enter/fadeIn
    // animation makes it a containing block for position:fixed (FAB would scroll
    // with content). So we mount the FAB on document.body and auto-remove it when
    // the wallpaper grid leaves the DOM (page navigation).
    const _mountFab=()=>{
        if(!pageGrid.isConnected||window._navEpoch!==pageEpoch||pageGrid.style.display==='none')return;
        if(document.getElementById('wp-add-fab'))return;
        const fab=document.createElement('button');
        fab.id='wp-add-fab';fab.className='wp-add-fab';
        fab.title=_tr('Añadir fondo de pantalla');
        fab.setAttribute('aria-label',_tr('Añadir fondo de pantalla'));
        fab.innerHTML=SVGI.plus;
        fab.addEventListener('click',_addWallpapers);
        document.body.appendChild(fab);
        // El router reemplaza los hijos de #app, que está dentro de
        // .detail-view. Observar solo .detail-view no detectaba la salida.
        const cleanup=()=>{fab.remove();obs.disconnect();};
        const obs=new MutationObserver(()=>{
            if(!pageGrid.isConnected)cleanup();
        });
        // La galería ahora vive dentro de la tarjeta, que no cambia al
        // navegar: se observa el contenedor de la página. #app y no `c`: `c`
        // es el Proxy de guardedContainer, observe() lo rechaza por no ser un
        // Node, y la excepción dejaba la galería en «Cargando…» para siempre.
        obs.observe(document.getElementById('app'),{childList:true});
        (window._pageCleanups ||= []).push(cleanup);
    };

    // Las dos mitades de una pareja de BookOS son el mismo fondo: en tema
    // oscuro el actual es `Dark/purple_dark.png` y la galería enseña
    // `Light/purple.png`. Comparando rutas salía dos veces y ninguna marcada.
    const _clave=p=>String(p).replace('/Dark/','/Light/').replace(/_dark(\.\w+)$/,'$1');
    const _mismoFondo=(a,b)=>!!a&&!!b&&_clave(a)===_clave(b);
    let loading=false,loaded=false,shown=0;
    const appendCards=()=>{
        const grid=pageGrid.querySelector('.wallpaper-grid');
        const batch=wallpapers.slice(shown,shown+24);
        grid.insertAdjacentHTML('beforeend',batch.map(w=>{
            const active=_mismoFondo(w.path,currentWp.path);
            return `<button type="button" class="wallpaper-card ${active?'active':''}" data-path="${esc(w.path)}" aria-pressed="${active}" aria-label="${esc(w.name)}"><img data-preview-path="${esc(w.thumbnail||w.path)}" class="wp-card-img" decoding="async" alt="" onerror="this.style.opacity='0'"><span class="wp-name">${esc(nombreFondo(w.path))}</span></button>`;
        }).join(''));
        shown+=batch.length;
        pageGrid.querySelector('[data-wp-more]').hidden=shown>=wallpapers.length;
        updatePreview?.observe(grid);
    };
    const openPicker=async()=>{
        if(loading||!pageGrid.isConnected||window._navEpoch!==pageEpoch)return;
        if(loaded){
            const hidden=pageGrid.style.display==='none';
            pageGrid.style.display=hidden?'block':'none';
            if(hidden){_mountFab();pageGrid.scrollIntoView({behavior:'instant',block:'nearest'});}
            else document.getElementById('wp-add-fab')?.remove();
            return;
        }
        loading=true;
        const button=c.querySelector('#btn-change-wp');
        button.disabled=true;
        pageGrid.style.display='block';
        pageGrid.innerHTML=renderLoading();
        _mountFab();
        try{
            wallpapers=JSON.parse(await tauriInvoke('get_wallpapers'));
            if(!pageGrid.isConnected||window._navEpoch!==pageEpoch)return;
            if(currentWp.path&&!wallpapers.some(w=>_mismoFondo(w.path,currentWp.path)))wallpapers.unshift(currentWp);
            pageGrid.innerHTML=`<div class="wallpaper-grid"></div><button type="button" class="wp-change-btn" data-wp-more>${_tr('Mostrar más')}</button>`;
            if(!wallpapers.length)pageGrid.querySelector('.wallpaper-grid').textContent=_tr('No se encontraron fondos de pantalla');
            updatePreview?.observe(pageGrid);
            appendCards();
            c.querySelector('#dyn-mockups')?.dispatchEvent(new Event('wp-preview-opened'));
            loaded=true;
            pageGrid.scrollIntoView({behavior:'instant',block:'nearest'});
        }catch(e){
            pageGrid.innerHTML=renderError('No se pudieron cargar los fondos de pantalla',{onRetry:openPicker});
        }finally{loading=false;button.disabled=false;}
    };
    c.querySelector('#btn-change-wp').addEventListener('click',openPicker);
    pageGrid.addEventListener('click',e=>{
        if(e.target.closest('[data-wp-more]'))appendCards();
    });
    // Apply the BookOS accent so it takes effect live.
    let applyingWallpaper=false;
    pageGrid.addEventListener('click',async e=>{
        const card=e.target.closest('.wallpaper-card');
        if(!card)return;
        if(applyingWallpaper||card.classList.contains('active'))return;
        applyingWallpaper=true;
        try{parseServiceResult(await tauriInvoke('set_wallpaper',{path:card.dataset.path}));}
        catch(e){toast('Error al aplicar fondo','❌');return;}
        finally{applyingWallpaper=false;}
        if(!card.isConnected)return;
        _dynSeedsCache={wallpaper:'',seeds:[]}; // el fondo cambió: la caché de semillas ya no vale
        pageGrid.querySelectorAll('.wallpaper-card').forEach(x=>{x.classList.remove('active');x.setAttribute('aria-pressed','false');});
        card.classList.add('active');
        card.setAttribute('aria-pressed','true');
        // Update preview immediately
        const previewImg=document.getElementById('wp-screen-img');
        currentWp.path=card.dataset.path;
        updatePreview(previewImg,card.dataset.path);
        toast('Fondo de pantalla aplicado','🖼️');
    });

    setupDynamicColor(currentWp.path);
}
// ── Paleta de colores ────────────────────────────────────────────────────
// Dos pasos, como en Android: se elige un color (del fondo o de la lista
// básica) y el estilo con el que se desarrolla en paleta completa. Elegir solo
// actualiza las maquetas de arriba; quien aplica de verdad es el botón.
const _DYN_STYLES=[['vibrant','Vibrante'],['expressive','Expresivo'],['muted','Suave'],['neutral','Neutro']];
// Semillas del último fondo leído — a nivel de módulo, no de la página, para
// que sobreviva a un ir-y-volver a Fondos. Sin esto, cada visita con la
// paleta ya activada volvía a lanzar ImageMagick (proceso + decodificar la
// imagen) aunque el fondo no hubiera cambiado desde la última vez.
let _dynSeedsCache={wallpaper:'',seeds:[]};
// Colores básicos: los mismos tonos que ofrece BookOS en sus esquemas fijos,
// para quien no quiera depender del fondo de pantalla.
const _DYN_BASIC=['#007AFF','#34C759','#FF9500','#FF3B30','#AF52DE','#FF2D92','#5AC8FA','#8E8E93'];

/** Tono HSL en grados de un #RRGGBB. Lo necesita set_icon_style, que tiñe por hue. */
function _dynHue(hex){
    const r=parseInt(hex.substr(1,2),16)/255,g=parseInt(hex.substr(3,2),16)/255,b=parseInt(hex.substr(5,2),16)/255;
    const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
    if(d===0)return 210;
    let h;
    if(mx===r)h=((g-b)/d+(g<b?6:0));else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;
    return h*60;
}

/** Tira vertical de tonos, como los swatches de Android. */
function _dynStrip(p,seed,active){
    const T=p.tones||{};
    const band=(ramp,i)=>(T[ramp]&&T[ramp][i])||'#888';
    // Cuatro bandas, no cinco: con la tira ya llenando el ancho del
    // contenedor, una banda de más solo la hacía verse recargada.
    // El tono 9 (95 de luminosidad) del neutro es casi blanco: contra una
    // tarjeta blanca/gris clara la última banda desaparecía. El 6 (70) se ve
    // siempre, tema claro u oscuro, fondo blanco o gris.
    const bands=[band('primary',7),band('tertiary',5),band('secondary',3),band('neutral',6)];
    return `<button class="dyn-strip${active?' on':''}" data-seed="${seed}">
        ${bands.map(c=>`<i style="background:${c}"></i>`).join('')}
        <span class="dyn-strip-check">✓</span>
    </button>`;
}

/** Tres maquetas con la paleta elegida: panel, lista y teclado numérico. */
function _dynMockups(r){
    if(!r)return '';
    const a=r.blue,a2=r['accent-2']||a,a3=r['accent-3']||a;
    const pill=(w,c)=>`<i class="mk-pill" style="width:${w}%;background:${c}"></i>`;
    return `
    <div class="dyn-mock" style="background:${r.bg}">
        <div class="mk-card" style="background:${r.card}">
            <div class="mk-row"><i class="mk-dot" style="background:${a}"></i>${pill(58,r.toff)}</div>
            <div class="mk-row"><i class="mk-dot" style="background:${a2}"></i>${pill(44,r.toff)}</div>
        </div>
        <div class="mk-card" style="background:${r.card}">
            <div class="mk-row"><i class="mk-dot" style="background:${a3}"></i>${pill(66,r.toff)}</div>
            <div class="mk-slider" style="background:${r.toff}"><i style="width:62%;background:${a}"></i></div>
            <div class="mk-slider" style="background:${r.toff}"><i style="width:38%;background:${a2}"></i></div>
        </div>
        <div class="mk-card" style="background:${r.card}">
            <div class="mk-row">${pill(48,r.toff)}<i class="mk-sw" style="background:${a}"></i></div>
            <div class="mk-row">${pill(60,r.toff)}<i class="mk-sw" style="background:${r.toff}"></i></div>
        </div>
    </div>
    <div class="dyn-mock" style="background:${r.bg}">
        <div class="mk-title" style="color:${a}">Ajustes</div>
        <div class="mk-card" style="background:${r.card}">
            ${[0,1,2].map(i=>`<div class="mk-row"><i class="mk-dot" style="background:${[a,a2,a3][i]}"></i>${pill([70,54,62][i],r.toff)}</div>`).join('')}
        </div>
        <div class="mk-card" style="background:${r.card}">
            ${[0,1,2,3].map(i=>`<div class="mk-row"><i class="mk-dot" style="background:${[a2,a3,a,a2][i]}"></i>${pill([58,66,50,62][i],r.toff)}</div>`).join('')}
        </div>
    </div>
    <div class="dyn-mock" style="background:${r.bg}">
        <div class="mk-num" style="color:${r.tx}">1260</div>
        <div class="mk-keys">
            ${[0,1,2,3,4,5,6,7].map(()=>`<i style="background:${r.card}"></i>`).join('')}
            <i style="background:${a}"></i>
        </div>
    </div>
    <div class="dyn-mock" style="background:${r.bg}">
        <div class="mk-card" style="background:${r.card}">
            <div class="mk-chips">
                <i class="mk-chip" style="background:${a}">Notas</i>
                <i class="mk-chip" style="background:${a2}">Fotos</i>
                <i class="mk-chip" style="background:${a3}">Reloj</i>
            </div>
        </div>
        <div class="mk-card" style="background:${r.card}">
            <div class="mk-row"><i class="mk-dot" style="background:${a}"></i>${pill(50,r.toff)}<i class="mk-toggle" style="background:${a}"></i></div>
            <div class="mk-row"><i class="mk-dot" style="background:${r.toff}"></i>${pill(62,r.toff)}<i class="mk-toggle off" style="background:${r.toff}"></i></div>
        </div>
    </div>`;
}

async function setupDynamicColor(current){
    const body=document.getElementById('dyn-body');
    const stripsEl=document.getElementById('dyn-strips');
    const stylesEl=document.getElementById('dyn-styles');
    const mockEl=document.getElementById('dyn-mockups');
    const applyBtn=document.getElementById('dyn-apply');
    if(!body||!stripsEl||!stylesEl||!mockEl||!applyBtn)return;

    // Keep the decorative palette mockups out of the DOM until the picker opens.
    let mockPalette=null,showMockups=false;
    const drawMockups=()=>{
        if(showMockups&&mockEl.isConnected)mockEl.innerHTML=_dynMockups(mockPalette?(isDark()?mockPalette.dark:mockPalette.light):null);
    };
    mockEl.addEventListener('wp-preview-opened',()=>{showMockups=true;drawMockups();});

    let seeds=[];                       // colores sacados del fondo
    let tab='wall';
    let sel={seed:'',style:'vibrant'};  // elección en curso (aún sin aplicar)
    let applied={seed:'',style:''};     // lo que está puesto de verdad
    let previewCache={};                // "seed|style" → paleta, para no repetir IPC

    const block=body.closest('#dyn-block');
    const show=on=>{body.style.display=on?'block':'none';block?.classList.toggle('dyn-off',!on);};
    const isDark=()=>document.documentElement.classList.contains('dark-mode');
    const colors=()=>tab==='wall'?seeds:_DYN_BASIC;

    const preview=async(seed,style)=>{
        const k=seed+'|'+style;
        if(previewCache[k])return previewCache[k];
        try{
            const p=JSON.parse(await tauriInvoke('dynamic_color_preview',{seed,style}));
            previewCache[k]=p;
            return p;
        }catch(e){return null;}
    };

    // Las maquetas y las tiras se redibujan juntas: comparten la misma paleta
    // y pedirla dos veces por separado dejaría un parpadeo entre ambas.
    const repaint=async()=>{
        const list=colors();
        const pals=await Promise.all(list.map(s=>preview(s,sel.style)));
        stripsEl.innerHTML=list.map((s,i)=>pals[i]?_dynStrip(pals[i],s,s===sel.seed):'').join('');
        stripsEl.querySelectorAll('.dyn-strip').forEach(b=>b.addEventListener('click',()=>{
            sel.seed=b.dataset.seed;
            repaint();
        }));

        const cur=await preview(sel.seed,sel.style);
        mockPalette=cur;
        drawMockups();
        // Previsualización de verdad: tiñe Ajustes entero mientras se elige,
        // no solo las maquetas de arriba. Nada se escribe a disco aquí, así
        // que otras apps de BookOS no se enteran hasta que se pulse "Aplicar".
        if(cur)previewPaletteCss(paletteToCss(cur));

        // Antes esto era un cuadro pálido casi vacío con tres puntos diminutos
        // flotando en medio — apenas se notaba la diferencia entre estilos. La
        // ficha ahora ES el color: mismas bandas que las tiras de semilla de
        // arriba, para comparar de un vistazo qué tan saturado sale cada uno.
        const styleCards=await Promise.all(_DYN_STYLES.map(async([id,label])=>{
            const p=await preview(sel.seed,id);
            if(!p)return '';
            const T=p.tones||{};
            const band=(ramp,i)=>(T[ramp]&&T[ramp][i])||'#888';
            // El tono 9 (95 de luminosidad) del neutro es casi blanco: contra una
    // tarjeta blanca/gris clara la última banda desaparecía. El 6 (70) se ve
    // siempre, tema claro u oscuro, fondo blanco o gris.
    const bands=[band('primary',7),band('tertiary',5),band('secondary',3),band('neutral',6)];
            return `<button class="dyn-style${id===sel.style?' on':''}" data-style="${id}">
                <span class="dyn-style-preview">${bands.map(c=>`<i style="background:${c}"></i>`).join('')}</span>
                <span class="dyn-style-label">${_tr(label)}</span>
            </button>`;
        }));
        stylesEl.innerHTML=styleCards.join('');
        stylesEl.querySelectorAll('.dyn-style').forEach(b=>b.addEventListener('click',()=>{
            sel.style=b.dataset.style;
            repaint();
        }));

        // El botón solo se enciende si hay algo nuevo que aplicar.
        applyBtn.disabled=!sel.seed||(sel.seed===applied.seed&&sel.style===applied.style);
    };

    // Extraer los colores del fondo pasa por ImageMagick: fuera del camino de
    // pintado de la página.
    const loadSeeds=async()=>{
        // Fondo sin cambiar desde la última lectura: nos ahorramos el viaje a
        // ImageMagick por completo.
        if(_dynSeedsCache.seeds.length&&_dynSeedsCache.wallpaper===current){
            seeds=_dynSeedsCache.seeds;
            if(!seeds.includes(sel.seed))sel.seed=seeds[0];
            return true;
        }
        stripsEl.innerHTML=`<span class="dyn-hint">${_tr('Leyendo el fondo de pantalla…')}</span>`;
        try{
            const r=JSON.parse(await tauriInvoke('dynamic_color_seeds',{path:null}));
            if(!r.ok||!r.seeds?.length){
                stripsEl.innerHTML=`<span class="dyn-hint">${_tr('No se pudo leer el fondo de pantalla')}</span>`;
                return false;
            }
            seeds=r.seeds;
            _dynSeedsCache={wallpaper:r.wallpaper||current,seeds};
            if(!seeds.includes(sel.seed))sel.seed=seeds[0];
            return true;
        }catch(e){
            stripsEl.innerHTML=`<span class="dyn-hint">${_tr('No se pudo leer el fondo de pantalla')}</span>`;
            return false;
        }
    };

    // Los iconos son ~8k SVG reescritos: se tocan solo al aplicar, y solo si el
    // interruptor lo pide.
    const applyIcons=async seed=>{
        if(!document.querySelector('[data-toggle="dyniconos"]')?.classList.contains('active'))return;
        try{
            await tauriInvoke('set_icon_style',{mode:'tinted',hue:_dynHue(seed),strength:45,
                dark:isDark(),tintBase:true,tintLogo:false,logoHue:_dynHue(seed)});
            localStorage.setItem('bookos_icon_style','tinted');
        }catch(e){}
    };

    applyBtn.addEventListener('click',async()=>{
        applyBtn.disabled=true;
        try{
            const r=JSON.parse(await tauriInvoke('dynamic_color_apply',{seed:sel.seed,style:sel.style}));
            if(r.ok){
                installPaletteCss(paletteToCss(r.palette));
                applied={seed:sel.seed,style:sel.style};
                applyIcons(sel.seed);
                toast(_tr('Paleta aplicada'));
                repaint();
            }else{toast(_tr('No se pudo aplicar la paleta'),'❌');repaint();}
        }catch(e){toast(_tr('No se pudo aplicar la paleta'),'❌');repaint();}
    });

    document.querySelectorAll('.dyn-tab').forEach(b=>b.addEventListener('click',()=>{
        document.querySelectorAll('.dyn-tab').forEach(x=>x.classList.remove('on'));
        b.classList.add('on');
        tab=b.dataset.tab;
        const list=colors();
        if(!list.includes(sel.seed))sel.seed=list[0]||'';
        repaint();
    }));

    let st=null;
    try{st=JSON.parse(await tauriInvoke('dynamic_color_state'));}catch(e){}
    if(st){
        sel={seed:st.seed||'',style:st.style||'vibrant'};
        applied={seed:st.seed||'',style:st.style||''};
        const tg=document.querySelector('[data-toggle="dyncolor"]');
        if(tg&&st.enabled){tg.classList.add('active');tg.setAttribute('aria-checked','true');}
        const ti=document.querySelector('[data-toggle="dyniconos"]');
        if(ti&&localStorage.getItem('bookos_dyn_icons')==='1'){ti.classList.add('active');ti.setAttribute('aria-checked','true');}
        show(!!st.enabled);
        if(st.enabled){ if(await loadSeeds()) await repaint(); }
    }

    // Deshace la previsualización si se sale de la página (o se apaga el
    // interruptor) sin pulsar "Aplicar": vuelve a lo que estaba puesto de
    // verdad, no a los colores por defecto de la app.
    const revertPreview=async()=>{
        if(applied.seed){
            const p=await preview(applied.seed,applied.style);
            installPaletteCss(p?paletteToCss(p):'');
        }else{
            installPaletteCss('');
        }
    };

    setupToggle('dyncolor',async on=>{
        show(on);
        // Era un interruptor aparte, «Acento automático»: hacía lo mismo desde
        // el mismo fondo, solo que para el escritorio. Ahora va con la paleta.
        await setSetting('ColorPalette',on?'true':'false');
        if(on){
            if(await loadSeeds())await repaint();
            try{await tauriInvoke('dynamic_color_set_enabled',{enabled:true});}catch(e){}
            try{parseServiceResult(await tauriInvoke('sync_desktop_accent'));}
            catch(e){toast('No se pudo cambiar el acento del escritorio','❌');}
        }else{
            try{await tauriInvoke('dynamic_color_set_enabled',{enabled:false});}catch(e){}
            installPaletteCss('');
            applied={seed:'',style:''};
            toast(_tr('Paleta de colores desactivada'));
        }
    });

    // #app owns this page; .detail-view only contains #app and does not
    // change when the router replaces a page.
    if(block?.parentElement){
        const leaveObs=new MutationObserver(()=>{
            if(!body.isConnected){
                if(sel.seed!==applied.seed||sel.style!==applied.style)revertPreview();
                leaveObs.disconnect();
            }
        });
        leaveObs.observe(block.parentElement,{childList:true});
    }
    // Solo recuerda la preferencia: teñir 8k iconos al pulsar un interruptor,
    // sin haber elegido paleta todavía, sería trabajo tirado.
    setupToggle('dyniconos',async on=>{
        localStorage.setItem('bookos_dyn_icons',on?'1':'0');
        if(on&&applied.seed)applyIcons(applied.seed);
    });
}

// ════════════════════════════════════════════════════════════════════════
// ── Modos y Rutinas ────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════

// ── SVG icon library (Lucide-style, stroke-based) ──
const SVGI = {
    // Mode icons (24px)
    moon:      `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
    briefcase: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>`,
    film:      `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/></svg>`,
    target:    `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
    // Trigger icons (18px)
    clock:     `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    plug:      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-5"/><path d="M9 7V2"/><path d="M15 7V2"/><rect x="6" y="7" width="12" height="10" rx="2"/></svg>`,
    batteryPlug:`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2"/><path d="M6 11h4"/></svg>`,
    batteryOff:`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2"/><line x1="6" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="6" y2="15"/></svg>`,
    wifi:      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></svg>`,
    wifiOff:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M10.72 5.08A16 16 0 0 1 22.56 9"/><path d="M5 12.55a11 11 0 0 1 5.17-2.39"/><path d="M10.71 16.11a6 6 0 0 1 4.12-.17"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></svg>`,
    bluetooth: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5"/></svg>`,
    batteryLow:`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2"/><path d="M6 11h2"/></svg>`,
    // Action icons (18px)
    zap:       `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    plane:     `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21 4 19 4s-2 1-3.5 2.5L11 8 2.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 7.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`,
    sun:       `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
    volume2:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
    bellOff:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`,
    moonSm:    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
    palette:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="1" fill="currentColor" stroke="none"/><circle cx="17.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="8.5" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="6.5" cy="12.5" r="1" fill="currentColor" stroke="none"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`,
    keyboard:  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/></svg>`,
    // UI icons
    plus:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    x:         `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    play:      `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    pencil:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    trash:     `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
    chevronR:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
};

const RB_TRIGGERS=[
    {type:'time',              svg:SVGI.clock,     label:'A una hora específica',     valueType:'time'},
    {type:'power_connected',   svg:SVGI.plug,      label:'Al conectar el cargador'},
    {type:'power_disconnected',svg:SVGI.batteryOff,label:'Al desconectar el cargador'},
    {type:'wifi_on',           svg:SVGI.wifi,      label:'Al activar el WiFi'},
    {type:'wifi_off',          svg:SVGI.wifiOff,   label:'Al desactivar el WiFi'},
    {type:'bt_on',             svg:SVGI.bluetooth, label:'Al activar Bluetooth'},
    {type:'bt_off',            svg:SVGI.bluetooth, label:'Al desactivar Bluetooth'},
    {type:'low_battery',       svg:SVGI.batteryLow,label:'Batería baja (<20%)'},
];
const RB_ACTIONS=[
    // ── Conexiones
    {type:'wifi',          svg:SVGI.wifi,     label:'WiFi',               valueType:'toggle_val', options:[['true',t('activate')],['false',t('deactivate')]], category:'Conexiones'},
    {type:'bluetooth',     svg:SVGI.bluetooth,label:'Bluetooth',          valueType:'toggle_val', options:[['true',t('activate')],['false',t('deactivate')]], category:'Conexiones'},
    {type:'airplane',      svg:SVGI.plane,    label:'Modo avión',         valueType:'toggle_val', options:[['true',t('activate')],['false',t('deactivate')]], category:'Conexiones'},
    // ── Pantalla
    {type:'brightness',    svg:SVGI.sun,      label:'Brillo de pantalla', valueType:'range', min:0, max:100, default:50, category:'Pantalla'},
    // ── Sonido
    {type:'volume',        svg:SVGI.volume2,  label:'Volumen del sistema', valueType:'range', min:0, max:100, default:50, category:'Sonido'},
    // ── Batería y rendimiento
    {type:'performance',   svg:SVGI.zap,      label:'Modo de rendimiento',valueType:'select', options:[['power-saver','Silencioso'],['balanced','Optimizado'],['performance','Rendimiento']], category:'Batería'},
    {type:'thermal',       svg:SVGI.zap,      label:'Perfil térmico',     valueType:'select', options:[['ahorro','Ahorro extremo (5W)'],['silencioso','Silencioso (8W)'],['optimizado','Optimizado (15W)'],['rendimiento','Rendimiento (28W)']], category:'Batería'},
    {type:'fan_mode',      svg:SVGI.zap,      label:'Modo ventilador',    valueType:'select', options:[['0','Automático'],['1','Silencioso'],['2','Normal']], category:'Batería'},
    {type:'charge_limit',  svg:SVGI.plug,     label:'Límite de carga',    valueType:'range', min:50, max:100, default:80, category:'Batería'},
    // ── Personalización
    {type:'theme',         svg:SVGI.palette,  label:'Tema del sistema',   valueType:'select', options:[['BreezeDark','Oscuro'],['BreezeLight','Claro']], category:'Personalización'},
    {type:'kbd_brightness',svg:SVGI.keyboard, label:'Brillo del teclado', valueType:'range', min:0, max:3, default:1, category:'Personalización'},
    // ── Notificaciones
    {type:'dnd',           svg:SVGI.bellOff,  label:'No molestar',        valueType:'toggle_val', options:[['true',t('activate')],['false',t('deactivate')]], category:'Notificaciones'},
];

function rbTriggerLabel(t){const d=RB_TRIGGERS.find(x=>x.type===t.type);return d?(d.label+(t.value?' — '+t.value:'')):t.type;}
function rbActionLabel(a){
    const d=RB_ACTIONS.find(x=>x.type===a.type);
    if(!d)return a.type;
    if(d.valueType==='range')return d.label+' — '+a.value+'%';
    if(d.valueType==='select'||d.valueType==='toggle_val'){const o=(d.options||[]).find(x=>x[0]===a.value);return d.label+' — '+(o?o[1]:a.value);}
    return d.label;
}

function renderRoutinesList(routines){
    if(!routines.length)return`<div class="detail-card routine-empty-card">
        <div class="routine-empty">
            <span class="routine-empty-title">No hay rutinas</span>
            <span class="routine-empty-sub">Automatiza brillo, tema, no molestar y más según hora o eventos</span>
            <button type="button" class="rb-new-btn" data-create-routine>${SVGI.plus}<span>Crear rutina</span></button>
        </div>
    </div>`;
    return`<div class="detail-card">`+routines.map(r=>`
        <div class="routine-item" data-id="${esc(r.id)}">
            <div class="routine-item-main">
                <div class="routine-item-info">
                    <span class="routine-item-name">${esc(r.name||'Rutina')}</span>
                    <span class="routine-item-desc">${esc(
                        (r.triggers[0]?rbTriggerLabel(r.triggers[0]):'Sin disparador')
                        +' → '
                        +(r.actions[0]?rbActionLabel(r.actions[0]):'Sin acción')
                        +(r.actions.length>1?' +'+( r.actions.length-1)+' más':'')
                    )}</span>
                </div>
                <div class="routine-item-actions">
                    <button class="rb-icon-btn rb-btn-run" data-run="${esc(r.id)}" title="Ejecutar">${SVGI.play}</button>
                    <button class="rb-icon-btn rb-btn-edit" data-edit="${esc(r.id)}" title="Editar">${SVGI.pencil}</button>
                    <button class="rb-icon-btn rb-btn-delete" data-delete="${esc(r.id)}" title="Eliminar">${SVGI.trash}</button>
                    <button type="button" class="toggle-switch ${r.enabled?'active':''}" data-routine-toggle="${esc(r.id)}" role="switch" aria-checked="${r.enabled?'true':'false'}"></button>
                </div>
            </div>
            <div class="routine-item-chips">
                ${r.triggers.slice(0,3).map(t=>`<span class="routine-chip routine-chip-trigger">${rbTriggerLabel(t)}</span>`).join('')}
                ${r.actions.slice(0,4).map(a=>`<span class="routine-chip routine-chip-action">${rbActionLabel(a)}</span>`).join('')}
            </div>
        </div>
    `).join('')+`</div>`;
}

function bindRoutineEvents(c){
    // Empty-state CTA (re-bound here so it works after deleting the last routine)
    c.querySelector('[data-create-routine]')?.addEventListener('click',()=>openRoutineBuilder(null,c));
    c.querySelectorAll('[data-routine-toggle]').forEach(el=>{
        el.addEventListener('click',async()=>{
            const routines=getRoutines(),r=routines.find(x=>x.id===el.dataset.routineToggle);
            if(!r)return;
            r.enabled=!r.enabled;
            saveRoutines(routines);
            el.classList.toggle('active',r.enabled);
            el.setAttribute('aria-checked',r.enabled?'true':'false');
            if(!r.enabled&&r.undo){
                const snap=_getSnap(r.id);
                if(snap){await restoreSnapshot(snap);_deleteSnap(r.id);toast(`"${r.name}" desactivada — estado restaurado`,'↩');}
                else{toast(`"${r.name}" desactivada`);}
            } else {
                toast(r.enabled?`"${r.name}" activada`:`"${r.name}" desactivada`);
            }
        });
    });
    c.querySelectorAll('[data-run]').forEach(btn=>{
        btn.addEventListener('click',async(e)=>{
            e.stopPropagation();
            const r=getRoutines().find(x=>x.id===btn.dataset.run);if(!r)return;
            btn.style.opacity='0.4';btn.disabled=true;
            await executeRoutine(r);
            btn.style.opacity='';btn.disabled=false;
            toast(`"${r.name}" ejecutada`,'✓');
        });
    });
    c.querySelectorAll('[data-edit]').forEach(btn=>{
        btn.addEventListener('click',(e)=>{
            e.stopPropagation();
            const r=getRoutines().find(x=>x.id===btn.dataset.edit);if(r)openRoutineBuilder(r,c);
        });
    });
    c.querySelectorAll('[data-delete]').forEach(btn=>{
        btn.addEventListener('click',(e)=>{
            e.stopPropagation();
            showDialog('Eliminar rutina','¿Seguro que quieres eliminar esta rutina?',{confirmText:'Eliminar',confirmClass:'danger',onConfirm:()=>{
                const routines=getRoutines().filter(x=>x.id!==btn.dataset.delete);saveRoutines(routines);
                const list=document.getElementById('routines-list');
                if(list){list.innerHTML=renderRoutinesList(routines);bindRoutineEvents(c);}
                toast('Rutina eliminada');
            }});
        });
    });
}

// ── Desktop Routine Builder Dialog ──────────────────────────────────────

function openRoutineBuilder(existing,mainContainer){
    const isEdit=!!existing;
    let routine=existing?JSON.parse(JSON.stringify(existing)):{id:crypto.randomUUID(),name:'',enabled:true,undo:true,triggers:[],actions:[]};
    if(routine.undo===undefined)routine.undo=true;
    const ov=document.createElement('div');ov.className='rb-overlay';
    const render=()=>{
        ov.innerHTML=`<div class="rb-dialog">
            <div class="rb-dialog-header">
                <span class="rb-dialog-title">${isEdit?'Editar rutina':'Nueva rutina'}</span>
                <button class="rb-dialog-close" id="rb-cancel" title="Cerrar">${SVGI.x}</button>
            </div>
            <div class="rb-dialog-namebar">
                <input class="rb-name-input" id="rb-name" placeholder="Nombre de la rutina…" value="${esc(routine.name)}" maxlength="48" spellcheck="false">
            </div>
            <div class="rb-dialog-body">
                <div class="rb-col">
                    <div class="rb-col-header">
                        <span class="rb-col-label rb-col-label-if">Si</span>
                        <span class="rb-col-hint">Condición de activación</span>
                    </div>
                    <div class="rb-col-items">
                        ${routine.triggers.length?routine.triggers.map((t,i)=>{
                            const d=RB_TRIGGERS.find(x=>x.type===t.type);
                            return`<div class="rb-item rb-item-trigger">
                                <span class="rb-item-icon rb-icon-blue">${d?.svg||SVGI.zap}</span>
                                <span class="rb-item-label">${rbTriggerLabel(t)}</span>
                                <button class="rb-item-rm" data-rm-trigger="${i}" title="Eliminar">${SVGI.x}</button>
                            </div>`;
                        }).join(''):''}
                        <button class="rb-add-row" id="rb-add-trigger">${SVGI.plus}<span>Añadir condición</span></button>
                    </div>
                </div>
                <div class="rb-col-divider"></div>
                <div class="rb-col">
                    <div class="rb-col-header">
                        <span class="rb-col-label rb-col-label-then">Entonces</span>
                        <span class="rb-col-hint">Acciones a ejecutar</span>
                    </div>
                    <div class="rb-col-items">
                        ${routine.actions.length?routine.actions.map((a,i)=>{
                            const d=RB_ACTIONS.find(x=>x.type===a.type);
                            return`<div class="rb-item rb-item-action">
                                <span class="rb-item-icon rb-icon-green">${d?.svg||SVGI.zap}</span>
                                <span class="rb-item-label">${rbActionLabel(a)}</span>
                                <button class="rb-item-rm" data-rm-action="${i}" title="Eliminar">${SVGI.x}</button>
                            </div>`;
                        }).join(''):''}
                        <button class="rb-add-row" id="rb-add-action">${SVGI.plus}<span>Añadir acción</span></button>
                    </div>
                </div>
            </div>
            <div class="rb-undo-section">
                <div class="rb-undo-row">
                    <div class="rb-undo-info">
                        <span class="rb-undo-label">Restaurar al finalizar</span>
                        <span class="rb-undo-hint">Revierte los cambios cuando la condición deje de cumplirse</span>
                    </div>
                    <div class="toggle-switch ${routine.undo?'active':''}" id="rb-undo-toggle"></div>
                </div>
            </div>
            <div class="rb-dialog-footer">
                <button class="rb-footer-cancel" id="rb-footer-cancel">Cancelar</button>
                <button class="rb-footer-save" id="rb-footer-save">Guardar rutina</button>
            </div>
        </div>`;
        bind();
    };
    const close=()=>ov.remove();
    const save=()=>{
        routine.name=(ov.querySelector('#rb-name')?.value||'').trim()||'Mi rutina';
        const routines=getRoutines(),idx=routines.findIndex(x=>x.id===routine.id);
        if(idx>=0)routines[idx]=routine;else routines.push(routine);
        saveRoutines(routines);
        const list=document.getElementById('routines-list');
        if(list){list.innerHTML=renderRoutinesList(routines);bindRoutineEvents(mainContainer);}
        close();toast(isEdit?'Rutina actualizada':'Rutina creada','✓');
    };
    function bind(){
        ov.querySelector('#rb-cancel')?.addEventListener('click',close);
        ov.querySelector('#rb-footer-cancel')?.addEventListener('click',close);
        ov.querySelector('#rb-footer-save')?.addEventListener('click',()=>{routine.name=(ov.querySelector('#rb-name')?.value||'').trim()||'Mi rutina';save();});
        ov.querySelector('#rb-name')?.addEventListener('input',e=>{routine.name=e.target.value;});
        ov.querySelector('#rb-add-trigger')?.addEventListener('click',()=>showTriggerPicker(routine,render,ov));
        ov.querySelector('#rb-add-action')?.addEventListener('click',()=>showActionPicker(routine,render,ov));
        ov.querySelectorAll('[data-rm-trigger]').forEach(b=>b.addEventListener('click',()=>{routine.triggers.splice(parseInt(b.dataset.rmTrigger),1);render();}));
        ov.querySelectorAll('[data-rm-action]').forEach(b=>b.addEventListener('click',()=>{routine.actions.splice(parseInt(b.dataset.rmAction),1);render();}));
        ov.querySelector('#rb-undo-toggle')?.addEventListener('click',()=>{routine.undo=!routine.undo;ov.querySelector('#rb-undo-toggle')?.classList.toggle('active',routine.undo);});
        ov.addEventListener('click',e=>{if(e.target===ov)close();});
    }
    document.body.appendChild(ov);render();
    requestAnimationFrame(()=>ov.querySelector('#rb-name')?.focus());
}

// ── Picker popover (desktop centered dialog) ────────────────────────────

function rbPickerDialog(title,bodyHTML,onClose){
    const ov=document.createElement('div');ov.className='rb-picker-overlay';
    ov.innerHTML=`<div class="rb-picker-dialog">
        <div class="rb-picker-header">
            <span class="rb-picker-title">${title}</span>
            <button class="rb-dialog-close" id="pk-close">${SVGI.x}</button>
        </div>
        <div class="rb-picker-body">${bodyHTML}</div>
    </div>`;
    document.body.appendChild(ov);
    const close=(val)=>{ov.remove();onClose(val);};
    ov.querySelector('#pk-close').addEventListener('click',()=>close(null));
    ov.addEventListener('click',e=>{if(e.target===ov)close(null);});
    return{ov,close};
}

function showTriggerPicker(routine,rebuild){
    const {ov}=rbPickerDialog('Añadir condición',
        `<div class="rb-pick-list">${RB_TRIGGERS.map(t=>`
            <button class="rb-pick-item" data-type="${t.type}">
                <span class="rb-pick-icon rb-icon-blue">${t.svg}</span>
                <span class="rb-pick-label">${t.label}</span>
                ${SVGI.chevronR}
            </button>`).join('')}</div>`,
        ()=>{}
    );
    ov.querySelectorAll('.rb-pick-item').forEach(item=>item.addEventListener('click',()=>{
        const type=item.dataset.type,def=RB_TRIGGERS.find(x=>x.type===type);
        ov.remove();
        if(def?.valueType==='time'){showTimeInput(val=>{if(val!==null){routine.triggers.push({type,value:val});rebuild();}});}
        else{routine.triggers.push({type});rebuild();}
    }));
}

function showActionPicker(routine,rebuild){
    // Group actions by category
    const categories=[...new Set(RB_ACTIONS.map(a=>a.category||'Otros'))];
    let listHTML='';
    categories.forEach(cat=>{
        const items=RB_ACTIONS.filter(a=>(a.category||'Otros')===cat);
        if(!items.length)return;
        listHTML+=`<div class="rb-pick-cat">${cat}</div>`;
        listHTML+=items.map(a=>`
            <button class="rb-pick-item" data-type="${a.type}">
                <span class="rb-pick-icon rb-icon-green">${a.svg}</span>
                <span class="rb-pick-label">${a.label}</span>
                ${SVGI.chevronR}
            </button>`).join('');
    });
    const {ov}=rbPickerDialog('Añadir acción',
        `<div class="rb-pick-list">${listHTML}</div>`,
        ()=>{}
    );
    ov.querySelectorAll('.rb-pick-item').forEach(item=>item.addEventListener('click',()=>{
        const type=item.dataset.type,def=RB_ACTIONS.find(x=>x.type===type);ov.remove();
        if(def?.valueType==='range')showRangeInput(def,val=>{if(val!==null){routine.actions.push({type,value:String(val)});rebuild();}});
        else if(def?.valueType==='select'||def?.valueType==='toggle_val')showSelectInput(def,val=>{if(val!==null){routine.actions.push({type,value:val});rebuild();}});
        else{routine.actions.push({type,value:'true'});rebuild();}
    }));
}

function showTimeInput(cb){
    const {ov}=rbPickerDialog('Hora de activación',
        `<div class="rb-value-body">
            <input type="time" id="rb-time-val" class="rb-time-input" value="08:00">
            <div class="rb-value-btns">
                <button class="rb-footer-cancel" id="tv-cancel">Cancelar</button>
                <button class="rb-footer-save" id="tv-ok">Añadir</button>
            </div>
        </div>`,
        ()=>cb(null)
    );
    ov.querySelector('#tv-cancel').addEventListener('click',()=>{ov.remove();cb(null);});
    ov.querySelector('#tv-ok').addEventListener('click',()=>{const v=ov.querySelector('#rb-time-val').value;ov.remove();cb(v);});
}

function showRangeInput(def,cb){
    const pct=def.default+'%';
    const {ov}=rbPickerDialog(def.label,
        `<div class="rb-value-body">
            <div class="rb-range-wrap">
                <div class="slider-container">
                    <input type="range" class="filled" id="rb-range-val" min="${def.min}" max="${def.max}" value="${def.default}" style="--fill:${pct}">
                    <span class="slider-label" id="rb-range-lbl">${def.default}${def.max===2?'':' %'}</span>
                </div>
            </div>
            <div class="rb-value-btns">
                <button class="rb-footer-cancel" id="rv-cancel">Cancelar</button>
                <button class="rb-footer-save" id="rv-ok">Añadir</button>
            </div>
        </div>`,
        ()=>cb(null)
    );
    const s=ov.querySelector('#rb-range-val'),lbl=ov.querySelector('#rb-range-lbl');
    s.addEventListener('input',()=>{const p=((s.value-s.min)/(s.max-s.min))*100;s.style.setProperty('--fill',p+'%');lbl.textContent=s.value+(def.max===2?'':' %');});
    ov.querySelector('#rv-cancel').addEventListener('click',()=>{ov.remove();cb(null);});
    ov.querySelector('#rv-ok').addEventListener('click',()=>{const v=s.value;ov.remove();cb(v);});
}

function showSelectInput(def,cb){
    const {ov}=rbPickerDialog(def.label,
        `<div class="rb-pick-list">${def.options.map(([val,label])=>`
            <button class="rb-pick-item" data-val="${esc(val)}">
                <span class="rb-pick-icon rb-icon-green">${def.svg}</span>
                <span class="rb-pick-label">${label}</span>
                ${SVGI.chevronR}
            </button>`).join('')}</div>`,
        ()=>cb(null)
    );
    ov.querySelectorAll('.rb-pick-item').forEach(item=>item.addEventListener('click',()=>{const v=item.dataset.val;ov.remove();cb(v);}));
}

export async function renderModos(c){
    c.innerHTML=renderHeader(t('hdr_modes_routines'))+renderSkeleton(2);
    let h=renderHeader(t('hdr_modes_routines'));

    // Mode cards — 4-column horizontal row
    const modes=[
        {id:'sleep', svg:SVGI.moon,      name:'Descanso',      desc:'Tema oscuro, no molestar', color:'#7b61ff'},
        {id:'work',  svg:SVGI.briefcase, name:'Trabajo',        desc:'Máximo brillo, enfocado',  color:'#0a84ff'},
        {id:'movie', svg:SVGI.film,      name:'Cine',           desc:'Tema oscuro, volumen alto',color:'#ff3b30'},
        {id:'focus', svg:SVGI.target,    name:'Concentración',  desc:'Sin distracciones',        color:'#ff9500'},
    ];
    h+=`<div class="modos-grid">`+modes.map(m=>`
        <div class="modo-card" data-modo="${m.id}">
            <div class="modo-icon" style="background:${m.color}18;color:${m.color}">${m.svg}</div>
            <div class="modo-info">
                <span class="modo-name">${m.name}</span>
                <span class="modo-desc">${m.desc}</span>
            </div>
        </div>`).join('')+`</div>`;

    const routines=getRoutines();
    h+=renderSection(t('sec_routines'))+`<div id="routines-list">${renderRoutinesList(routines)}</div>`;
    h+=`<div class="routine-add-wrap">
        <button class="rb-new-btn" id="btn-create-routine">${SVGI.plus}<span>Nueva rutina</span></button>
    </div>`;
    c.innerHTML=h;

    // Restore saved active mode
    getSetting('active_mode','').then(am=>{
        if(am)document.querySelector(`.modo-card[data-modo="${am}"]`)?.classList.add('active');
    });

    document.querySelectorAll('.modo-card').forEach(btn=>{
        btn.addEventListener('click',async()=>{
            const id=btn.dataset.modo;
            // Use the user's configured light/dark schemes (theme schedule) so
            // modes don't yank a BookOS-themed desktop over to Breeze.
            let lightScheme='BreezeLight',darkScheme='BreezeDark';
            try{
                const s=JSON.parse(await tauriInvoke('get_theme_schedule'));
                if(s.light_theme)lightScheme=s.light_theme;
                if(s.dark_theme)darkScheme=s.dark_theme;
            }catch(e){}
            let theme=lightScheme,dnd=false,brightness=50;
            if(id==='sleep'){theme=darkScheme;dnd=true;brightness=20;}
            if(id==='work'){theme=lightScheme;dnd=true;brightness=90;}
            if(id==='movie'){theme=darkScheme;dnd=true;brightness=60;}
            if(id==='focus'){theme=lightScheme;dnd=true;brightness=70;}
            document.querySelectorAll('.modo-card').forEach(x=>x.classList.remove('active'));
            btn.classList.add('active');
            btn.style.opacity='0.6';
            try{
                await Promise.all([
                    tauriInvoke('set_color_scheme',{scheme:theme}).catch(()=>{}),
                    tauriInvoke('toggle_dnd',{enable:dnd}).catch(()=>{}),
                    tauriInvoke('set_brightness',{value:brightness}).catch(()=>{}),
                ]);
                document.documentElement.className=/dark/i.test(theme)?'dark-mode':'light-mode';
            }finally{btn.style.opacity='';}
            setSetting('active_mode',id);
            toast(`Modo ${btn.querySelector('.modo-name').textContent} activado`,'✓');
        });
    });

    bindRoutineEvents(c);
    document.getElementById('btn-create-routine')?.addEventListener('click',()=>openRoutineBuilder(null,c));
}

// ════════════════════════════════════════════════════════════════════════
// ── Aplicaciones Predeterminadas (NEW) ─────────────────────────────────
// ════════════════════════════════════════════════════════════════════════
export async function renderAplicaciones(c){
    c.innerHTML=renderHeader(t('hdr_apps'))+renderSkeleton(3);
    let defaults={};
    try{defaults=JSON.parse(await tauriInvoke('get_default_apps'));}catch(e){}

    // Per-role metadata: fallback glyph + label.
    const roleMeta={
        browser:{glyph:'🌐',label:_tr('Navegador web')},
        email:{glyph:'✉️',label:_tr('Cliente de correo')},
        filemanager:{glyph:'📁',label:_tr('Gestor de archivos')},
        image:{glyph:'🖼️',label:_tr('Imágenes')},
        video:{glyph:'🎬',label:_tr('Vídeo')},
        audio:{glyph:'🎵',label:_tr('Audio')},
        pdf:{glyph:'📄',label:_tr('Documentos PDF')},
        text:{glyph:'📝',label:_tr('Archivos de texto')},
        archive:{glyph:'🗜️',label:_tr('Archivos comprimidos')},
    };
    const order=['browser','email','filemanager','image','video','audio','pdf','text','archive'];

    // Render an app icon: real .desktop Icon if it's an absolute path, else
    // a tinted glyph tile as fallback.
    const appIconHtml=(cur,glyph)=>{
        const ic=appIconUrl(cur&&cur.id,cur&&cur.icon);
        if(ic){
            return `<img src="${ic}" class="app-def-img" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'app-def-glyph',textContent:'${glyph}'}))">`;
        }
        return `<div class="app-def-glyph">${glyph}</div>`;
    };

    const buildRows=()=>order.map(key=>{
        const cur=defaults[key]||{};
        const m=roleMeta[key];
        const curName=cur.name||_tr('No configurada');
        return `<div class="app-def-row" data-role="${key}">
            <div class="app-def-icon">${appIconHtml(cur,m.glyph)}</div>
            <div class="app-def-info">
                <span class="app-def-role">${m.label}</span>
                <span class="app-def-current">${esc(curName)}</span>
            </div>
            <svg class="app-def-chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>`;
    }).join('');

    const render=()=>{
        c.innerHTML=renderHeader(t('hdr_apps'))
            +renderSection(t('sec_default_apps'))
            +`<div class="detail-card app-def-list">${buildRows()}</div>`
            +`<p class="app-def-hint">${_tr('Toca una categoría para elegir la app predeterminada.')}</p>`;
        wire();
    };

    const openPicker=async(role)=>{
        const m=roleMeta[role];
        let apps=[];
        try{apps=JSON.parse(await tauriInvoke('list_apps_for_role',{role}));}catch(e){}
        const curId=(defaults[role]||{}).id||'';
        if(!apps.length){
            showDialog(m.label,_tr('No se encontraron aplicaciones para esta categoría.'),
                {confirmText:null,cancelText:_tr('Cerrar'),onCancel:()=>{}});
            return;
        }
        const list=apps.map(a=>{
            const active=a.id===curId;
            const _ic=appIconUrl(a.id,a.icon);
            const icon=_ic
                ? `<img src="${_ic}" class="app-pick-img" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'app-pick-glyph',textContent:'${m.glyph}'}))">`
                : `<div class="app-pick-glyph">${m.glyph}</div>`;
            return `<button class="app-pick-row${active?' active':''}" data-id="${esc(a.id)}">
                ${icon}
                <span class="app-pick-name">${esc(a.name)}</span>
                ${active?'<svg viewBox="0 0 20 20" width="18" height="18" fill="none"><path d="M5 10l3 3 7-7" stroke="var(--blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>':''}
            </button>`;
        }).join('');
        showDialog(`${_tr('Elegir')} · ${m.label}`, `<div class="app-pick-list">${list}</div>`,
            {confirmText:null,cancelText:_tr('Cerrar'),onCancel:()=>{}});
        // Wire the picker rows (the dialog is appended to body).
        document.querySelectorAll('.bk-overlay .app-pick-row').forEach(btn=>{
            btn.addEventListener('click',async()=>{
                const id=btn.dataset.id;
                document.querySelector('.bk-overlay')?.remove();
                try{
                    const r=JSON.parse(await tauriInvoke('set_default_app',{role,desktopId:id}));
                    if(r.ok){
                        // Refresh from system to show the new default.
                        try{defaults=JSON.parse(await tauriInvoke('get_default_apps'));}catch(e){}
                        render();
                        toast(_tr('App predeterminada actualizada'),'✅');
                    } else toast(_tr('No se pudo cambiar'),'❌');
                }catch(e){toast(_tr('No se pudo cambiar'),'❌');}
            });
        });
    };

    function wire(){
        c.querySelectorAll('.app-def-row').forEach(row=>{
            row.addEventListener('click',()=>openPicker(row.dataset.role));
        });
    }

    render();
}

// ════════════════════════════════════════════════════════════════════════
// ── Accesibilidad ───────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════
export async function renderAccesibilidad(c){
return desktop.accessibility(c);
}

// ════════════════════════════════════════════════════════════════════════
// ── Funciones Avanzadas / Labs ──────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════
export async function renderAvanzadas(c){
return desktop.advanced(c);
}

// ════════════════════════════════════════════════════════════════════════
// ── Placeholder ────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════
// ── Dispositivos conectados ────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════
const _SVG_HEADPHONES=`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>`;
const _SVG_SHARE=`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;

// Helper for Dispositivos rows with icon
function _devRow({id='',icon,iconColor='var(--tx2)',title,subtitle,subtitleId='',right='',extraClass='',extraStyle=''}){
    return `<div class="detail-item detail-item-row${extraClass?' '+extraClass:''}"${id?` id="${id}"`:''}${extraStyle?` style="${extraStyle}"`:''}>`+
        `<div style="flex-shrink:0;width:36px;height:36px;display:flex;align-items:center;justify-content:center;color:${iconColor}">${icon}</div>`+
        `<div style="flex:1;min-width:0;padding:0 12px"><span class="dt" style="display:block">${title}</span>${subtitle!==undefined&&subtitle!==''?`<span class="ds" style="display:block;margin-top:3px"${subtitleId?` id="${subtitleId}"`:''}>${subtitle}</span>`:''}</div>`+
        `${right}</div>`;
}

// ── Buds detail sub-page ────────────────────────────────────────────────
// EQ preset index → label mapping (matches Rust buds.rs EqPresets)
const _BUDS_EQ_PRESETS = [
    {idx:0, key:'bass',   label:'Graves'},
    {idx:1, key:'soft',   label:'Suave'},
    {idx:2, key:'dynamic',label:'Dinámico'},
    {idx:3, key:'clear',  label:'Nítido'},
    {idx:4, key:'treble', label:'Agudos'},
];
// ANC mode index → label
const _BUDS_ANC_MODES = [
    {idx:0, label:'Apagado'},
    {idx:1, label:'Reducción de ruido'},
    {idx:2, label:'Sonido ambiente'},
    {idx:3, label:'Adaptativo'},
];

// ── Connection popup modal (Samsung-style) ──
function _showBudsConnectModal(name, phase){
    let m=document.getElementById('buds-conn-modal');
    if(!m){
        m=document.createElement('div');
        m.id='buds-conn-modal';
        m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(8px);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn .2s ease';
        document.body.appendChild(m);
    }
    const icon = phase==='ok'
        ? '<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>'
        : phase==='fail'
        ? '<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
        : `<div style="width:52px;height:52px;border:4px solid var(--brd);border-top-color:var(--blue);border-radius:50%;animation:spin 1s linear infinite"></div>`;
    const label = phase==='ok'?'Conectado':phase==='fail'?'No se pudo conectar':'Conectando...';
    m.innerHTML=`<div style="background:var(--card);border-radius:20px;padding:28px 32px;min-width:260px;display:flex;flex-direction:column;align-items:center;gap:14px;box-shadow:0 12px 40px rgba(0,0,0,.3)">
        ${icon}
        <div style="font-size:16px;font-weight:600;color:var(--tx);text-align:center">${esc(name)}</div>
        <div style="font-size:13px;color:var(--tx2)">${label}</div>
    </div>`;
    if(phase==='ok'||phase==='fail'){setTimeout(()=>m.remove(),1200);}
}

// ── Buds: Administrar conexiones submenu ───────────────────────────────
async function _renderBudsConn(c, device){
    if(window.pushSubNav) window.pushSubNav(()=>_renderBudsDetail(c,device));
    c.innerHTML=renderHeader('Administrar conexiones')+renderSkeleton(2);
    let prefs={eq_enabled:false,eq_preset:2,anc_mode:0,touchpad_locked:false,auto_reconnect:false};
    try{prefs=JSON.parse(await tauriInvoke('buds_get_prefs',{mac:device.mac}));}catch(e){}

    let h=renderHeader('Administrar conexiones');
    const ep=(await getSetting('buds_easypair_'+device.mac,'false'))==='true';
    h+=renderCard([
        renderRowItem('Reconexión automática','Conecta los buds cuando estén cerca y encendidos',renderToggle('buds-auto-rc',prefs.auto_reconnect)),
        renderRowItem('Conexión fácil con auriculares','Cambia entre dispositivos cercanos sin desemparejar',renderToggle('buds-easypair',ep)),
    ]);
    h+=renderSection('Estado guardado');
    h+=renderCard([
        renderRowItem('Ecualizador',prefs.eq_enabled?(_BUDS_EQ_PRESETS.find(p=>p.idx===prefs.eq_preset)?.label||'Estándar'):'Plano',''),
        renderRowItem('ANC',(_BUDS_ANC_MODES.find(m=>m.idx===prefs.anc_mode)?.label||'Desactivado'),''),
        renderRowItem('Touchpad',prefs.touchpad_locked?'Bloqueado':'Activo',''),
    ]);
    c.innerHTML=h;
    setupToggle('buds-auto-rc',async a=>{
        try{await tauriInvoke('buds_set_auto_reconnect',{mac:device.mac,enable:a});}catch(e){}
        toast(a?'Reconexión automática activada':'Reconexión automática desactivada','🔁');
    });
    setupToggle('buds-easypair',async a=>{
        try{await tauriInvoke('buds_set_easy_pairing',{enable:a});}catch(e){toast('Error: ¿buds conectados?');return;}
        setSetting('buds_easypair_'+device.mac,a?'true':'false');
        toast(a?'Conexión fácil activada':'Conexión fácil desactivada','🔗');
    });
}

// ── Buds: Acerca de los auriculares ────────────────────────────────────
async function _renderBudsAbout(c, device, statusInit, modelTag, fwOld){
    if(window.pushSubNav) window.pushSubNav(()=>_renderBudsDetail(c,device));
    c.innerHTML=renderHeader('Acerca de los auriculares')+renderSkeleton(2);
    // Request fresh info via SPP
    try{await tauriInvoke('buds_request_info');}catch(e){}
    // Poll status up to 2s for fw/serial
    let st=statusInit||{};
    for(let i=0;i<10;i++){
        try{st=JSON.parse(await tauriInvoke('buds_get_status'));}catch(e){}
        if(st.fw_left||st.serial)break;
        await new Promise(r=>setTimeout(r,200));
    }
    const swVer=(window.__BOOKOS_APP_VER__||'BookOS Settings');
    let h=renderHeader('Acerca de los auriculares');
    h+=renderSection('Dispositivo');
    h+=renderCard([
        renderRowItem('Modelo',esc(st.model||modelTag||'Galaxy Buds'),''),
        renderRowItem('Nombre Bluetooth',esc(device.name||'—'),''),
        renderRowItem('Dirección MAC',esc(device.mac||'—'),''),
    ]);
    h+=renderSection('Firmware');
    h+=renderCard([
        renderRowItem('Auricular izquierdo',esc(st.fw_left||fwOld||'—'),''),
        renderRowItem('Auricular derecho',esc(st.fw_right||fwOld||'—'),''),
        renderRowItem('Número de serie',esc(st.serial||'—'),''),
    ]);
    h+=renderSection('Estado');
    h+=renderCard([
        renderRowItem('Batería Izquierda',(st.battery_l||0)+'%',''),
        renderRowItem('Batería Derecha',(st.battery_r||0)+'%',''),
        renderRowItem('Batería Estuche',(st.battery_case||0)+'%',''),
    ]);
    h+=renderSection('Software');
    h+=renderCard([
        renderRowItem('Cliente',esc(swVer),''),
        renderRowItem('Protocolo SPP','Galaxy Buds nativo (BookOS)',''),
    ]);
    c.innerHTML=h;
}

// ── Buds: Fit test (Adaptar a tus oídos) ───────────────────────────────
async function _renderBudsFitTest(c, device){
    if(window.pushSubNav) window.pushSubNav(()=>_renderBudsDetail(c,device));
    const fitLabel=v=>v===0?'Buen ajuste':v===1?'Ajuste flojo':v===2?'Mal ajuste':'—';
    const fitColor=v=>v===0?'#34c759':v===1?'#ff9500':v===2?'#ff3b30':'var(--tx2)';
    let h=renderHeader('Adaptar a tus oídos');
    h+=`<div class="detail-card" style="padding:24px;text-align:center">
        <p style="font-size:14px;color:var(--tx2);margin:0 0 18px;line-height:1.4">Coloca los auriculares en tus oídos. El test reproducirá un tono y medirá el sello.</p>
        <div style="display:flex;justify-content:center;gap:40px;margin:24px 0">
            <div><div style="font-size:11px;color:var(--tx2);margin-bottom:6px">Izquierdo</div><div id="fit-l" style="font-size:18px;font-weight:600;color:var(--tx2)">—</div></div>
            <div><div style="font-size:11px;color:var(--tx2);margin-bottom:6px">Derecho</div><div id="fit-r" style="font-size:18px;font-weight:600;color:var(--tx2)">—</div></div>
        </div>
        <button id="fit-start" class="btn btn-primary" style="width:100%;max-width:240px">Iniciar prueba</button>
    </div>`;
    c.innerHTML=h;
    let polling=null;
    document.getElementById('fit-start')?.addEventListener('click',async()=>{
        const btn=document.getElementById('fit-start');
        btn.disabled=true;btn.textContent='Probando…';
        try{await tauriInvoke('buds_fit_test_start');}catch(e){toast('Error iniciando prueba');btn.disabled=false;btn.textContent='Iniciar prueba';return;}
        let elapsed=0;
        polling=setInterval(async()=>{
            elapsed+=500;
            try{
                const st=JSON.parse(await tauriInvoke('buds_get_status'));
                if(st.fit_l!==255||st.fit_r!==255){
                    document.getElementById('fit-l').textContent=fitLabel(st.fit_l);
                    document.getElementById('fit-l').style.color=fitColor(st.fit_l);
                    document.getElementById('fit-r').textContent=fitLabel(st.fit_r);
                    document.getElementById('fit-r').style.color=fitColor(st.fit_r);
                    clearInterval(polling);
                    try{await tauriInvoke('buds_fit_test_stop');}catch(e){}
                    btn.disabled=false;btn.textContent='Repetir prueba';
                }
            }catch(e){}
            if(elapsed>=15000){clearInterval(polling);try{await tauriInvoke('buds_fit_test_stop');}catch(e){}btn.disabled=false;btn.textContent='Repetir prueba';}
        },500);
    });
}

async function _renderBudsDetail(c, device){
    if(!device){console.error('[Buds] device es undefined');return;}
    c.innerHTML=renderHeader(device.name||'Buds')+renderSkeleton(2);

    // Try SPP connection to get real buds status
    let status = {connected:false,battery_l:0,battery_r:0,battery_case:0,anc_mode:0,eq_preset:2,eq_enabled:true,wearing_l:false,wearing_r:false,touchpad_locked:false,model:'',error:null};
    let sppConnected = false;
    let gbcAvail = false;
    let gbcDev = null;
    if(device.connected){
        // Fast path: SPP session already alive → use cached status, skip modal
        let alreadyAlive=false;
        try{
            const s=JSON.parse(await tauriInvoke('buds_get_status'));
            if(s&&s.connected){status=s;sppConnected=true;alreadyAlive=true;}
        }catch(e){}

        if(!alreadyAlive){
            _showBudsConnectModal(device.name||'Buds','connecting');
            try{
                const r = JSON.parse(await tauriInvoke('buds_connect',{mac:device.mac}));
                if(r.connected){status=r;sppConnected=true;localStorage.setItem('buds_last_mac',device.mac);}
            }catch(e){console.warn('[Buds] SPP connect failed:',e);}

            if(!sppConnected){
                try{gbcAvail=await tauriInvoke('gbc_is_available');}catch(e){}
                if(gbcAvail){
                    try{gbcDev=JSON.parse(await tauriInvoke('gbc_get_device'));}catch(e){console.warn('[Buds] GBC read fail:',e);}
                    if(gbcDev&&gbcDev.BatteryLeft!=null){
                        status.battery_l=gbcDev.BatteryLeft;
                        status.battery_r=gbcDev.BatteryRight;
                        status.battery_case=gbcDev.BatteryCase;
                        status.wearing_l=gbcDev.WearStateLeft==='Wearing';
                        status.wearing_r=gbcDev.WearStateRight==='Wearing';
                        status.model=gbcDev.Model||'';
                    }
                }
            }
            _showBudsConnectModal(device.name||'Buds', (sppConnected||gbcAvail)?'ok':'fail');
        }
    }

    // Fallback: read UPower battery + saved settings
    let vol=50;
    try{vol=parseInt(JSON.parse(await tauriInvoke('get_volume')).volume)||50;}catch(e){}
    if(!sppConnected&&!gbcAvail){
        try{
            const batt=JSON.parse(await tauriInvoke('get_bt_device_battery',{mac:device.mac}));
            const pct=parseInt(batt.percentage)||0;
            status.battery_l=pct;status.battery_r=pct;
        }catch(e){}
    }
    if(!sppConnected){
        const savedAnc=await getSetting('buds_anc_'+device.mac,'0');
        const savedEq=await getSetting('buds_eq_'+device.mac,'2');
        status.anc_mode=parseInt(savedAnc)||0;
        status.eq_preset=parseInt(savedEq)||2;
        status.eq_enabled=true;
    }

    const battL=status.battery_l;
    const battR=status.battery_r;
    const battCase=status.battery_case;
    const fw=gbcDev?gbcDev.FirmwareVersion:'';
    const modelTag=status.model||(gbcDev?gbcDev.Model:'');

    // Pick model-specific artwork from src/assets. buds4pro has the full set;
    // older models fall back to generic earbuds. Case colour is user-selectable
    // (BT doesn't report it) and persisted per-device.
    const _bn=((device.name||'')+' '+(modelTag||'')).toLowerCase();
    const _model=(_bn.includes('buds4')||_bn.includes('buds 4'))?'4pro'
                :(_bn.includes('buds2')||_bn.includes('buds 2'))?'2pro':'3pro';
    const _BUDS_ART={
        '4pro':{hero:'buds4pro-together.svg',l:'buds4pro-left.svg',r:'buds4pro-right.svg'},
        '3pro':{hero:'buds3pro-together.png',l:'buds3pro-left.png',r:'buds3pro-right.png'},
        '2pro':{hero:'buds3pro-together.svg',l:'budsleft.svg',r:'budsright.svg'},
    }[_model];
    // Available case colours per model (swatch value → label).
    const _CASE_COLORS={
        '4pro':[['white','White'],['black','Black']],
        '3pro':[['white','White'],['silver','Silver']],
        '2pro':[['white','White'],['black','Black'],['purple','Purple']],
    }[_model];
    let _caseColor=await getSetting('buds_case_color_'+device.mac,_CASE_COLORS[0][0]);
    if(!_CASE_COLORS.some(c=>c[0]===_caseColor))_caseColor=_CASE_COLORS[0][0];
    // Real-photo case art (PNG) where available; rest fall back to line-art SVG.
    const _CASE_PNG={'3pro-silver':1};
    const _caseFile=c=>`buds${_model}-case-${c}.${_CASE_PNG[_model+'-'+c]?'png':'svg'}`;
    // Live-updated current case colour + builder, so the battery-ring poll
    // (which rewrites #buds-rings) re-renders the case with the picked colour
    // instead of the value frozen at first render.
    let _curCase=_caseColor;
    const _caseIcoHtml=col=>`<img id="buds-case-img" src="./assets/${_caseFile(col)}" class="buds-model-icon buds-keep-color" width="28" height="28" alt="">`;
    const _bimg=(p,cls,style)=>`<img src="./assets/${p}" class="buds-model-icon${p.endsWith('.png')?' buds-keep-color':''}" ${style||'width="28" height="28"'} alt="">`;
    // Icons (inline SVG, currentColor)
    const _ICO={
        earbud:_bimg(_BUDS_ART.l),
        earbudL:_bimg(_BUDS_ART.l),
        earbudR:_bimg(_BUDS_ART.r),
        case:_caseIcoHtml(_caseColor),
        hero:`<img src="./assets/${_BUDS_ART.hero}" class="buds-model-icon${_BUDS_ART.hero.endsWith('.png')?' buds-keep-color':''}" style="width:168px;height:112px;object-fit:contain" alt="${esc(device.name||'Buds')}">`,
        eq:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 4v6M6 14v6M12 4v2M12 10v10M18 4v10M18 18v2"/><circle cx="6" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="8" r="1.8" fill="currentColor"/><circle cx="18" cy="16" r="1.8" fill="currentColor"/></svg>',
        touch:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V6a2 2 0 0 1 4 0v7"/><path d="M13 9a2 2 0 0 1 4 0v5"/><path d="M17 11a2 2 0 0 1 2 2v4a5 5 0 0 1-5 5h-2a5 5 0 0 1-4.3-2.5L5 15"/><path d="M9 11a2 2 0 0 0-2 2v1"/></svg>',
        voice:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
        conn:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
        adv:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.5 5.5L20 8.5l-4 4 1 5.5L12 15.5 7 18l1-5.5-4-4 5.5-1z"/></svg>',
        a11y:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4.5" r="1.8"/><path d="M5 8l7 2 7-2M12 10v5l-3 6M12 15l3 6"/></svg>',
        find:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.3-4.3"/></svg>',
        diag:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-5 4 10 2-5h6"/></svg>',
        about:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>',
        chevron:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    };

    // Circular battery ring — icon inside, "Label %" below
    function _battRing(pct,label,icon){
        const r=30,c=2*Math.PI*r;
        const p=Math.max(0,Math.min(100,pct||0));
        const off=c*(1-p/100);
        const col=p>50?'#4cd964':p>20?'#ffcc00':p>10?'#ff9500':'#ff3b30';
        return `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;min-width:86px">
            <div style="position:relative;width:70px;height:70px">
                <svg width="70" height="70" viewBox="0 0 70 70">
                    <circle cx="35" cy="35" r="${r}" fill="none" stroke="rgba(128,128,128,.18)" stroke-width="4"/>
                    <circle cx="35" cy="35" r="${r}" fill="none" stroke="${col}" stroke-width="4" stroke-linecap="round"
                        stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 35 35)"/>
                </svg>
                <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--tx)">${icon||''}</span>
            </div>
            <span style="font-size:12.5px;color:var(--tx);font-weight:500">${esc(label)} ${p}%</span>
        </div>`;
    }

    // ANC stepper — ordered per Samsung app: Off → Ambient → Adaptive → ANC
    const _ancSteps=[
        {idx:0,label:'Desactivado'},
        {idx:2,label:'Sonido Ambiente'},
        {idx:3,label:'Adaptable'},
        {idx:1,label:'Cancelación activa de ruido'},
    ];
    function _ancStepper(active){
        const n=_ancSteps.length;
        const aIdx=Math.max(0,_ancSteps.findIndex(s=>s.idx===active));
        const ease='cubic-bezier(.4,0,.2,1)';
        const slot=100/n;
        return `<div class="buds-anc-stepper" data-active-i="${aIdx}" data-n="${n}" style="padding:20px 18px 18px;position:relative">
            <div class="anc-inner" style="position:relative">
                <div class="anc-track" style="position:absolute;top:8.5px;left:${slot/2}%;right:${slot/2}%;height:3px;background:rgba(128,128,128,.25);border-radius:2px;z-index:0"></div>
                <div class="anc-beam" style="position:absolute;top:8.5px;left:${slot/2}%;height:3px;background:var(--blue);border-radius:2px;z-index:1;pointer-events:none;width:0;transform:translateZ(0);will-change:width"></div>
                <div class="anc-thumb-halo" style="position:absolute;top:-5px;left:0;width:30px;height:30px;margin-left:-15px;border-radius:50%;background:radial-gradient(circle,rgba(10,132,255,.35) 0%,rgba(10,132,255,0) 70%);z-index:2;pointer-events:none;filter:blur(2px);transform:translate3d(0,0,0);will-change:transform"></div>
                <div class="anc-thumb" style="position:absolute;top:3px;left:0;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:var(--blue);box-shadow:0 2px 6px rgba(10,132,255,.5),0 0 0 4px rgba(10,132,255,.18);z-index:4;pointer-events:none;transform:translate3d(0,0,0);will-change:transform"></div>
                <div class="anc-grid" style="display:grid;grid-template-columns:repeat(${n},1fr);position:relative;z-index:3">
                    ${_ancSteps.map((s,i)=>{const on=s.idx===active;return `<button class="buds-anc-node" data-anc="${s.idx}" data-i="${i}" style="background:none;border:none;padding:0;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:12px;position:relative">
                        <span class="anc-dot" style="width:8px;height:8px;border-radius:50%;background:${on?'transparent':'rgba(128,128,128,.45)'};margin-top:6px;transition:background .3s ${ease}"></span>
                        <span class="anc-lbl" style="font-size:11px;text-align:center;color:${on?'var(--blue)':'var(--tx2)'};font-weight:${on?'600':'400'};line-height:1.25;max-width:78px;transition:color .3s ${ease},font-weight .3s ${ease}">${esc(s.label)}</span>
                    </button>`;}).join('')}
                </div>
            </div>
        </div>`;
    }
    function _ancPositionThumb(card){
        if(!card)return;
        const inner=card.querySelector('.anc-inner');
        if(!inner)return;
        const w=inner.getBoundingClientRect().width;
        if(!w)return;
        const n=parseInt(card.dataset.n||'4');
        const i=parseInt(card.dataset.activeI||'0');
        const slotPx=w/n;
        const xPx=slotPx*(i+0.5);
        const thumb=card.querySelector('.anc-thumb');
        const halo=card.querySelector('.anc-thumb-halo');
        const beam=card.querySelector('.anc-beam');
        if(thumb){thumb.style.transform=`translate3d(${xPx}px,0,0)`;}
        if(halo){halo.style.transform=`translate3d(${xPx}px,0,0)`;}
        if(beam){beam.style.width=`${slotPx*i}px`;}
    }

    // Samsung-style row: icon + (title+blue subtitle) + chevron
    function _sRow(title,sub,id,icon,clickable=true){
        return `<div class="buds-s-row" ${id?`id="${id}"`:''} style="padding:14px 18px;display:flex;align-items:center;gap:14px;${clickable?'cursor:pointer':''}">
            <span style="color:var(--tx2);flex-shrink:0;display:flex;align-items:center;justify-content:center;width:28px;height:28px">${icon||''}</span>
            <div style="flex:1;display:flex;flex-direction:column;gap:2px;min-width:0">
                <span style="font-size:14px;color:var(--tx);font-weight:500">${esc(title)}</span>
                ${sub?`<span style="font-size:13px;color:var(--blue)">${esc(sub)}</span>`:''}
            </div>
            <span style="color:var(--tx2);opacity:.6;flex-shrink:0">${SVGI.chevronR}</span>
        </div>`;
    }
    function _sCard(rows){
        // rows can be string OR {row, expand} — expand slides in right below its row
        const items=rows.map(r=>typeof r==='string'?{row:r}:r);
        const sep='<div style="height:1px;background:var(--brd);margin-left:60px"></div>';
        return `<div class="detail-card" style="padding:0;margin:10px 16px;overflow:hidden">
            ${items.map((it,i)=>it.row+(it.expand||'')+(i<items.length-1?sep:'')).join('')}
        </div>`;
    }
    function _sExpand(id,options,currentVal){
        return `<div id="${id}" class="buds-exp" style="display:none;padding:0 16px 14px"><div class="res-list" style="margin-bottom:0">
            ${options.map(o=>`<div class="res-item ${String(o.value)===String(currentVal)?'active':''}" data-v="${esc(String(o.value))}"><span>${esc(o.label)}</span></div>`).join('')}
        </div></div>`;
    }

    const avatarUrl=gbcDev&&gbcDev.DeviceImage?gbcDev.DeviceImage:'';
    const autoAmbient=!!(gbcDev&&(gbcDev.AmbientSoundMode||gbcDev.AutoSwitchAudioOutput));

    let h='';
    // Top bar: connect button right-aligned (no floating avatar)
    h+=`<div style="display:flex;align-items:center;justify-content:flex-end;padding:10px 16px 0">
        <button class="bk-dbtn confirm" id="buds-conn-btn" style="flex:0 0 auto;width:auto;height:34px;padding:0 18px;font-size:13px;border-radius:17px">${device.connected?'Desconectar':'Conectar'}</button>
    </div>`;

    // Hero: big earbuds illustration (or DeviceImage if GBC provides it)
    h+=`<div style="display:flex;justify-content:center;padding:10px 16px 4px">
        ${avatarUrl
            ?`<img src="${esc(avatarUrl)}" style="width:220px;height:140px;object-fit:contain">`
            :_ICO.hero}
    </div>`;

    // Name centered
    h+=`<div style="text-align:center;padding:6px 16px 16px">
        <div style="font-size:18px;font-weight:600;color:var(--tx)">${esc(device.name)}</div>
        ${modelTag?`<div style="font-size:12px;color:var(--tx2);margin-top:3px">${esc(modelTag)}${fw?' · '+esc(fw):''}</div>`:''}
    </div>`;

    // 3 battery rings with earbud/case icons inside
    h+=`<div id="buds-rings" style="display:flex;justify-content:center;gap:22px;padding:0 16px 18px">
        ${_battRing(battL,'Izda',_ICO.earbudL)}
        ${_battRing(battR,'Dcha',_ICO.earbudR)}
        ${_battRing(battCase,'Estuche',_ICO.case)}
    </div>`;

    // Case colour picker (per-model, persisted per-device).
    const _swColor={white:'#e8e8ea',black:'#2a2a2c',silver:'#c4c8cc',purple:'#7d6fc7'};
    if(_CASE_COLORS.length>1){
        h+=`<div class="detail-card" style="margin:0 16px 10px;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;gap:14px">
            <span style="font-size:14px;color:var(--tx)">${_tr('Color del estuche')}</span>
            <div style="display:flex;gap:10px" id="buds-case-colors">
                ${_CASE_COLORS.map(([v,l])=>`<button class="buds-color-sw${v===_caseColor?' active':''}" data-color="${v}" title="${_tr(l)}" aria-label="${_tr(l)}" style="background:${_swColor[v]||'#888'}"></button>`).join('')}
            </div>
        </div>`;
    }

    // ANC card: stepper + auto-ambient toggle
    h+=`<div class="detail-card" style="padding:0;margin:0 16px 10px;overflow:hidden">
        ${_ancStepper(status.anc_mode)}
        <div style="height:1px;background:var(--brd);margin:0 18px"></div>
        <div style="padding:14px 18px;display:flex;align-items:center;justify-content:space-between;gap:14px">
            <span style="font-size:14px;color:var(--tx)">Cambio automático a sonido ambiente</span>
            ${renderToggle('buds-auto-ambient',autoAmbient)}
        </div>
    </div>`;

    // Settings groups (Samsung style rows)
    const eqSubtitle=status.eq_enabled?(_BUDS_EQ_PRESETS.find(p=>p.idx===status.eq_preset)?.label||'Estándar'):'Plano';
    const touchSubtitle=status.touchpad_locked?'Bloqueado':'Estándar';
    const eqOpts=[{value:'-1',label:'Plano'}].concat(_BUDS_EQ_PRESETS.map(p=>({value:String(p.idx),label:p.label})));
    const eqCur=String(status.eq_enabled?status.eq_preset:-1);
    h+=_sCard([
        {row:_sRow('Calidad y efectos de sonido',eqSubtitle,'buds-row-eq',_ICO.eq),
         expand:_sExpand('buds-eq-list',eqOpts,eqCur)},
        _sRow('Controles de auriculares','','buds-row-touch',_ICO.touch),
        _sRow('Controles de voz','','buds-row-voice',_ICO.voice),
    ]);
    h+=_sCard([
        _sRow('Administrar conexiones','','buds-row-conn',_ICO.conn),
        _sRow('Funciones avanzadas','','buds-row-adv',_ICO.adv),
    ]);
    h+=_sCard([_sRow('Accesibilidad','','buds-row-a11y',_ICO.a11y)]);
    h+=_sCard([
        _sRow('Adaptar a tus oídos','','buds-row-fit',_ICO.eq),
        _sRow('Buscar mis auriculares','','buds-row-find',_ICO.find),
        _sRow('Diagnóstico','','buds-row-diag',_ICO.diag),
    ]);
    h+=_sCard([_sRow('Acerca de los auriculares','','buds-row-about',_ICO.about)]);

    c.innerHTML=renderHeader(device.name||'Buds')+h;

    // Case colour swatches → persist + swap the case artwork live.
    document.querySelectorAll('#buds-case-colors .buds-color-sw').forEach(sw=>{
        sw.addEventListener('click',async()=>{
            const col=sw.dataset.color;
            _curCase=col;
            await setSetting('buds_case_color_'+device.mac,col);
            document.querySelectorAll('#buds-case-colors .buds-color-sw').forEach(x=>x.classList.remove('active'));
            sw.classList.add('active');
            const img=document.getElementById('buds-case-img');
            if(img)img.src='./assets/'+_caseFile(col);
        });
    });

    // BT connect/disconnect button — master poll picks up transition + re-renders
    document.getElementById('buds-conn-btn')?.addEventListener('click',async()=>{
        const btn=document.getElementById('buds-conn-btn');
        btn.disabled=true;btn.textContent=device.connected?'Desconectando...':'Conectando...';
        try{
            if(device.connected){
                await tauriInvoke('buds_disconnect').catch(()=>{});
                await tauriInvoke('disconnect_bluetooth',{mac:device.mac});
            } else {
                await tauriInvoke('connect_bluetooth',{mac:device.mac});
            }
            window.updateHomeBudsRow?.();
        }catch(e){
            toast('Error de conexión');
            btn.disabled=false;btn.textContent=device.connected?'Desconectar':'Conectar';
        }
    });

    // ANC stepper nodes
    let _lastAnc=status.anc_mode;
    function _ancApply(mode){
        const card=document.querySelector('.buds-anc-stepper');
        if(!card) return;
        const inner=card.querySelector('.anc-inner');
        if(!inner) return;
        const n=parseInt(card.dataset.n||String(_ancSteps.length));
        const newI=_ancSteps.findIndex(s=>s.idx===mode);
        if(newI<0) return;
        const curI=parseInt(card.dataset.activeI||'0');
        if(newI===curI) return;
        const w=inner.getBoundingClientRect().width;
        if(!w) return;
        const slotPx=w/n;
        const fromX=slotPx*(curI+0.5);
        const toX=slotPx*(newI+0.5);
        const fromW=slotPx*curI, toW=slotPx*newI;
        const dist=Math.abs(newI-curI);
        const dur=Math.min(420, 320+dist*30);
        const spring='cubic-bezier(.3,.3,.2,.9)';
        const nodes=card.querySelectorAll('.buds-anc-node');
        const thumb=card.querySelector('.anc-thumb');
        const halo=card.querySelector('.anc-thumb-halo');
        const beam=card.querySelector('.anc-beam');
        const oldNode=nodes[curI], newNode=nodes[newI];

        // labels swap
        if(oldNode){
            const l=oldNode.querySelector('.anc-lbl'); if(l){l.style.color='var(--tx2)';l.style.fontWeight='400';}
            const d=oldNode.querySelector('.anc-dot'); if(d) d.style.background='rgba(128,128,128,.45)';
        }
        if(newNode){
            const l=newNode.querySelector('.anc-lbl'); if(l){l.style.color='var(--blue)';l.style.fontWeight='600';}
            const d=newNode.querySelector('.anc-dot'); if(d) d.style.background='transparent';
        }

        // thumb — pure transform, GPU composited
        if(thumb){
            thumb.animate([
                {transform:`translate3d(${fromX}px,0,0) scale(1,1)`},
                {transform:`translate3d(${(fromX+toX)/2}px,0,0) scale(${1+0.2*Math.min(dist,2)},.82)`, offset:0.55},
                {transform:`translate3d(${toX}px,0,0) scale(1,1)`}
            ],{duration:dur, easing:spring, fill:'forwards'});
        }
        if(halo){
            halo.animate([
                {transform:`translate3d(${fromX}px,0,0) scale(1)`, opacity:.85},
                {transform:`translate3d(${(fromX+toX)/2}px,0,0) scale(1.35)`, opacity:1, offset:0.55},
                {transform:`translate3d(${toX}px,0,0) scale(1)`, opacity:.85}
            ],{duration:dur, easing:spring, fill:'forwards'});
        }
        if(beam){
            beam.animate([
                {width:`${fromW}px`},
                {width:`${toW}px`}
            ],{duration:dur, easing:spring, fill:'forwards'});
        }

        card.dataset.activeI=String(newI);
    }
    // Initial thumb/beam positioning (needs layout)
    requestAnimationFrame(()=>{
        const card=document.querySelector('.buds-anc-stepper');
        if(card) _ancPositionThumb(card);
    });
    // Reposition on window resize
    const _ancResize=()=>{
        const card=document.querySelector('.buds-anc-stepper');
        if(card) _ancPositionThumb(card);
    };
    window.removeEventListener('resize',window.__ancResize||(()=>{}));
    window.__ancResize=_ancResize;
    window.addEventListener('resize',_ancResize);
    document.querySelectorAll('.buds-anc-node').forEach(btn=>{
        btn.addEventListener('click',async()=>{
            const mode=parseInt(btn.dataset.anc);
            _ancApply(mode);
            if(sppConnected){
                try{await tauriInvoke('buds_set_anc',{mode});}
                catch(e){toast('Error al cambiar ANC');}
            } else if(gbcAvail){
                try{
                    let act=null;
                    if(mode===1) act='AncToggle';
                    else if(mode===2) act='AmbientToggle';
                    else if(mode===0){
                        if(_lastAnc===1) act='AncToggle';
                        else if(_lastAnc===2) act='AmbientToggle';
                    }
                    if(act) await tauriInvoke('gbc_execute_action',{action:act});
                }catch(e){toast('Error GBC: '+e);}
            }
            _lastAnc=mode;
            setSetting('buds_anc_'+device.mac, String(mode));
            const lbl=_ancSteps.find(m=>m.idx===mode)?.label||'';
            toast(lbl);
        });
    });

    // Auto-ambient toggle (GBC only — SPP cmd TBD)
    setupToggle('buds-auto-ambient',async a=>{
        if(gbcAvail){
            try{await tauriInvoke('gbc_execute_action',{action:'AmbientToggle'});}catch(e){}
        }
        toast(a?'Cambio automático activado':'Cambio automático desactivado');
    });

    // Row: Calidad y efectos de sonido → toggle inline expansion
    document.getElementById('buds-row-eq')?.addEventListener('click',()=>{
        const el=document.getElementById('buds-eq-list');
        if(el)el.style.display=el.style.display==='none'?'block':'none';
    });
    document.querySelectorAll('#buds-eq-list [data-v]').forEach(item=>{
        item.addEventListener('click',async()=>{
            const idx=parseInt(item.dataset.v);
            const enabled=idx>=0;
            document.querySelectorAll('#buds-eq-list [data-v]').forEach(x=>x.classList.remove('active'));
            item.classList.add('active');
            if(sppConnected){
                try{await tauriInvoke('buds_set_eq',{preset:enabled?idx:0,enabled});}
                catch(e){toast('Error EQ');}
            } else if(gbcAvail){
                try{await tauriInvoke('gbc_execute_action',{action:'EqualizerNextPreset'});}catch(e){}
            }
            if(enabled)setSetting('buds_eq_'+device.mac,String(idx));
            status.eq_enabled=enabled;status.eq_preset=enabled?idx:2;
            const lbl=enabled?(_BUDS_EQ_PRESETS.find(p=>p.idx===idx)?.label||''):'Plano';
            const sub=document.querySelectorAll('#buds-row-eq span')[2];
            if(sub)sub.textContent=lbl;
            toast('EQ: '+lbl);
        });
    });

    // Row: Controles de auriculares → full sub-page
    document.getElementById('buds-row-touch')?.addEventListener('click',()=>{
        if(window.pushSubNav)window.pushSubNav(()=>_renderBudsDetail(c,device));
        window.clearPageIntervals?.();
        _renderBudsTouch(c,device,status,sppConnected,gbcAvail);
    });

    // Row: Buscar mis auriculares
    document.getElementById('buds-row-find')?.addEventListener('click',async()=>{
        if(gbcAvail){
            try{await tauriInvoke('gbc_execute_action',{action:'StartStopFind'});toast('Sonido de localización');}
            catch(e){toast('Error al localizar');}
        } else {toast('Requiere Galaxy Buds Client');}
    });

    // Row: Acerca de
    document.getElementById('buds-row-about')?.addEventListener('click',()=>_renderBudsAbout(c,device,status,modelTag,fw));

    // Stubs for non-implemented rows
    ['buds-row-voice','buds-row-adv','buds-row-a11y','buds-row-diag'].forEach(id=>{
        document.getElementById(id)?.addEventListener('click',()=>toast('Próximamente'));
    });
    document.getElementById('buds-row-conn')?.addEventListener('click',()=>_renderBudsConn(c,device));
    document.getElementById('buds-row-fit')?.addEventListener('click',()=>_renderBudsFitTest(c,device));

    // Live refresh: update battery rings
    function _renderRingsLive(bl,br,bc){
        const rings=document.getElementById('buds-rings');
        if(!rings) return;
        rings.innerHTML=_battRing(bl,'Izda',_ICO.earbudL)+_battRing(br,'Dcha',_ICO.earbudR)+_battRing(bc,'Estuche',_caseIcoHtml(_curCase));
    }

    // Master poll: detect BT connect/disconnect transitions + live battery
    let _wasConnected=device.connected;
    addInterval(async()=>{
        // Abort if DOM swapped away (user navigated)
        if(!document.getElementById('buds-rings'))return;
        let nowConnected=false, freshDev=null;
        try{
            const list=JSON.parse(await tauriInvoke('get_bluetooth_devices'));
            freshDev=list.find(d=>d.mac===device.mac);
            nowConnected=!!(freshDev&&freshDev.connected);
        }catch(e){return;}

        // Connect state transition → full re-render
        if(nowConnected!==_wasConnected){
            if(window._pageIntervals){window._pageIntervals.forEach(clearInterval);window._pageIntervals=[];}
            _renderBudsDetail(c, freshDev||Object.assign({},device,{connected:nowConnected}));
            return;
        }

        // Still connected: update battery rings
        if(nowConnected){
            if(sppConnected){
                try{
                    const r=JSON.parse(await tauriInvoke('buds_get_status'));
                    _renderRingsLive(r.battery_l,r.battery_r,r.battery_case);
                }catch(e){}
            } else if(gbcAvail){
                try{
                    const d=JSON.parse(await tauriInvoke('gbc_get_device'));
                    _renderRingsLive(d.BatteryLeft,d.BatteryRight,d.BatteryCase);
                }catch(e){}
            } else {
                try{
                    const b=JSON.parse(await tauriInvoke('get_bt_device_battery',{mac:device.mac}));
                    const pct=parseInt(b.percentage)||0;
                    _renderRingsLive(pct,pct,0);
                }catch(e){}
            }
        }
    },3000);
}

// ── Controles táctiles sub-page ───────────────────────────────────────────
async function _renderBudsTouch(c,device,status,sppConnected,gbcAvail){
    const mac=device.mac;
    const _k=s=>'buds_'+s+'_'+mac;

    // Action maps
    const PINCH_OPTS=[
        {value:'noise',label:'Controles de ruido'},
        {value:'sound',label:'Controles de sonido'},
        {value:'volume',label:'Volumen'},
    ];
    const TAP1_OPTS=[
        {value:'playpause',label:'Reproducir o pausar música'},
        {value:'none',label:'Ninguno'},
    ];
    const TAP2_OPTS=[
        {value:'next',label:'Reproducir siguiente canción'},
        {value:'prev',label:'Reproducir canción anterior'},
        {value:'volup',label:'Subir volumen'},
        {value:'voldown',label:'Bajar volumen'},
        {value:'none',label:'Ninguno'},
    ];
    const TAP3_OPTS=TAP2_OPTS;
    const LONG_OPTS=[
        {value:'custom',label:'Ejecutar acción personalizada'},
        {value:'voice',label:'Asistente de voz'},
        {value:'none',label:'Ninguno'},
    ];

    // Load persisted per-device settings
    const [pinchL,pinchR,tap1,tap2,tap3,lng,pinchLEn,pinchREn,tap1En,tap2En,tap3En,lngEn]=await Promise.all([
        getSetting(_k('pinchL'),'noise'),
        getSetting(_k('pinchR'),'noise'),
        getSetting(_k('tap1'),'playpause'),
        getSetting(_k('tap2'),'next'),
        getSetting(_k('tap3'),'prev'),
        getSetting(_k('long'),'custom'),
        getSetting(_k('pinchLEn'),'1'),
        getSetting(_k('pinchREn'),'1'),
        getSetting(_k('tap1En'),'1'),
        getSetting(_k('tap2En'),'1'),
        getSetting(_k('tap3En'),'1'),
        getSetting(_k('longEn'),'1'),
    ]);
    const state={pinchL,pinchR,tap1,tap2,tap3,long:lng,
        pinchLEn:pinchLEn==='1',pinchREn:pinchREn==='1',
        tap1En:tap1En==='1',tap2En:tap2En==='1',tap3En:tap3En==='1',longEn:lngEn==='1'};

    const labelOf=(opts,v)=>opts.find(o=>o.value===v)?.label||'';

    function rowHTML(id,title,subtitle,toggleId,toggleOn,pickable=true){
        return `<div class="buds-tc-row" ${id?`id="${id}"`:''} style="padding:14px 18px;display:flex;align-items:center;gap:14px;${pickable?'cursor:pointer':''}">
            <div style="flex:1;display:flex;flex-direction:column;gap:3px;min-width:0">
                <span style="font-size:14px;color:var(--tx);font-weight:500">${esc(title)}</span>
                ${subtitle?`<span style="font-size:13px;color:${pickable?'var(--blue)':'var(--tx2)'}">${esc(subtitle)}</span>`:''}
            </div>
            ${toggleId?renderToggle(toggleId,toggleOn):''}
        </div>`;
    }
    function expHTML(id,opts,cur){
        return `<div id="${id}" class="buds-exp" style="display:none;padding:0 16px 14px"><div class="res-list" style="margin-bottom:0">
            ${opts.map(o=>`<div class="res-item ${String(o.value)===String(cur)?'active':''}" data-v="${esc(String(o.value))}"><span>${esc(o.label)}</span></div>`).join('')}
        </div></div>`;
    }
    const sep='<div style="height:1px;background:var(--brd);margin:0 18px"></div>';
    const card=items=>`<div class="detail-card" style="padding:0;margin:10px 16px;overflow:hidden">${items.map((it,i)=>{
        const s=(typeof it==='string'?it:(it.row+(it.expand||'')));
        return s+(i<items.length-1?sep:'');
    }).join('')}</div>`;
    const sectionTitle=t=>`<div style="padding:20px 20px 6px;font-size:13px;color:var(--tx2);font-weight:500">${esc(t)}</div>`;

    let h=renderHeader(t('hdr_touch_controls'));
    // Bloquear toques
    h+=card([rowHTML('tc-lock','Bloquear toques','Deshabilitar toques','tc-lock-tg',!!status.touchpad_locked,false)]);
    // Pinch & hold
    h+=sectionTitle('Controles de pellizcar y mantener');
    h+=card([
        {row:rowHTML('tc-pinchL','Izquierdo',labelOf(PINCH_OPTS,state.pinchL),'tc-pinchL-tg',state.pinchLEn),
         expand:expHTML('exp-pinchL',PINCH_OPTS,state.pinchL)},
        {row:rowHTML('tc-pinchR','Derecho',labelOf(PINCH_OPTS,state.pinchR),'tc-pinchR-tg',state.pinchREn),
         expand:expHTML('exp-pinchR',PINCH_OPTS,state.pinchR)},
    ]);
    // Taps
    h+=sectionTitle('Toques y acciones');
    h+=card([
        {row:rowHTML('tc-tap1','Un toque',labelOf(TAP1_OPTS,state.tap1),'tc-tap1-tg',state.tap1En),
         expand:expHTML('exp-tap1',TAP1_OPTS,state.tap1)},
        {row:rowHTML('tc-tap2','Doble toque',labelOf(TAP2_OPTS,state.tap2),'tc-tap2-tg',state.tap2En),
         expand:expHTML('exp-tap2',TAP2_OPTS,state.tap2)},
        {row:rowHTML('tc-tap3','Triple toque',labelOf(TAP3_OPTS,state.tap3),'tc-tap3-tg',state.tap3En),
         expand:expHTML('exp-tap3',TAP3_OPTS,state.tap3)},
        {row:rowHTML('tc-long','Toque y presionar',labelOf(LONG_OPTS,state.long),'tc-long-tg',state.longEn),
         expand:expHTML('exp-long',LONG_OPTS,state.long)},
    ]);
    c.innerHTML=h;

    // Bloquear toques toggle
    setupToggle('tc-lock-tg',async a=>{
        if(sppConnected){
            try{await tauriInvoke('buds_set_touch_lock',{locked:a});}catch(e){toast('Error');}
        } else if(gbcAvail){
            try{await tauriInvoke('gbc_execute_action',{action:'LockTouchpadToggle'});}catch(e){}
        }
        toast(a?'Táctil bloqueado':'Táctil activo');
    });

    // Bind picker rows — toggle inline expansion panel
    function bindPicker(rowId,expId,opts,key,toggleId){
        const row=document.getElementById(rowId);
        const exp=document.getElementById(expId);
        row?.addEventListener('click',e=>{
            if(e.target.closest('.toggle-switch'))return;
            if(exp)exp.style.display=exp.style.display==='none'?'block':'none';
        });
        exp?.querySelectorAll('[data-v]').forEach(item=>{
            item.addEventListener('click',async()=>{
                const v=item.dataset.v;
                exp.querySelectorAll('[data-v]').forEach(x=>x.classList.remove('active'));
                item.classList.add('active');
                state[key]=v;
                await setSetting(_k(key),v);
                const sub=row?.querySelectorAll('span')[1];
                if(sub)sub.textContent=labelOf(opts,v);
                toast(labelOf(opts,v));
            });
        });
        setupToggle(toggleId,async a=>{
            state[key+'En']=a;
            await setSetting(_k(key+'En'),a?'1':'0');
        });
    }
    bindPicker('tc-pinchL','exp-pinchL',PINCH_OPTS,'pinchL','tc-pinchL-tg');
    bindPicker('tc-pinchR','exp-pinchR',PINCH_OPTS,'pinchR','tc-pinchR-tg');
    bindPicker('tc-tap1','exp-tap1',TAP1_OPTS,'tap1','tc-tap1-tg');
    bindPicker('tc-tap2','exp-tap2',TAP2_OPTS,'tap2','tc-tap2-tg');
    bindPicker('tc-tap3','exp-tap3',TAP3_OPTS,'tap3','tc-tap3-tg');
    bindPicker('tc-long','exp-long',LONG_OPTS,'long','tc-long-tg');
}

// ── Book Share sub-page ──────────────────────────────────────────────────
async function _renderBookShare(c){
    c.innerHTML=renderHeader(t('hdr_book_share'))+renderSkeleton(2);

    // ── Fetch KDE Connect devices ──
    let kdeDevices=[];
    try{kdeDevices=JSON.parse(await tauriInvoke('get_kdeconnect_devices'));}catch(e){console.error('[BookShare]',e);}
    // Dedupe: kdeconnect a veces lista el mismo teléfono dos veces (entrada
    // vieja + nueva con distinto id). Nos quedamos con una por nombre,
    // prefiriendo la que esté al alcance.
    {
        const byName=new Map();
        for(const d of kdeDevices){
            const k=(d.name||'').trim().toLowerCase()||d.id;
            const prev=byName.get(k);
            if(!prev||(d.reachable&&!prev.reachable))byName.set(k,d);
        }
        kdeDevices=[...byName.values()];
    }

    const _SVG_UPLOAD=`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
    const _SVG_PHONE=`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/></svg>`;
    const _SVG_LAPTOP=`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M0 21h24"/></svg>`;

    let h=renderHeader(t('hdr_book_share'));

    // ── KDE Connect / Teléfono ──
    h+=renderSection(t('sec_paired_devices'));
    if(kdeDevices.length===0){
        h+=renderCard([_devRow({
            icon:_SVG_PHONE,iconColor:'var(--tx2)',
            title:'Sin dispositivos KDE Connect',
            subtitle:'Instala KDE Connect en tu teléfono para vincularlos'
        })]);
    } else {
        const battIcon=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2"/></svg>`;
        h+=renderCard(kdeDevices.map(d=>{
            const batt=d.battery?`<span style="font-size:12px;color:var(--tx2);display:inline-flex;align-items:center;gap:3px;margin-left:6px">${battIcon}${esc(d.battery)}%</span>`:'';
            return _devRow({
                icon:_SVG_PHONE,iconColor:d.reachable?'var(--green)':'var(--tx2)',
                title:esc(d.name)+batt,
                subtitle:d.reachable?'Conectado y disponible':'Fuera de alcance'
            });
        }));
    }

    // ── Quick Share (rqs_lib built-in) ──
    h+=renderSection(t('sec_quickshare'));
    h+=renderCard([_devRow({
        icon:_SVG_SHARE,iconColor:'var(--blue)',
        title:'Compartir cercano',
        subtitleId:'qs-status-sub',
        subtitle:'Inactivo',
        right:renderToggle('qs-toggle',false)
    })]);
    // Visibility selector (only when active)
    h+=`<div id="qs-visibility-row" style="display:none">`;
    h+=renderCard([_devRow({
        icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
        iconColor:'var(--tx2)',
        title:'Visible para otros',
        subtitle:'Otros dispositivos pueden encontrarte',
        right:renderToggle('qs-vis-toggle',true)
    })]);
    h+=`</div>`;

    // ── Discovered devices (mDNS — same WiFi) ──
    h+=`<div id="qs-discover-section" style="display:none">`;
    h+=renderSection(t('sec_nearby'));
    h+=`<div id="qs-devices-list">`;
    h+=renderCard([_devRow({icon:_SVG_LAPTOP,iconColor:'var(--tx2)',title:'Buscando dispositivos…',subtitle:'Mantén Quick Share activo en el otro equipo'})]);
    h+=`</div></div>`;

    // ── Wi-Fi Direct P2P devices (no WiFi compartida necesaria) ──
    const _SVG_WIFI_DIRECT=`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></svg>`;
    h+=`<div id="p2p-section" style="display:none">`;
    h+=renderSection(t('sec_wifi_direct'));
    h+=`<div id="p2p-devices-list">`;
    h+=renderCard([_devRow({icon:_SVG_WIFI_DIRECT,iconColor:'var(--tx2)',title:'Buscando por Wi-Fi Direct…',subtitle:'Abre Nearby Share en el S22 Ultra'})]);
    h+=`</div></div>`;

    // ── Receive section ──
    const _SVG_DOWNLOAD=`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    const _SVG_FOLDER=`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    h+=`<div id="qs-recv-section" style="display:none">`;
    h+=renderSection(t('sec_receive'));
    h+=renderCard([
        _devRow({
            icon:_SVG_DOWNLOAD,iconColor:'var(--green)',
            title:'Listo para recibir',
            subtitle:'Este equipo es visible para dispositivos cercanos'
        }),
        _devRow({
            id:'qs-recv-folder-row',extraStyle:'cursor:pointer',
            icon:_SVG_FOLDER,iconColor:'var(--tx2)',
            title:'Carpeta de descarga',
            subtitleId:'qs-folder-label',subtitle:'~/Descargas',
            right:`<div style="color:var(--tx2);flex-shrink:0">${SVGI.chevronR}</div>`
        })
    ]);
    h+=`<div id="qs-incoming-list"></div>`;
    h+=`</div>`;

    // ── Send file shortcut ──
    h+=renderSection(t('sec_send'));
    h+=renderCard([_devRow({
        id:'qs-send-btn',extraStyle:'cursor:pointer',
        icon:_SVG_UPLOAD,iconColor:'var(--blue)',
        title:'Enviar archivo',
        subtitle:'Elige un archivo y selecciona un dispositivo cercano',
        right:`<div style="color:var(--tx2);flex-shrink:0">${SVGI.chevronR}</div>`
    })]);
    h+=`<div id="qs-outbound-list"></div>`;

    c.innerHTML=h;

    // ── State ──
    let qsRunning=false;
    let _unlistenTransfer=null, _unlistenDevice=null;
    let _unlistenP2PAdded=null, _unlistenP2PRemoved=null, _unlistenP2PConn=null;
    const qsDevices={};       // endpointId → EndpointInfo (mDNS)
    const p2pDevices={};      // path → P2PPeer (Wi-Fi Direct)
    const p2pConnected=new Set(); // paths of connected P2P peers
    const qsTransfers={};     // id → {msg, el} — inbound
    const qsOutbound={};      // id → {msg, el} — outbound

    const origClear=window.clearPageIntervals;
    window.clearPageIntervals=()=>{
        window.clearPageIntervals=origClear;
        if(qsRunning){
            tauriInvoke('qs_stop_discover').catch(()=>{});
            tauriInvoke('qs_stop').catch(()=>{});
        }
        _unlistenTransfer?.(); _unlistenDevice?.();
        _unlistenP2PAdded?.(); _unlistenP2PRemoved?.(); _unlistenP2PConn?.();
        origClear?.();
    };

    function _renderDevicesList(){
        const keys=Object.keys(qsDevices);
        const el=document.getElementById('qs-devices-list');
        if(!el)return;
        if(keys.length===0){
            el.innerHTML=renderCard([_devRow({icon:_SVG_LAPTOP,iconColor:'var(--tx2)',title:'Sin dispositivos encontrados',subtitle:'Asegúrate de que Quick Share esté activo en el otro equipo'})]);
            return;
        }
        el.innerHTML=renderCard(keys.map(id=>{
            const d=qsDevices[id];
            return _devRow({
                id:`qs-dev-${id}`,extraStyle:'cursor:pointer',
                icon:_SVG_LAPTOP,iconColor:'var(--blue)',
                title:esc(d.name||id),
                subtitle:esc(d.ip||'Dispositivo cercano'),
                right:`<button class="qs-send-to" data-id="${esc(id)}" style="padding:5px 14px;border-radius:20px;border:1.5px solid var(--blue);background:transparent;color:var(--blue);font-size:12px;cursor:pointer">Enviar</button>`
            });
        }));
        el.querySelectorAll('.qs-send-to').forEach(btn=>{
            btn.addEventListener('click',async e=>{
                e.stopPropagation();
                const id=btn.dataset.id;
                const d=qsDevices[id];
                if(!d)return;
                let files=[];
                try{
                    const picked=await window.__TAURI__.dialog.open({multiple:true});
                    if(!picked)return;
                    files=Array.isArray(picked)?picked:[picked];
                }catch(e){toast('No se pudo abrir el selector de archivos');return;}
                try{
                    await tauriInvoke('qs_send_files',{endpointId:id,name:d.name||'',addr:d.ip||'',files});
                    toast('Enviando…');
                }catch(e){toast('Error al enviar: '+e);}
            });
        });
    }

    function _renderP2PList(){
        const el=document.getElementById('p2p-devices-list');
        const sec=document.getElementById('p2p-section');
        if(!el)return;
        const keys=Object.keys(p2pDevices);
        if(keys.length===0){
            el.innerHTML=renderCard([_devRow({icon:_SVG_WIFI_DIRECT,iconColor:'var(--tx2)',title:'Buscando por Wi-Fi Direct…',subtitle:'Abre Nearby Share en el S22 Ultra'})]);
            return;
        }
        if(sec)sec.style.display='';
        el.innerHTML=renderCard(keys.map(path=>{
            const d=p2pDevices[path];
            const isConn=p2pConnected.has(path);
            const sig=d.strength>0?` · ${d.strength}%`:'';
            const rightBtn=isConn
                ?`<span style="font-size:12px;color:var(--green);font-weight:600">● Conectado</span>`
                :`<button class="p2p-connect-btn" data-path="${esc(path)}" data-mac="${esc(d.mac)}" data-name="${esc(d.name||d.mac)}"
                    style="padding:5px 14px;border-radius:20px;border:1.5px solid var(--blue);background:transparent;color:var(--blue);font-size:12px;cursor:pointer">
                    Conectar</button>`;
            return _devRow({
                icon:_SVG_WIFI_DIRECT,iconColor:isConn?'var(--green)':'var(--blue)',
                title:esc(d.name||d.mac),
                subtitle:`Wi-Fi Direct${sig}${isConn?' — listo para recibir':''}`,
                right:rightBtn
            });
        }));
        el.querySelectorAll('.p2p-connect-btn').forEach(btn=>{
            btn.addEventListener('click',async e=>{
                e.stopPropagation();
                btn.disabled=true;btn.textContent='Conectando…';
                try{
                    await tauriInvoke('p2p_connect',{mac:btn.dataset.mac,name:btn.dataset.name});
                    p2pConnected.add(btn.dataset.path);
                    _renderP2PList();
                    toast('Wi-Fi Direct conectado con '+btn.dataset.name);
                }catch(err){
                    toast('Error P2P: '+err);
                    btn.disabled=false;btn.textContent='Conectar';
                }
            });
        });
    }

    function _transferTitle(meta){
        if(!meta)return'Archivo';
        if(meta.text_payload)return meta.text_description||'Texto';
        if(meta.files?.length>1)return`${meta.files.length} archivos`;
        return meta.files?.[0]||meta.text_description||'Archivo';
    }
    function _transferSubIcon(meta){
        if(!meta||meta.files)return _SVG_DOWNLOAD;
        return`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    }
    function _progressBar(pct){
        return`<div style="width:100%;height:5px;border-radius:3px;background:var(--brd);overflow:hidden">
            <div style="width:${pct}%;height:100%;border-radius:3px;background:var(--blue);transition:width .25s ease"></div>
        </div>`;
    }

    function _upsertTransfer(msg){
        // Route outbound to separate list
        if(msg.rtype==='Outbound'){_upsertOutbound(msg);return;}
        const list=document.getElementById('qs-incoming-list');
        if(!list)return;
        const id=msg.id;
        qsTransfers[id]=qsTransfers[id]||{};
        qsTransfers[id].msg=msg;

        const stateStr=(msg.state||'').toLowerCase();
        const isDone=stateStr==='finished'||stateStr==='cancelled'||stateStr==='rejected'||stateStr==='disconnected';
        if(isDone){
            if(stateStr==='finished')toast(`Archivo recibido: ${_transferTitle(msg.meta)}`,'✓');
            qsTransfers[id].el?.remove();
            delete qsTransfers[id];
            return;
        }
        let el=qsTransfers[id].el;
        if(!el){
            el=document.createElement('div');
            el.style.cssText='margin-bottom:4px';
            list.appendChild(el);
            qsTransfers[id].el=el;
        }
        const title=_transferTitle(msg.meta);
        const from=msg.meta?.source?.name?`De: ${esc(msg.meta.source.name)}`:'';
        const progress=(msg.meta?.ack_bytes&&msg.meta?.total_bytes&&msg.meta.total_bytes>0)?
            Math.round(msg.meta.ack_bytes/msg.meta.total_bytes*100):null;
        const pin=msg.meta?.pin_code;
        const isWaiting=stateStr==='waitingforuserconsent'||stateStr==='waiting'||!stateStr;
        el.innerHTML=renderCard([`
            <div class="detail-item" style="flex-direction:column;align-items:flex-start;gap:10px">
                <div style="display:flex;align-items:center;gap:10px;width:100%">
                    <div style="color:var(--blue);flex-shrink:0">${_transferSubIcon(msg.meta)}</div>
                    <div style="flex:1;min-width:0">
                        <div class="dt" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(title)}</div>
                        <div class="ds">${from||'Solicitud entrante'}</div>
                    </div>
                    <div style="font-size:12px;color:${isWaiting?'var(--blue)':'var(--tx2)'};font-weight:600;flex-shrink:0">
                        ${isWaiting?'Pendiente':progress!==null?progress+'%':esc(msg.state||'')}
                    </div>
                </div>
                ${pin?`<div style="text-align:center;width:100%;font-size:24px;font-weight:700;letter-spacing:8px;color:var(--blue);padding:4px 0">${esc(pin)}</div>`:''}
                ${isWaiting?`
                <div style="display:flex;gap:8px;width:100%">
                    <button class="qs-accept" data-tid="${esc(id)}" style="flex:1;padding:9px;border-radius:12px;border:none;background:var(--blue);color:#fff;font-size:13px;font-weight:600;cursor:pointer">Aceptar</button>
                    <button class="qs-reject" data-tid="${esc(id)}" style="flex:1;padding:9px;border-radius:12px;border:1.5px solid var(--brd);background:transparent;color:var(--tx);font-size:13px;cursor:pointer">Rechazar</button>
                </div>`:progress!==null?_progressBar(progress):''}
            </div>
        `]);
        el.querySelectorAll('.qs-accept').forEach(b=>b.addEventListener('click',async()=>{
            b.disabled=true;b.textContent='Aceptando…';
            try{await tauriInvoke('qs_action',{transferId:b.dataset.tid,accept:true});}
            catch(e){toast('Error: '+e);b.disabled=false;b.textContent='Aceptar';}
        }));
        el.querySelectorAll('.qs-reject').forEach(b=>b.addEventListener('click',async()=>{
            try{await tauriInvoke('qs_action',{transferId:b.dataset.tid,accept:false});}catch(e){toast('Error: '+e);}
        }));
    }

    function _upsertOutbound(msg){
        const list=document.getElementById('qs-outbound-list');
        if(!list)return;
        const id=msg.id;
        qsOutbound[id]=qsOutbound[id]||{};
        qsOutbound[id].msg=msg;
        const stateStr=(msg.state||'').toLowerCase();
        const isDone=stateStr==='finished'||stateStr==='cancelled'||stateStr==='rejected'||stateStr==='disconnected';
        if(isDone){
            if(stateStr==='finished')toast(`Archivo enviado: ${_transferTitle(msg.meta)}`,'✓');
            qsOutbound[id].el?.remove();
            delete qsOutbound[id];
            return;
        }
        let el=qsOutbound[id].el;
        if(!el){
            el=document.createElement('div');
            el.style.cssText='margin-bottom:4px';
            list.appendChild(el);
            qsOutbound[id].el=el;
        }
        const title=_transferTitle(msg.meta);
        const to=msg.meta?.destination?`A: ${esc(msg.meta.destination.split('/').pop()||msg.meta.destination)}`:'';
        const progress=(msg.meta?.ack_bytes&&msg.meta?.total_bytes&&msg.meta.total_bytes>0)?
            Math.round(msg.meta.ack_bytes/msg.meta.total_bytes*100):null;
        el.innerHTML=renderCard([`
            <div class="detail-item" style="flex-direction:column;align-items:flex-start;gap:10px">
                <div style="display:flex;align-items:center;gap:10px;width:100%">
                    <div style="color:var(--blue);flex-shrink:0">${_SVG_UPLOAD}</div>
                    <div style="flex:1;min-width:0">
                        <div class="dt" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(title)}</div>
                        <div class="ds">Enviando${to?' · '+to:''}</div>
                    </div>
                    <div style="font-size:12px;color:var(--blue);font-weight:600;flex-shrink:0">${progress!==null?progress+'%':'…'}</div>
                </div>
                ${progress!==null?_progressBar(progress):''}
            </div>
        `]);
    }

    // ── Toggle Quick Share on/off ──
    setupToggle('qs-toggle',async(on)=>{
        const sub=document.getElementById('qs-status-sub');
        const visRow=document.getElementById('qs-visibility-row');
        const discSec=document.getElementById('qs-discover-section');
        const recvSec=document.getElementById('qs-recv-section');
        if(on){
            if(sub)sub.textContent='Iniciando…';
            try{
                await tauriInvoke('qs_start');
                await tauriInvoke('qs_discover');
                qsRunning=true;
                if(sub)sub.textContent='Activo — buscando dispositivos';
                if(visRow)visRow.style.display='';
                if(discSec)discSec.style.display='';
                if(recvSec)recvSec.style.display='';

                // Listen to device events
                // present=true → appeared, present=null/undefined (default) → removed
                _unlistenDevice=await window.__TAURI__.event.listen('qs-device',ev=>{
                    const d=ev.payload;
                    if(!d||!d.id)return;
                    if(d.present===true){
                        qsDevices[d.id]=d;
                    } else {
                        // removal — present is null/undefined in default struct
                        delete qsDevices[d.id];
                    }
                    _renderDevicesList();
                });
                // Listen to transfer events
                _unlistenTransfer=await window.__TAURI__.event.listen('qs-transfer',ev=>{
                    if(ev.payload)_upsertTransfer(ev.payload);
                });
                // Listen to P2P peer events (Wi-Fi Direct, no shared WiFi needed)
                _unlistenP2PAdded=await window.__TAURI__.event.listen('p2p-peer-added',ev=>{
                    const d=ev.payload;
                    if(!d||!d.path)return;
                    p2pDevices[d.path]=d;
                    document.getElementById('p2p-section')?.style.setProperty('display','');
                    _renderP2PList();
                });
                _unlistenP2PRemoved=await window.__TAURI__.event.listen('p2p-peer-removed',ev=>{
                    if(ev.payload?.path)delete p2pDevices[ev.payload.path];
                    _renderP2PList();
                    if(Object.keys(p2pDevices).length===0)
                        document.getElementById('p2p-section')?.style.setProperty('display','none');
                });
                _unlistenP2PConn=await window.__TAURI__.event.listen('p2p-connected',ev=>{
                    const peer=ev.payload;
                    if(peer?.path)p2pConnected.add(peer.path);
                    if(sub)sub.textContent='Activo — Wi-Fi Direct conectado';
                    _renderP2PList();
                    toast('Wi-Fi Direct activo con '+(peer?.name||peer?.mac||'dispositivo'));
                });
                _renderDevicesList();
            }catch(err){
                document.querySelector('[data-toggle="qs-toggle"]')?.classList.remove('active');
                if(sub)sub.textContent='Error al iniciar';
                toast('No se pudo iniciar Quick Share: '+err);
            }
        } else {
            try{await tauriInvoke('qs_stop_discover');}catch(e){}
            try{await tauriInvoke('qs_stop');}catch(e){}
            qsRunning=false;
            _unlistenTransfer?.();_unlistenDevice?.();
            _unlistenP2PAdded?.();_unlistenP2PRemoved?.();_unlistenP2PConn?.();
            _unlistenTransfer=null;_unlistenDevice=null;
            _unlistenP2PAdded=null;_unlistenP2PRemoved=null;_unlistenP2PConn=null;
            p2pConnected.clear();
            if(sub)sub.textContent='Inactivo';
            if(visRow)visRow.style.display='none';
            if(discSec)discSec.style.display='none';
            if(recvSec)recvSec.style.display='none';
            document.getElementById('p2p-section')?.style.setProperty('display','none');
        }
    });

    // ── Visibility toggle ──
    setupToggle('qs-vis-toggle',async visible=>{
        try{await tauriInvoke('qs_set_visibility',{visible});}catch(err){toast('Error: '+err);}
    });

    // ── Download folder picker ──
    document.getElementById('qs-recv-folder-row')?.addEventListener('click',async()=>{
        if(!qsRunning){toast('Activa Quick Share primero');return;}
        try{
            const dir=await window.__TAURI__.dialog.open({directory:true,multiple:false});
            if(!dir)return;
            await tauriInvoke('qs_set_download_path',{path:dir});
            const lbl=document.getElementById('qs-folder-label');
            if(lbl)lbl.textContent=dir.replace(/^\/home\/[^/]+/,'~');
            toast('Carpeta actualizada');
        }catch(e){toast('Error: '+e);}
    });

    // ── Send file button ──
    document.getElementById('qs-send-btn')?.addEventListener('click',async()=>{
        if(!qsRunning){toast('Activa Quick Share primero');return;}
        const keys=Object.keys(qsDevices);
        if(keys.length===0){toast('Sin dispositivos cercanos encontrados');return;}
        let files=[];
        try{
            const picked=await window.__TAURI__.dialog.open({multiple:true});
            if(!picked)return;
            files=Array.isArray(picked)?picked:[picked];
        }catch(e){toast('No se pudo abrir el selector de archivos');return;}
        if(keys.length===1){
            const d=qsDevices[keys[0]];
            try{await tauriInvoke('qs_send_files',{endpointId:keys[0],name:d.name||'',addr:d.ip||'',files});toast('Enviando…');}
            catch(e){toast('Error al enviar: '+e);}
            return;
        }
        // Multiple devices — show picker
        showDialog('¿A qué dispositivo?',
            `<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">${keys.map(id=>`<button class="qs-pick-dev" data-id="${esc(id)}" style="padding:9px 14px;border-radius:10px;border:1.5px solid var(--brd);background:transparent;color:var(--tx);text-align:left;cursor:pointer">${esc(qsDevices[id].name||id)}</button>`).join('')}</div>`,
            {confirmText:'Cancelar',cancelText:'',onConfirm:()=>{}});
        setTimeout(()=>{
            document.querySelectorAll('.qs-pick-dev').forEach(btn=>btn.addEventListener('click',async()=>{
                const id=btn.dataset.id;const d=qsDevices[id];
                document.querySelector('.bk-overlay')?.remove();
                try{await tauriInvoke('qs_send_files',{endpointId:id,name:d.name||'',addr:d.ip||'',files});toast('Enviando…');}
                catch(e){toast('Error al enviar: '+e);}
            }));
        },100);
    });

    // ── Refresh KDE Connect battery every 60s ──
    addInterval(async()=>{
        try{
            const devs=JSON.parse(await tauriInvoke('get_kdeconnect_devices'));
            // reachable al final: si hay duplicados por nombre, gana el que responde
            devs.sort((a,b)=>(a.reachable?1:0)-(b.reachable?1:0));
            devs.forEach(d=>{
                document.querySelectorAll('.detail-item.detail-item-row').forEach(row=>{
                    if(row.querySelector('.dt')?.textContent?.includes(d.name)){
                        const sub=row.querySelector('.ds');
                        if(sub)sub.textContent=d.reachable?'Conectado y disponible':'Fuera de alcance';
                    }
                });
            });
        }catch(e){}
    },60000);
}

// ── Main dispositivos list ──────────────────────────────────────────────
// ── Connected-buds shortcut (used by the Home profile card) ──────────────
// Returns the connected earbuds/headset device, or null.
async function _getConnectedBudsDevice(){
    try{
        const st=JSON.parse(await tauriInvoke('get_bluetooth_status'));
        if(!(st.enabled||st.powered))return null;
        const devs=JSON.parse(await tauriInvoke('get_bluetooth_devices'));
        const isAudio=d=>{ const ic=(d.icon||'').toLowerCase(),nm=(d.name||'').toLowerCase();
            return ic.includes('headset')||ic.includes('headphone')||ic.includes('audio-head')||ic.includes('audio')||ic.startsWith('audio-')||
                   nm.includes('buds')||nm.includes('airpods')||nm.includes('headset')||nm.includes('earphone')||
                   nm.includes('galaxy buds')||nm.includes('pixel buds')||nm.includes('wf-')||nm.includes('wh-')||nm.includes('beats'); };
        return devs.find(d=>d.connected&&(isAudio(d)||!d.icon))||null;
    }catch(e){return null;}
}
if(typeof window!=='undefined'){
    window.getConnectedBuds=_getConnectedBudsDevice;
    // Open the Buds control page straight from the Home profile card.
    window.openConnectedBuds=async function(){
        const dev=await _getConnectedBudsDevice();
        if(!dev)return;
        const app=document.getElementById('app');
        if(!app)return;
        // Back returns to the (empty) Home view.
        if(window.pushSubNav)window.pushSubNav(()=>{ app.innerHTML=''; document.querySelectorAll('.item').forEach(i=>i.classList.remove('active-item')); });
        window.clearPageIntervals?.();
        _renderBudsDetail(app,dev);
    };
}
export async function renderDispositivos(c){
    c.innerHTML=renderHeader(t('hdr_devices'))+renderSkeleton(2);

    let btDevices=[], scanning=false;
    let btEnabled=false;
    try{const st=JSON.parse(await tauriInvoke('get_bluetooth_status'));btEnabled=!!(st.enabled||st.powered);}catch(e){}
    try{if(btEnabled)btDevices=JSON.parse(await tauriInvoke('get_bluetooth_devices'));}catch(e){}

    const isAudio=d=>{
        const ic=(d.icon||'').toLowerCase(),nm=(d.name||'').toLowerCase();
        return ic.includes('headset')||ic.includes('headphone')||ic.includes('audio-head')||
               ic.includes('audio')||ic.startsWith('audio-')||
               nm.includes('buds')||nm.includes('airpods')||nm.includes('headset')||
               nm.includes('earphone')||nm.includes('galaxy buds')||nm.includes('pixel buds')||
               nm.includes('wf-')||nm.includes('wh-')||nm.includes('beats');
    };
    // Connected audio device with empty icon still counts
    const budsDevices=btDevices.filter(d=>isAudio(d)||(d.connected&&!d.icon));
    // Sort: connected first
    budsDevices.sort((a,b)=>(b.connected?1:0)-(a.connected?1:0));

    // Pre-fetch battery for connected buds (in parallel, best-effort)
    const battMap={};
    await Promise.all(budsDevices.filter(d=>d.connected).map(async d=>{
        try{
            const r=JSON.parse(await tauriInvoke('get_bt_device_battery',{mac:d.mac}));
            if(r.percentage)battMap[d.mac]=r.percentage;
        }catch(e){}
    }));

    function _budsSubtitle(d){
        const batt=battMap[d.mac];
        const battSpan=batt?`<span style="color:var(--tx2);font-size:12px;margin-left:6px">· 🔋${batt}%</span>`:'';
        if(d.connected) return `<span style="color:var(--green)">Conectado${battSpan}</span>`;
        return `<span style="color:var(--tx2)">Desconectado</span>`;
    }

    const _SVG_SCAN=`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;

    let h=renderHeader(t('hdr_devices'));

    // ── Galaxy Buds ──
    h+=`<div class="section-header-row"><p class="section-header" style="margin:0">Galaxy Buds</p>
        ${btEnabled?`<button class="refresh-btn" id="btn-buds-scan" title="Buscar Buds">${_SVG_SCAN}Buscar</button>`:''}
    </div>`;

    if(!btEnabled){
        h+=renderCard([_devRow({icon:_SVG_HEADPHONES,iconColor:'var(--tx2)',
            title:'Bluetooth desactivado',subtitle:'Activa Bluetooth para ver tus Buds',
            right:`<button class="bk-dbtn confirm" id="bt-enable-btn" style="flex:0 0 auto;width:auto;height:auto;font-size:13px;padding:8px 20px;border-radius:18px">Activar</button>`})]);
    } else if(budsDevices.length===0){
        h+=renderCard([_devRow({id:'buds-pair',extraStyle:'cursor:pointer',
            icon:_SVG_HEADPHONES,iconColor:'var(--blue)',
            title:'Vincular nuevos Buds',subtitle:'Activa el modo emparejamiento en tus auriculares y pulsa Buscar',
            right:`<div style="color:var(--tx2);flex-shrink:0">${SVGI.chevronR}</div>`})]);
    } else {
        const _budsModelIcon=(name)=>{
            const n=(name||'').toLowerCase();
            const art=(n.includes('buds4')||n.includes('buds 4'))?'buds4pro-together.svg'
                     :(n.includes('buds3')||n.includes('buds 3'))?'buds3pro-together.png'
                     :(n.includes('buds2')||n.includes('buds 2'))?'buds3pro-together.svg':null;
            if(art)return `<img src="./assets/${art}" class="buds-model-icon${art.endsWith('.png')?' buds-keep-color':''}" style="width:36px;height:36px;object-fit:contain" alt="">`;
            return _SVG_HEADPHONES;
        };
        h+=renderCard(budsDevices.map((d,i)=>_devRow({
            extraClass:'buds-list-row',
            extraStyle:'cursor:pointer',
            icon:_budsModelIcon(d.name),
            iconColor:d.connected?'var(--green)':'var(--tx2)',
            title:esc(d.name),
            subtitle:_budsSubtitle(d),
            right:`<div style="display:flex;align-items:center;gap:8px">
                ${!d.connected?`<button class="bk-dbtn confirm buds-quick-conn" data-idx="${i}" style="font-size:12px;padding:5px 12px;flex-shrink:0">Conectar</button>`:''}
                <div style="color:var(--tx2);flex-shrink:0">${SVGI.chevronR}</div>
            </div>`
        })));
    }

    // ── Book Share ──
    h+=renderSection(t('sec_book_share'));
    h+=renderCard([_devRow({id:'bc-row',extraStyle:'cursor:pointer',
        icon:_SVG_SHARE,iconColor:'var(--blue)',
        title:'Book Share',subtitle:'Quick Share · KDE Connect · Archivos cercanos',
        right:`<div style="color:var(--tx2);flex-shrink:0">${SVGI.chevronR}</div>`})]);

    c.innerHTML=h;

    // BT enable
    document.getElementById('bt-enable-btn')?.addEventListener('click',async()=>{
        try{await tauriInvoke('toggle_bluetooth',{enable:true});}catch(e){}
        setTimeout(()=>renderDispositivos(c),1200);
    });

    // Scan button
    document.getElementById('btn-buds-scan')?.addEventListener('click',async()=>{
        const btn=document.getElementById('btn-buds-scan');
        if(!btn||scanning)return;
        scanning=true;
        btn.disabled=true;
        btn.innerHTML=`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="animation:spin .8s linear infinite"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>Buscando…`;
        try{await tauriInvoke('bluetooth_scan');}catch(e){}
        // Refresh list after 7s (scan runs for 6s)
        setTimeout(()=>renderDispositivos(c),7000);
    });

    // Pair new buds → go to Bluetooth page (scan/pair UI)
    document.getElementById('buds-pair')?.addEventListener('click',()=>{
        if(window.pushSubNav)window.pushSubNav(()=>renderDispositivos(c));
        window.clearPageIntervals?.();
        renderBTPage(c);
    });

    // Quick-connect buttons (stop propagation so row click doesn't fire)
    document.querySelectorAll('.buds-quick-conn').forEach(btn=>{
        btn.addEventListener('click',async e=>{
            e.stopPropagation();
            const device=budsDevices[parseInt(btn.dataset.idx)];
            if(!device)return;
            btn.disabled=true;btn.textContent='Conectando…';
            try{await tauriInvoke('connect_bluetooth',{mac:device.mac});}catch(e){}
            setTimeout(()=>renderDispositivos(c),1200);
        });
    });

    // Each Buds row → opens Buds detail sub-page
    document.querySelectorAll('.buds-list-row').forEach((row,i)=>{
        const device=budsDevices[i];
        if(!device)return;
        row.addEventListener('click',e=>{
            if(e.target.closest('.buds-quick-conn'))return; // handled above
            if(window.pushSubNav)window.pushSubNav(()=>renderDispositivos(c));
            window.clearPageIntervals?.();
            _renderBudsDetail(c,device);
        });
    });

    document.getElementById('bc-row')?.addEventListener('click',()=>{
        if(window.pushSubNav)window.pushSubNav(()=>renderDispositivos(c));
        window.clearPageIntervals?.();
        _renderBookShare(c);
    });

    // Live status + battery refresh every 10s
    addInterval(async()=>{
        if(!document.querySelector('.buds-list-row'))return;
        try{
            const devs=JSON.parse(await tauriInvoke('get_bluetooth_devices'));
            const audio=devs.filter(isAudio);
            audio.sort((a,b)=>(b.connected?1:0)-(a.connected?1:0));
            // Update battery for connected devices
            await Promise.all(audio.filter(d=>d.connected).map(async d=>{
                try{const r=JSON.parse(await tauriInvoke('get_bt_device_battery',{mac:d.mac}));if(r.percentage)battMap[d.mac]=r.percentage;}catch(e){}
            }));
            audio.forEach((d,i)=>{
                const rows=document.querySelectorAll('.buds-list-row');
                const row=rows[i];if(!row)return;
                const sub=row.querySelector('.ds');
                if(sub){
                    const batt=battMap[d.mac];
                    const battSpan=batt&&d.connected?`<span style="color:var(--tx2);font-size:12px;margin-left:6px">· 🔋${batt}%</span>`:'';
                    sub.innerHTML=d.connected?`<span style="color:var(--green)">Conectado${battSpan}</span>`:`<span style="color:var(--tx2)">Desconectado</span>`;
                }
                const iconEl=row.querySelector('[style*="color:"]');
                if(iconEl&&iconEl.tagName==='DIV')iconEl.style.color=d.connected?'var(--green)':'var(--tx2)';
            });
        }catch(e){}
    },10000);
}

// ── Opciones avanzadas de energía ──────────────────────────────────────
// Antes esto devolvía desktop.lockscreen(c): «Opciones avanzadas» de Batería
// abría la pantalla de bloqueo. La tapa la gestiona logind y la batería
// crítica UPower; el compositor no toca ninguna de las dos.
export async function renderEnergyAdvanced(c){
    c.innerHTML=renderHeader('Opciones avanzadas de energía')+renderSkeleton(3);
    let acc,cfg=null,fw=[];
    try{
        [acc,cfg,fw]=await Promise.all([
            tauriInvoke('get_power_actions').then(JSON.parse),
            tauriInvoke('bookos_get_config').then(JSON.parse).catch(()=>null),
            tauriInvoke('get_firmware_power_controls').then(JSON.parse).catch(()=>[]),
        ]);
    }catch(e){c.innerHTML=renderHeader('Opciones avanzadas de energía')+renderServiceError(e,'energía');return;}
    // Solo acciones de logind que tienen sentido en un portátil.
    const TAPA=[['suspend','Suspender'],['hibernate','Hibernar'],['lock','Bloquear la pantalla'],['poweroff','Apagar'],['ignore','No hacer nada']];
    // Suspend/Ignore exigen AllowRiskyCriticalPowerAction en UPower: con la
    // batería a cero, suspender puede perder lo que hay en memoria.
    const CRITICA=[['Auto','Automático'],['HybridSleep','Suspensión híbrida'],['Hibernate','Hibernar'],['PowerOff','Apagar']];
    const nombre=(list,v)=>(list.find(([k])=>k===v)||[v,v])[1];
    const SUSP=[0,60,300,600,1800,3600];
    const tiempo=v=>v===0?'Nunca':v<60?`${v} s`:v%3600===0?`${v/3600} h`:`${Math.round(v/60)} min`;
    const pick=(id,label)=>`<button type="button" class="bk-select" id="${id}" aria-haspopup="listbox"><span>${esc(_tr(label))}</span></button>`;
    let h=renderHeader('Opciones avanzadas de energía')
        +renderSection('Tapa')+renderCard([
            renderRowItem('Al cerrar la tapa con batería','',pick('pa-tapa',nombre(TAPA,acc.tapa))),
            renderRowItem('Al cerrar la tapa conectado','',pick('pa-tapa-ac',nombre(TAPA,acc.tapa_ac))),
            ...fw.filter(x=>x.id==='power_on_lid_open').map(x=>renderRowItem(x.label,'Firmware',renderToggle('fw-'+x.id,x.value))),
        ]);
    if(cfg)h+=renderSection('Inactividad')+renderCard([
        renderRowItem('Suspender tras el bloqueo','Cuenta desde que se bloquea la pantalla',pick('pa-susp',tiempo(cfg.suspension_inactividad??0))),
    ]);
    h+=renderSection('Batería')+renderCard([
        renderRowItem('Con la batería crítica','Lo decide UPower al llegar al nivel crítico',pick('pa-critica',nombre(CRITICA,acc.critica))),
    ]);
    const resto=fw.filter(x=>x.id!=='power_on_lid_open');
    if(resto.length)h+=renderSection('Firmware')+renderCard(resto.map(x=>renderRowItem(x.label,'',renderToggle('fw-'+x.id,x.value))));
    c.innerHTML=h;

    const menu=(id,title,list,current,apply)=>{
        const btn=document.getElementById(id);if(!btn)return;
        let actual=current;
        btn.addEventListener('click',()=>popoverSelect(btn.closest('.detail-item'),{title:_tr(title),current:actual,
            options:list.map(([val,label])=>({val:String(val),label:esc(_tr(label))})),
            onSelect:async v=>{
                const par=list.find(([k])=>String(k)===v);
                if(!par||String(actual)===v)return;
                btn.disabled=true;
                try{if(await apply(par[0])){actual=par[0];btn.querySelector('span').textContent=_tr(par[1]);toast(_tr('Guardado'));}}
                catch(e){toast(String(e),'❌');}
                finally{btn.disabled=false;}
            }}));
    };
    // Los valores salen de las listas de arriba, nunca del usuario: el guion
    // de shell no lleva nada que haya que escapar.
    const escribirTapa=(bat,ac)=>promptSudo('cambiar qué hace la tapa','sh',['-c',
        `mkdir -p /etc/systemd/logind.conf.d && printf '[Login]\\nHandleLidSwitch=${bat}\\nHandleLidSwitchExternalPower=${ac}\\n' > /etc/systemd/logind.conf.d/50-bookos.conf && systemctl kill -s HUP systemd-logind`]);
    menu('pa-tapa','Al cerrar la tapa con batería',TAPA,acc.tapa,async v=>{if(!await escribirTapa(v,acc.tapa_ac))return false;acc.tapa=v;return true;});
    menu('pa-tapa-ac','Al cerrar la tapa conectado',TAPA,acc.tapa_ac,async v=>{if(!await escribirTapa(acc.tapa,v))return false;acc.tapa_ac=v;return true;});
    menu('pa-critica','Con la batería crítica',CRITICA,acc.critica,v=>promptSudo('cambiar la acción con batería crítica','sh',['-c',
        `sed -i 's/^#\\?CriticalPowerAction=.*/CriticalPowerAction=${v}/' /etc/UPower/UPower.conf && systemctl restart upower`]));
    if(cfg){
        const v0=cfg.suspension_inactividad??0;
        const lista=(SUSP.includes(v0)?SUSP:[...SUSP,v0].sort((a,b)=>a-b)).map(v=>[v,tiempo(v)]);
        menu('pa-susp','Suspender tras el bloqueo',lista,v0,async v=>{await tauriInvoke('bookos_apply_config',{config:{suspension_inactividad:v}});return true;});
    }
    fw.forEach(x=>setupToggle('fw-'+x.id,async active=>{
        const r=await invokeWithAuth('set_firmware_power_control',{id:x.id,enabled:active},{description:'Este ajuste modifica el firmware y requiere permisos de administrador.'});
        if(!r?.ok)throw new Error(r?.error||'No se pudo aplicar el ajuste');
    }));
}

// ── Pantallas externas ─────────────────────────────────────────────────



// ── Pantallas, gestionadas por BookOS Desktop ───────────────────────────
// Mismo diseño que las demás pantallas: tarjetas, filas y
// popovers— pero hablando con el compositor. Lo que cambia es que aquí un
// fallo se ve: cada acción enseña «aplicando…» y termina en aplicado o en el
// error que devolvió el compositor, nunca en un éxito supuesto.
export async function renderPantallasBookOS(c){
    const title=_tr('Pantallas');
    c.innerHTML=renderHeader(title)+renderSkeleton(2);

    // El brillo va dentro de este render y no añadido después desde
    // renderPantalla: aquello lo anteponía al título (prepend sobre `c`), lo
    // pintaba a 0% con la pista vacía hasta leer el valor, y desaparecía en
    // cuanto aplicar() repintaba la página.
    const [outs,caps,brillo]=await Promise.all([bkGetOutputs(),bkCapabilities(),
        tauriInvoke('get_brightness').then(r=>{const d=JSON.parse(r);return d.ok===false?null:d.brightness;}).catch(()=>null)]);
    const rerender=()=>renderPantallasBookOS(c);
    // Toda acción reescribe la configuración entera y vuelve a dibujar con lo
    // que diga el censo nuevo: así lo que se ve es el estado real y no lo que
    // se pidió.
    const aplicar=async(id,cambios)=>{
        bkToast('pendiente',_tr('Aplicando')+'…');
        const r=await bkApply(bkPeticiones(outs,id,cambios));
        if(!r.ok){bkToast('error',r.error||_tr('Error al aplicar'));return false;}
        bkToast('aplicado',_tr('Aplicado'));
        rerender();
        return true;
    };

    let h=renderHeader(title);
    if(brillo!=null)h+=renderCard([renderRowItem(_tr('Brillo'),'',renderSlider('native-brightness',brillo))]);
    const setupBrillo=()=>{if(brillo!=null)setupSlider('native-brightness',async value=>{
        try{const r=JSON.parse(await tauriInvoke('set_brightness',{value:Number(value)}));if(r.ok===false)throw new Error(r.error);}
        catch(e){toast(String(e),'❌');}
    });};
    if(!outs.length){
        h+=renderCard([`<div class="detail-item"><span class="dt">${_tr('No se detectó ninguna pantalla')}</span></div>`]);
        c.innerHTML=h;
        setupBrillo();
        return;
    }

    const principal=outs.find(o=>o.principal&&o.activa)||outs.find(o=>o.activa)||outs[0];
    const activas=outs.filter(o=>o.activa).length;

    outs.forEach((o,idx)=>{
        const p=`bk${idx}`;
        const m=bkModoActual(o);
        const hz=bkHz(m);
        const nombre=[o.fabricante,o.modelo].filter(Boolean).join(' ')||o.conector;
        const rows=[];
        rows.push(renderRowItem(esc(nombre),esc(o.conector)+(o.mm_ancho?` · ${o.mm_ancho}×${o.mm_alto} mm`:''),
            renderToggle(`${p}-en`,o.activa)));
        if(o.activa){
            rows.push(`<div class="detail-item" style="cursor:pointer" id="${p}-res">
                <span class="dt">${_tr('Resolución')}</span>
                <div style="display:flex;align-items:center;gap:6px"><span style="color:var(--blue);font-size:14px">${esc(bkRes(m))}</span>${chevron()}</div>
            </div>`);
            rows.push(`<div class="detail-item" style="cursor:pointer" id="${p}-hz">
                <span class="dt">${_tr('Frecuencia de actualización')}</span>
                <div style="display:flex;align-items:center;gap:6px"><span style="color:var(--blue);font-size:14px">${hz} Hz</span>${chevron()}</div>
            </div>`);
            rows.push(`<div class="detail-item" style="cursor:pointer" id="${p}-scale">
                <span class="dt">${_tr('Escala')}</span>
                <div style="display:flex;align-items:center;gap:6px"><span style="color:var(--blue);font-size:14px">${Math.round(o.escala*100)}% · ${o.logico_ancho}×${o.logico_alto}</span>${chevron()}</div>
            </div>`);
            if(caps.rotation)rows.push(`<div class="detail-item" style="cursor:pointer" id="${p}-rot">
                <span class="dt">${_tr('Rotación')}</span>
                <div style="display:flex;align-items:center;gap:6px"><span style="color:var(--blue);font-size:14px">${esc(_tr(_bkRotLabel(o.transformacion)))}</span>${chevron()}</div>
            </div>`);
            if(o.vrr_capaz)rows.push(renderRowItem(_tr('Frecuencia variable'),
                _tr('Ajusta el refresco al contenido; ahorra batería'),renderToggle(`${p}-vrr`,o.vrr)));
            if(o!==principal)rows.push(`<div class="detail-item" style="cursor:pointer" id="${p}-pos">
                <span class="dt">${_tr('Posición')}</span>
                <div style="display:flex;align-items:center;gap:6px"><span style="color:var(--blue);font-size:14px">${esc(_bkPosLabel(o,principal))}</span>${chevron()}</div>
            </div>`);
            if(!o.principal)rows.push(`<div class="detail-item" style="cursor:pointer" id="${p}-primary"><span class="dt" style="color:var(--blue)">${_tr('Establecer como principal')}</span></div>`);
            const aviso=bkAvisoFluidez(o.escala,hz);
            if(aviso)rows.push(`<div class="detail-item"><span class="ds">⚠︎ ${esc(aviso)}</span></div>`);
        }
        h+=renderSection(o.principal?_tr('Pantalla principal'):(o.activa?_tr('Pantalla'):_tr('Pantalla desconectada del escritorio')));
        h+=renderCard(rows);
    });

    if(caps.multi_output===false&&outs.length>1){
        h+=renderCard([`<div class="detail-item"><span class="ds">${_tr('Esta versión del escritorio dibuja en una sola pantalla a la vez. Las demás se detectan y se pueden consultar, pero todavía no encenderse.')}</span></div>`]);
    }
    c.innerHTML=h;
    setupBrillo();

    outs.forEach((o,idx)=>{
        const p=`bk${idx}`;
        const m=bkModoActual(o);
        setupToggle(`${p}-en`,async a=>{
            // La comprobación de aquí es cortesía: quien decide de verdad es el
            // compositor, que rechaza cualquier configuración sin una pantalla
            // encendida. Adelantarla evita el viaje al bus y da mejor mensaje.
            if(!a&&activas<=1){bkToast('error',_tr('No puedes apagar la única pantalla encendida'));rerender();return;}
            if(!await aplicar(o.id,{activa:a}))rerender();
        });
        document.getElementById(`${p}-res`)?.addEventListener('click',e=>{
            const vistas=[...new Set((o.modos||[]).map(x=>`${x.ancho}x${x.alto}`))];
            popoverSelect(e.currentTarget,{
                title:_tr('Resolución'),
                options:vistas.map(r=>({val:r,label:r})),
                current:bkRes(m),
                onSelect:async v=>{
                    const [w,hh]=v.split('x').map(Number);
                    const cand=(o.modos||[]).filter(x=>x.ancho===w&&x.alto===hh)
                        .sort((a,b)=>(bkHz(b)===bkHz(m)?1:0)-(bkHz(a)===bkHz(m)?1:0)||b.refresco_mhz-a.refresco_mhz)[0];
                    if(!cand){bkToast('error',_tr('Ese modo no existe en esta pantalla'));return;}
                    await aplicar(o.id,{ancho:cand.ancho,alto:cand.alto,refresco_mhz:cand.refresco_mhz});
                },
            });
        });
        document.getElementById(`${p}-hz`)?.addEventListener('click',e=>{
            // Solo los refrescos de la resolución puesta: cambiar las dos cosas
            // a la vez desde un mismo menú es como se acaba pidiendo un modo
            // que no existe.
            const mismos=(o.modos||[]).filter(x=>x.ancho===m.ancho&&x.alto===m.alto)
                .sort((a,b)=>b.refresco_mhz-a.refresco_mhz);
            popoverSelect(e.currentTarget,{
                title:_tr('Frecuencia de actualización'),
                options:mismos.map(x=>({val:String(x.refresco_mhz),label:bkHz(x)+' Hz',
                    sub:bkAvisoFluidez(o.escala,bkHz(x))||undefined})),
                current:String(m.refresco_mhz),
                onSelect:async v=>{await aplicar(o.id,{ancho:m.ancho,alto:m.alto,refresco_mhz:parseInt(v)});},
            });
        });
        document.getElementById(`${p}-scale`)?.addEventListener('click',e=>{
            const escalas=(o.escalas?.length?o.escalas:[1,1.25,1.5,1.75,2]);
            popoverSelect(e.currentTarget,{
                title:_tr('Escala'),
                options:escalas.map(x=>{
                    const [lw,lh]=_bkLogico(m,x,o.transformacion);
                    return {val:String(x),label:Math.round(x*100)+'%',right:`${lw}×${lh}`,
                        sub:bkAvisoFluidez(x,bkHz(m))||undefined};
                }),
                current:String(o.escala),
                onSelect:async v=>{await aplicar(o.id,{escala:parseFloat(v)});},
            });
        });
        document.getElementById(`${p}-rot`)?.addEventListener('click',e=>{
            popoverSelect(e.currentTarget,{
                title:_tr('Rotación'),
                options:['normal','90','180','270'].map(x=>({val:x,label:_tr(_bkRotLabel(x))})),
                current:o.transformacion,
                onSelect:async v=>{await aplicar(o.id,{transformacion:v});},
            });
        });
        setupToggle(`${p}-vrr`,async a=>{
            if(!await aplicar(o.id,{vrr:a}))rerender();
        });
        document.getElementById(`${p}-pos`)?.addEventListener('click',e=>{
            const [pw,ph]=[principal.logico_ancho,principal.logico_alto];
            const [ow,oh]=_bkLogico(m,o.escala,o.transformacion);
            popoverSelect(e.currentTarget,{
                title:_tr('Posición'),
                options:[
                    {val:'right',label:_tr('A la derecha')},
                    {val:'left',label:_tr('A la izquierda')},
                    {val:'above',label:_tr('Arriba')},
                    {val:'below',label:_tr('Abajo')},
                    {val:'mirror',label:_tr('Duplicar pantalla')},
                ],
                current:'',
                onSelect:async v=>{
                    // Las posiciones son del conjunto: se recolocan las dos, y
                    // la principal se ancla al origen para que el escritorio no
                    // se vaya a coordenadas negativas.
                    const destino=v==='mirror'?{x:principal.x,y:principal.y}
                        :v==='left'?{x:principal.x-ow,y:principal.y}
                        :v==='above'?{x:principal.x,y:principal.y-oh}
                        :v==='below'?{x:principal.x,y:principal.y+ph}
                        :{x:principal.x+pw,y:principal.y};
                    bkToast('pendiente',_tr('Aplicando')+'…');
                    const r=await bkApply(bkPeticiones(outs,o.id,destino));
                    if(!r.ok){bkToast('error',r.error||_tr('Error al aplicar'));return;}
                    bkToast('aplicado',_tr('Aplicado'));
                    rerender();
                },
            });
        });
        document.getElementById(`${p}-primary`)?.addEventListener('click',async()=>{
            bkToast('pendiente',_tr('Aplicando')+'…');
            const r=await bkApply(bkPeticionesPrincipal(outs,o.id));
            if(!r.ok){bkToast('error',r.error||_tr('Error al aplicar'));return;}
            bkToast('aplicado',_tr('Aplicado'));
            rerender();
        });
    });
}

function _bkRotLabel(t){
    return {normal:'Sin rotar','90':'90°','180':'180°','270':'270°'}[t]||t;
}

function _bkLogico(m,escala,transformacion){
    if(!m)return [0,0];
    const gira=['90','270','flipped-90','flipped-270'].includes(transformacion);
    const w=gira?m.alto:m.ancho,h=gira?m.ancho:m.alto;
    // Hacia arriba, igual que el compositor: si aquí se redondease al más
    // próximo, la posición calculada para «a la derecha» dejaría una columna de
    // un píxel sin cubrir y el compositor lo rechazaría por solape.
    return [Math.ceil(w/escala),Math.ceil(h/escala)];
}

function _bkPosLabel(o,principal){
    const dx=o.x-principal.x,dy=o.y-principal.y;
    if(dx===0&&dy===0)return _tr('Duplicada');
    if(Math.abs(dy)>Math.abs(dx))return dy<0?_tr('Arriba'):_tr('Abajo');
    return dx<0?_tr('A la izquierda'):_tr('A la derecha');
}

// ── Touchpad y ratón — página del sidebar ──────────────────────────────
export async function renderTouchpadMouse(c){
return desktop.input(c);
}

// ── Teclado — página del sidebar ───────────────────────────────────────
export async function renderTeclado(c){
return desktop.keyboard(c);
}

// ── Pantalla de inicio ────────────────────────────────────────────────────

// BookOS: la configuración del dock vive dentro del applet icontasks del panel,
// no en un archivo de configuración suelto. La API del compositor la aplica
// en vivo, así que los cambios se reflejan sin reiniciar la sesión.
// y recarga el applet en vivo.
// El panel del dock lleva sus accesos; `dockWidgets` recoge además
// el Launchpad, que replica el mismo reposo encogido para no verse más grande.


// readConfig devuelve '' cuando la clave nunca se ha escrito -> vale el default


// La posición del dock pertenece al panel BookOS.


// El grosor del panel manda sobre el tamaño de los iconos del dock: es
// "height" en el API de scripting, tanto en horizontal como en vertical.



export async function renderPantallaInicio(c){
return desktop.home(c);
}

export function renderPlaceholder(c, title, msg='Esta sección estará disponible próximamente.'){
    c.innerHTML=renderHeader(title)+renderCard([renderInfoItem(msg,'En desarrollo')]);
}
