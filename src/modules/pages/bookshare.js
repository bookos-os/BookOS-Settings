// Book Share: enviar y recibir con móviles cercanos (Quick Share) y KDE Connect.
// El servicio `bookos-bookshare` es el dueño de todo (recepción en segundo
// plano, descubrimiento, isla, notificaciones); la página pinta el estado que
// manda y le pide cambios. Mientras la página está abierta, busca aparatos.
import{tauriInvoke,elegirRuta}from'../../tauri-api.js';
import{esc,toast,addInterval,renderSkeleton,renderCard,renderSection,renderHeader,renderNavRow,renderToggle,setupToggle,showDialog,popoverSelect,chevron,_tr}from'./_common.js';
import{ico}from'./iconos.js';

const TITULO='Book Share';

const icoAparato=tipo=>ico({movil:'smartphone',tableta:'tablet',portatil:'laptop'}[tipo]||'share-2',{size:20});

function bytes(b){
    const u=['B','KB','MB','GB','TB'];let i=0;let v=b;
    while(v>=1024&&i<u.length-1){v/=1024;i++;}
    return i?`${v.toFixed(1).replace('.',',')} ${u[i]}`:`${b} B`;
}

function queEs(t){
    if(t.texto)return t.texto.titulo||_tr('Texto');
    const e=t.elementos||[];
    if(!e.length)return _tr('Archivos');
    if(e.length===1)return e[0].nombre;
    return `${e[0].nombre} ${_tr('y')} ${e.length-1} ${_tr('más')}`;
}

function textoVisibilidad(e){
    if(!e.activo)return _tr('Nadie: recibir está apagado');
    if(e.visibilidad==='visible')return _tr('Todos los dispositivos cercanos');
    if(e.visibilidad==='temporal'){
        const min=Math.max(1,Math.ceil((e.visible_hasta-Date.now()/1000)/60));
        return `${_tr('Todos durante')} ${min} min`;
    }
    return _tr('Nadie');
}

// Aquí salen los que pueden recibir: un móvil solo aparece con Quick Share
// visible para todos. Si el servicio lo ve cerca por BLE, se le nombra.
function pistaBusqueda(e){
    const cerca=e.cerca||[];
    if(cerca.length)return `«${esc(cerca[0])}» ${_tr('está cerca, pero no está visible. En el móvil, pon Quick Share en «Todos» y en la misma Wi-Fi.')}`;
    return _tr('Para que un móvil aparezca, pon Quick Share en «Todos» en el móvil. Tiene que estar en la misma Wi-Fi.');
}

function filaTransferencia(t){
    const entrante=t.direccion==='entrante';
    const icono=ico(entrante?'download':'upload',{size:20});
    const pin=t.pin?` · PIN ${esc(t.pin)}`:'';
    const quien=esc(t.aparato||_tr('otro dispositivo'));
    let sub,abajo='';
    switch(t.estado){
        case'conectando':sub=`${_tr('Conectando con')} ${quien}…`;break;
        case'esperando_aceptacion':
            if(entrante){
                sub=`${quien} ${_tr('quiere compartir contigo')}${pin}`;
                abajo=`<div class="bs-botones">
                    <button type="button" class="btn btn-secondary" data-bs="bookshare_rechazar" data-id="${esc(t.id)}">${_tr('Rechazar')}</button>
                    <button type="button" class="btn btn-primary bs-foco" data-bs="bookshare_aceptar" data-id="${esc(t.id)}">${_tr('Aceptar')}</button>
                </div>`;
            }else sub=`${_tr('Esperando a que')} ${quien} ${_tr('acepte')}${pin}`;
            break;
        case'transfiriendo':{
            const pct=t.total?Math.min(100,Math.round(t.hechos/t.total*100)):0;
            sub=`${entrante?_tr('Recibiendo de'):_tr('Enviando a')} ${quien} · ${pct} %`;
            abajo=`<div class="bs-progreso" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(_tr('Progreso'))}"><i style="transform:scaleX(${pct/100})"></i></div>`;
            break;
        }
        case'terminada':sub=entrante?`${_tr('Recibido de')} ${quien}`:`${_tr('Enviado a')} ${quien}`;break;
        case'rechazada':sub=entrante?_tr('Rechazado'):`${quien} ${_tr('no lo ha aceptado')}`;break;
        case'cancelada':sub=_tr('Cancelado');break;
        default:sub=`${_tr('No se pudo completar')}: ${esc(_tr(t.motivo||''))}`;
    }
    const cancelable=['conectando','transfiriendo'].includes(t.estado)||(t.estado==='esperando_aceptacion'&&!entrante);
    const derecha=cancelable?`<button type="button" class="btn btn-secondary btn-sm" data-bs="bookshare_cancelar" data-id="${esc(t.id)}">${_tr('Cancelar')}</button>`:'';
    const clase=t.estado==='fallida'?' mal':t.estado==='terminada'?' bien':'';
    return`<div class="detail-item bs-transferencia">
        <div class="bs-fila"><span class="bs-icono${clase}">${icono}</span>
            <div class="detail-texts"><span class="dt bs-corta">${esc(queEs(t))}</span><span class="ds" role="status">${sub}</span></div>${derecha}</div>
        ${abajo}
    </div>`;
}

function filaAparato(a){
    return`<div class="detail-item detail-item-row bs-aparato">
        <span class="bs-icono">${icoAparato(a.tipo)}</span>
        <div class="detail-texts"><span class="dt bs-corta">${esc(a.nombre)}</span><span class="ds">${esc(a.ip)}</span></div>
        <button type="button" class="btn btn-primary btn-sm" data-enviar="${esc(a.id)}" aria-label="${esc(_tr('Enviar archivos a'))} ${esc(a.nombre)}">${_tr('Enviar')}</button>
    </div>`;
}

function vista(e,historial,kde){
    let h=renderHeader(TITULO);
    // ── Recibir ──
    const sub=e.error?`<span class="bs-mal">${esc(_tr(e.error))}</span>`
        :e.activo?`${_tr('Visible como')} «${esc(e.nombre)}»`:_tr('Los móviles no pueden enviarte nada');
    h+=renderCard([
        `<div class="detail-item detail-item-row"><div class="detail-texts"><span class="dt">${_tr('Recibir de dispositivos cercanos')}</span><span class="ds" data-custom="1">${sub}</span></div>${renderToggle('bs-activo',e.activo)}</div>`,
        e.activo?renderNavRow('Quién puede verte','',{id:'bs-visibilidad',right:`<span class="bs-valor">${esc(textoVisibilidad(e))}</span>${chevron()}`}):'',
        renderNavRow('Nombre del equipo','',{id:'bs-nombre',right:`<span class="bs-valor">${esc(e.nombre)}</span>${chevron()}`}),
        renderNavRow('Carpeta de descargas','',{id:'bs-carpeta',right:`<span class="bs-valor">${esc(String(e.carpeta).replace(/^\/home\/[^/]+/,'~'))}</span>${chevron()}`}),
    ]);
    // ── En curso ──
    const vivas=e.transferencias||[];
    if(vivas.length)h+=renderSection('En curso')+`<div class="detail-card">${vivas.map(filaTransferencia).join('')}</div>`;
    // ── Cercanos ──
    h+=renderSection('Dispositivos cercanos');
    if(e.aparatos?.length)h+=`<div class="detail-card">${e.aparatos.map(filaAparato).join('')}</div>`;
    else h+=`<div class="detail-card"><div class="detail-item detail-item-row bs-buscando">
        <div class="spinner" aria-hidden="true"></div>
        <div class="detail-texts"><span class="dt">${_tr('Buscando…')}</span><span class="ds">${pistaBusqueda(e)}</span></div></div></div>`;
    // ── Recientes ──
    if(historial.length){
        h+=renderSection('Recientes')+renderCard(historial.slice(0,5).map(t=>{
            const cuando=new Date((t.fin||0)*1000).toLocaleString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
            const dir=t.direccion==='entrante'?_tr('De'):_tr('A');
            const ok=t.estado==='terminada';
            return`<div class="detail-item detail-item-row"><span class="bs-icono${ok?'':' apagado'}">${ico(t.direccion==='entrante'?'download':'upload',{size:20})}</span>
                <div class="detail-texts"><span class="dt bs-corta">${esc(queEs(t))}</span><span class="ds">${dir} ${esc(t.aparato||'?')} · ${esc(cuando)}${ok?'':' · '+_tr(t.estado==='rechazada'?'Rechazado':t.estado==='cancelada'?'Cancelado':'No completado')}</span></div></div>`;
        }));
    }
    // ── KDE Connect ──
    h+=renderSection('KDE Connect');
    h+=renderCard(kde.length?kde.map(d=>`<div class="detail-item detail-item-row"><span class="bs-icono${d.reachable?' bien':' apagado'}">${ico('smartphone',{size:20})}</span>
        <div class="detail-texts"><span class="dt">${esc(d.name)}</span><span class="ds">${_tr(d.reachable?'Conectado y disponible':'Fuera de alcance')}${d.battery?` · ${esc(d.battery)} %`:''}</span></div></div>`)
        :[`<div class="detail-item"><span class="dt">${_tr('Sin dispositivos KDE Connect')}</span><span class="ds">${_tr('Instala KDE Connect en tu teléfono para vincularlos')}</span></div>`]);
    return h;
}

function dialogoNombre(actual,guardar){
    const previo=document.activeElement?.id;
    const ov=document.createElement('div');
    ov.className='bk-overlay';
    ov.innerHTML=`<div class="bk-dialog" role="dialog" aria-modal="true" aria-labelledby="bs-dlg-t">
        <div class="bk-dialog-title" id="bs-dlg-t">${_tr('Nombre del equipo')}</div>
        <p class="bk-dialog-msg">${_tr('Así te verán los móviles cercanos.')}</p>
        <input type="text" class="upd-auth-input bs-dlg-input" maxlength="40" autocomplete="off" aria-label="${esc(_tr('Nombre del equipo'))}" value="${esc(actual)}">
        <div class="bk-dialog-btns"><button class="bk-dbtn cancel" type="button">${_tr('Cancelar')}</button><button class="bk-dbtn confirm" type="button">${_tr('Guardar')}</button></div>
    </div>`;
    document.body.appendChild(ov);
    const entrada=ov.querySelector('input');
    const cerrar=()=>{ov.remove();document.removeEventListener('keydown',tecla,true);document.getElementById(previo)?.focus();};
    const aceptar=()=>{guardar(entrada.value);cerrar();};
    function tecla(e){
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cerrar();}
        else if(e.key==='Enter'&&document.activeElement===entrada){e.preventDefault();aceptar();}
    }
    document.addEventListener('keydown',tecla,true);
    ov.querySelector('.cancel').onclick=cerrar;
    ov.querySelector('.confirm').onclick=aceptar;
    ov.addEventListener('click',e=>{if(e.target===ov)cerrar();});
    (window._pageCleanups||=[]).push(()=>ov.isConnected&&cerrar());
    entrada.focus();entrada.select();
}

function sinServicio(c,e,reintentar){
    const noInstalado=String(e)==='no-instalado';
    c.innerHTML=renderHeader(TITULO)+`<div class="detail-card bs-panel">
        <div class="sudo-icon-wrap">${ico(noInstalado?'share-2':'triangle-alert',{size:26})}</div>
        <h3 class="bs-titulo">${_tr(noInstalado?'Book Share no está instalado':'Book Share no responde')}</h3>
        <p class="bs-cuerpo">${_tr(noInstalado?'Instálalo con src-tauri/bookshare/sistema/instalar.sh y vuelve a abrir esta página.':'Comprueba que bookos-bookshare.service esté en marcha y vuelve a intentarlo.')}</p>
        <div class="bs-botones"><button type="button" class="btn btn-primary" id="bs-reintentar">${_tr('Reintentar')}</button></div>
    </div>`;
    c.querySelector('#bs-reintentar')?.addEventListener('click',reintentar);
    if(!noInstalado)console.error('[bookshare]',e);
}

async function kdeConnect(){
    try{
        const lista=JSON.parse(await tauriInvoke('get_kdeconnect_devices'));
        // kdeconnect a veces repite el mismo teléfono (entrada vieja y nueva):
        // uno por nombre, mejor el que responde.
        const porNombre=new Map();
        for(const d of lista){
            const k=(d.name||'').trim().toLowerCase()||d.id;
            const prev=porNombre.get(k);
            if(!prev||(d.reachable&&!prev.reachable))porNombre.set(k,d);
        }
        return[...porNombre.values()];
    }catch(e){return[];}
}

export async function renderBookShare(c){
    c.innerHTML=renderHeader(TITULO)+renderSkeleton(3);
    const epoca=window.navEpoch();
    let estado,historial=[],kde=[],firma='';

    const pintar=()=>{
        // El progreso llega diez veces por segundo: se mueve la barra sin repintar.
        const sinProgreso=JSON.stringify({...estado,transferencias:(estado.transferencias||[]).map(t=>({...t,hechos:0}))});
        const nueva=sinProgreso+JSON.stringify(historial)+JSON.stringify(kde);
        if(nueva===firma){
            for(const t of estado.transferencias||[]){
                if(t.estado!=='transfiriendo')continue;
                const pct=t.total?Math.min(100,Math.round(t.hechos/t.total*100)):0;
                const fila=c.querySelector(`[data-id="${CSS.escape(t.id)}"]`)?.closest('.bs-transferencia');
                fila?.querySelector('.bs-progreso i')?.style.setProperty('transform',`scaleX(${pct/100})`);
                fila?.querySelector('.bs-progreso')?.setAttribute('aria-valuenow',pct);
                const sub=fila?.querySelector('.ds');
                if(sub)sub.textContent=sub.textContent.replace(/\d+ %$/,`${pct} %`);
            }
            return;
        }
        firma=nueva;
        const foco=document.activeElement?.id||document.activeElement?.dataset?.toggle;
        const habia=c.querySelector('.bs-foco');
        c.innerHTML=vista(estado,historial,kde);
        conectar();
        const mismo=foco&&(c.querySelector(`#${CSS.escape(foco)}`)||c.querySelector(`[data-toggle="${CSS.escape(foco)}"]`));
        if(mismo)mismo.focus();
        // Una petición nueva: el foco va a «Aceptar» para contestar con Intro.
        else if(!habia&&c.querySelector('.bs-foco'))c.querySelector('.bs-foco').focus();
    };

    const aplicar=texto=>{
        const nuevo=JSON.parse(texto);
        if(nuevo.ok===false){toast(_tr(nuevo.error||'Error'),'❌');return false;}
        const termino=(estado?.transferencias||[]).some(a=>!a.estado?.match(/terminada|rechazada|cancelada|fallida/)&&(nuevo.transferencias||[]).some(b=>b.id===a.id&&/terminada|rechazada|cancelada|fallida/.test(b.estado)));
        estado=nuevo;
        if(termino)cargarHistorial();
        pintar();
        return true;
    };
    const pedir=async(comando,args={})=>{
        try{return aplicar(await tauriInvoke(comando,args));}
        catch(e){sinServicio(c,e,arrancar);return false;}
    };
    const cargarHistorial=async()=>{
        try{historial=JSON.parse(await tauriInvoke('get_bookshare_historial',{limite:5})).historial||[];if(estado)pintar();}catch(e){}
    };

    function conectar(){
        setupToggle('bs-activo',async activo=>{
            const r=JSON.parse(await tauriInvoke('bookshare_activo',{activo}));
            if(r.ok===false)throw r.error;
            estado=r;pintar();
        });
        const vis=c.querySelector('#bs-visibilidad');
        vis?.addEventListener('click',()=>popoverSelect(vis,{
            title:_tr('Quién puede verte'),
            current:estado.visibilidad,
            options:[
                {val:'visible',label:_tr('Todos'),sub:_tr('Cualquier móvil cercano en tu red. Cada envío lo tienes que aceptar.')},
                {val:'temporal',label:_tr('Todos durante 10 minutos'),sub:_tr('También por Bluetooth, sin compartir Wi-Fi. Después vuelve a «Nadie».')},
                {val:'oculto',label:_tr('Nadie'),sub:_tr('No apareces; puedes seguir enviando.')},
            ],
            onSelect:modo=>pedir('bookshare_visibilidad',{modo}),
        }));
        c.querySelector('#bs-nombre')?.addEventListener('click',()=>dialogoNombre(estado.nombre,nombre=>pedir('bookshare_nombre',{nombre})));
        c.querySelector('#bs-carpeta')?.addEventListener('click',()=>pedir('bookshare_abrir_carpeta'));
        c.querySelectorAll('[data-bs]').forEach(b=>b.addEventListener('click',()=>{b.disabled=true;pedir(b.dataset.bs,{id:b.dataset.id});}));
        c.querySelectorAll('[data-enviar]').forEach(b=>b.addEventListener('click',async()=>{
            let rutas;
            try{
                const elegidas=await elegirRuta('open',{multiple:true,title:_tr('Elige qué enviar')});
                if(!elegidas)return;
                rutas=Array.isArray(elegidas)?elegidas:[elegidas];
            }catch(e){toast(_tr('No se pudo abrir el selector de archivos'),'❌');return;}
            pedir('bookshare_enviar',{aparato:b.dataset.enviar,rutas});
        }));
    }

    async function arrancar(){
        try{
            const inicial=await tauriInvoke('get_bookshare_estado');
            if(window.isStale(epoca))return;
            [kde]=await Promise.all([kdeConnect(),cargarHistorial()]);
            firma='';
            aplicar(inicial);
            // Busca mientras esta conexión siga en el bus; si Ajustes se cierra, para solo.
            pedir('bookshare_buscar');
        }catch(e){if(!window.isStale(epoca))sinServicio(c,e,arrancar);}
    }

    await arrancar();
    if(window.isStale(epoca))return;
    const dejar=await window.__TAURI__.event.listen('bookshare-estado',ev=>{if(!window.isStale(epoca)&&estado)aplicar(ev.payload);});
    (window._pageCleanups||=[]).push(()=>{dejar();tauriInvoke('bookshare_dejar_de_buscar').catch(()=>{});});
    // KDE Connect no avisa: se pregunta cada minuto. La cuenta atrás de «Todos durante» también.
    addInterval(async()=>{kde=await kdeConnect();if(estado)pintar();},60000);
    addInterval(()=>{if(estado?.visibilidad==='temporal'){firma='';pintar();}},30000);
}

// ── Hoja de compartir un enlace (bookos-settings --share-url) ──
// La abre el botón de compartir del navegador: busca aparatos y manda el enlace
// al elegido, que lo abre en su navegador.
export async function abrirHojaCompartir(url){
    let estado;
    try{estado=JSON.parse(await tauriInvoke('get_bookshare_estado'));await tauriInvoke('bookshare_buscar');}
    catch(e){toast(_tr(String(e)==='no-instalado'?'Book Share no está instalado':'Book Share no responde'),'❌');return;}
    let dejar=null;
    const cerrar=()=>{dejar?.();tauriInvoke('bookshare_dejar_de_buscar').catch(()=>{});};
    showDialog(_tr('Enviar con Book Share'),`<div class="bs-hoja-url">${esc(url)}</div><div id="bs-hoja-lista" class="bs-hoja-lista"></div>`,
        {confirmText:null,cancelText:_tr('Cancelar'),onCancel:cerrar});
    const pintar=()=>{
        const lista=document.getElementById('bs-hoja-lista');
        if(!lista)return;
        const aparatos=estado.aparatos||[];
        lista.innerHTML=aparatos.length?aparatos.map(a=>`<button type="button" class="bs-hoja-aparato" data-id="${esc(a.id)}">${icoAparato(a.tipo)}<span>${esc(a.nombre)}</span></button>`).join('')
            :`<div class="bs-hoja-vacia"><div class="spinner" aria-hidden="true"></div>${_tr('Buscando dispositivos cercanos…')}</div>`;
        lista.querySelectorAll('.bs-hoja-aparato').forEach(b=>b.addEventListener('click',async()=>{
            document.querySelector('.bk-overlay')?.remove();
            try{
                const r=JSON.parse(await tauriInvoke('bookshare_enviar_texto',{aparato:b.dataset.id,texto:url,url:true}));
                if(r.ok===false)throw r.error;
                toast(_tr('Enviando enlace…'));
            }catch(e){toast(`${_tr('No se pudo enviar')}: ${e}`,'❌');}
            cerrar();
        }));
    };
    pintar();
    dejar=await window.__TAURI__.event.listen('bookshare-estado',ev=>{estado=JSON.parse(ev.payload);pintar();});
}
