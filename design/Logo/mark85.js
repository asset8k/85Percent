/* 85Percent — shared mark renderer (finalized geometry + violet gradients) */
(function(){
  const NS='http://www.w3.org/2000/svg';

  /* ---- finalized geometry (built once) ---- */
  function buildEdges(){
    const edges=[];
    function L(x1,y1,x2,y2,o1=0,o2=0,tag){
      const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy),ux=dx/len,uy=dy/len;
      edges.push([x1-ux*o1,y1-uy*o1,x2+ux*o2,y2+uy*o2,tag]);
    }
    const BIG=96,MID=0,BOT=96;
    const yTop=92,yUp=132,yRu=212,yMid=250,yLd=292,yRl=372,yBot=410;
    // EIGHT
    const xL=100,xR=232,cx8=166;
    const Lx=157,Rx=175;   // waist connects at a LEFT and a RIGHT point, gap between them
    L(xL,yUp,cx8,yTop,0,BIG); L(xR,yUp,cx8,yTop,0,BIG);
    L(xL,yUp,xL,yRu); L(xR,yUp,xR,yRu);
    L(xL,yRu,Lx,yMid); L(xR,yRu,Rx,yMid);   // upper hex -> left & right waist points
    L(xL,yLd,Lx,yMid); L(xR,yLd,Rx,yMid);   // lower hex -> same points (open center gap)
    L(xL,yLd,xL,yRl); L(xR,yLd,xR,yRl);
    L(xL,yRl,cx8,yBot,0,BOT); L(xR,yRl,cx8,yBot,0,BOT);
    // FIVE — vertical stem + raised hexagonal bowl
    const fL=270,fR=402,cf=336;
    const stubTop=343, peakY=222, shY=260, stemB=240;
    L(fL,yUp,cf,yTop,0,BIG); L(fR,yUp,cf,yTop,-Math.hypot(fR-cf,yUp-yTop),BIG);   // keep left tip; drop the 5's dangling bottom-right half
    L(fL,yUp,fL,stemB);
    L(fL,stemB,cf,peakY);
    L(cf,peakY,fR,shY);
    L(fR,shY,fR,yRl);
    L(fR,yRl,cf,yBot,0,BOT); L(fL,yRl,cf,yBot,0,BOT);
    L(fL,yRl,fL,stubTop,0,0,'fade2');   // free end fades into the background
    return edges;
  }
  const EDGES=buildEdges();
  const VB=[40,40,440,420];
  // vertical, symmetric vector: extremes (y=44 top / y=456 bottom) mirror about
  // the center axis (y=250) so the glow sits dead-center.
  const VEC={x1:0,y1:42,x2:0,y2:458};

  /* ---- gradient palettes (symmetric, glowing-center) ---- */
  const GRADS={
    // PRIMARY · ends dissolve to white -> brand #6D28D9 core (symmetric)
    gradient:[
      ['0','#FFFFFF'],     // top tip — fades into white
      ['0.10','#EADBFB'],
      ['0.22','#B98AF0'],
      ['0.36','#8B5CF6'],
      ['0.50','#6D28D9'],  // brand-violet core (richest)
      ['0.64','#8B5CF6'],
      ['0.78','#B98AF0'],
      ['0.90','#EADBFB'],
      ['1','#FFFFFF']      // bottom anchor — fades into white
    ],
    // REVERSED · ends dissolve into charcoal, luminous violet core (symmetric)
    dark:[
      ['0','#1A1530'],
      ['0.18','#5B21B6'],['0.34','#8B5CF6'],
      ['0.5','#E9D5FF'],
      ['0.66','#8B5CF6'],['0.82','#5B21B6'],
      ['1','#1A1530']
    ],
  };
  const SOLID={mono:'#475569',violet:'#6D28D9'};

  let gid=0;
  function hexLerp(a,b,t){
    const pa=[1,3,5].map(i=>parseInt(a.substr(i,2),16));
    const pb=[1,3,5].map(i=>parseInt(b.substr(i,2),16));
    return '#'+pa.map((v,i)=>Math.round(v+(pb[i]-v)*t).toString(16).padStart(2,'0')).join('');
  }
  function sampleGrad(stops,frac){
    frac=Math.max(0,Math.min(1,frac));
    for(let i=1;i<stops.length;i++){
      const o0=+stops[i-1][0], o1=+stops[i][0];
      if(frac<=o1){ const t=o1===o0?0:(frac-o0)/(o1-o0); return hexLerp(stops[i-1][1],stops[i][1],t); }
    }
    return stops[stops.length-1][1];
  }
  function renderMark(svg){
    const mode=svg.dataset.mode||'gradient';
    const h=+(svg.dataset.h||300);
    const w=h*(VB[2]/VB[3]);
    svg.setAttribute('viewBox',VB.join(' '));
    svg.setAttribute('width',w); svg.setAttribute('height',h);
    svg.style.overflow='visible';

    const grad=GRADS[mode];
    let stroke, defsInner='';
    if(grad){
      const id='g85_'+(gid++);
      const stops=grad.map(([o,c])=>`<stop offset="${o}" stop-color="${c}"/>`).join('');
      defsInner+=`<linearGradient id="${id}" x1="${VEC.x1}" y1="${VEC.y1}" x2="${VEC.x2}" y2="${VEC.y2}" gradientUnits="userSpaceOnUse">${stops}</linearGradient>`;
      stroke=`url(#${id})`;
    }else{
      stroke=SOLID[mode];
    }
    const fadeBg=(mode==='dark')?'#0B1020':'#FFFFFF';
    const sw=Math.max(2.4, 7*(h/300)+1.6);
    let lines='';
    for(const e of EDGES){
      const x1=e[0],y1=e[1],x2=e[2],y2=e[3],tag=e[4];
      let s=stroke;
      // free-floating tips fade to the background along their own axis
      if(tag==='fade2' && grad){
        const lid='g85f_'+(gid++);
        const frac=(y1-VEC.y1)/(VEC.y2-VEC.y1);
        const body=sampleGrad(grad,frac);
        defsInner+=`<linearGradient id="${lid}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${body}"/><stop offset="1" stop-color="${fadeBg}"/></linearGradient>`;
        s=`url(#${lid})`;
      }
      lines+=`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${s}" stroke-width="${sw}" stroke-linecap="round"/>`;
    }
    svg.innerHTML=`<defs>${defsInner}</defs>`+lines;
  }

  function renderAll(root){ (root||document).querySelectorAll('svg.m').forEach(renderMark); }
  window.Mark85={ render:renderMark, renderAll, VB, GRADS, SOLID };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>renderAll());
  else renderAll();
})();
