// Create this loader only when the picker opens. Keep image work out of scroll.
export function setupWallpaperPreviews(container, invoke, assetUrl){
    const queue=new Set(),observed=new WeakSet(),inflight=new WeakSet(),loaded=new WeakMap();
    const commits=[];
    const anchor=container.querySelector('#wp-grid');
    const scrollRoot=anchor.closest?.('.detail-view');
    let running=0,disposed=false,scrolling=false,idleTimer;
    const pump=()=>{
        if(disposed||scrolling)return;
        commits.splice(0).forEach(commit=>commit());
        while(running<2&&queue.size){
            const img=queue.values().next().value;
            queue.delete(img);
            if(!img.isConnected||inflight.has(img))continue;
            const path=img.dataset.previewPath;
            if(loaded.get(img)===path)continue;
            running++;
            inflight.add(img);
            invoke('wallpaper_preview',{path,hero:img.id==='wp-screen-img'})
                .then(url=>{
                    commits.push(()=>{
                        if(img.isConnected&&img.dataset.previewPath===path){
                            img.style.opacity='1';
                            img.src=assetUrl(url);
                            loaded.set(img,path);
                            observer.unobserve(img);
                        }
                    });
                })
                .catch(()=>{
                    commits.push(()=>{
                        if(img.dataset.previewPath===path)img.style.opacity='0';
                    });
                })
                .finally(()=>{
                    running--;inflight.delete(img);
                    if(img.dataset.previewPath!==path&&img.isConnected)queue.add(img);
                    pump();
                });
        }
    };
    const onScroll=()=>{
        scrolling=true;
        clearTimeout(idleTimer);
        idleTimer=setTimeout(()=>{scrolling=false;pump();},140);
    };
    scrollRoot?.addEventListener('scroll',onScroll,{passive:true});
    const observer=new IntersectionObserver(entries=>{
        for(const entry of entries){
            if(entry.isIntersecting){
                if(!inflight.has(entry.target))queue.add(entry.target);
            }else queue.delete(entry.target);
        }
        pump();
    },{root:scrollRoot||null,rootMargin:'120px'});
    const observe=root=>root.querySelectorAll('img[data-preview-path]').forEach(img=>{
        if(!observed.has(img)&&img.dataset.previewPath){observed.add(img);observer.observe(img);}
    });
    observe(container);
    const dispose=()=>{
        disposed=true;queue.clear();commits.length=0;clearTimeout(idleTimer);
        observer.disconnect();leave.disconnect();
        scrollRoot?.removeEventListener('scroll',onScroll);
    };
    const leave=new MutationObserver(()=>{if(!anchor.isConnected)dispose();});
    leave.observe(anchor.parentElement,{childList:true});
    if(typeof window!=='undefined')(window._pageCleanups ||= []).push(dispose);
    const update=(img,path)=>{
        if(disposed||!img)return;
        img.dataset.previewPath=path;
        observer.unobserve(img);
        const pending=[...queue];
        queue.clear();queue.add(img);
        pending.forEach(item=>queue.add(item));
        pump();
    };
    update.observe=observe;
    return update;
}
