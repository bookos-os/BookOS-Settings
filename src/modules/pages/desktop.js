// Native BookOS controls. Only keys implemented by the compositor are exposed.
import {tauriInvoke,esc,renderHeader,renderCard,renderRowItem,renderToggle,setupToggle,toast,renderSkeleton,renderInfoItem,promptSudo,invokeWithAuth,renderServiceError,_tr,popoverSelect,renderSection} from './_common.js';
import {renderSddmEditor} from './sddm-editor.js';
const config=async()=>JSON.parse(await tauriInvoke('bookos_get_config'));
const parseServiceResult=raw=>{
    const value=typeof raw==='string'?JSON.parse(raw):raw;
    if(value?.ok===false)throw new Error(value.error||'Servicio BookOS no disponible');
    return value;
};
async function save(value,restart=false){
    await tauriInvoke('bookos_apply_config',{config:value});
    toast(restart?'Guardado. Se aplicará al volver a iniciar sesión.':'Guardado');
}
// Menú y deslizador propios en vez de <select> e <input type=number>: el menú
// nativo de WebKitGTK es un GtkMenu sin tema y la casilla numérica sale blanca
// y corta decimales («0,0799» en la posición del reloj).
function select(key,label,value,values){
    const current=values.find(([id])=>String(id)===String(value));
    const name=current?current[1]:String(value??'');
    return renderRowItem(label,'',`<button type="button" class="bk-select" data-choice="${esc(key)}" data-options="${esc(JSON.stringify(values))}" data-value="${esc(value??'')}" title="${esc(name)}" aria-haspopup="listbox"><span>${esc(name)}</span></button>`);
}
const formats={px:v=>`${Math.round(v)} px`,pct:v=>`${Math.round(v*100)} %`,dec:v=>(Math.round(v*10)/10).toLocaleString('es-ES',{minimumFractionDigits:1})};
function range(key,label,value,min,max,step,format){
    return `<div class="detail-item bk-slider-row"><div class="detail-texts"><span class="dt">${_tr(label)}</span><span class="ds">${formats[format](value)}</span></div><input class="bk-range" type="range" aria-label="${esc(_tr(label))}" data-config="${esc(key)}" data-format="${format}" min="${min}" max="${max}" step="${step}" value="${esc(value)}"></div>`;
}
// Relleno desde el centro cuando el rango cruza el cero (balance, velocidad):
// relleno desde la izquierda se lee como «cuánto», no como «hacia dónde».
function fillRange(el){
    const min=Number(el.min),max=Number(el.max),pct=(el.value-min)/(max-min)*100,from=min<0&&max>0?-min/(max-min)*100:0;
    el.style.setProperty('--from',`${Math.min(from,pct)}%`);
    el.style.setProperty('--to',`${Math.max(from,pct)}%`);
}
// Tiempos en segundos para el compositor, pero en pasos humanos en la UI. Un
// valor puesto a mano en el TOML que no esté en la lista se añade tal cual
// para no mostrar una opción que no es la real.
function duration(key,label,value,steps){
    const name=v=>v===0?'Nunca':v<60?`${v} s`:v%3600===0?`${v/3600} h`:`${Math.round(v/60)} min`;
    const list=steps.includes(value)?steps:[...steps,value].sort((a,b)=>a-b);
    return select(key,label,value,list.map(v=>[v,name(v)]));
}
function toggle(key,label,value,subtitle=''){
    // data-custom: sin él setupToggle sustituye el subtítulo por «Activado».
    return renderRowItem(label,subtitle,renderToggle(key,!!value)).replace('class="ds"','class="ds" data-custom="1"');
}
async function page(c,title,build,restart=false){
    c.innerHTML=renderHeader(title)+renderSkeleton(2);
    try{
        const data=await config();
        c.innerHTML=renderHeader(title)+(restart?renderInfoItem('Estos cambios se aplicarán al volver a iniciar sesión.'):'')+renderCard(build(data));
        const store=async(key,value)=>{await save({[key]:value},restart||key==='escritorios');data[key]=value;};
        c.querySelectorAll('[data-config]').forEach(el=>{
            const percent=el.closest('.bk-slider-row')?.querySelector('.ds');
            if(el.classList.contains('bk-range')){
                fillRange(el);
                el.addEventListener('input',()=>{fillRange(el);percent.textContent=formats[el.dataset.format](Number(el.value));});
            }
            el.addEventListener('change',async()=>{
                const key=el.dataset.config;
                const value=el.type==='range'?Number(el.value):el.value;
                el.disabled=true;
                try{await store(key,value);}
                catch(e){
                    el.value=data[key];toast(String(e),'❌');
                    if(percent){fillRange(el);percent.textContent=formats[el.dataset.format](Number(el.value));}
                }finally{el.disabled=false;}
            });
        });
        c.querySelectorAll('[data-choice]').forEach(el=>el.addEventListener('click',()=>{
            const key=el.dataset.choice,options=JSON.parse(el.dataset.options),row=el.closest('.detail-item');
            popoverSelect(row,{
                title:row.querySelector('.dt').textContent,
                options:options.map(([val,name])=>({val,label:esc(name)})),
                current:el.dataset.value,
                onSelect:async val=>{
                    const [id,name]=options.find(([id])=>String(id)===val);
                    el.disabled=true;
                    try{await store(key,id);el.dataset.value=id;el.title=name;el.querySelector('span').textContent=name;}
                    catch(e){toast(String(e),'❌');}
                    finally{el.disabled=false;}
                },
            });
        }));
        c.querySelectorAll('[data-toggle]').forEach(el=>{
            const key=el.dataset.toggle;
            setupToggle(key,async active=>{await save({[key]:active},restart);});
        });
    }catch(e){c.innerHTML=renderHeader(title)+renderInfoItem('No se pudo leer la configuración de BookOS',esc(String(e)));}
}
export async function appearance(c,icons){
    await page(c,'Apariencia',d=>[
        select('tema','Tema',d.tema,[['claro','Claro'],['oscuro','Oscuro'],['automatico','Automático']]),
        select('acento','Color de acento',d.acento,['azul','indigo','morado','rosa','rojo','naranja','amarillo','verde','turquesa','grafito'].map(x=>[x,x])),
        renderRowItem('Tema claro desde','',`<input class="btn" data-config="tema_claro_desde" type="time" value="${esc(d.tema_claro_desde)}">`),
        renderRowItem('Tema oscuro desde','',`<input class="btn" data-config="tema_oscuro_desde" type="time" value="${esc(d.tema_oscuro_desde)}">`),
        select('efectos','Efectos',d.efectos,[['completos','Completos'],['reducidos','Reducidos']]),
        renderRowItem('Iconos tintados','', '<button type="button" class="btn btn-secondary" id="native-icons">Configurar</button>'),
    ]);
    c.querySelector('#native-icons')?.addEventListener('click',()=>icons?.());
}
export async function lockscreen(c){
    await page(c,'Pantalla de bloqueo',d=>[
        toggle('bloqueo_huella','Desbloquear con huella',d.bloqueo_huella,'Requiere un lector compatible y una huella registrada. La contraseña sigue disponible.'),
        duration('bloqueo_inactividad','Bloquear tras inactividad',d.bloqueo_inactividad,[0,60,120,300,600,900,1800,3600]),
        duration('suspension_inactividad','Suspender tras el bloqueo',d.suspension_inactividad,[0,60,300,600,1800,3600]),
        toggle('bloqueo_animaciones','Animaciones',d.bloqueo_animaciones),toggle('bloqueo_fecha','Mostrar fecha',d.bloqueo_fecha),toggle('bloqueo_medios','Controles multimedia',d.bloqueo_medios),
        // Límites iguales a los que valida bookos-comp (ajustes.rs): fuera de
        // ellos el compositor rechaza la configuración entera.
        range('bloqueo_reloj_tamano','Tamaño del reloj',d.bloqueo_reloj_tamano,72,220,1,'px'),
        range('bloqueo_avatar_tamano','Tamaño del avatar',d.bloqueo_avatar_tamano,64,220,1,'px'),
        range('bloqueo_reloj_y','Posición vertical del reloj',d.bloqueo_reloj_y,.02,.4,.01,'pct'),
        range('bloqueo_acceso_y','Posición vertical del acceso',d.bloqueo_acceso_y,.18,.72,.01,'pct'),
        range('bloqueo_medios_y','Posición vertical de medios',d.bloqueo_medios_y,.42,.88,.01,'pct'),
        renderRowItem('Pantalla de inicio de sesión','SDDM', '<button type="button" class="btn btn-secondary" id="native-sddm">Configurar</button>'),
    ]);
    c.querySelector('#native-sddm')?.addEventListener('click',()=>renderSddmEditor(c));
}
export async function input(c){
    await page(c,'Touchpad y ratón',d=>[
        range('velocidad_touchpad','Velocidad del touchpad',d.velocidad_touchpad,-1,1,.1,'dec'),
        range('velocidad_raton','Velocidad del ratón',d.velocidad_raton,-1,1,.1,'dec'),
        toggle('toque_para_clic','Tocar para hacer clic',d.toque_para_clic),toggle('scroll_natural','Desplazamiento natural',d.scroll_natural),
    ],true);
}
export async function keyboard(c){
    let layouts=[];
    try{layouts=JSON.parse(await tauriInvoke('list_keymaps_pretty'));}catch{}
    await page(c,'Teclado',d=>[select('teclado','Distribución',d.teclado,layouts.map(x=>[x.id,x.name]))],true);
}
export async function home(c){
    await page(c,'Escritorio',d=>[
        range('dock_tamano','Tamaño de los iconos del dock',d.dock_tamano??50,32,80,1,'px'),
        select('escritorios','Número de escritorios',d.escritorios,[1,2,3,4,5].map(n=>[n,String(n)])),
        renderInfoItem('El número de escritorios se aplicará al volver a iniciar sesión.'),
        renderInfoItem('Los lanzadores se fijan y se retiran desde el dock o el launchpad.'),
    ]);
}
export async function accessibility(c){
    await page(c,'Accesibilidad',d=>[
        toggle('alto_contraste','Alto contraste',d.alto_contraste),
        select('efectos','Efectos de ventanas y desenfoque',d.efectos,[['completos','Completos'],['reducidos','Reducidos']]),
        toggle('bloqueo_animaciones','Animaciones del bloqueo',d.bloqueo_animaciones),
        toggle('actividades_animaciones','Animaciones de actividades',d.actividades_animaciones),
    ]);
}
export async function advanced(c){
    await page(c,'Funciones avanzadas',d=>[
        toggle('actividades','Actividades dinámicas',d.actividades),
        toggle('temporizador_siempre_visible','Temporizador siempre visible',d.temporizador_siempre_visible),
        toggle('actividades_animaciones','Animaciones',d.actividades_animaciones),
    ]);
    // renderCard produce .detail-card: buscar «.card» no encontraba nada y esta
    // sección no llegaba a mostrarse nunca.
    const card=c.querySelector('.detail-card'); if(!card)return;
    card.insertAdjacentHTML('afterend',renderSection('Energía y firmware')+renderCard([renderInfoItem('Comprobando capacidades…')]));
    const list=card.nextElementSibling.nextElementSibling;
    try{
        const controls=JSON.parse(await tauriInvoke('get_firmware_power_controls'));
        list.innerHTML=controls.length?controls.map(x=>renderRowItem(x.label,'',renderToggle('fw-'+x.id,x.value))).join(''):renderInfoItem('El kernel o el firmware no exponen controles compatibles.');
        controls.forEach(x=>setupToggle('fw-'+x.id,async active=>{
            const r=await invokeWithAuth('set_firmware_power_control',{id:x.id,enabled:active},{description:'Este ajuste modifica el firmware y requiere permisos de administrador.'});
            if(!r?.ok)throw new Error(r?.error||'No se pudo aplicar el ajuste');
        }));
    }catch(e){list.innerHTML=renderInfoItem('No se pudieron leer las capacidades del firmware.');}
}

// Último HTML pintado por contenedor. StateChanged llega con cualquier cambio
// del sistema (batería, red…), no solo de audio: sin esto la página se
// repintaba entera, con esqueleto incluido, y eso era el parpadeo.
const soundHtml=new WeakMap();
export async function sound(c){
    const mounted=soundHtml.has(c)&&c.querySelector('.audio-page');
    if(!mounted)c.innerHTML=renderHeader('Sonido')+renderSkeleton(2);
    try{
        const d=parseServiceResult(await tauriInvoke('get_audio_devices'));
        // Repintar con un menú abierto o un deslizador con el foco lo cierra o
        // lo suelta en la cara del usuario. El blur tras cada cambio devuelve
        // el foco, así que la siguiente señal sí repinta.
        if(c.querySelector('.audio-page #bk-popover, .audio-page input:focus'))return;
        const out=d.output,input=d.input;
        const slider=(id,label,value,min=0,max=100)=>`<input class="bk-range" aria-label="${esc(label)}" type="range" min="${min}" max="${max}" value="${value||0}" data-audio="${id}">`;
        const sliderRow=(title,sub,control)=>`<div class="detail-item bk-slider-row"><div class="detail-texts"><span class="dt">${_tr(title)}</span>${sub?`<span class="ds">${sub}</span>`:''}</div>${control}</div>`;
        // El desplegable nativo de WebKitGTK es un menú GTK sin tema; el
        // popover de la app es el mismo que usan Pantalla y el resto.
        const menus=[];
        const selectRow=(title,sub,apply,list,current)=>{
            const label=list.find(x=>x.value===current)?.label||current||'';
            menus.push({title:_tr(title),list,current,apply});
            return renderRowItem(title,sub,`<button type="button" class="bk-select" data-menu="${menus.length-1}" title="${esc(label)}" aria-haspopup="listbox"><span>${esc(label)}</span></button>`);
        };
        const devices=list=>list.map(x=>({value:x.name,label:x.description||x.name}));
        const rows=[];
        if(!out)rows.push(renderInfoItem('Sin dispositivo de audio','No se detectó ningún altavoz o auricular'));
        if(out)rows.push(selectRow('Salida','',name=>['set_default_sink',{name}],devices(d.sinks),d.defaultSink),sliderRow('Volumen',`${out.volume}%`,slider('output','Volumen',out.volume)),toggle('audio-mute','Silenciar salida',out.muted));
        if(!input)rows.push(renderInfoItem('Sin dispositivo de audio','No se detectó ningún micrófono'));
        if(input)rows.push(selectRow('Entrada','',name=>['set_default_source',{name}],devices(d.sources),d.defaultSource),sliderRow('Micrófono',`${input.volume}%`,slider('input','Micrófono',input.volume)),toggle('audio-mic','Silenciar micrófono',input.muted));
        if(out)rows.push(sliderRow('Balance',_tr('Izquierda / derecha'),`<input class="bk-range" aria-label="Balance" id="audio-balance" type="range" min="-100" max="100" value="${out.balance||0}">`));
        for(const app of d.apps||[])rows.push(sliderRow(esc(app.name||'Aplicación'),`${app.volume}%`,slider(`app:${app.index}`,app.name||'Aplicación',app.volume)));
        for(const card of d.cards||[]){
            const profiles=Array.isArray(card.profiles)?card.profiles:Object.entries(card.profiles||{}).map(([name,p])=>({name,...p}));
            rows.push(selectRow(esc(card.properties?.['device.description']||card.name),'Perfil',profile=>['set_audio_profile',{card:card.name,profile}],profiles.filter(p=>p.available!=='no').map(p=>({value:p.name,label:p.description||p.name})),card.active_profile));
        }
        const html=renderHeader('Sonido')+`<div class="audio-page">${renderCard(rows.length?rows:[renderInfoItem('No hay dispositivos de audio')])}</div>`;
        if(mounted&&soundHtml.get(c)===html)return;
        c.innerHTML=html;
        soundHtml.set(c,html);
        // Sin repintar aquí: el servicio emite StateChanged tras aplicar el
        // cambio y renderSonido ya escucha esa señal. Repintar también desde
        // aquí pedía los dispositivos dos veces por cada gesto.
        const action=async(el,cmd,args)=>{el.blur();try{parseServiceResult(await tauriInvoke(cmd,args));}catch(e){toast(String(e),'❌');await sound(c);}};
        c.querySelector('#audio-balance')?.addEventListener('input',e=>fillRange(e.target));
        c.querySelectorAll('.bk-range').forEach(fillRange);
        c.querySelectorAll('[data-audio]').forEach(el=>{
            const percent=el.closest('.bk-slider-row')?.querySelector('.ds');
            el.addEventListener('input',()=>{fillRange(el);if(percent)percent.textContent=`${el.value}%`;});
            el.addEventListener('change',()=>{
                const id=el.dataset.audio,value=Number(el.value);
                return id.startsWith('app:')?action(el,'set_app_volume',{index:Number(id.slice(4)),volume:value}):action(el,'system_set_volume',{input:id==='input',value});
            });
        });
        c.querySelectorAll('[data-menu]').forEach(el=>el.addEventListener('click',()=>{
            const menu=menus[el.dataset.menu];
            popoverSelect(el.closest('.detail-item'),{
                title:menu.title,
                options:menu.list.map(x=>({val:x.value,label:esc(x.label)})),
                current:menu.current,
                onSelect:value=>{
                    const label=menu.list.find(x=>x.value===value)?.label||value;
                    el.querySelector('span').textContent=label;el.title=label;
                    return action(el,...menu.apply(value));
                },
            });
        }));
        c.querySelector('#audio-balance')?.addEventListener('change',e=>action(e.target,'set_balance',{balance:Number(e.target.value)}));
        // setupToggle ya revierte el interruptor y avisa si esto lanza.
        setupToggle('audio-mute',async active=>parseServiceResult(await tauriInvoke('system_set_mute',{input:false,muted:active})));
        setupToggle('audio-mic',async active=>parseServiceResult(await tauriInvoke('set_mic_muted',{muted:active})));
    }catch(e){soundHtml.delete(c);c.innerHTML=renderHeader('Sonido')+renderServiceError(e,'audio');}
}
export async function security(c){
    c.innerHTML=renderHeader('Seguridad y privacidad')+renderSkeleton(2);
    try{
        const [fw,cam,mic]=await Promise.all(['get_firewall_status','get_camera_enabled','get_mic_muted'].map(cmd=>tauriInvoke(cmd).then(JSON.parse)));
        c.innerHTML=renderHeader('Seguridad y privacidad')+renderCard([
            toggle('native-fw','Cortafuegos',fw.active),toggle('native-camera','Cámara',cam.enabled),toggle('native-mic','Micrófono',!mic.muted),
            renderRowItem('Bloqueo y suspensión','', '<button class="btn" id="native-lock">Configurar</button>')]);
        setupToggle('native-fw',async enable=>{if(!await promptSudo(enable?'activar el cortafuegos':'desactivar el cortafuegos','ufw',[enable?'enable':'disable']))throw new Error('No se pudo cambiar el cortafuegos');});
        setupToggle('native-camera',enabled=>tauriInvoke('set_camera_enabled',{enabled}));
        setupToggle('native-mic',enabled=>tauriInvoke('set_mic_muted',{muted:!enabled}));
        c.querySelector('#native-lock')?.addEventListener('click',()=>lockscreen(c));
    }catch(e){c.innerHTML=renderHeader('Seguridad y privacidad')+renderInfoItem('No se pudo leer el estado',esc(String(e)));}
}
