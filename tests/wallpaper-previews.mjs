import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/modules/pages/wallpaper-previews.js',import.meta.url),'utf8');
const {setupWallpaperPreviews}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('bounded loading, stale results, failures and navigation cleanup',async()=>{
    let intersection,leave,observedParent,disconnected=false;
    globalThis.IntersectionObserver=class{
        constructor(cb){intersection=cb;}
        observe(){} unobserve(){} disconnect(){disconnected=true;}
    };
    globalThis.MutationObserver=class{
        constructor(cb){leave=cb;}
        observe(node){observedParent=node;} disconnect(){}
    };
    const images=Array.from({length:6},(_,i)=>({id:i?'':'wp-screen-img',isConnected:true,dataset:{previewPath:`/image${i}`},style:{}}));
    const anchor={isConnected:true,parentElement:{id:"app"}};
    const container={querySelectorAll:()=>images,querySelector:()=>anchor};
    const calls=[];
    const invoke=(command,args)=>new Promise((resolve,reject)=>calls.push({command,args,resolve,reject}));
    const update=setupWallpaperPreviews(container,invoke,p=>`asset:${p}`);
    assert.equal(observedParent,anchor.parentElement,'observe the DOM parent, not the guarded renderer Proxy');
    assert.equal(calls.length,0,'hidden images do not load');
    intersection(images.map(target=>({target,isIntersecting:true})));
    assert.equal(calls.length,2);
    assert.equal(calls[0].args.hero,true);
    update(images[0],'/new-wallpaper');
    calls[0].resolve('/old-preview.jpg');
    await new Promise(setImmediate);
    assert.equal(images[0].src,undefined,'late response must not overwrite a new selection');
    assert.equal(calls.length,3);
    calls[1].reject(new Error('bad image'));
    await new Promise(setImmediate);
    assert.equal(images[1].src,undefined,'no expensive original fallback');
    assert.equal(calls.length,4,'queue continues after failure');
    assert.equal(calls[2].args.path,'/new-wallpaper','selected preview takes priority');
    calls[2].resolve('/small.jpg');
    await new Promise(setImmediate);
    assert.equal(images[0].src,'asset:/small.jpg');
    const count=calls.length;
    anchor.isConnected=false;
    leave();
    for(const call of calls)call.resolve('/late.jpg');
    await new Promise(setImmediate);
    assert.equal(calls.length,count,'navigation discards queued requests');
    assert.equal(images[3].src,undefined);
    assert.ok(disconnected);
});

test('scroll defers image commits and drops offscreen queued requests',async()=>{
    let intersection,leave,scroll,removed=false;
    globalThis.IntersectionObserver=class{
        constructor(cb){intersection=cb;}
        observe(){} unobserve(){} disconnect(){}
    };
    globalThis.MutationObserver=class{
        constructor(cb){leave=cb;}
        observe(){} disconnect(){}
    };
    const root={addEventListener:(type,fn)=>{scroll=fn;},removeEventListener:()=>{removed=true;}};
    const anchor={isConnected:true,parentElement:{},closest:()=>root};
    const images=Array.from({length:4},(_,i)=>({isConnected:true,dataset:{previewPath:`/${i}`},style:{}}));
    const calls=[];
    const update=setupWallpaperPreviews({querySelector:()=>anchor,querySelectorAll:()=>images},
        (command,args)=>new Promise(resolve=>calls.push({args,resolve})),p=>p);
    intersection(images.map(target=>({target,isIntersecting:true})));
    scroll();
    calls[0].resolve('/preview.jpg');
    await new Promise(setImmediate);
    assert.equal(images[0].src,undefined,'image upload waits until scrolling ends');
    assert.equal(calls.length,2,'no new backend work during scroll');
    intersection([{target:images[2],isIntersecting:false}]);
    await new Promise(resolve=>setTimeout(resolve,170));
    assert.equal(images[0].src,'/preview.jpg');
    assert.equal(calls[2].args.path,'/3','offscreen queued image is skipped');
    const added={isConnected:true,dataset:{previewPath:'/more'},style:{}};
    update.observe({querySelectorAll:()=>[added]});
    scroll();
    intersection([{target:added,isIntersecting:true}]);
    anchor.isConnected=false;leave();
    for(const call of calls)call.resolve('/late.jpg');
    await new Promise(resolve=>setTimeout(resolve,170));
    assert.equal(calls.length,3,'leaving cancels the scroll timer and pending work');
    assert.ok(removed);
});
