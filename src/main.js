import {startSystemEvents} from './modules/system-events.js';
import{renderHome,searchIndex,subSearchIndex}from'./modules/home.js';
import{t,getLang}from'./modules/i18n.js';
// Routines engine is light and needed at startup (seeding + system-event
// handlers), so it loads statically. The heavy page renderers in pages.js are
// dynamically imported on first navigation to keep cold start fast.
import{getRoutines,executeRoutine,snapshotForRoutine,restoreSnapshot,getRoutineSnapshot,deleteRoutineSnapshot,saveRoutineSnapshot,saveRoutines}from'./modules/routines-engine.js';
let _pagesPromise=null;
const _loadPages=()=>(_pagesPromise||(_pagesPromise=import('./modules/pages.js')));
import{tauriInvoke,isTauri}from'./tauri-api.js';
import{applyCachedPalette,syncPalette}from'./modules/dynamic-color.js';

const _esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let equipo={};
try{equipo=JSON.parse(localStorage.getItem('__equipo__')||'{}');}catch{}

/// Rellena el inicio con lo que pasa ahora: qué equipo es, a qué red está
/// conectado, cuánta batería queda, por dónde suena y a qué brillo. Antes el
/// inicio era un cartel de bienvenida y cuatro atajos con subtítulos fijos
/// («WiFi · Bluetooth · Modo Avión») que repetían la barra lateral.
async function rellenarInicio(app){
    const poner=(sel,texto)=>{const el=app.querySelector(sel);if(el&&texto)el.textContent=texto;};
    const json=async(cmd)=>{try{const v=JSON.parse(await tauriInvoke(cmd));return v?.ok===false?null:v;}catch{return null;}};
    const [info,wifi,bat,audio,brillo]=await Promise.all([
        json('get_system_info'),json('get_wifi_status'),json('get_battery_status'),json('get_audio_devices'),json('get_brightness'),
    ]);
    if(info){
        // Sin la edición entre paréntesis: «Fedora Linux 44 (KDE Plasma
        // Desktop Edition)» dice que el escritorio es Plasma, y no lo es.
        equipo={model:info.model!=='—'?info.model:'',distro:String(info.distro||'').replace(/\s*\([^)]*\)\s*$/,'')};
        try{localStorage.setItem('__equipo__',JSON.stringify(equipo));}catch{}
        poner('[data-equipo="modelo"]',equipo.model);
        poner('[data-equipo="sistema"]',equipo.distro);
    }
    if(wifi)poner('[data-estado="conexiones"]',!wifi.enabled?t('home_wifi_off'):wifi.ssid||t('home_wifi_none'));
    if(bat){
        const estado={charging:t('home_bat_charging'),'fully-charged':t('home_bat_full')}[bat.state];
        poner('[data-estado="bateria"]',`${parseInt(bat.percentage)||0} %${estado?' · '+estado:''}`);
    }
    if(audio?.output){
        const salida=(audio.sinks||[]).find(x=>x.name===audio.defaultSink);
        const nombre=salida?.description?.match(/Speaker$/)?t('home_speakers'):(salida?.description||'');
        poner('[data-estado="sonido"]',`${nombre?nombre+' · ':''}${audio.output.muted?t('home_muted'):audio.output.volume+' %'}`);
    }
    if(brillo&&brillo.brightness!=null)poner('[data-estado="pantalla"]',`${t('home_brightness')} ${brillo.brightness} %`);
}

function renderHomeLanding(){
    const quick=[
        ['conexiones','wifi.svg','connections','connections_sub'],
        ['pantalla','brightness.svg','display','display_sub'],
        ['sonido','sound.svg','sound','sound_sub'],
        ['bateria','battery.svg','battery','battery_sub'],
    ];
    return `<section class="home-landing" aria-label="${t('settings')}">
        <div class="home-landing-hero">
            <span class="home-landing-accent" aria-hidden="true"></span>
            <div class="home-landing-copy">
                <div class="home-landing-eyebrow">${t('settings')} · BOOKOS</div>
                <h2 data-equipo="modelo">${_esc(equipo.model||t('home_welcome_title'))}</h2>
                <p data-equipo="sistema">${_esc(equipo.distro||t('home_welcome_sub'))}</p>
            </div>
        </div>
        <div class="home-landing-section">
            <div class="home-landing-section-head">
                <span>${t('home_quick_title')}</span>
                <span class="home-landing-hint">${t('home_quick_hint')}</span>
            </div>
            <div class="home-quick-grid">
                ${quick.map(([page,icon,title,sub])=>`<button class="home-quick-card" type="button" data-page="${page}">
                    <img src="assets/${icon}" alt="" class="home-quick-icon">
                    <span class="home-quick-copy"><strong>${t(title)}</strong><small data-estado="${page}">${t(sub)}</small></span>
                    <span class="home-quick-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></span>
                </button>`).join('')}
            </div>
        </div>
    </section>`;
}

// La paleta dinámica se aplica desde la caché ANTES de que corra nada más: si
// esperase al backend, la ventana abriría con los colores de fábrica y saltaría
// al color del fondo medio segundo después, que es peor que no teñir nada.
applyCachedPalette();

document.addEventListener('DOMContentLoaded',async()=>{
    document.getElementById('wp-add-fab')?.remove();
    startSystemEvents().catch(console.error);
    const sb=document.getElementById('sb'),app=document.getElementById('app'),mc=document.getElementById('mc');
    // Apply translations to static index.html elements
    document.documentElement.lang=getLang();
    document.title=t('settings')+' BookOS';
    const _hdr=document.querySelector('.header-title');if(_hdr)_hdr.textContent=t('settings');
    const _sIn=document.getElementById('search-in');if(_sIn)_sIn.placeholder=t('search_placeholder');
    const _noR=document.getElementById('no-res');if(_noR)_noR.textContent=t('no_results');
    // ── Instant first paint ──
    // Never block the sidebar on backend shell spawns. Apply the last-known
    // theme + user from localStorage synchronously (no flash, no await), paint
    // immediately, then correct from the backend when it answers.
    const _applyTheme=(isDark)=>{document.documentElement.classList.toggle('dark-mode',isDark);document.documentElement.classList.toggle('light-mode',!isDark);};
    try{const c=localStorage.getItem('__theme_dark__');if(c!==null)_applyTheme(c==='1');}catch{}
    // Restore "reduced motion" lab preference (before any render)
    try{if(localStorage.getItem('bookos_lab_reducedmotion')==='true')document.documentElement.classList.add('reduced-motion');}catch{}
    let userInfo=null;
    try{userInfo=JSON.parse(localStorage.getItem('__user_info__')||'null');}catch{}
    if(sb)sb.innerHTML=renderHome(userInfo);
    // Todo "volver al inicio" pasa por aquí: vaciar #app dejaba el panel en blanco.
    const pintarInicio=()=>{app.innerHTML=renderHomeLanding();rellenarInicio(app);};
    if(app)pintarInicio();

    // ── Backend corrections (non-blocking) ──
    tauriInvoke('get_current_theme').then(j=>{try{const th=JSON.parse(j);if(typeof th.is_dark!=='boolean')return;_applyTheme(th.is_dark);localStorage.setItem('__theme_dark__',th.is_dark?'1':'0');}catch(e){}}).catch(()=>{});
    tauriInvoke('get_user_info').then(j=>{try{const ui=JSON.parse(j);if(JSON.stringify(ui)!==JSON.stringify(userInfo)){userInfo=ui;if(sb)sb.innerHTML=renderHome(ui);window.updateHomeBudsRow?.();}localStorage.setItem('__user_info__',j);}catch(e){}}).catch(()=>{});
    // Re-apply hardware settings saved from previous session (battery limit, perf mode)
    tauriInvoke('restore_startup_settings').catch(()=>{});
    // Corrige la paleta en caché con la que hay de verdad en disco (puede
    // haberla cambiado otra app, o haberse desactivado).
    syncPalette();
    // Detect distro package manager once and cache for UI
    tauriInvoke('get_pkg_mgr').then(j=>{try{localStorage.setItem('__pkg_mgr__',j);}catch{}}).catch(()=>{});
    tauriInvoke('has_flatpak').then(j=>{try{localStorage.setItem('__has_flatpak__',j);}catch{}}).catch(()=>{});

    // Warm the page-renderers module in the background once home is painted, so
    // the first navigation is instant despite the renderers being lazy-loaded.
    setTimeout(()=>{_loadPages();},500);

    // ── Cache warm-up ──
    // Prefetch the read data of the most-visited pages in the background so the
    // FIRST navigation to them is served instantly from the invoke cache.
    // Two staggered waves to avoid a process-spawn burst during startup.
    setTimeout(()=>{
        ['get_battery_status','get_brightness','get_volume','get_system_info',
         'get_wifi_status','get_bluetooth_status','get_airplane_mode']
            .forEach(c=>tauriInvoke(c).catch(()=>{}));
    },1200);
    setTimeout(()=>{
        ['get_audio_devices','get_bluetooth_devices',
         'get_theme_schedule','get_datetime_info','get_locale_info','get_lock_timeout']
            .forEach(c=>tauriInvoke(c).catch(()=>{}));
    },3000);

    // Page id → exported render function name in pages.js (resolved lazily).
    const pages={
        conexiones:'renderConexiones',pantalla:'renderPantalla',sonido:'renderSonido',
        bateria:'renderBateria',notificaciones:'renderNotificaciones',temas:'renderTemas',
        acerca:'renderAcerca',actualizacion:'renderActualizacion',recuperacion:'renderSnapshots',bloqueo:'renderBloqueo',
        general:'renderGeneral',cuentas:'renderCuentas',mantenimiento:'renderMantenimiento',
        seguridad:'renderSeguridad',fondos:'renderFondos',aplicaciones:'renderAplicaciones',
        dispositivos:'renderDispositivos',
        teclado:'renderTeclado',
        touchpadmouse:'renderTouchpadMouse',
        modos:'renderModos',
        avanzadas:'renderAvanzadas',
        accesibilidad:'renderAccesibilidad',
        inicio:'renderPantallaInicio',
        sddmeditor:'renderSddmEditor'
    };
    // Páginas directas / aliases usados por los widgets del panel (BookOS-Widgets)
    pages.wifi='renderWifiPage';          // subpágina Wi-Fi
    pages.bluetooth='renderBTPage';       // subpágina Bluetooth
    const pageAliases={red:'conexiones',brillo:'pantalla',volumen:'sonido'};
    Object.entries(pageAliases).forEach(([a,t])=>{ if(!pages[a]) pages[a]=pages[t]; });
    // Resolve+invoke a page renderer, loading the renderers module on first use.
    // The guarded container drops writes if the user navigated away meanwhile.
    function renderPage(id,container){
        _loadPages().then(mod=>{
            const fn=mod[pages[id]]||((c)=>mod.renderPlaceholder(c,id));
            fn(container);
        }).catch(e=>console.error('[renderPage]',id,e));
    }

    // ── Navigation ──
    const _navHistory=[];
    function clearPageIntervals(){
        // El botón vive en body, fuera de #app: limpiar la página no lo quita.
        // También se ejecuta al reabrir la ventana mediante resetToHome().
        document.getElementById('wp-add-fab')?.remove();
        document.getElementById('bk-popover')?.remove();   // el menú emergente también vive en body
        (window._pageCleanups||[]).splice(0).forEach(fn=>fn());
        if(window._pageIntervals){window._pageIntervals.forEach(clearInterval);window._pageIntervals=[];}
    }
    // Wrap the page container so async renders can't overwrite a newer page.
    // Each render gets a container bound to the nav epoch at call time; once the
    // user navigates (epoch bumps), writes from the stale render are ignored.
    // Al ir atrás o adelante se repone al instante la foto HTML de la página y
    // el render real llega encima. Mientras tanto se descarta su esqueleto:
    // pintarlo sobre la foto era el «cargando» de cada vuelta.
    let _desdeFoto=false;
    function mostrarFoto(html,scroll){
        if(!html)return;
        app.innerHTML=html;_desdeFoto=true;
        if(detailView)detailView.scrollTop=scroll||0;
    }
    function guardedContainer(epoch){
        return new Proxy(app,{
            set(target,prop,value){
                if(prop==='innerHTML' && (window._navEpoch||0)!==epoch) return true; // stale: drop write
                if(prop==='innerHTML'){
                    if(_desdeFoto&&String(value).includes('class="skeleton'))return true;
                    _desdeFoto=false;
                }
                target[prop]=value; return true;
            },
            get(target,prop){
                const v=target[prop];
                return typeof v==='function'?v.bind(target):v;
            }
        });
    }
    // Per-page scroll memory + HTML snapshots (for swipe previews)
    const _scrollMem={};
    const _pageSnaps={};
    const _fwdHistory=[];
    const detailView=document.querySelector('.detail-view');
    function _rememberScroll(pageId){
        if(!pageId||!detailView)return;
        _scrollMem[pageId]=detailView.scrollTop;
        // Snapshot the rendered page so swipe gestures can preview it
        if(app&&app.innerHTML)_pageSnaps[pageId]=app.innerHTML;
    }
    function _restoreScroll(pageId){
        if(!detailView)return;
        const y=_scrollMem[pageId]||0;
        // Pages render async; retry briefly until the content is tall enough
        let tries=0;
        (function attempt(){
            if(detailView.scrollHeight-detailView.clientHeight>=y||tries++>10){detailView.scrollTop=y;return;}
            setTimeout(attempt,50);
        })();
    }
    function _playTransition(back){
        app.classList.remove('page-enter','page-enter-back','no-anim');
        void app.offsetWidth;
        app.classList.add(back?'page-enter-back':'page-enter');
    }
    const _PADRES={wifi:'conexiones',bluetooth:'conexiones',sddmeditor:'bloqueo'};
    function openPage(id){
        if(!app)return;
        _navegando=true;
        // Bump the navigation token so any in-flight async render from the
        // previous page knows it's stale and must not overwrite the new page.
        const epoch=(window._navEpoch=(window._navEpoch||0)+1);
        clearPageIntervals();
        _desdeFoto=false;   // un salto nuevo sí enseña su esqueleto
        const curId=sb.querySelector('.item.active-item')?.dataset?.page;
        _rememberScroll(curId);
        // Skip push if navigating to same page; cap depth at 15
        if(curId!==id){
            _navHistory.push(curId||null);
            if(_navHistory.length>15)_navHistory.shift();
        }
        // Subpáginas con id propio (las abre el widget del panel, o una fila de
        // otra página): sin esto no tenían miga ni volvían a su sección.
        const padre=_PADRES[id];
        if(padre){
            const titulo=(window._tr||(x=>x))(searchIndex.find(x=>x.id===padre)?.title||'');
            _navHistory.push({_subNav:true,title:titulo,snapshot:'',scroll:0,fn:()=>{
                window._navEpoch=(window._navEpoch||0)+1;
                sb.querySelector(`[data-page="${padre}"]`)?.classList.add('active-item');
                renderPage(padre,guardedContainer(window._navEpoch));
            }});
        }
        sb.querySelectorAll('.item').forEach(i=>i.classList.remove('active-item'));
        sb.querySelector(`[data-page="${padre||id}"]`)?.classList.add('active-item');
        _fwdHistory.length=0;   // a fresh jump invalidates the forward stack
        _playTransition(false);
        if(detailView)detailView.scrollTop=0;
        renderPage(id,guardedContainer(epoch));
    }
    // Forward navigation (only reachable after going back)
    function goForward(){
        if(!_fwdHistory.length)return;
        _navegando=true;
        const epoch=(window._navEpoch=(window._navEpoch||0)+1);
        clearPageIntervals();
        const next=_fwdHistory.pop();
        const curId=sb.querySelector('.item.active-item')?.dataset?.page;
        _rememberScroll(curId);
        _navHistory.push(curId||null);
        if(_navHistory.length>15)_navHistory.shift();
        sb.querySelectorAll('.item').forEach(i=>i.classList.remove('active-item'));
        sb.querySelector(`[data-page="${next}"]`)?.classList.add('active-item');
        _playTransition(false);
        mostrarFoto(_pageSnaps[next],_scrollMem[next]);
        renderPage(next,guardedContainer(epoch));
        _restoreScroll(next);
    }
    function goBack(){
        const epoch=(window._navEpoch=(window._navEpoch||0)+1);
        clearPageIntervals();
        if(!_navHistory.length){pintarInicio();sb.querySelectorAll('.item').forEach(i=>i.classList.remove('active-item'));return;}
        const prev=_navHistory.pop();
        sb.querySelectorAll('.item').forEach(i=>i.classList.remove('active-item'));
        if(prev){
            sb.querySelector(`[data-page="${prev}"]`)?.classList.add('active-item');
            renderPage(prev,guardedContainer(epoch));
        } else {
            pintarInicio();
        }
    }
    // Push a callback-based back entry (for sub-pages that render into app directly)
    // Cabecera que se espera tras una navegación explícita. Si aparece otra
    // cabecera sin que nadie haya navegado, la página abrió una subpágina por
    // su cuenta, sin pushSubNav (ver el observador de migas).
    let _navegando=true;
    function pushSubNav(fn){
        _navegando=true;
        _navHistory.push({_subNav:true,fn,title:app?.querySelector('.detail-title')?.textContent||'',snapshot:app?.innerHTML||'',scroll:detailView?.scrollTop||0});
        if(_navHistory.length>15)_navHistory.shift();
    }
    // Extends goBack: handles callback-based sub-page entries pushed via pushSubNav
    function goBackExt(){
        _navegando=true;
        clearPageIntervals();
        if(!_navHistory.length){pintarInicio();sb.querySelectorAll('.item').forEach(i=>i.classList.remove('active-item'));return;}
        const prev=_navHistory.pop();
        // Sub-page pop: do NOT bump the epoch here — the callback re-renders the
        // parent through the guarded container it closed over, which was created
        // with the epoch still current. Bumping first made that container stale,
        // so the parent render was silently dropped and the next back-press
        // jumped to the wrong page.
        if(prev&&typeof prev==='object'&&prev._subNav){_playTransition(true);mostrarFoto(prev.snapshot,prev.scroll);prev.fn();return;}
        const epoch=(window._navEpoch=(window._navEpoch||0)+1);
        const curId=sb.querySelector('.item.active-item')?.dataset?.page;
        if(curId){_rememberScroll(curId);_fwdHistory.push(curId);if(_fwdHistory.length>15)_fwdHistory.shift();}
        sb.querySelectorAll('.item').forEach(i=>i.classList.remove('active-item'));
        if(prev){
            sb.querySelector(`[data-page="${prev}"]`)?.classList.add('active-item');
            _playTransition(true);
            mostrarFoto(_pageSnaps[prev],_scrollMem[prev]);
            renderPage(prev,guardedContainer(epoch));
            _restoreScroll(prev);
        } else {
            pintarInicio();
        }
    }
    // Vuelve al estado limpio: sin sección abierta, como recién arrancada.
    // Lo dispara el backend (evento "reset-to-home") cuando se pide mostrar la
    // ventana y estaba oculta — cerrar con la X no mata el proceso, así que sin
    // esto la app reaparecía en la misma página que se dejó abierta.
    async function resetToHome(){
        _navegando=true;
        window._navEpoch=(window._navEpoch||0)+1;   // invalida renders en vuelo
        clearPageIntervals();
        _navHistory.length=0;
        _fwdHistory.length=0;
        pintarInicio();
        sb.querySelectorAll('.item').forEach(i=>i.classList.remove('active-item'));
        if(sb)sb.scrollTop=0;
        // Deja el buscador vacío: reabrir con una búsqueda a medias del rato
        // anterior tampoco es "empezar limpio".
        const sIn=document.getElementById('search-in');
        if(sIn&&sIn.value){sIn.value='';sIn.dispatchEvent(new Event('input'));}
        // Si quien nos abrió pidió una página concreta (el widget de batería
        // escribe /tmp/bookos-start-page antes de lanzar), respetarla en vez de
        // quedarse en blanco. get_startup_page consume el fichero al leerlo, así
        // que solo aplica a la petición que acaba de llegar.
        // Antes esto solo se miraba al arrancar el proceso, de modo que con
        // Ajustes ya vivo el widget de batería nunca llegaba a su página.
        try{const sp=await tauriInvoke('get_startup_page');if(sp&&pages[sp])openPage(sp);}catch(e){}
    }
    window.resetToHome=resetToHome;

    window.openPage=openPage;
    window.goBack=goBackExt;
    // Alias: el editor de inicio de sesión lo llama por su nombre interno.
    window.goBackExt=goBackExt;
    window.goForward=goForward;
    document.addEventListener('click',e=>{
        if(e.target.closest('.back-btn'))window.goBack?.();
        // Saltar varias migas de golpe: se descartan las entradas intermedias
        // sin renderizarlas. Llamar a goBack n veces lanzaba n renders
        // asíncronos que podían terminar desordenados.
        const crumb=e.target.closest('.crumb');
        if(crumb){_navHistory.splice(_navHistory.length-Number(crumb.dataset.up)+1);goBackExt();}
    });
    // Migas de pan como en Windows para cualquier subpágina, sin que cada una
    // tenga que saber quién es su padre: salen de las entradas de pushSubNav
    // que haya al final del historial.
    // Muchas páginas abren sus subpáginas pintando otra cabecera en el mismo
    // contenedor sin pasar por pushSubNav: sin migas y con «atrás» saltando a
    // la página anterior del sidebar. Aquí se detecta ese cambio de título y se
    // apunta la entrada que falta; volver repinta la página del sidebar.
    let _tituloActual='';
    const tituloDe=h=>h?.querySelector('.detail-title')?.textContent||'';
    new MutationObserver(()=>{
        const header=app.querySelector('.detail-header');
        const titulo=tituloDe(header);
        if(!header){if(!app.childElementCount)_tituloActual='';return;}
        if(_navegando)_navegando=false;
        else if(_tituloActual&&titulo&&titulo!==_tituloActual&&!header.querySelector('.crumb')){
            const id=sb.querySelector('.item.active-item')?.dataset?.page;
            if(id){
                _navHistory.push({_subNav:true,title:_tituloActual,snapshot:'',scroll:0,fn:()=>renderPage(id,guardedContainer(window._navEpoch||0))});
                if(_navHistory.length>15)_navHistory.shift();
            }
        }
        _tituloActual=titulo;
        if(header.querySelector('.crumb'))return;
        const trail=[];
        for(let i=_navHistory.length-1;i>=0;i--){
            const h=_navHistory[i];
            if(!h||typeof h!=='object'||!h._subNav)break;
            if(h.title)trail.unshift({title:h.title,up:_navHistory.length-i});
        }
        if(!trail.length)return;
        const title=header.querySelector('.detail-title');if(!title)return;
        for(const c of trail){
            const b=document.createElement('button');b.type='button';b.className='crumb';b.dataset.up=c.up;b.textContent=c.title;
            const sep=document.createElement('span');sep.className='crumb-sep';sep.ariaHidden='true';sep.textContent='›';
            title.before(b,sep);
        }
    }).observe(app,{childList:true});
    window.pushSubNav=pushSubNav;
    window.clearPageIntervals=clearPageIntervals;
    window._navHistory=_navHistory;
    // Render guard: a render captures window._navEpoch at start; if it changed
    // by the time the async work finishes, the user navigated away — bail out.
    window.navEpoch=()=>window._navEpoch||0;
    window.isStale=(epoch)=>(window._navEpoch||0)!==epoch;
    // Navigate to --page startup arg if provided (e.g. launched from battery applet)
    try{const sp=await tauriInvoke('get_startup_page');if(sp&&pages[sp])openPage(sp);}catch(e){}


    // Open the Buds page from the Home shortcut; ensure pages.js (which owns
    // openConnectedBuds) is loaded first.
    const _openBuds=()=>{ if(window.openConnectedBuds)window.openConnectedBuds(); else _loadPages().then(()=>window.openConnectedBuds?.()); };
    sb?.addEventListener('click',e=>{
        const more=e.target.closest('.home-more-toggle');
        if(more){
            const card=more.closest('.home-more-card');
            const collapsed=card?.classList.toggle('is-collapsed');
            more.setAttribute('aria-expanded',String(!collapsed));
            return;
        }
        if(e.target.closest('#home-buds')){_openBuds();return;}
        const item=e.target.closest('[data-page]');
        if(item)openPage(item.dataset.page);
    });
    // Keyboard activation for the focusable (role="button") sidebar items.
    sb?.addEventListener('keydown',e=>{
        if(e.key!=='Enter'&&e.key!==' ')return;
        const more=e.target.closest('.home-more-toggle');
        if(more){e.preventDefault();more.click();return;}
        if(e.target.closest('#home-buds')){e.preventDefault();_openBuds();return;}
        const item=e.target.closest('[data-page]');
        if(item){e.preventDefault();openPage(item.dataset.page);}
    });
    app?.addEventListener('click',e=>{
        const item=e.target.closest('.home-quick-card[data-page]');
        if(item)openPage(item.dataset.page);
    });

    // Keep the Home profile-card buds shortcut in sync with the connected device.
    // Detect the connected earbuds/headset locally (pages.js is lazy-loaded, so
    // we can't rely on window.getConnectedBuds being available on the Home view).
    async function _connectedBudsLocal(){
        try{
            const st=JSON.parse(await tauriInvoke('get_bluetooth_status'));
            if(!(st.enabled||st.powered))return null;
            const devs=JSON.parse(await tauriInvoke('get_bluetooth_devices'));
            const isAudio=d=>{const ic=(d.icon||'').toLowerCase(),nm=(d.name||'').toLowerCase();
                return ic.includes('headset')||ic.includes('headphone')||ic.includes('audio-head')||ic.includes('audio')||ic.startsWith('audio-')||
                       nm.includes('buds')||nm.includes('airpods')||nm.includes('headset')||nm.includes('earphone')||
                       nm.includes('galaxy buds')||nm.includes('pixel buds')||nm.includes('wf-')||nm.includes('wh-')||nm.includes('beats');};
            return devs.find(d=>d.connected&&(isAudio(d)||!d.icon))||null;
        }catch(e){return null;}
    }
    // Show the shortcut whenever earbuds/headset are connected (auto or manual).
    async function updateHomeBudsRow(){
        const row=document.getElementById('home-buds');
        if(!row)return;
        let dev=null;
        try{ dev=await (window.getConnectedBuds?window.getConnectedBuds():_connectedBudsLocal()); }catch(e){ dev=await _connectedBudsLocal().catch(()=>null); }
        if(dev&&dev.connected){
            row.style.display='';
            const nm=row.querySelector('.home-buds-name');
            if(nm)nm.textContent=dev.name||'Buds';
        }else{
            row.style.display='none';
        }
    }
    window.updateHomeBudsRow=updateHomeBudsRow;
    // pages.js (where getConnectedBuds lives) is lazy-loaded; poll so the row
    // appears once it's available and tracks connect/disconnect.
    updateHomeBudsRow();
    // Esto solo pinta una fila de la pantalla de inicio, así que no tiene
    // sentido refrescarlo con la ventana oculta — a diferencia de los timers de
    // auriculares y rutinas de más abajo, que sí deben seguir con la app en la
    // bandeja. Se refresca además al volver a la ventana, para que la fila esté
    // al día en cuanto se mira.
    // Por aviso del servicio del sistema (BlueZ cambia → `bookos-system-changed`)
    // y no cada 5 s: eran 24 llamadas por minuto con la ventana quieta —medido—
    // para una fila que cambia al conectar o desconectar unos auriculares.
    // El aviso trae el estado entero —red, Bluetooth y audio—: solo cuenta si
    // cambió la parte de Bluetooth, o la señal del Wi-Fi también la repintaba.
    let _btAnterior='';
    window.addEventListener('bookos-system-changed',e=>{
        const bt=JSON.stringify(e.detail?.bluetooth??null);
        if(bt===_btAnterior)return;
        _btAnterior=bt;
        if(!document.hidden)updateHomeBudsRow();
    });
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden) updateHomeBudsRow(); });

    // ── Search ──
    const sIn=document.getElementById('search-in'),sX=document.getElementById('search-x'),noR=document.getElementById('no-res');
    // Prefetch pages.js on first focus so window._tr is ready for sub-results.
    sIn?.addEventListener('focus',()=>{_loadPages();},{once:true});
    sIn?.addEventListener('input',()=>{const v=sIn.value.length>0;if(sX)sX.style.visibility=v?'visible':'hidden';filter(sIn.value);});
    sIn?.addEventListener('keydown',e=>{if(e.key==='Escape'){sIn.value='';if(sX)sX.style.visibility='hidden';filter('');}});
    sX?.addEventListener('click',()=>{sIn.value='';if(sX)sX.style.visibility='hidden';filter('');sIn.focus();});

    // Container for sub-setting results (created on-demand, lives at end of sidebar)
    let _subResultsCard=null;
    function _ensureSubResultsCard(){
        if(_subResultsCard&&document.body.contains(_subResultsCard))return _subResultsCard;
        _subResultsCard=document.createElement('div');
        _subResultsCard.className='card sub-results-card';
        _subResultsCard.style.display='none';
        sb.appendChild(_subResultsCard);
        return _subResultsCard;
    }
    // Normaliza para comparar: minúsculas y sin diacríticos, para que "bateria"
    // encuentre "Batería" y "energia" encuentre "Energía".
    const _norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'');
    // El índice está escrito solo en español y _tr() se aplicaba únicamente al
    // pintar, nunca al comparar: en inglés solo se encontraba lo que tuviera
    // keywords en inglés puestas a mano. Ahora se compara contra ambos idiomas.
    const _hit=(q,...vals)=>{
        const trf=window._tr||(x=>x);
        return vals.some(v=>{
            if(!v)return false;
            if(Array.isArray(v))return v.some(k=>_norm(k).includes(q));
            return _norm(v).includes(q)||_norm(trf(v)).includes(q);
        });
    };

    function filter(raw){
        const q=_norm((raw||'').trim());
        const cards=sb.querySelectorAll('.card:not(.sub-results-card)');let any=false;
        const subCard=_ensureSubResultsCard();
        if(!q){cards.forEach(c=>{c.classList.remove('hidden');c.querySelectorAll('.item').forEach(i=>i.classList.remove('hidden'));if(c.classList.contains('home-more-card')){c.classList.add('is-collapsed');c.querySelector('.home-more-toggle')?.setAttribute('aria-expanded','false');}});subCard.style.display='none';subCard.innerHTML='';noR.style.display='none';return;}
        cards.forEach(card=>{
            if(card.classList.contains('card-profile')){const m=_hit(q,['cuenta','perfil','profile','account','usuario','user']);card.classList.toggle('hidden',!m);if(m)any=true;return;}
            let vis=false;
            card.querySelectorAll('.item[data-page]').forEach(item=>{
                const e=searchIndex.find(s=>s.id===item.dataset.page);
                if(!e){item.classList.add('hidden');return;}
                const ok=_hit(q,e.title,e.subtitle,e.keywords);
                item.classList.toggle('hidden',!ok);if(ok)vis=true;
            });
            card.classList.toggle('hidden',!vis);if(vis)any=true;
            if(vis&&card.classList.contains('home-more-card')){card.classList.remove('is-collapsed');card.querySelector('.home-more-toggle')?.setAttribute('aria-expanded','true');}
        });
        // Sub-setting matches — show items that didn't already match by parent page
        const visiblePages=new Set([...sb.querySelectorAll('.card:not(.hidden) .item[data-page]:not(.hidden)')].map(i=>i.dataset.page));
        const subMatches=subSearchIndex.filter(s=>{
            if(visiblePages.has(s.parent))return false;
            return _hit(q,s.title,s.keywords);
        }).slice(0,30);
        if(subMatches.length){
            const labelOf=id=>searchIndex.find(x=>x.id===id)?.title||id;
            // _tr (literal ES→EN dict) lives in pages/_common.js; identity until it loads.
            const trf=window._tr||(x=>x);
            const inWord=getLang()==='es'?'en':'in';
            subCard.innerHTML=subMatches.map(s=>`<div class="item sub-result-item" data-page="${s.page||s.parent}" tabindex="0"><div class="item-icon sub-result-ic">›</div><div class="item-texts"><span class="title">${trf(s.title)}</span><span class="subtitle">${inWord} ${trf(labelOf(s.parent))}</span></div></div>`).join('');
            subCard.style.display='';
            any=true;
        }else{
            subCard.style.display='none';subCard.innerHTML='';
        }
        noR.style.display=any?'none':'block';
    }

    // ── Sidebar collapse toggle ──
    // The sidebar is always visible on launch; it only hides when the user
    // presses the toggle (or Ctrl+B) within the session — no persistence.
    {
        document.getElementById('sidebar-toggle')?.addEventListener('click',()=>{
            mc?.classList.toggle('sidebar-collapsed');
        });
        // Keyboard shortcut: Ctrl+B
        document.addEventListener('keydown',e=>{
            if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='b'&&!e.target?.matches?.('input,textarea')){
                e.preventDefault();
                mc?.classList.toggle('sidebar-collapsed');
            }
        });
    }

    // Sin manejador de `wheel` propio: uno no pasivo que hacía preventDefault y
    // movía scrollTop por rAF (con getComputedStyle por evento) sacaba el scroll
    // del compositor y lo pasaba al hilo principal; a escala 2× iba a saltos.

    // ── Window controls ──
    if(isTauri()){
        let w=window.__TAURI__?.window?.getCurrentWindow?.()||window.__TAURI__?.window?.appWindow;
        if(w){
            document.getElementById('minimize')?.addEventListener('click',()=>w.minimize());
            document.getElementById('close')?.addEventListener('click',()=>w.close());
            const mx=document.getElementById('maximize');
            // Iconos y no caracteres: ☐ y ❐ salían distintos con cada fuente.
            const ICONO_MAX='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>';
            const ICONO_RESTAURAR='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="12" height="12" rx="2.5"/><path d="M8 8V6.5A2.5 2.5 0 0 1 10.5 4h7A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H16"/></svg>';
            const toggleMax=async()=>{
                if(await w.isMaximized()){await w.unmaximize();mx.innerHTML=ICONO_MAX;mc?.classList.add('windowed');}
                else{await w.maximize();mx.innerHTML=ICONO_RESTAURAR;mc?.classList.remove('windowed');}
            };
            mx?.addEventListener('click',toggleMax);
            // NOTE: double-clicking a data-tauri-drag-region already toggles
            // maximize natively. A JS dblclick handler here would fire a *second*
            // toggle (maximize then immediately restore) — so we don't add one.
            // Instead we just keep the button icon / windowed class in sync.
            const syncMaxState=async()=>{
                const m=await w.isMaximized().catch(()=>false);
                if(mx)mx.innerHTML=m?ICONO_RESTAURAR:ICONO_MAX;
                mc?.classList.toggle('windowed',!m);
            };
            w.onResized?.(syncMaxState);
            await syncMaxState();
        }
    }

    // ── Touch swipe gestures (2-finger horizontal = back/forward) ──
    {
        let t0=null;
        document.addEventListener('touchstart',e=>{if(e.touches.length===2)t0={x:(e.touches[0].clientX+e.touches[1].clientX)/2,y:(e.touches[0].clientY+e.touches[1].clientY)/2};},{passive:true});
        document.addEventListener('touchend',e=>{
            if(!t0||e.changedTouches.length<1)return;
            const x1=(e.changedTouches[0].clientX+(e.changedTouches[1]?.clientX??e.changedTouches[0].clientX))/2;
            const y1=(e.changedTouches[0].clientY+(e.changedTouches[1]?.clientY??e.changedTouches[0].clientY))/2;
            const dx=x1-t0.x, dy=y1-t0.y;
            t0=null;
            if(Math.abs(dy)>60||Math.abs(dx)<80)return;
            if(dx>0)window.goBack?.();
        },{passive:true});
    }

    // ── Touchpad gestures: interactive swipe back/forward with live preview ──
    // Touchpads emit wheel events with deltaX (no touch events in WebKitGTK).
    // Swipe right = back, swipe left = forward. The destination page slides in
    // as a real preview card (Android predictive-back style) using the HTML
    // snapshot taken when you left that page. Navigation only commits on
    // RELEASE (wheel silence ≈ fingers lifted) at full progress.
    {
        const THRESHOLD=300;
        let acc=0,endT=null,active=false,dir=0;   // dir: -1 back, +1 forward
        let cooldownUntil=0;                       // swallow touchpad momentum after a gesture ends
        // Arrow bubble (progress indicator)
        const bub=document.createElement('div');
        bub.className='swipe-back-bubble';
        const ARROW_BACK='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
        const ARROW_FWD='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
        document.body.appendChild(bub);
        // Preview card inside a clipping frame pinned to the content area, so
        // the card emerges from the sidebar's edge instead of crossing over it.
        const clip=document.createElement('div');
        clip.className='swipe-preview-clip';
        const card=document.createElement('div');
        card.className='swipe-preview detail-view';
        clip.appendChild(card);
        document.body.appendChild(clip);
        function targetPage(){
            if(dir<0){
                const prev=_navHistory[_navHistory.length-1];
                return typeof prev==='string'?{snapshot:_pageSnaps[prev],scroll:_scrollMem[prev]||0}:prev?{snapshot:prev.snapshot,scroll:prev.scroll}:null;
            }
            const next=_fwdHistory[_fwdHistory.length-1];
            return next?{snapshot:_pageSnaps[next],scroll:_scrollMem[next]||0}:null;
        }
        let areaRect=null;   // detail-view rect captured at gesture start (sidebar-aware)
        function beginPreview(){
            areaRect=detailView?detailView.getBoundingClientRect():null;
            const target=targetPage();
            if(!target?.snapshot||!areaRect){clip.style.display='none';return;}
            const r=areaRect;
            clip.style.cssText=`display:block;top:${r.top}px;left:${r.left}px;width:${r.width}px;height:${r.height}px`;
            card.style.transform=`translateX(${dir<0?-104:104}%)`;
            card.innerHTML=`<div>${target.snapshot}</div>`;
            card.scrollTop=target.scroll;
        }
        function paint(p){
            const side=dir<0?1:-1;   // back: things come from the left
            bub.innerHTML=dir<0?ARROW_BACK:ARROW_FWD;
            bub.style.opacity=Math.min(1,p*1.6);
            // Anchor the bubble to the content area's edges, not the window's,
            // so it doesn't land on top of the sidebar when it's open.
            const aL=areaRect?areaRect.left:0;
            const aR=areaRect?(window.innerWidth-areaRect.right):0;
            bub.style.left=dir<0?aL+'px':'auto';
            bub.style.right=dir<0?'auto':aR+'px';
            bub.style.transform=`translateY(-50%) translateX(${side*(-46+p*62)}px) scale(${0.6+p*0.4})`;
            bub.classList.toggle('armed',p>=1);
            // Preview slides in over the page; page parallaxes away
            card.style.transform=`translateX(${side*(-104+p*104)}%)`;
            if(detailView)detailView.style.transform=`translateX(${side*p*42}px)`;
        }
        function reset(fire){
            const p=Math.min(1,Math.abs(acc)/THRESHOLD);
            const commit=fire&&p>=1;
            acc=0;active=false;          // dir stays set until the exit paint below
            // Inertia after lifting the fingers must not start a new gesture
            cooldownUntil=Date.now()+(commit?800:450);
            bub.classList.add('anim');card.classList.add('anim');
            if(detailView){detailView.style.transition='transform .25s cubic-bezier(.2,.8,.3,1)';detailView.style.transform='';}
            if(commit){
                // Preview finishes sliding to cover the page, then the real
                // render happens underneath it before it fades away.
                card.style.transform='translateX(0)';
                bub.style.opacity='0';
                if(dir<0)window.goBackExt?.();else window.goForward?.();
                setTimeout(()=>{card.style.opacity='0';},180);
                setTimeout(()=>{clip.style.display='none';card.style.opacity='';card.innerHTML='';},420);
            }else{
                paint(0);
                setTimeout(()=>{clip.style.display='none';card.innerHTML='';},260);
            }
            dir=0;
            setTimeout(()=>{bub.classList.remove('anim','armed');card.classList.remove('anim');if(detailView)detailView.style.transition='';},260);
        }
        document.addEventListener('wheel',e=>{
            if(Date.now()<cooldownUntil)return;    // momentum tail: ignore entirely
            if(Math.abs(e.deltaX)<=Math.abs(e.deltaY)){if(active)reset(false);return;}
            let el=e.target instanceof Element?e.target:null;
            while(el&&el!==document.body){
                if(el.scrollWidth>el.clientWidth+5){const ox=getComputedStyle(el).overflowX;if(ox==='auto'||ox==='scroll')return;}
                el=el.parentElement;
            }
            if(!active){
                // Gestures start only inside the content area — never from the
                // sidebar, which stays untouched and fully visible.
                if(!(e.target instanceof Element)||!detailView||!detailView.contains(e.target))return;
                // Direction decided once, at gesture start, and locked
                const newDir=e.deltaX<0?-1:1;
                if(newDir<0&&!_navHistory.length)return;
                if(newDir>0&&!_fwdHistory.length)return;
                dir=newDir;acc=0;active=true;
                bub.classList.remove('anim');card.classList.remove('anim');
                beginPreview();
            }
            acc+=e.deltaX;
            // Locked direction: pulling the other way only reduces progress
            if(dir<0&&acc>0)acc=0;
            if(dir>0&&acc<0)acc=0;
            paint(Math.min(1,Math.abs(acc)/THRESHOLD));
            clearTimeout(endT);
            endT=setTimeout(()=>reset(true),140);
        },{passive:true});
        clip.addEventListener('click',()=>{
            if(!active)return;
            clearTimeout(endT);
            acc=dir*THRESHOLD;
            reset(true);
        });
    }

    // ── Keyboard shortcuts ──
    document.addEventListener('keydown',e=>{
        // El buscador vive en la barra lateral: si está plegada, desplegarla
        // antes de enfocar o el foco iría a un elemento con pointer-events:none.
        if((e.ctrlKey||e.metaKey)&&e.key==='f'){e.preventDefault();mc?.classList.remove('sidebar-collapsed');sIn?.focus();sIn?.select();}
        // Escape no navega atrás si hay un diálogo/popover abierto (cada uno
        // gestiona el suyo) ni mientras se escribe en un campo — antes se iba
        // hacia atrás dejando el diálogo huérfano encima de la página nueva.
        if(e.key==='Escape'){
            if(document.querySelector('.bk-overlay,#bk-popover,dialog[open]')||e.target?.matches?.('input,textarea'))return;
            goBackExt();
        }
        if(e.key==='ArrowDown'||e.key==='ArrowUp'){
            const items=[...sb.querySelectorAll('.item:not(.hidden)[tabindex]')];
            const cur=document.activeElement;const idx=items.indexOf(cur);
            if(idx>=0){e.preventDefault();items[e.key==='ArrowDown'?Math.min(idx+1,items.length-1):Math.max(idx-1,0)]?.focus();}
            else if(items.length)items[0]?.focus();
        }
        if(e.key==='Enter'&&document.activeElement?.dataset?.page)openPage(document.activeElement.dataset.page);
    });

    // ── Routine automation ──────────────────────────────────────────────
    // Opposite trigger map: when a trigger fires, which trigger is its "undo" event?
    const OPPOSITE_TRIGGERS={
        power_connected:'power_disconnected',
        power_disconnected:'power_connected',
        wifi_on:'wifi_off',
        wifi_off:'wifi_on',
        bt_on:'bt_off',
        bt_off:'bt_on',
        low_battery:'power_connected'
    };
    // Built-in battery routine, seeded once: switch to power-saver when the
    // charger is unplugged; the undo snapshot restores the previous profile on
    // reconnect. User can edit/disable/delete it like any routine.
    try{
        if(!localStorage.getItem('bookos_seeded_battery_routine')){
            localStorage.setItem('bookos_seeded_battery_routine','1');
            const rs=getRoutines();
            if(!rs.some(r=>r.triggers&&r.triggers.some(t=>t.type==='power_disconnected'))){
                rs.push({id:crypto.randomUUID(),name:'Ahorro al desconectar',enabled:true,undo:true,
                         triggers:[{type:'power_disconnected'}],
                         actions:[{type:'performance',value:'power-saver'}]});
                saveRoutines(rs);
            }
        }
    }catch(e){}

    // Fire all enabled routines that match a given trigger type.
    // Undo snapshots are persisted (localStorage) so the "switch back to the
    // previous state" works even if the app was restarted in between, and
    // regardless of the routine's undo flag (the flag only governs manual
    // disable-restore in the routines page).
    async function fireMatchingRoutines(triggerType){
        const routines=getRoutines();

        // 1) Restore any routine whose opposite trigger just fired
        for(const r of routines){
            if(!r.enabled||r.undo===false)continue;
            const opposites=new Set();
            for(const t of r.triggers){if(OPPOSITE_TRIGGERS[t.type])opposites.add(OPPOSITE_TRIGGERS[t.type]);}
            if(!opposites.has(triggerType))continue;
            const snap=getRoutineSnapshot(r.id);
            if(!snap)continue;
            try{
                await restoreSnapshot(snap);
                deleteRoutineSnapshot(r.id);
                if(window.toast)window.toast(`"${r.name||'Rutina'}" restaurada`,'↩️');
            }catch(e){}
        }

        // 2) Then fire matching routines (snapshot current state first)
        const matching=routines.filter(r=>r.enabled&&r.triggers.some(t=>t.type===triggerType));
        for(const r of matching){
            try{
                if(r.undo!==false&&r.triggers.some(t=>OPPOSITE_TRIGGERS[t.type]))
                    await saveRoutineSnapshot(r);
                await executeRoutine(r);
                if(window.toast)window.toast(`Rutina "${r.name}" ejecutada automáticamente`,'⚙️');
            }catch(e){}
        }
    }

    // Listen for system events emitted by the Rust backend
    if(isTauri()){
        const listenFn=window.__TAURI__?.event?.listen||window.__TAURI__?.core?.listen;
        if(listenFn){
            listenFn('routine-trigger',(ev)=>{
                const trigger_type=ev?.payload?.trigger_type;
                if(trigger_type)fireMatchingRoutines(trigger_type);
            });
            // El backend lo emite justo antes de mostrar una ventana que estaba
            // oculta, para que reabrir desde el menú empiece en blanco.
            listenFn('reset-to-home',()=>{ try{ resetToHome(); }catch(e){} });
            // Otra instancia pide una página: llega como evento, no preguntando
            // cada 2 s como antes (medido: 30 llamadas por minuto en reposo).
            listenFn('navigate',e=>{ const p=e?.payload; if(p&&pages[p])openPage(p); });
        }
    }

    // Buds battery watcher: notify when low (<20%) once per session, plus
    // refresh tray-level info every 2 min while connected.
    // Note: no document.hidden guard on the buds watchers — they exist
    // precisely for when the app sits hidden in the tray.
    const _budsLowFired={l:false,r:false,c:false};
    setInterval(async()=>{
        try{
            const st=JSON.parse(await tauriInvoke('buds_get_status'));
            if(!st||!st.connected) return;
            const l=st.battery_l|0, r=st.battery_r|0, ca=st.battery_case|0;
            const isLow=(l>0&&l<=20)||(r>0&&r<=20);
            if(isLow){
                const key=(l<=20?'l':'')+(r<=20?'r':'');
                if(!_budsLowFired[key]){
                    _budsLowFired[key]=true;
                    const lang=localStorage.getItem('bookos_lang')||'es';
                    await tauriInvoke('buds_notify_battery',{left:l,right:r,case:ca,low:true,lang}).catch(()=>{});
                }
            } else {
                // Reset trigger when batteries recover
                _budsLowFired.l=false;_budsLowFired.r=false;
            }
        }catch(e){}
    },120000);

    // Buds auto-reconnect: every 15s ask backend to reconnect any saved buds
    // marked with auto_reconnect=true if they're in range. Cheap no-op when already connected.
    setInterval(async()=>{
        if(!localStorage.getItem('buds_last_mac'))return;
        try{await tauriInvoke('buds_try_auto_reconnect');}catch(e){}
    },15000);

    // Buds audio-aware switch: every 5s check if PC is playing audio. If yes + buds
    // not on PC → connect (steal from phone). If silent ~30s + buds on PC → disconnect
    // (let phone take them).
    setInterval(async()=>{
        const mac = localStorage.getItem('buds_last_mac');
        if(!mac) return;
        try{
            const r = JSON.parse(await tauriInvoke('buds_audio_switch_check',{mac}));
            if(r.action==='connect'){
                await tauriInvoke('connect_bluetooth',{mac}).catch(()=>{});
            } else if(r.action==='disconnect'){
                await tauriInvoke('buds_disconnect').catch(()=>{});
                await tauriInvoke('disconnect_bluetooth',{mac}).catch(()=>{});
            }
        }catch(e){}
    },5000);

    // Watchdog: time-based routines. Window-based comparison instead of exact
    // HH:MM equality — interval drift or webview timer throttling used to skip
    // minutes entirely, so scheduled routines (e.g. backlight at a set hour)
    // silently never fired. Now any trigger time that fell inside the window
    // since the last check fires exactly once.
    let _lastTimeCheck=Date.now();
    setInterval(async()=>{
        const now=Date.now();
        const from=_lastTimeCheck;
        _lastTimeCheck=now;
        // Cap the window at 6h so a laptop waking from a long suspend doesn't
        // replay a whole day of routines.
        const windowStart=Math.max(from,now-6*3600*1000);
        const routines=getRoutines();
        for(const r of routines){
            if(!r.enabled)continue;
            for(const t of r.triggers){
                if(t.type!=='time'||!t.value)continue;
                const m=/^(\d{1,2}):(\d{2})$/.exec(t.value);
                if(!m)continue;
                // Today's occurrence of the trigger time (and yesterday's, for
                // windows that span midnight)
                const d=new Date(now);d.setHours(parseInt(m[1]),parseInt(m[2]),0,0);
                for(const ts of [d.getTime(),d.getTime()-86400000]){
                    if(ts>windowStart&&ts<=now){
                        try{
                            await executeRoutine(r);
                            if(window.toast)window.toast(`Rutina "${r.name}" ejecutada (${t.value})`,'⏰');
                        }catch(e){}
                        break;
                    }
                }
            }
        }
    },20000);
});
