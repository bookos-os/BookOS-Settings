// Native BookOS controls. Only keys implemented by the compositor are exposed.
import {tauriInvoke,esc,renderHeader,renderCard,renderRowItem,renderToggle,setupToggle,toast,renderSkeleton,renderInfoItem,promptSudo} from './_common.js';
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
function select(key,label,value,values){
    return renderRowItem(label,'',`<select class="btn" data-config="${esc(key)}">${values.map(([id,name])=>`<option value="${esc(id)}" ${id===String(value)?'selected':''}>${esc(name)}</option>`).join('')}</select>`);
}
function number(key,label,value,min,max,step=1){
    return renderRowItem(label,'',`<input class="btn" style="max-width:130px" data-config="${esc(key)}" type="number" min="${min}" max="${max}" step="${step}" value="${esc(value)}">`);
}
function toggle(key,label,value){return renderRowItem(label,'',renderToggle(key,!!value));}
async function page(c,title,build,restart=false){
    c.innerHTML=renderHeader(title)+renderSkeleton(2);
    try{
        const data=await config();
        c.innerHTML=renderHeader(title)+(restart?renderInfoItem('Estos cambios se aplicarán al volver a iniciar sesión.'):'')+renderCard(build(data));
        c.querySelectorAll('[data-config]').forEach(el=>el.addEventListener('change',async()=>{
            const key=el.dataset.config;
            const value=el.type==='number'?Number(el.value):el.value;
            try{await save({[key]:value},restart);data[key]=value;}catch(e){el.value=data[key];toast(String(e),'❌');}
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
        renderRowItem('Iconos tintados','', '<button class="btn" id="native-icons">Configurar</button>'),
    ]);
    c.querySelector('#native-icons')?.addEventListener('click',()=>icons?.());
}
export async function lockscreen(c){
    await page(c,'Pantalla de bloqueo',d=>[
        number('bloqueo_inactividad','Bloquear tras inactividad (segundos; 0 desactiva)',d.bloqueo_inactividad,0,86400),
        number('suspension_inactividad','Suspender tras el bloqueo (segundos; 0 desactiva)',d.suspension_inactividad,0,86400),
        toggle('bloqueo_animaciones','Animaciones',d.bloqueo_animaciones),toggle('bloqueo_fecha','Mostrar fecha',d.bloqueo_fecha),toggle('bloqueo_medios','Controles multimedia',d.bloqueo_medios),
        number('bloqueo_reloj_tamano','Tamaño del reloj',d.bloqueo_reloj_tamano,72,220),
        number('bloqueo_avatar_tamano','Tamaño del avatar',d.bloqueo_avatar_tamano,64,220),
        number('bloqueo_reloj_y','Posición vertical del reloj',d.bloqueo_reloj_y,.02,.4,.01),
        number('bloqueo_acceso_y','Posición vertical del acceso',d.bloqueo_acceso_y,.18,.72,.01),
        number('bloqueo_medios_y','Posición vertical de medios',d.bloqueo_medios_y,.42,.88,.01),
        renderRowItem('Pantalla de inicio de sesión','SDDM', '<button class="btn" id="native-sddm">Configurar</button>'),
    ]);
    c.querySelector('#native-sddm')?.addEventListener('click',()=>renderSddmEditor(c));
}
export async function input(c){
    await page(c,'Touchpad y ratón',d=>[
        number('velocidad_touchpad','Velocidad del touchpad',d.velocidad_touchpad,-1,1,.1),
        number('velocidad_raton','Velocidad del ratón',d.velocidad_raton,-1,1,.1),
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
        number('escritorios','Número de escritorios',d.escritorios,1,5),
        renderInfoItem('Los lanzadores se fijan y se retiran desde el dock o el launchpad.'),
    ],true);
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
    await page(c,'Actividades',d=>[
        toggle('actividades','Actividades dinámicas',d.actividades),
        toggle('temporizador_siempre_visible','Temporizador siempre visible',d.temporizador_siempre_visible),
        toggle('actividades_animaciones','Animaciones',d.actividades_animaciones),
    ]);
}

export async function sound(c){
    c.innerHTML=renderHeader('Sonido')+renderSkeleton(2);
    try{
        const d=parseServiceResult(await tauriInvoke('get_audio_devices'));
        const out=d.output,input=d.input;
        const slider=(id,value)=>`<input aria-label="Volumen" type="range" min="0" max="100" value="${value||0}" data-audio="${id}">`;
        const deviceSelect=(id,list,current)=>`<select class="btn" data-audio-default="${id}">${list.map(x=>`<option value="${esc(x.name)}" ${x.name===current?'selected':''}>${esc(x.description||x.name)}</option>`).join('')}</select>`;
        const rows=[];
        if(!out)rows.push(renderInfoItem('Sin dispositivo de audio','No se detectó ningún altavoz o auricular'));
        if(out)rows.push(renderRowItem('Salida','',deviceSelect('output',d.sinks,d.defaultSink)),renderRowItem('Volumen',`${out.volume}%`,slider('output',out.volume)),toggle('audio-mute','Silenciar salida',out.muted));
        if(!input)rows.push(renderInfoItem('Sin dispositivo de audio','No se detectó ningún micrófono'));
        if(input)rows.push(renderRowItem('Entrada','',deviceSelect('input',d.sources,d.defaultSource)),renderRowItem('Micrófono',`${input.volume}%`,slider('input',input.volume)),toggle('audio-mic','Silenciar micrófono',input.muted));
        if(out)rows.push(renderRowItem('Balance','Izquierda / derecha',`<input aria-label="Balance" id="audio-balance" type="range" min="-100" max="100" value="${out.balance||0}">`));
        for(const app of d.apps||[])rows.push(renderRowItem(esc(app.name||'Aplicación'),'',slider(`app:${app.index}`,app.volume)));
        for(const card of d.cards||[]){
            const profiles=Array.isArray(card.profiles)?card.profiles:Object.entries(card.profiles||{}).map(([name,p])=>({name,...p}));
            rows.push(renderRowItem(esc(card.properties?.['device.description']||card.name),'Perfil',`<select class="btn" data-card="${esc(card.name)}">${profiles.filter(p=>p.available!=='no').map(p=>`<option value="${esc(p.name)}" ${card.active_profile===p.name?'selected':''}>${esc(p.description||p.name)}</option>`).join('')}</select>`));
        }
        c.innerHTML=renderHeader('Sonido')+renderCard(rows.length?rows:[renderInfoItem('No hay dispositivos de audio')]);
        const action=async(cmd,args)=>{try{await tauriInvoke(cmd,args);}catch(e){toast(String(e),'❌');}await sound(c);};
        c.querySelectorAll('[data-audio]').forEach(el=>el.addEventListener('change',()=>{
            const id=el.dataset.audio,value=Number(el.value);
            return id.startsWith('app:')?action('set_app_volume',{index:Number(id.slice(4)),volume:value}):action('system_set_volume',{input:id==='input',value});
        }));
        c.querySelectorAll('[data-audio-default]').forEach(el=>el.addEventListener('change',()=>action(el.dataset.audioDefault==='input'?'set_default_source':'set_default_sink',{name:el.value})));
        c.querySelectorAll('[data-card]').forEach(el=>el.addEventListener('change',()=>action('set_audio_profile',{card:el.dataset.card,profile:el.value})));
        c.querySelector('#audio-balance')?.addEventListener('change',e=>action('set_balance',{balance:Number(e.target.value)}));
        setupToggle('audio-mute',active=>action('system_set_mute',{input:false,muted:active}));
        setupToggle('audio-mic',active=>action('set_mic_muted',{muted:active}));
    }catch(e){c.innerHTML=renderHeader('Sonido')+renderServiceError(e,'audio');}
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
