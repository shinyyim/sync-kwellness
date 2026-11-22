'use strict';

(() => {
  const looks = {signature:'Signature',track:'Track star',silver:'Silver lining',denim:'Off duty',beret:'After hours'};
  const goals = {Hydration:/hydrat|dry|moisture|dehydrat/i, Comfort:/comfort|sensitiv|sooth|calm|gentle|redness/i, Glow:/glow|bright|dull|uneven/i};
  const groups = [
    ['serum',/serum|ampoule/i,['serum']], ['moisturizer',/moisturi[sz]er|cream/i,['cream']],
    ['sunscreen',/sunscreen|spf|sun care/i,['sunscreen']], ['cleanser',/cleanser|cleansing/i,['cleanse_1','cleanse_2']],
    ['mask',/mask/i,['mask']], ['pad',/toner pad/i,['pad']]
  ];
  const memoryKey='ksync.doona.lastPick.v1';
  const room=$('meet'), question=$('room-question'), input=$('room-input'), choices=$('room-choices');
  const cardArea=$('room-result'), context=$('room-context');
  let visit, phase, remembered=null, catalogError=false;
  try {remembered=JSON.parse(localStorage.getItem(memoryKey));} catch {}
  const react=()=>room.dispatchEvent(new Event('doona-react'));
  const newVisit=()=>({mode:null, goal:null, budget:null, group:null, keep:null, product:null});

  function say(line, suggestions=[], placeholder='Message Doona…') {
    question.textContent=line;
    choices.replaceChildren();
    for(const [label,action] of suggestions) {
      const button=document.createElement('button');
      button.type='button';button.textContent=label;button.onclick=()=>{react();action();};choices.append(button);
    }
    input.placeholder=placeholder;
    $('room-restart').hidden=phase==='home';
    const parts=[visit.goal, visit.group?.[0], visit.budget!=null ? 'Up to '+money(visit.budget).replace(/\.00$/,'') : null].filter(Boolean);
    context.textContent=parts.join(' · ');context.hidden=!parts.length;
  }

  function home() {
    visit=newVisit();phase='home';cardArea.replaceChildren();input.value='';
    const last=catalog.find(p=>p.id===remembered?.id);
    const actions=[['Pick one for me',()=>start('one')],['Check a product',()=>start('check')],['Build a routine',()=>start('routine')]];
    if(last) actions.unshift(['Revisit my pick',()=>{visit.product=last;showPick(last);}],['Forget this pick',()=>{remembered=null;try{localStorage.removeItem(memoryKey);}catch{}home();}]);
    say(last?'Back for your '+last.brand+' pick?':'What can I help you find?',actions,'Try “a hydrating serum under $30”');
  }
  function start(mode) {visit=newVisit();visit.mode=mode;cardArea.replaceChildren();advance();}
  function productCard(p) {
    const article=document.createElement('div');article.className='room-product';
    const img=document.createElement('img');img.src='data/'+p.image;img.alt='';
    const button=document.createElement('button');button.type='button';
    const brand=document.createElement('small'),name=document.createElement('strong'),price=document.createElement('span');
    brand.textContent=p.brand;name.textContent=p.name;price.textContent=money(p.price_usd)+(p.is_set?' · set price':'')+' · Apr 2026';
    button.append(brand,name,price);button.onclick=()=>document.dispatchEvent(new CustomEvent('doona-product',{detail:p.id}));
    article.append(img,button);cardArea.append(article);
  }
  function showPick(p) {
    phase='result';visit.product=p;cardArea.replaceChildren();
    productCard(p);
    const active=visit.goal && evidenceFor(p,FOCUS_AXIS[visit.goal])[0];
    const explanation=active ? 'For '+visit.goal.toLowerCase()+', the listing highlights '+active.inci+'.' : p.enriched?.what;
    if(explanation){const note=document.createElement('p');note.className='room-note';note.textContent=explanation;cardArea.append(note);}
    const acts=[['See product details',()=>document.dispatchEvent(new CustomEvent('doona-product',{detail:p.id}))]];
    if(remembered?.id!==p.id) acts.push(['Remember this pick',()=>{
      try{localStorage.setItem(memoryKey,JSON.stringify({id:p.id}));remembered={id:p.id};showPick(p);}
      catch{toast('Your browser could not save this pick.');}
    }]);
    say(remembered?.id===p.id?'I’ve kept this pick for you.':visit.mode==='check'?'Here’s what I found.':'I’d start with this one.',acts,'Ask another question…');
  }
  function findProduct(text) {
    const words=text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu,' ').split(/\s+/).filter(w=>w && !['check','the','a','an','please','product','can','you','for','me','look','up','on','is','this'].includes(w));
    const list=words.length ? catalog.filter(p=>words.every(w=>(p.brand+' '+p.name).toLowerCase().includes(w))) : [];
    if(list.length===1) return showPick(list[0]);
    phase='lookup';
    say(list.length?'Which one did you mean?':'Which product should I look up?',list.slice(0,4).map(p=>[p.brand+' '+p.name,()=>showPick(p)]),list.length?'Type a more specific name…':words.length?'No match yet. Try a brand or shorter name…':'Type a brand or product name…');
  }
  function advance() {
    cardArea.replaceChildren();
    if(visit.mode==='check'){phase='lookup';say('Which product should I look up?',[],'Type a brand or product name…');return;}
    if(!visit.goal){
      phase='goal';say('What’s your main skin goal?',Object.keys(goals).map(g=>[g,()=>{visit.goal=g;advance();}]),'Hydration, comfort, or glow?');return;
    }
    if(visit.budget==null) {
      phase='budget';say(visit.mode==='routine'?'What’s your total routine budget?':'How much would you like to spend?',[20,30,50].map(b=>['$'+b,()=>{visit.budget=b;advance();}]),'Enter your budget in USD…');return;
    }
    if(visit.mode==='routine' && (visit.budget<15 || visit.budget>120)) {
      visit.budget=null;advance();question.textContent='For this routine, choose $15–$120.';return;
    }
    if(visit.mode==='routine' && visit.keep==null){
      phase='keep';say('Keeping your current moisturizer?',[['Yes, keep mine',()=>{visit.keep=true;advance();}],['I need one',()=>{visit.keep=false;advance();}]],'Yes or no…');return;
    }
    if(!catalog.length){
      phase='waiting';say(catalogError?'The catalog couldn’t load.':'I’m opening the catalog…',catalogError?[['Reload',()=>location.reload()]]:[]);return;
    }
    if(visit.mode==='routine'){
      state.concern=visit.goal;state.override=!!state.read;state.budget=visit.budget;state.keep=visit.keep;
      syncControls();build(false);phase='result';
      for(const [p] of state.items) productCard(p);
      const total=state.items.reduce((n,[p])=>n+p.price_usd,0);
      say(state.items.length?'Your routine comes to '+money(total)+'.':'No routine fits this budget yet.',
        state.items.length?[['See routine steps',()=>$('routine').scrollIntoView({behavior:'smooth'})]]:[['Change budget',()=>{visit.budget=null;advance();}]]);return;
    }
    const axis=FOCUS_AXIS[visit.goal],slots=visit.group?.[2] || ['serum','cream'];
    const match=ranked(slots,axis).find(item=>item.p.price_usd<=visit.budget);
    if(match){showPick(match.p);return;}
    phase='result';say('I couldn’t find a match at that price.',[['Change budget',()=>{visit.budget=null;advance();}],['Try another category',()=>{visit.group=null;advance();}]]);
  }
  function submit(text) {
    const value=text.trim();if(!value)return;
    input.value='';react();
    if(phase==='lookup'){findProduct(value);return;}
    if(/^(?:check|look up|find the)\b/i.test(value)){start('check');findProduct(value);return;}
    const goal=Object.entries(goals).find(([,re])=>re.test(value))?.[0];
    const group=groups.find(([,re])=>re.test(value));
    const price=value.match(/(?:\$\s*|under\s+|up to\s+|budget(?: of)?\s+)(\d+(?:\.\d{1,2})?)/i) || value.match(/^(\d+(?:\.\d{1,2})?)\s*(?:dollars?|usd)?$/i);
    if(phase==='result'){
      cardArea.replaceChildren();
      if(goal || group || price || /routine/i.test(value)){
        visit.mode=/routine/i.test(value)?'routine':visit.mode==='routine'?'routine':'one';
        visit.product=null;
      } else {visit=newVisit();phase='home';}
    }
    if(phase==='home' && !goal && !group && !price && !/routine|pick|recommend/i.test(value)){
      const knownBrand=catalog.some(p=>value.toLowerCase().includes(p.brand.toLowerCase()));
      if(knownBrand){visit.mode='check';findProduct(value);return;}
      phase='clarify';say('What would you like to do with that?',[
        ['Find a match',()=>start('one')],['Look up that product',()=>{visit.mode='check';findProduct(value);}],
        ['Talk it through',()=>{chatOpen(true);converse(value);home();}]
      ]);return;
    }
    if(!visit.mode) visit.mode=/routine/i.test(value)?'routine':'one';
    if(goal)visit.goal=goal;
    if(group)visit.group=group;
    if(price)visit.budget=Number(price[1]);
    if(/(?:already have|keep my|own a).*moisturi[sz]er/i.test(value))visit.keep=true;
    if(/(?:need|no|don't have).*moisturi[sz]er/i.test(value))visit.keep=false;
    if(phase==='keep' && /^(yes|yeah|keep|yep)/i.test(value))visit.keep=true;
    if(phase==='keep' && /^(no|need|nope)/i.test(value))visit.keep=false;
    advance();
  }
  function setLook(key) {
    if(!Object.hasOwn(looks,key))return;
    room.dataset.look=key;
    for(const img of [$('doona-art'),document.querySelector('#buddy-face img'),document.querySelector('#portrait img')])img.src='assets/doona/'+key+'.webp';
    $('doona-art').alt='Doona in her '+looks[key]+' look';$('look-name').textContent=looks[key];
    for(const b of document.querySelectorAll('.wardrobe-list button')) b.setAttribute('aria-pressed',String(b.dataset.look===key));
  }
  for(const b of document.querySelectorAll('.wardrobe-list button')) b.onclick=()=>{
    setLook(b.dataset.look);try{localStorage.setItem('ksync.doona.look',b.dataset.look);}catch{}
    $('style-panel').open=false;$('style-panel').querySelector('summary').focus();react();
  };
  let look;try{look=localStorage.getItem('ksync.doona.look');}catch{}setLook(Object.hasOwn(looks,look)?look:'signature');
  const greetings=['Hey, I’m Doona!','Hi there!','What’s on your shelf?'];let greeting=0;
  $('doona-hello').onclick=()=>{greeting=(greeting+1)%greetings.length;$('hello-bubble').textContent=greetings[greeting];react();};
  $('room-form').onsubmit=e=>{e.preventDefault();submit(input.value);};
  $('room-restart').onclick=home;
  document.addEventListener('catalog-ready',()=>{if(phase==='home')home();else if(phase==='waiting')advance();});
  document.addEventListener('catalog-error',()=>{catalogError=true;if(phase==='waiting')advance();});
  function revealSection() {
    if(location.hash==='#discover' || location.hash==='#studio') document.querySelector(location.hash).hidden=false;
  }
  for(const anchor of document.querySelectorAll('a[href="#discover"],a[href="#studio"]')) anchor.addEventListener('click',()=>{document.querySelector(anchor.hash).hidden=false;});
  window.addEventListener('hashchange',revealSection);
  revealSection();
  home();
})();
