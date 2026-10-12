import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const idioma=readFileSync(new URL('../src/modules/i18n.js',import.meta.url),'utf8').replaceAll('export function','function');
const comun=readFileSync(new URL('../src/modules/pages/_common.js',import.meta.url),'utf8');
const diccionario=comun.slice(comun.indexOf('const _UI_TR_EN ='),comun.indexOf('// Los estados cambian también'));
const avisos=comun.slice(comun.indexOf('const _TOAST_TR_EN ='),comun.indexOf('function toast('));

for(const [sistema,guardado,esperado] of [
    ['en-US',null,'en'],['en-GB','auto','en'],['es-ES',null,'es'],
    ['en-US','es','es'],['es-ES','en','en'],['es-ES','en-US','en'],
]){
    test(`Idioma coherente con sistema ${sistema} y preferencia ${guardado}`,()=>{
        const valores=new Map(guardado?[['bookos_lang',guardado]]:[]);
        const contexto=vm.createContext({navigator:{language:sistema},localStorage:{
            getItem:clave=>valores.get(clave),setItem:(clave,valor)=>valores.set(clave,valor),
            removeItem:clave=>valores.delete(clave),
        }});
        vm.runInContext(idioma+diccionario+avisos,contexto);
        assert.equal(vm.runInContext('getLang()',contexto),esperado);
        assert.equal(vm.runInContext('_isEN()',contexto),esperado==='en');
        assert.equal(vm.runInContext('_tr("Actividades dinámicas")',contexto),esperado==='en'?'Dynamic activities':'Actividades dinámicas');
        assert.equal(vm.runInContext('_toastTr("Guardado")',contexto),esperado==='en'?'Saved':'Guardado');
        vm.runInContext('setLang("en")',contexto);
        assert.equal(vm.runInContext('t("advanced_sub")',contexto),'Dynamic activities');
        vm.runInContext('setLang("es")',contexto);
        assert.equal(vm.runInContext('_tr("Actividades dinámicas")',contexto),'Actividades dinámicas');
        assert.equal(vm.runInContext('Object.keys(ES).sort().join()===Object.keys(EN).sort().join()',contexto),true);
        assert.equal(vm.runInContext('ES.ls_to_full.includes("%1") && EN.ls_to_full.includes("%1")',contexto),true);
    });
}

const contextoIngles=()=>{
    const contexto=vm.createContext({navigator:{language:'en-US'},localStorage:{getItem:()=>null}});
    vm.runInContext(idioma+diccionario,contexto);
    return contexto;
};

test('Los textos literales de los controles tienen traducción',()=>{
    const contexto=contextoIngles();
    for(const ruta of ['../src/modules/pages.js','../src/modules/pages/desktop.js']){
        const fuente=readFileSync(new URL(ruta,import.meta.url),'utf8');
        for(const coincidencia of fuente.matchAll(/(?:_tr|renderSection|renderHeader|renderRowItem|renderInfoItem)\(\s*'([^'\n]+)'/g)){
            const texto=coincidencia[1];
            contexto.texto=texto;
            assert.equal(vm.runInContext('Object.hasOwn(_UI_TR_EN,texto)',contexto),true,`Falta traducción: ${texto}`);
        }
    }
});

test('Traduce los atributos del propio elemento y conserva los espacios del texto',()=>{
    const contexto=contextoIngles();
    const nodo={nodeValue:'  Hora automática  '};
    const atributos=new Map([['placeholder','Buscar zona…'],['title','Reintentar'],['aria-label','Zona horaria']]);
    const raiz={matches:()=>true,querySelectorAll:()=>[],getAttribute:clave=>atributos.get(clave),setAttribute:(clave,valor)=>atributos.set(clave,valor)};
    contexto.getLang=()=> 'en';
    contexto.NodeFilter={SHOW_TEXT:4};
    contexto.document={createTreeWalker:()=>{let pendiente=true;return {nextNode:()=>pendiente?(pendiente=false,nodo):null};}};
    const paso=comun.slice(comun.indexOf('function translateDOM(root)'),comun.indexOf('// Los estados cambian también'));
    vm.runInContext(paso,contexto);
    contexto.translateDOM(raiz);
    assert.equal(nodo.nodeValue,'  Automatic time  ');
    assert.equal(atributos.get('placeholder'),'Search time zones…');
    assert.equal(atributos.get('title'),'Retry');
    assert.equal(atributos.get('aria-label'),'Time zone');
    nodo.nodeValue='  Conectar a Red $&  ';
    contexto.translateDOM(raiz);
    assert.equal(nodo.nodeValue,'  Connect to Red $&  ');
});

test('Traduce cambios de texto, atributos y nodos de texto añadidos',()=>{
    const contexto=contextoIngles();
    const pendientes=[];
    let observar,opciones;
    contexto.window={};
    contexto.document={body:{},readyState:'complete'};
    contexto.MutationObserver=class{
        constructor(callback){observar=callback;}
        observe(raiz,configuracion){opciones=configuracion;}
    };
    contexto.requestAnimationFrame=callback=>{pendientes.push(callback);return pendientes.length;};
    const observador=comun.slice(comun.indexOf("if(typeof window!=='undefined'){\n    window.translateDOM=translateDOM;"),comun.indexOf('function renderRowItem('));
    const traducidos=[];
    contexto.translateDOM=raiz=>traducidos.push(raiz);
    vm.runInContext(observador,contexto);
    traducidos.length=0;
    const texto={parentElement:{}},atributo={},nuevoTexto={nodeType:3,parentElement:{}};
    observar([
        {type:'characterData',target:texto},
        {type:'attributes',target:atributo},
        {type:'childList',addedNodes:[nuevoTexto]},
    ]);
    assert.equal(pendientes.length,1);
    pendientes[0]();
    assert.deepEqual(traducidos,[texto.parentElement,atributo,nuevoTexto.parentElement]);
    assert.equal(opciones.characterData,true);
    assert.equal(opciones.attributes,true);
});

test('Las traducciones literales no cambian al pasar dos veces por el traductor',()=>{
    const contexto=contextoIngles();
    const pares=vm.runInContext('Object.entries(_UI_TR_EN)',contexto);
    for(const [original,traducido] of pares){
        contexto.texto=traducido;
        assert.equal(vm.runInContext('_tr(texto)',contexto),traducido,`Doble traducción de ${original}`);
    }
});

test('Conserva códigos, nombres, cantidades y espacios en frases variables',()=>{
    const contexto=contextoIngles();
    vm.runInContext(avisos,contexto);
    for(const [original,esperado] of [
        ['Conectar a Red $&','Connect to Red $&'],
        ['Olvidar "Red de casa"','Forget "Red de casa"'],
        ['¿Quieres olvidar Auriculares?','Do you want to forget Auriculares?'],
        ['Eliminar cuenta "maria"','Delete account "maria"'],
        ['Para cambiar el idioma del sistema, introduce la contraseña del equipo.','To change the system language, enter your computer password.'],
        ['Archivo recibido: foto $&.png','File received: foto $&.png'],
        ['Enviando enlace a Pixel…','Sending link to Pixel…'],
        ['3 archivos','3 files'],
        ['2h 15min de batería restante','2h 15min of battery remaining'],
        ['45% disponible','45% available'],
        ['Error: Las contraseñas no coinciden','Error: Passwords do not match'],
        ['Error al enviar: Permiso denegado','Could not send: Permission denied'],
        ['  Actualizando  ','  Updating  '],
        ['  Hora\n automática  ','  Automatic time  '],
        ['constructor','constructor'],
        ['toString','toString'],
    ]){
        contexto.texto=original;
        assert.equal(vm.runInContext('_toastTr(texto)',contexto),esperado,original);
        vm.runInContext('_lang="es"',contexto);
        assert.equal(vm.runInContext('_toastTr(texto)',contexto),original);
        vm.runInContext('_lang="en"',contexto);
    }
});

test('Los catálogos conservan todos sus marcadores',()=>{
    const contexto=contextoIngles();
    const pares=vm.runInContext('Object.keys(ES).map(clave=>[clave,ES[clave],EN[clave]])',contexto);
    for(const [clave,es,en] of pares){
        const marcadores=texto=>[...texto.matchAll(/%\d+|\{\w+\}/g)].map(m=>m[0]).sort();
        assert.deepEqual(marcadores(es),marcadores(en),clave);
    }
});

test('Los textos HTML de páginas y ventanas tienen traducción',()=>{
    const contexto=contextoIngles();
    const neutros=new Set(['Ethernet','MAC:','Madrid','18ºC','A','B','Win+L','Wi-Fi','Bluetooth','Book Share']);
    for(const ruta of ['../src/modules/pages.js','../src/modules/pages/desktop.js','../src/modules/pages/sddm-editor.js']){
        const fuente=readFileSync(new URL(ruta,import.meta.url),'utf8');
        for(const coincidencia of fuente.matchAll(/>([^<>$`{}]+)</g)){
            const antes=fuente.slice(0,coincidencia.index+1);
            const etiqueta=antes.slice(antes.lastIndexOf('<'));
            if(!/^<\/?(?:span|p|div|button|b|i|u|label|h[1-6]|small|strong|option|a|em|li|td|th)(?:\s[^<>]*)?>$/i.test(etiqueta))continue;
            const texto=coincidencia[1].trim().replace(/\s+/g,' ');
            if(/[=]|^['"]/.test(texto))continue;
            if(!/[a-záéíóúñ]/i.test(texto)||neutros.has(texto))continue;
            contexto.texto=texto;
            assert.equal(vm.runInContext('Object.hasOwn(_UI_TR_EN,texto)',contexto),true,`Falta traducción en ${ruta}: ${texto}`);
        }
    }
});

test('Los resúmenes de rutinas traducen cada etiqueta y conservan su valor',()=>{
    const contexto=contextoIngles();
    const fuente=readFileSync(new URL('../src/modules/pages.js',import.meta.url),'utf8');
    contexto.RB_TRIGGERS=[{type:'time',label:'Hora'}];
    contexto.RB_ACTIONS=[{type:'theme',label:'Tema del sistema',valueType:'select',options:[['BreezeDark','Oscuro']]},{type:'volume',label:'Volumen',valueType:'range'}];
    vm.runInContext(fuente.slice(fuente.indexOf('function rbTriggerLabel'),fuente.indexOf('function renderRoutinesList')),contexto);
    assert.equal(contexto.rbTriggerLabel({type:'time',value:'08:35'}),'Time — 08:35');
    assert.equal(contexto.rbActionLabel({type:'theme',value:'BreezeDark'}),'System theme — Dark');
    assert.equal(contexto.rbActionLabel({type:'volume',value:'37'}),'Volume — 37%');
});

for(const lang of ['es','en']){
    test(`El emparejamiento Bluetooth se traduce sin cargar páginas en ${lang}`,async()=>{
        const escuchas=new Map(),dialogos=[];
        const contexto=vm.createContext({navigator:{language:lang},localStorage:{getItem:()=>null},console,
            document:{body:{append:dialogo=>dialogos.push(dialogo)},createElement:etiqueta=>({
                etiqueta,children:[],style:{},atributos:{},
                append(...hijos){this.children.push(...hijos);},
                setAttribute(clave,valor){this.atributos[clave]=valor;},addEventListener(){},showModal(){},remove(){},focus(){},
            })},
            window:{__TAURI__:{event:{listen:async(nombre,callback)=>escuchas.set(nombre,callback)}}},
            tauriInvoke:async()=>{},invalidateSystemCache:()=>{},
        });
        vm.runInContext(idioma,contexto);
        const fuente=readFileSync(new URL('../src/modules/system-events.js',import.meta.url),'utf8')
            .replace(/^import .+;\n/gm,'').replace('export async function','async function');
        vm.runInContext(fuente,contexto);
        await contexto.startSystemEvents();
        escuchas.get('bookos-pairing')({payload:{id:'prueba',kind:'confirm',value:'123456'}});
        const dialogo=dialogos[0];
        assert.equal(dialogo.children[0].textContent,lang==='es'?'Emparejamiento Bluetooth':'Bluetooth pairing');
        assert.equal(dialogo.children[1].textContent,lang==='es'?'¿Coincide este código en el dispositivo? 123456':'Does this code match the one on the device? 123456');
        assert.equal(dialogo.children.at(-1).textContent,lang==='es'?'Confirmar':'Confirm');
        escuchas.get('bookos-pairing')({payload:{id:'prueba',kind:'pin'}});
        const campo=dialogos[1].children.find(e=>e.etiqueta==='input');
        assert.equal(campo.placeholder,lang==='es'?'Código del dispositivo':'Device code');
        assert.equal(campo.atributos['aria-label'],campo.placeholder);
    });
}
