import {useEffect,useRef} from 'react';
import type {AnimationItem} from 'lottie-web';

export function ClaudeMascot({label}:{label:string}) {
  const container=useRef<HTMLSpanElement>(null), animation=useRef<AnimationItem>();
  useEffect(()=>{
    const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
    let disposed=false;
    const rest=()=>{const item=animation.current;if(item&&motion.matches)item.goToAndStop(item.totalFrames-1,true);};
    motion.addEventListener('change',rest);
    void Promise.all([import('lottie-web/build/player/lottie_light.js'),import('../assets/clawd-laptop.json')]).then(([{default:lottie},{default:data}])=>{
      if(disposed||!container.current)return;
      const item=lottie.loadAnimation({container:container.current,renderer:'svg',loop:false,autoplay:!motion.matches,animationData:structuredClone(data)});
      animation.current=item;
      item.addEventListener('DOMLoaded',rest);
    }).catch(()=>{/* Decorative animation: leave the composer usable if loading fails. */});
    return()=>{disposed=true;motion.removeEventListener('change',rest);animation.current?.destroy();animation.current=undefined;};
  },[]);
  return <button type="button" aria-label={label}
    className="absolute right-0 bottom-[calc(100%-13px)] h-20 w-20 appearance-none border-0 bg-transparent p-0 select-none touch-manipulation focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--text-muted)]"
    style={{WebkitTapHighlightColor:'transparent'}}
    onMouseDown={event=>event.preventDefault()}
    onClick={()=>{if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)animation.current?.goToAndPlay(0,true);}}>
    <span ref={container} aria-hidden="true" className="block h-full w-full -scale-x-100 pointer-events-none"/>
  </button>;
}
