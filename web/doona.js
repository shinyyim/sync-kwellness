'use strict';

(() => {
  const looks = {signature:'Signature', track:'Track star', silver:'Silver lining', denim:'Off duty', beret:'After hours'};
  const goals = [
    {label:'Hydration', value:'Hydration', icon:'drop'},
    {label:'Comfort', value:'Comfort', icon:'heart'},
    {label:'Glow', value:'Glow', icon:'spark'}
  ];
  const memoryKey = 'ksync.doona.lastPick.v1';
  const room = $('meet'), choices = $('room-choices'), heading = $('room-question');
  const back = $('room-back'), card = $('room-result'), caption = $('room-caption');
  let scene = 'hello', goal, budget, pick, remembered, catalogFailed = false, fromMemory = false;
  try { remembered = JSON.parse(localStorage.getItem(memoryKey))?.id; } catch {}
  const react = () => room.dispatchEvent(new Event('doona-react'));

  function chip(label, action, icon, primary = false) {
    const button = document.createElement('button');
    button.type = 'button';
    if(primary) button.className = 'room-primary';
    if(icon) {
      const mark = document.createElement('span');
      mark.className = 'choice-mark mark-' + icon;
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = {wave:'👋',heart:'♡',spark:'✦',drop:'',save:'♡'}[icon];
      button.append(mark);
    }
    button.append(label);
    button.onclick = () => { react(); action(); };
    choices.append(button);
  }

  function screen(next, line, description = '', focus = true) {
    scene = room.dataset.scene = next;
    choices.replaceChildren();
    card.replaceChildren();
    heading.textContent = line;
    caption.textContent = description;
    caption.hidden = !description;
    back.hidden = next === 'hello';
    const step = next === 'goal' ? 1 : next === 'budget' ? 2 : 0;
    $('room-progress').hidden = !step;
    $('room-step').textContent = step ? step + ' of 2' : '';
    $('hello-bubble').hidden = true;
    $('doona-hello').setAttribute('aria-label', next === 'hello' ? 'Say hi to Doona' : 'Wave to Doona');
    if(focus) heading.focus({preventScroll:true});
  }

  function hello(focus = true) {
    goal = budget = pick = null;
    fromMemory = false;
    const last = catalog.find(p => p.id === remembered);
    screen('hello', last ? 'Welcome back.' : 'Hey, I’m ', '', focus);
    if(!last) {
      const name = document.createElement('em');
      name.textContent = 'Doona';
      const dot = document.createElement('span'); dot.textContent = '.';
      name.append(dot); heading.append(name);
    }
    chip(last ? 'See my pick' : 'Say hi', greet, 'wave', true);
    if(last) chip('Find a new pick', askGoal);
  }

  function greet() {
    const last = catalog.find(p => p.id === remembered);
    if(last) {fromMemory = true; pick = last; reveal();} else askGoal();
  }
  function askGoal() {
    fromMemory = false;
    screen('goal', 'Your skin goal?');
    for(const option of goals) chip(option.label, () => {goal = option.value; askBudget(); moodReaction(goal);}, option.icon);
  }
  function moodReaction(value) {
    if(matchMedia('(prefers-reduced-motion: reduce)').matches || $('doona-hello').classList.contains('motion-paused')) return;
    const symbol = {Hydration:'●', Comfort:'♡', Glow:'✦'}[value];
    const stage = room.querySelector('.avatar-theatre');
    for(const [x,y] of [[29,48],[67,33],[76,52]]) {
      const particle = document.createElement('span');
      particle.className = 'mood-particle mood-' + value;
      particle.textContent = symbol;
      particle.setAttribute('aria-hidden','true');
      particle.style.left = x + '%';
      particle.style.top = y + '%';
      stage.append(particle);
      particle.addEventListener('animationend',()=>particle.remove(),{once:true});
    }
  }
  function askBudget() {
    screen('budget', 'Your budget?');
    for(const amount of [20,30,50]) chip('$' + amount + ' or less', () => {budget = amount; match();});
  }
  function match() {
    if(!catalog.length) {
      screen('waiting', catalogFailed ? 'My shelf couldn’t load.' : 'Let me check the shelf…');
      if(catalogFailed) chip('Try again', () => location.reload(), null, true);
      return;
    }
    pick = ranked(['serum','cream'], FOCUS_AXIS[goal]).find(item => item.p.price_usd <= budget)?.p;
    if(!pick) {
      screen('empty', 'Let’s try another budget.', 'My shelf has no match for this combination.');
      chip('Change my budget', askBudget, null, true); return;
    }
    reveal();
  }
  function reveal() {
    const saved = pick.id === remembered;
    const active = goal && evidenceFor(pick, FOCUS_AXIS[goal])[0];
    screen('result', fromMemory ? 'Your saved pick.' : 'Your match.',
      !goal ? '' : goal + ' · $' + budget + ' or less');
    const product = document.createElement('button');
    product.type = 'button'; product.className = 'pick-ticket';
    const img = document.createElement('img'); img.alt = ''; img.src = 'data/' + pick.image;
    const details = document.createElement('span');
    const brand = document.createElement('small'), name = document.createElement('strong'), price = document.createElement('span');
    brand.textContent = pick.brand; name.textContent = pick.name;
    price.textContent = money(pick.price_usd) + (pick.is_set ? ' · set price' : '') + ' · Apr 2026';
    details.append(brand,name,price); product.append(img,details);
    const inspect = () => document.dispatchEvent(new CustomEvent('doona-product', {detail:pick.id}));
    product.onclick = inspect; card.append(product);
    if(active) {
      const why = document.createElement('p');
      why.textContent = 'For ' + goal.toLowerCase() + ', the listing highlights ' + active.inci + '.';
      card.append(why);
    }
    chip(saved ? 'Forget this pick' : 'Remember this pick', () => {
      try {
        if(saved) localStorage.removeItem(memoryKey); else localStorage.setItem(memoryKey, JSON.stringify({id:pick.id}));
        remembered = saved ? null : pick.id;
        fromMemory = fromMemory && !saved;
        reveal(); toast(saved ? 'Pick forgotten.' : 'I’ll remember this pick on this device.');
      } catch {toast('Your browser couldn’t save that change.');}
    }, 'save', !saved);
    chip('See details', inspect);
    if(!goal) chip('Find a new pick', askGoal);
  }
  back.onclick = () => {
    react();
    if(scene === 'goal' || fromMemory || !goal) hello();
    else if(scene === 'budget') askGoal();
    else askBudget();
  };
  $('doona-hello').onclick = () => {
    react();
    if(scene === 'hello') {greet();return;}
    const bubble = $('hello-bubble');
    $('bubble-text').textContent = scene === 'goal' ? 'Go with your gut!' : scene === 'budget' ? 'Your call!' : 'Hi again!';
    bubble.hidden = false;
  };
  function setLook(key) {
    if(!Object.hasOwn(looks,key))return;
    room.dataset.look=key;
    for(const img of [$('doona-art'),document.querySelector('#buddy-face img'),document.querySelector('#portrait img')]) img.src='assets/doona/'+key+'.webp';
    $('doona-art').alt='Doona in her '+looks[key]+' look';$('look-name').textContent=looks[key];
    for(const b of document.querySelectorAll('.wardrobe-list button')) b.setAttribute('aria-pressed',String(b.dataset.look===key));
  }
  for(const b of document.querySelectorAll('.wardrobe-list button')) b.onclick=()=>{
    setLook(b.dataset.look); try {localStorage.setItem('ksync.doona.look',b.dataset.look);} catch {}
    react();
  };
  let look;try {look=localStorage.getItem('ksync.doona.look');} catch {}
  setLook(Object.hasOwn(looks,look)?look:'signature');
  document.addEventListener('catalog-ready',()=>{if(scene==='hello' && remembered)hello(false);else if(scene==='waiting')match();});
  document.addEventListener('catalog-error',()=>{catalogFailed=true;if(scene==='waiting')match();});
  function showSection(hash) {
    if(hash==='#discover' || hash==='#studio') document.querySelector(hash).hidden=false;
  }
  const menu=$('room-menu');
  const toggle=$('menu-toggle');
  function toggleMenu(open) {
    toggle.setAttribute('aria-expanded',String(open));
    menu.classList.toggle('is-open',open);
  }
  toggle.onclick=()=>toggleMenu(toggle.getAttribute('aria-expanded')!=='true');
  menu.addEventListener('click',event=>{
    const link=event.target.closest('a');
    if(link){showSection(link.hash);if(link.hash==='#meet')hello();}
    if(link || event.target.closest('#shelf-nav,#routine-nav')) toggleMenu(false);
  });
  document.querySelector('.doona-logo').addEventListener('click',()=>hello());
  document.addEventListener('click',event=>{if(!menu.contains(event.target) && !toggle.contains(event.target))toggleMenu(false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && toggle.getAttribute('aria-expanded')==='true'){toggleMenu(false);toggle.focus();}});
  window.addEventListener('hashchange',()=>showSection(location.hash));
  new IntersectionObserver(([entry])=>document.body.classList.toggle('meeting-doona',entry.isIntersecting)).observe(room);
  showSection(location.hash);
  hello(false);
})();
