'use strict';

(() => {
  const looks = {
    signature: { name: 'Signature', alt: 'in a black blazer with a lime serum dropper', line: 'What’s on your skincare wishlist?' },
    track: { name: 'Track star', alt: 'in a yellow track jacket with a toner bottle', line: 'A quick routine before you head out?' },
    silver: { name: 'Silver lining', alt: 'in a silver puffer with a red compact', line: 'What’s your go-to for a glow day?' },
    denim: { name: 'Off duty', alt: 'in a knit beanie holding a cleansing oil', line: 'Let’s keep today’s routine simple.' },
    beret: { name: 'After hours', alt: 'in a black beret holding a pink lip tint', line: 'Getting ready for an evening out?' }
  };
  const replies = ['Tell me what you already use.', 'Got a budget in mind?', 'Hydration, comfort, or glow?'];
  const stage = document.querySelector('.doona-stage');
  const hero = $('meet');
  const portrait = $('doona-art');
  const finder = $('match-dialog');
  const form = $('match-form');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let replyIndex = 0;
  let lastHeroChatTrigger = null;

  function bounce() {
    if (!reduceMotion.matches) {
      portrait.animate([{rotate:'0deg'}, {rotate:'-2.5deg', offset:.35}, {rotate:'1deg', offset:.7}, {rotate:'0deg'}], {duration:470});
    }
  }

  function setLook(key) {
    const look = looks[key];
    if (!look) return;
    hero.dataset.look = key;
    const src = 'assets/doona/' + key + '.webp';
    for (const img of [portrait, $('match-face'), document.querySelector('#buddy-face img'), document.querySelector('#portrait img')]) img.src = src;
    portrait.alt = 'Doona ' + look.alt;
    $('look-name').textContent = look.name;
    $('doona-line').textContent = look.line;
    for (const button of document.querySelectorAll('.wardrobe-list button')) button.setAttribute('aria-pressed', String(button.dataset.look === key));
    replyIndex = 0;
  }

  for (const button of document.querySelectorAll('.wardrobe-list button')) {
    button.onclick = () => {
      setLook(button.dataset.look);
      bounce();
      try { localStorage.setItem('ksync.doona.look', button.dataset.look); } catch {}
    };
  }
  let initialLook = 'signature';
  try {
    const saved = localStorage.getItem('ksync.doona.look');
    if (Object.hasOwn(looks, saved)) initialLook = saved;
  } catch {}
  setLook(initialLook);
  function greet() {
    $('doona-line').textContent = replies[replyIndex];
    replyIndex = (replyIndex + 1) % replies.length;
    bounce();
  }
  $('doona-hello').onclick = greet;
  $('doona-speech').onclick = greet;
  stage.onpointermove = event => {
    if (event.pointerType === 'touch' || reduceMotion.matches) return;
    const rect = stage.getBoundingClientRect();
    stage.style.setProperty('--dx', ((event.clientX-rect.left)/rect.width-.5)*14+'px');
    stage.style.setProperty('--dy', ((event.clientY-rect.top)/rect.height-.5)*7+'px');
  };
  stage.onpointerleave = () => {
    stage.style.removeProperty('--dx');
    stage.style.removeProperty('--dy');
  };

  $('doona-chat').onclick = () => {
    lastHeroChatTrigger = $('doona-chat');
    if (!chat.log.length) chatAdd('agent', 'Hey, I’m Doona! What would you like help finding? Try “Glow under $30.”');
    chatOpen(true);
  };
  function restoreChatFocus() {
    if (lastHeroChatTrigger && !chat.open) {
      lastHeroChatTrigger.focus({preventScroll:true});
      lastHeroChatTrigger = null;
    }
  }
  $('chat-x').addEventListener('click', restoreChatFocus);
  window.addEventListener('keydown', e => { if (e.key === 'Escape') restoreChatFocus(); });

  $('doona-match').onclick = () => {
    form.elements.goal.value = state.concern;
    $('match-budget').value = state.budget;
    $('match-value').value = '$' + state.budget;
    $('match-keep').checked = state.keep;
    finder.showModal();
  };
  $('match-budget').oninput = e => { $('match-value').value = '$' + e.target.value; };
  $('match-close').onclick = () => finder.close();
  $('match-scan').onclick = () => { finder.close(); $('open-scan').click(); };
  form.onsubmit = event => {
    event.preventDefault();
    if (!catalog.length) return;
    state.concern = form.elements.goal.value;
    state.override = Boolean(state.read);
    state.budget = Number($('match-budget').value);
    state.keep = $('match-keep').checked;
    syncControls();
    finder.close();
    build();
    $('routine').setAttribute('tabindex','-1');
    $('routine').focus({preventScroll:true});
  };
  function updateCatalogButton(failed = false) {
    $('match-submit').disabled = !catalog.length;
    $('match-submit').textContent = catalog.length ? 'Show my picks' : failed ? 'Catalog unavailable · reload to retry' : 'Loading the catalog…';
  }
  updateCatalogButton();
  document.addEventListener('catalog-ready', () => updateCatalogButton());
  document.addEventListener('catalog-error', () => updateCatalogButton(true));
})();
