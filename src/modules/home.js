export const searchIndex=[
{id:'conexiones',title:'Conexiones',subtitle:'Wi-Fi · Bluetooth · Modo avión',keywords:['wifi','red','internet','bluetooth','avion','conexion','network','connections','airplane','ethernet','cable','wired']},
{id:'dispositivos',title:'Dispositivos conectados',subtitle:'Share · Buds',keywords:['dispositivo','compartir','share','buds','devices','connected','nearby','headphones','earbuds']},
{id:'recuperacion',title:'Recuperación',subtitle:'Instantáneas · Restaurar',keywords:['recuperacion','recovery','snapshot','captura','revertir','rollback','btrfs','snapper','restaurar','backup']},
{id:'teclado',title:'Teclado',subtitle:'Repetición · Distribución',keywords:['repetir','retardo','velocidad','teclado','keyboard','distribucion','layout','atajos','shortcuts','teclas','repeticion','xkb']},
{id:'touchpadmouse',title:'Touchpad y ratón',subtitle:'Sensibilidad · Botones · Velocidad',keywords:['touchpad','raton','mouse','tactil','panel','gestos','tap','scroll','puntero','botones','velocidad','aceleracion']},
{id:'modos',title:'Modos y rutinas',subtitle:'Modos · Rutinas',keywords:['modo','rutina','modes','routines','automation','automatizacion']},
{id:'sonido',title:'Sonido',subtitle:'Volumen · Salida',keywords:['sonido','volumen','audio','silencio','salida','sound','volume','mute','output','balance']},
{id:'notificaciones',title:'Notificaciones',subtitle:'No molestar',keywords:['notificacion','alerta','dnd','notifications','alert','do not disturb']},
{id:'pantalla',title:'Pantalla',subtitle:'Brillo · Resolución · Escala',keywords:['pantalla','brillo','resolucion','display','blur','efectos','screen','brightness','resolution','escala']},
{id:'bateria',title:'Batería',subtitle:'Energía · Carga · Samsung Book',keywords:['bateria','energia','carga','samsung','book','ventilador','rendimiento','battery','power','charge','performance','fan']},
{id:'bloqueo',title:'Pantalla de bloqueo',subtitle:'Bloqueo · Reloj',keywords:['bloqueo','lock','aod','huella','lockscreen','biometrics','fingerprint']},
{id:'inicio',title:'Escritorio',subtitle:'Dock · Escritorios virtuales',keywords:['inicio','home','escritorio','homescreen','layout','desktop','dock','escritorios']},
{id:'fondos',title:'Fondo de pantalla',subtitle:'Fondos · Paleta',keywords:['fondo','wallpaper','paleta','background','palette','accent','color']},
{id:'temas',title:'Temas',subtitle:'Temas · Modo oscuro',keywords:['tema','oscuro','claro','dark','light','themes','theme','mode']},
{id:'huella',title:'Huella y contraseña',subtitle:'Huellas · Contraseña',keywords:['huella','dactilar','fingerprint','fprint','contraseña','password','lector','desbloquear']},
{id:'seguridad',title:'Seguridad y privacidad',subtitle:'Firewall · Permisos',keywords:['seguridad','privacidad','permiso','firewall','ufw','security','privacy','permissions','camera','microphone']},
{id:'cuentas',title:'Cuentas',subtitle:'Perfil · Nombre · Nombre del equipo',keywords:['cuenta','perfil','nombre','hostname','account','profile','name','password','user']},
{id:'avanzadas',title:'Funciones avanzadas',subtitle:'Actividades dinámicas',keywords:['avanzado','labs','advanced','experimental','compositor','effects']},
{id:'mantenimiento',title:'Mantenimiento',subtitle:'Almacenamiento · Caché',keywords:['mantenimiento','limpiar','cache','espacio','disk','almacenamiento','memoria','maintenance','clean','storage','space']},
{id:'aplicaciones',title:'Aplicaciones',subtitle:'Apps predeterminadas',keywords:['aplicacion','app','predeterminada','navegador','browser','apps','default','pdf','image','video','imagenes','correo','email']},
{id:'general',title:'Administración general',subtitle:'Idioma · Teclado · Fecha',keywords:['idioma','teclado','fecha','hora','keyboard','general','language','date','time','locale','shortcuts','atajos','autostart']},
{id:'accesibilidad',title:'Accesibilidad',subtitle:'Efectos · Animaciones',keywords:['accesibilidad','vision','zoom','accessibility','cursor','font','invert','contrast']},
{id:'actualizacion',title:'Actualización de software',subtitle:'Sistema · Flatpak',keywords:['actualizar','update','paru','pacman','flatpak','updates','software','upgrade','dnf','channel','canal']},
{id:'acerca',title:'Acerca del portátil',subtitle:'Hardware · Info',keywords:['acerca','about','info','kernel','bookos','hardware','version']},
];

// Granular sub-settings index — each entry points to its parent page.
// Optional `page` field: navigate directly to that page instead of the parent
// (used by full pages demoted from the sidebar into a section of another page).
export const subSearchIndex=[
{parent:'inicio',title:'Número de escritorios',keywords:['escritorios','virtuales']},
{parent:'avanzadas',title:'Actividades dinámicas',keywords:['actividades','temporizador','animaciones']},
{parent:'accesibilidad',title:'Reducir efectos y animaciones',keywords:['efectos','animaciones','reducidos']},
{parent:'bloqueo',title:'Bloqueo por inactividad',keywords:['inactividad','bloqueo','suspension']},
// Funciones nuevas (sub-páginas dentro de páginas existentes)
{parent:'pantalla',title:'Pantallas externas',keywords:['monitor','externo','hdmi','proyector','multimonitor','duplicar','extender','display']},
{parent:'bateria',title:'Opciones avanzadas de energía',keywords:['tapa','lid','suspender','suspension','inactividad','critica','energia','apagar']},
// Páginas fusionadas en Seguridad / Actualización (sin entrada propia en sidebar)
// Pantalla
{parent:'pantalla',title:'Brillo',keywords:['brillo','brightness','luminosidad']},
{parent:'pantalla',title:'Resolución',keywords:['resolucion','tamaño','pixel']},
{parent:'pantalla',title:'Tasa de refresco',keywords:['refresco','hz','60','120','frecuencia']},
{parent:'pantalla',title:'Escala',keywords:['escala','zoom','dpi']},
// Bateria
{parent:'bateria',title:'Modo de rendimiento',keywords:['rendimiento','performance','balanced','silencioso','potencia']},
{parent:'bateria',title:'Protección de batería',keywords:['proteccion','limite','80','tope']},
{parent:'bateria',title:'Modo ventilador',keywords:['ventilador','fan','silencio','ruido']},
{parent:'bateria',title:'Información de la batería',keywords:['info','salud','ciclos','health','wear']},
// Sonido
{parent:'sonido',title:'Volumen',keywords:['volumen','volume','sonido']},
{parent:'sonido',title:'Silenciar',keywords:['silenciar','mute','silencio']},
{parent:'sonido',title:'Salida de audio',keywords:['salida','output','altavoz','auriculares','speaker']},
{parent:'sonido',title:'Entrada de micrófono',keywords:['microfono','mic','entrada','input']},
// Conexiones
{parent:'conexiones',title:'WiFi',keywords:['wifi','wireless','red','redes']},
{parent:'conexiones',title:'Bluetooth',keywords:['bluetooth','bt']},
{parent:'conexiones',title:'Modo avión',keywords:['avion','airplane','vuelo']},
{parent:'conexiones',title:'VPN',keywords:['vpn','virtual','tunel']},
// Bloqueo
{parent:'bloqueo',title:'Personalizar',keywords:['reloj','avatar','tamaño','posicion','altura','musica','personalizar','fuente','grosor','letra']},
// Notificaciones
{parent:'notificaciones',title:'No molestar (DND)',keywords:['dnd','molestar','silencio']},
{parent:'notificaciones',title:'Notificaciones',keywords:['notificacion','alerta','aviso']},
// Inicio
// Fondos
{parent:'fondos',title:'Fondo de pantalla',keywords:['fondo','wallpaper','imagen']},
{parent:'fondos',title:'Paleta de colores',keywords:['paleta','colores','acento','tono']},
// Temas
{parent:'temas',title:'Esquema de color',keywords:['esquema','color','oscuro','claro','dark','light']},
{parent:'temas',title:'Modo oscuro automático',keywords:['automatico','horario','schedule','noche','dia']},
// Seguridad
{parent:'seguridad',title:'Firewall (UFW)',keywords:['firewall','ufw','puertos']},
// Cuentas
{parent:'cuentas',title:'Nombre de usuario',keywords:['nombre','usuario','user']},
{parent:'cuentas',title:'Hostname',keywords:['hostname','equipo','red','nombre']},
{parent:'cuentas',title:'Avatar',keywords:['avatar','foto','imagen','perfil']},
// General
{parent:'general',title:'Idioma',keywords:['idioma','language','lenguaje','locale']},
{parent:'general',title:'Fecha y hora',keywords:['fecha','hora','date','time','zona']},
{parent:'general',title:'Página de inicio',keywords:['inicio','startup','arranque','default']},
// Mantenimiento
{parent:'mantenimiento',title:'Almacenamiento',keywords:['almacenamiento','disco','disk','espacio']},
{parent:'mantenimiento',title:'Logs del sistema',keywords:['logs','registros','journal']},
// Acerca
{parent:'acerca',title:'Modelo del equipo',keywords:['modelo','equipo','samsung','book','galaxy']},
{parent:'acerca',title:'Procesador',keywords:['cpu','procesador','intel','amd']},
{parent:'acerca',title:'Memoria RAM',keywords:['ram','memoria','gb']},
{parent:'acerca',title:'GPU',keywords:['gpu','grafica','video','intel','nvidia']},
{parent:'acerca',title:'Kernel',keywords:['kernel','linux','version']},
{parent:'acerca',title:'Escritorio BookOS',keywords:['bookos','escritorio','version']},
// Actualizacion
{parent:'actualizacion',title:'Actualizaciones del sistema',keywords:['actualizacion','update','paru','pacman']},
{parent:'actualizacion',title:'Flatpak',keywords:['flatpak','app']},
// Modos
{parent:'modos',title:'Modos predefinidos',keywords:['modo','predefinido','perfil']},
{parent:'modos',title:'Rutinas',keywords:['rutina','automatizacion','disparador','trigger']},
// Avanzadas
// Accesibilidad
// Aplicaciones
{parent:'aplicaciones',title:'Navegador predeterminado',keywords:['navegador','browser','firefox','chromium']},
{parent:'aplicaciones',title:'Cliente de correo',keywords:['correo','email','mail']},
{parent:'aplicaciones',title:'Reproductor multimedia',keywords:['reproductor','multimedia','video','audio']},
// Dispositivos
{parent:'dispositivos',title:'Quick Share',keywords:['share','compartir','quick','rquickshare']},
{parent:'dispositivos',title:'Galaxy Buds',keywords:['buds','audifonos','samsung']},
// Conexiones — añadidos
{parent:'conexiones',title:'Ethernet (cable)',keywords:['ethernet','cable','wired','rj45','lan']},
// Avanzadas — efectos concretos
// Bateria — añadidos
{parent:'bateria',title:'Al conectar el cargador',keywords:['cargador','enchufe','charger','plug','ac','corriente']},
{parent:'bateria',title:'Perfil térmico',keywords:['termico','thermal','watts','tdp','temperatura']},
{parent:'bateria',title:'Límite de carga',keywords:['limite','carga','80','tope','charge limit']},
// Sonido — añadidos
{parent:'sonido',title:'Balance de audio',keywords:['balance','izquierda','derecha','left','right','pan']},
// Accesibilidad — añadidos
// Aplicaciones — categorías nuevas
{parent:'aplicaciones',title:'Visor de imágenes',keywords:['imagen','imagenes','image','foto','gwenview','visor']},
{parent:'aplicaciones',title:'Lector de PDF',keywords:['pdf','documento','okular','lector']},
{parent:'aplicaciones',title:'Editor de texto',keywords:['texto','editor','text','kate']},
{parent:'aplicaciones',title:'Gestor de archivos',keywords:['archivos','files','gestor','dolphin']},
{parent:'aplicaciones',title:'Archivos comprimidos',keywords:['comprimido','zip','rar','7z','archive']},
// Mantenimiento
{parent:'mantenimiento',title:'Limpiar caché',keywords:['cache','limpiar','clean','basura','temporal']},
{parent:'mantenimiento',title:'Limpiar Flatpak',keywords:['flatpak','limpiar','huerfanos','unused']},
];

import{t}from'./i18n.js';

const ic=s=>`<div class="item-icon"><img src="assets/${s}" alt=""></div>`;
// Earbuds icon for the Home profile-card shortcut — reuses the same SVG art as
// the Buds page rings (looks clean, never emoji).
// Como máscara y no como <img>: los SVG son trazo oscuro y en tema oscuro no
// se veían. Así toman el color del texto.
const BUDS_SVG=`<span class="home-buds-pair"><i style="--src:url(assets/budsleft.svg)"></i><i style="--src:url(assets/budsright.svg)"></i></span>`;
const it=(page,icon,key)=>`<div class="item" data-page="${page}" tabindex="0" role="button">${ic(icon)}<div class="item-texts"><span class="title">${t(key)}</span><span class="subtitle">${t(key+'_sub')}</span></div></div>`;

export function renderHome(u){
    const name=u?.display_name||t('user');
    const ini=name.charAt(0).toUpperCase();
    // Backend inlines the avatar as a data URL — no protocol headaches.
    const _assetUrl=(p)=>window.__TAURI__?.core?.convertFileSrc?window.__TAURI__.core.convertFileSrc(p):('asset://localhost'+(p.startsWith('/')?p:'/'+p));
    const avSrc=u?.avatar_data||(u?.has_avatar?_assetUrl(u.avatar_path):'');
    const av=avSrc
        ?`<img src="${avSrc}" class="profile-avatar" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'profile-avatar-placeholder',textContent:'${ini}'}))">`
        :`<div class="profile-avatar-placeholder">${ini}</div>`;
    return `
<div class="card card-profile">
    <div class="item" data-page="cuentas" tabindex="0" role="button">
        ${av}<div class="profile-left"><span class="title">${name}</span><span class="subtitle">${t('bookos_account')}</span></div>
    </div>
    <div class="item home-buds-row" id="home-buds" tabindex="0" role="button" style="display:none">
        <div class="item-icon">${BUDS_SVG}</div>
        <div class="item-texts"><span class="title home-buds-name"></span><span class="subtitle home-buds-bat"></span></div>
    </div>
</div>

<div class="card">
    ${it('conexiones','wifi.svg','connections')}
    ${it('dispositivos','connected.svg','devices')}
</div>

<div class="card">
    ${it('sonido','sound.svg','sound')}
    ${it('pantalla','brightness.svg','display')}
    ${it('bateria','battery.svg','battery')}
</div>

<div class="card">
    ${it('bloqueo','lockscreen.svg','lockscreen')}
    ${it('inicio','start.svg','homescreen')}
    ${it('fondos','wallpaper.svg','wallpaper')}
    ${it('temas','themes.svg','themes')}
</div>

<div class="card">
    ${it('general','general.svg','general')}
    ${it('teclado','keyboard.svg','kb_page')}
    ${it('touchpadmouse','touchpad.svg','tpm_page')}
    ${it('notificaciones','notification.svg','notifications')}
    ${it('accesibilidad','accesibility.svg','accessibility')}
</div>

<div class="card">
    ${it('seguridad','security.svg','security')}
    ${it('huella','fingerprint.svg','fingerprint')}
    ${it('aplicaciones','aplications.svg','apps')}
    ${it('actualizacion','software.svg','updates')}
</div>

<div class="card home-more-card is-collapsed" id="home-more-card">
    <button class="home-more-toggle" type="button" aria-expanded="false">
        <span class="home-more-copy"><span class="title">${t('more_settings')}</span><span class="subtitle">${t('more_settings_sub')}</span></span>
        <span class="home-more-chevron" aria-hidden="true">›</span>
    </button>
    <div class="home-more-items">
        ${it('modos','routines.svg','modes_routines')}
        ${it('avanzadas','advanced.svg','advanced')}
        ${it('recuperacion','recovery.svg','recovery')}
        ${it('mantenimiento','maintanance.svg','maintenance')}
        ${it('acerca','about.svg','about')}
    </div>
</div>`;
}
