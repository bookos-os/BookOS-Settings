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
// Una página larga de filas sueltas no se lee: build puede devolver grupos
// [título, filas] y cada uno sale en su tarjeta.
const cards=items=>Array.isArray(items[0])?items.map(([t,rows])=>(t?renderSection(t):'')+renderCard(rows)).join(''):renderCard(items);
async function page(c,title,build,restart=false){
    c.innerHTML=renderHeader(title)+renderSkeleton(2);
    try{
        const data=await config();
        c.innerHTML=renderHeader(title)+(restart?renderInfoItem('Estos cambios se aplicarán al volver a iniciar sesión.'):'')+cards(build(data));
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
        renderRowItem('Tema claro desde','',`<input class="bk-time" data-config="tema_claro_desde" type="time" value="${esc(d.tema_claro_desde)}">`),
        renderRowItem('Tema oscuro desde','',`<input class="bk-time" data-config="tema_oscuro_desde" type="time" value="${esc(d.tema_oscuro_desde)}">`),
        select('efectos','Efectos',d.efectos,[['completos','Completos'],['reducidos','Reducidos']]),
        renderRowItem('Iconos tintados','', '<button type="button" class="btn btn-secondary" id="native-icons">Configurar</button>'),
    ]);
    c.querySelector('#native-icons')?.addEventListener('click',()=>{window.pushSubNav?.(()=>appearance(c,icons));icons?.();});
}
export async function lockscreen(c){
    await page(c,'Pantalla de bloqueo',d=>[
        ['Seguridad',[
            toggle('bloqueo_huella','Desbloquear con huella',d.bloqueo_huella,'Requiere un lector compatible y una huella registrada. La contraseña sigue disponible.'),
            duration('bloqueo_inactividad','Bloquear tras inactividad',d.bloqueo_inactividad,[0,60,120,300,600,900,1800,3600]),
            duration('suspension_inactividad','Suspender tras el bloqueo',d.suspension_inactividad,[0,60,300,600,1800,3600]),
            // `!==false`: un compositor anterior a estas claves no las envía.
            toggle('bloqueo_energia','Botón de apagado',d.bloqueo_energia!==false,'Apagar, reiniciar o suspender sin desbloquear'),
        ]],
        ['Qué se muestra',[
            toggle('bloqueo_fecha','Fecha',d.bloqueo_fecha),
            toggle('bloqueo_nombre','Nombre de usuario',d.bloqueo_nombre!==false),
            toggle('bloqueo_medios','Controles multimedia',d.bloqueo_medios),
            toggle('bloqueo_animaciones','Animaciones',d.bloqueo_animaciones),
        ]],
        // Límites iguales a los que valida bookos-comp (ajustes.rs): fuera de
        // ellos el compositor rechaza la configuración entera.
        ['Tamaño y posición',[
            range('bloqueo_reloj_tamano','Tamaño del reloj',d.bloqueo_reloj_tamano,72,220,1,'px'),
            range('bloqueo_avatar_tamano','Tamaño del avatar',d.bloqueo_avatar_tamano,64,220,1,'px'),
            range('bloqueo_reloj_y','Altura del reloj',d.bloqueo_reloj_y,.02,.4,.01,'pct'),
            range('bloqueo_acceso_y','Altura del acceso',d.bloqueo_acceso_y,.18,.72,.01,'pct'),
            range('bloqueo_medios_y','Altura de los controles multimedia',d.bloqueo_medios_y,.42,.88,.01,'pct'),
        ]],
        ['Inicio de sesión',[
            renderRowItem('Pantalla de inicio de sesión','SDDM', '<button type="button" class="btn btn-secondary" id="native-sddm">Configurar</button>'),
        ]],
    ]);
    c.querySelector('#native-sddm')?.addEventListener('click',()=>{window.pushSubNav?.(()=>lockscreen(c));renderSddmEditor(c);});
    // Maqueta de la pantalla de bloqueo de bookos-desktop. Lee los valores de
    // los propios controles para no duplicar el estado; el reloj va a 0,2× (la
    // maqueta mide ~216 px de alto frente a los ~1080 de una pantalla).
    const header=c.querySelector('.detail-header');if(!header)return;
    header.insertAdjacentHTML('afterend',`<div class="detail-card lock-preview" aria-hidden="true"><div class="lp-screen"><div class="lp-clock"><span class="lp-time">09:41</span><span class="lp-date">martes, 30 de septiembre</span></div><div class="lp-access"><div class="lp-avatar"></div><span class="lp-name">${esc(_tr('Usuario'))}</span><span class="lp-field"></span></div><i class="lp-power"></i><div class="lp-media"><i></i><span>Reproduciendo</span></div></div></div>`);
    const box=c.querySelector('.lp-screen');
    const val=k=>Number(c.querySelector(`[data-config="${k}"]`)?.value);
    const on=k=>c.querySelector(`[data-toggle="${k}"]`)?.classList.contains('active');
    const K=.2;
    const paint=()=>{
        const st=box.style;
        st.setProperty('--clock',`${val('bloqueo_reloj_tamano')*K}px`);
        st.setProperty('--avatar',`${val('bloqueo_avatar_tamano')*K}px`);
        st.setProperty('--clock-y',`${val('bloqueo_reloj_y')*100}%`);
        st.setProperty('--access-y',`${val('bloqueo_acceso_y')*100}%`);
        st.setProperty('--media-y',`${val('bloqueo_medios_y')*100}%`);
        box.querySelector('.lp-date').hidden=!on('bloqueo_fecha');
        box.querySelector('.lp-media').hidden=!on('bloqueo_medios');
        box.querySelector('.lp-name').hidden=!on('bloqueo_nombre');
        box.querySelector('.lp-power').hidden=!on('bloqueo_energia');
    };
    paint();
    c.addEventListener('input',paint);
    c.querySelectorAll('[data-toggle="bloqueo_fecha"],[data-toggle="bloqueo_medios"],[data-toggle="bloqueo_nombre"],[data-toggle="bloqueo_energia"]').forEach(t=>t.addEventListener('click',()=>requestAnimationFrame(paint)));
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
    let n=2,size=50,names=[],pinned=[];
    await page(c,'Escritorio',d=>{
        n=d.escritorios;size=d.dock_tamano??50;pinned=d.dock||[];
        names=Array.from({length:5},(_,i)=>d.nombres_escritorios?.[i]||`Escritorio ${i+1}`);
        const seg=[1,2,3,4,5].map(v=>`<button type="button" class="bk-seg-btn${v===n?' active':''}" data-desk="${v}" aria-pressed="${v===n}">${v}</button>`).join('');
        return [
            range('dock_tamano','Tamaño del dock',size,32,80,1,'px'),
            toggle('genio','Efecto magic lamp al minimizar',d.genio!==false,'La ventana se pliega hacia el dock. Apagado, solo se encoge.'),
            renderRowItem('Número de escritorios','',`<div class="bk-seg" role="group" aria-label="Número de escritorios">${seg}</div>`),
        ];
    });
    const header=c.querySelector('.detail-header'),card=c.querySelector('.detail-card');
    if(!header||!card)return;
    // Vista previa con los iconos a tamaño real: es lo que el deslizador cambia,
    // y un número en píxeles no dice si 50 es mucho o poco.
    // Los lanzadores fijados de verdad (inicial de su etiqueta, sin resolver el
    // icono del tema desde aquí); con el dock vacío, unos de muestra.
    const cols=['var(--blue)','var(--green)','var(--orange)','var(--red)','var(--yellow)'];
    const tiles=(pinned.length?pinned.slice(0,7):[{},{},{},{},{}]).map((l,i)=>`<i style="background:${cols[i%cols.length]}">${esc((l.etiqueta||'').trim().charAt(0).toUpperCase())}</i>`).join('');
    const dots=Array.from({length:5},(_,i)=>`<b${i<n?'':' hidden'}${i===0?' class="on"':''}></b>`).join('');
    header.insertAdjacentHTML('afterend',`<div class="detail-card dock-preview" aria-hidden="true"><div class="dock-desks">${dots}</div><span class="dock-desk-name">${esc(names[0])}</span><div class="dock-bar" style="--dock:${size}px">${tiles}</div></div>`);
    const bar=c.querySelector('.dock-bar');
    c.querySelector('[data-config="dock_tamano"]')?.addEventListener('input',e=>bar.style.setProperty('--dock',`${e.target.value}px`));
    const seg=c.querySelector('.bk-seg');
    seg?.addEventListener('click',async e=>{
        const btn=e.target.closest('[data-desk]');if(!btn)return;
        const v=Number(btn.dataset.desk);if(v===n)return;
        try{
            await save({escritorios:v},true);
            n=v;
            seg.querySelectorAll('[data-desk]').forEach(x=>{const on=x===btn;x.classList.toggle('active',on);x.setAttribute('aria-pressed',String(on));});
            c.querySelectorAll('.dock-desks b').forEach((d,i)=>{d.hidden=i>=v;});
            c.querySelectorAll('.desk-name-row').forEach((r,i)=>{r.hidden=i>=v;});
        }catch(err){toast(String(err),'❌');}
    });
    // Nombres: el compositor los guarda separados por comas, así que se quitan.
    const rows=names.map((nm,i)=>`<div class="detail-item detail-item-row desk-name-row"${i<n?'':' hidden'}><div class="detail-texts"><span class="dt">Escritorio ${i+1}</span></div><input class="desk-name" data-i="${i}" maxlength="24" value="${esc(nm)}" aria-label="Nombre del escritorio ${i+1}"></div>`).join('');
    card.insertAdjacentHTML('afterend',renderSection('Nombres')+renderCard([rows]));
    const label=c.querySelector('.dock-desk-name');
    c.querySelectorAll('.desk-name').forEach(inp=>{
        const i=Number(inp.dataset.i);
        inp.addEventListener('focus',()=>{label.textContent=inp.value||`Escritorio ${i+1}`;});
        inp.addEventListener('input',()=>{label.textContent=inp.value||`Escritorio ${i+1}`;});
        inp.addEventListener('change',async()=>{
            const v=inp.value.replace(/,/g,' ').trim()||`Escritorio ${i+1}`;
            const prev=names[i];
            inp.value=v;names[i]=v;
            try{await save({nombres_escritorios:names.slice(0,n)});}
            catch(err){names[i]=prev;inp.value=prev;toast(String(err),'❌');}
        });
    });
    c.insertAdjacentHTML('beforeend','<p class="page-foot">El número de escritorios se aplica al volver a iniciar sesión. Los lanzadores se fijan y se retiran desde el dock o el launchpad.</p>');
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
/// El nombre de un dispositivo de audio tal como se reconoce.
///
/// PipeWire los llama por el chip: «Core Ultra 200V Series Processors HD Audio
/// Speaker». Todo lo que va hasta «Audio» es igual en todos los del portátil y
/// no distingue nada; lo que dice qué es, es lo de después. Los de Bluetooth o
/// USB no llevan ese prefijo y se quedan como vienen.
function nombreAudio(desc){
    const entero=String(desc).replace(/^Monitor of /,'');
    const resto=entero.replace(/^.*?\b(?:HD )?Audio(?:\s+|$)/,'');
    if(!resto)return _tr('Audio del portátil');
    const conocidos=[
        [/^Speaker$/i,'Altavoces del portátil'],
        [/^Headphones?$/i,'Auriculares'],
        [/^Stereo Microphone$/i,'Micrófono estéreo'],
        [/^Digital Microphone$/i,'Micrófono del portátil'],
        [/^Headset Microphone$/i,'Micrófono de los auriculares'],
        [/^(HDMI \/ DisplayPort \d+) Output$/i,'$1'],
    ];
    for(const [re,nombre] of conocidos)if(re.test(resto))return _tr(resto.replace(re,nombre));
    // Algo que no se conoce se deja entero: cortado, «USB Audio Device» se
    // quedaba en «Device».
    return entero;
}

export async function sound(c){
    const mounted=soundHtml.has(c)&&c.querySelector('.audio-page');
    if(!mounted)c.innerHTML=renderHeader('Sonido')+renderSkeleton(2);
    try{
        // El chasquido lo pone el compositor: fuera de una sesión BookOS no
        // hay a quién preguntar, y la página de sonido sigue valiendo sin él.
        const [d,escritorio]=await Promise.all([tauriInvoke('get_audio_devices').then(parseServiceResult),config().catch(()=>null)]);
        // Repintar con un menú abierto o un deslizador con el foco lo cierra o
        // lo suelta en la cara del usuario. El blur tras cada cambio devuelve
        // el foco, así que la siguiente señal sí repinta.
        if(document.getElementById('bk-popover')||c.querySelector('.audio-page :focus'))return;
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
        const devices=list=>list.map(x=>({value:x.name,label:nombreAudio(x.description||x.name)}));
        const rows=[];
        if(!out)rows.push(renderInfoItem('Sin dispositivo de audio','No se detectó ningún altavoz o auricular'));
        if(out)rows.push(selectRow('Salida','',name=>['set_default_sink',{name}],devices(d.sinks),d.defaultSink),sliderRow('Volumen',`${out.volume}%`,slider('output','Volumen',out.volume)),toggle('audio-mute','Silenciar salida',out.muted));
        if(out&&escritorio)rows.push(toggle('audio-feedback','Sonido al cambiar el volumen',escritorio.sonido_volumen!==false,'Con las teclas de volumen'));
        if(!input)rows.push(renderInfoItem('Sin dispositivo de audio','No se detectó ningún micrófono'));
        // Los «Monitor of …» son lo que suena por una salida, no micrófonos.
        const microfonos=(d.sources||[]).filter(x=>!String(x.name||'').endsWith('.monitor'));
        if(input)rows.push(selectRow('Entrada','',name=>['set_default_source',{name}],devices(microfonos),d.defaultSource),sliderRow('Micrófono',`${input.volume}%`,slider('input','Micrófono',input.volume)),toggle('audio-mic','Silenciar micrófono',input.muted));
        if(out)rows.push(sliderRow('Balance',_tr('Izquierda / derecha'),`<input class="bk-range" aria-label="Balance" id="audio-balance" type="range" min="-100" max="100" value="${out.balance||0}">`));
        // speech-dispatcher deja abierto un flujo de reposo aunque nadie hable:
        // no es una aplicación que el usuario reconozca ni quiera ajustar.
        for(const app of (d.apps||[]).filter(a=>!/^speech-dispatcher/.test(a.name||'')))rows.push(sliderRow(esc(app.name||'Aplicación'),`${app.volume}%`,slider(`app:${app.index}`,app.name||'Aplicación',app.volume)));
        for(const card of d.cards||[]){
            const profiles=Array.isArray(card.profiles)?card.profiles:Object.entries(card.profiles||{}).map(([name,p])=>({name,...p}));
            rows.push(selectRow(esc(nombreAudio(card.properties?.['device.description']||card.name)),'Perfil',profile=>['set_audio_profile',{card:card.name,profile}],profiles.filter(p=>p.available!=='no').map(p=>({value:p.name,label:p.description||p.name})),card.active_profile));
        }
        const html=renderHeader('Sonido')+`<div class="audio-page">${renderCard(rows.length?rows:[renderInfoItem('No hay dispositivos de audio')])}</div>`;
        if(mounted&&soundHtml.get(c)===html)return;
        c.innerHTML=html;
        soundHtml.set(c,html);
        // Sin repintar aquí: el servicio emite StateChanged tras aplicar el
        // cambio y renderSonido ya escucha esa señal. Repintar también desde
        // aquí pedía los dispositivos dos veces por cada gesto.
        const action=async(el,cmd,args)=>{try{parseServiceResult(await tauriInvoke(cmd,args));}catch(e){toast(String(e),'❌');await sound(c);}};
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
        setupToggle('audio-feedback',active=>tauriInvoke('bookos_apply_config',{config:{sonido_volumen:active}}));
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
        c.querySelector('#native-lock')?.addEventListener('click',()=>{window.pushSubNav?.(()=>security(c));lockscreen(c);});
    }catch(e){c.innerHTML=renderHeader('Seguridad y privacidad')+renderInfoItem('No se pudo leer el estado',esc(String(e)));}
}
