'use strict';
(() => {
  const categories = {
    All: [], Serums: ['serum'], Moisturizers: ['cream'], Cleansers: ['cleanse_1', 'cleanse_2'],
    Sunscreens: ['sunscreen'], Masks: ['mask'], Pads: ['pad'], Other: ['spot', 'exfoliate', 'mist']
  };
  const featured = ['GA230920410', 'GA240121573', 'GA220113363', 'GA220816048'];
  let category = 'All', limit = 8, savedOnly = false, alternatives = null;
  let selected = [];
  const storageKey = 'sync.edit.saved.v1';
  let saved = new Set();
  try {
    const ids = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(ids)) saved = new Set(ids.filter(id => typeof id === 'string'));
  } catch {}
  const grid = $('edit-grid'), dialog = $('edit-dialog'), compareButton = $('edit-compare');
  const lookup = id => catalog.find(p => p.id === id);
  const ingredientNames = p => (p.enriched?.key_actives || []).map(a => a.inci);
  const focusText = {moisturising:'Hydration',soothing:'Comfort',brightening:'Brightness',well_aging:'Firmness',acne:'Blemish care',dullness:'Glow',visible_pores:'Pore care'};
  const categoryName = p => Object.keys(categories).find(key => categories[key].includes(p.slot)) || p.category;
  const size = p => p.volume && !/[가-힣]/.test(p.volume) ? p.volume : 'See listing';
  const hasFilters = () => category !== 'All' || savedOnly || alternatives ||
    $('edit-search').value || $('edit-skin').value || $('edit-budget').value || $('edit-sort').value !== 'featured';
  function products() {
    const query = $('edit-search').value.trim().toLowerCase();
    const skin = $('edit-skin').value, price = Number($('edit-budget').value);
    const matches = catalog.filter(p => (!savedOnly || saved.has(p.id))
      && (!alternatives || (p.slot === alternatives.slot && p.price_usd <= state.budget))
      && (category === 'All' || categories[category].includes(p.slot))
      && (!skin || p.skin_types.includes(skin)) && (!price || p.price_usd <= price)
      && (!query || [p.name,p.brand,...ingredientNames(p),...p.featured_ingredients.map(i => i.replaceAll('_',' '))].join(' ').toLowerCase().includes(query)));
    const sort = $('edit-sort').value;
    const rank = p => featured.includes(p.id) ? featured.indexOf(p.id) : featured.length;
    if (sort === 'low') return matches.sort((a,b) => a.price_usd - b.price_usd);
    if (sort === 'high') return matches.sort((a,b) => b.price_usd - a.price_usd);
    if (sort === 'brand') return matches.sort((a,b) => a.brand.localeCompare(b.brand));
    return matches.sort((a,b) => rank(a) - rank(b));
  }
  function render() {
    const list = products(), onShelf = savedOnly ? ' saved' : '';
    $('saved-count').textContent = saved.size;
    $('shelf-nav').setAttribute('aria-pressed', String(savedOnly));
    $('edit-count').textContent = alternatives ? list.length + ' alternatives and picks · up to $' + state.budget : list.length + onShelf + (list.length === 1 ? ' product' : ' products');
    $('edit-reset').hidden = !hasFilters();
    document.querySelectorAll('[data-edit-category]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.editCategory === category)));
    compareButton.disabled = selected.length !== 2;
    compareButton.textContent = 'Compare (' + selected.length + '/2)';
    $('edit-more').hidden = list.length <= limit;
    const card = p => {
      const active = selected.includes(p.id);
      const label = esc(p.brand + ' ' + p.name);
      return `<article class="ed-card">
        <div class="ed-visual"><button class="ed-image" data-detail="${esc(p.id)}" aria-label="View ${label}"><img src="data/${esc(p.image)}" loading="lazy" alt=""></button>
        <button class="ed-save" data-save="${esc(p.id)}" aria-label="Save ${label}" aria-pressed="${saved.has(p.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-8.5-5.2-8.5-11a4.7 4.7 0 0 1 8.5-2.7A4.7 4.7 0 0 1 20.5 9c0 5.8-8.5 11-8.5 11Z"/></svg></button></div>
        <div class="ed-brand">${esc(p.brand)}</div><h3><button data-detail="${esc(p.id)}">${esc(p.name)}</button></h3>
        <div class="ed-card-meta"><strong>${money(p.price_usd)}</strong><span>${esc(p.is_set ? 'Set' : categoryName(p))}</span></div>
        <button class="ed-pick" data-pick="${esc(p.id)}" aria-pressed="${active}"><i aria-hidden="true">${active ? '✓' : '+'}</i> Compare</button></article>`;
    };
    grid.innerHTML = list.slice(0,limit).map(card).join('');
    if (!list.length) grid.innerHTML = '<div class="ed-empty"><h3>' + (savedOnly && !saved.size ? 'Your shelf is empty.' : 'No matching products.') + '</h3><p>' + (savedOnly && !saved.size ? 'Tap a heart on any product to save it here.' : 'Try another search or clear your filters.') + '</p><button data-clear>Browse all products</button></div>';
  }
  function reset() {
    category = 'All'; savedOnly = false; alternatives = null; limit = 8;
    for (const id of ['edit-skin','edit-budget','edit-search']) $(id).value = '';
    $('edit-sort').value = 'featured';
  }
  function toggleSave(id) {
    if (saved.has(id)) saved.delete(id); else saved.add(id);
    try {localStorage.setItem(storageKey,JSON.stringify([...saved]));} catch {}
    render();
  }
  function toggleCompare(id) {
    if (selected.includes(id)) selected = selected.filter(item => item !== id);
    else if (selected.length < 2) selected.push(id);
    else { showComparison(); return; }
    render();
  }
  function openPanel(html) {
    $('edit-dialog-body').innerHTML = html;
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
  }
  const facts = p => [
    ['Price',money(p.price_usd) + (p.is_set ? ' · set price' : '')], ['Size',size(p)], ['Routine step',p.enriched?.step || categoryName(p)],
    ['When to use',p.enriched?.when || p.am_pm.join(' / ')],['Key ingredients',ingredientNames(p).slice(0,4).join(', ') || 'See listing'],
    ['Catalog focus', p.concerns.map(c=>focusText[c] || c).join(', ')]
  ];
  const retailer = p => `<a class="underlink" target="_blank" rel="noopener" href="${esc(p.url)}">View on Olive Young</a>`;
  function showDetail(p) {
    openPanel(`<div class="ed-detail"><div class="ed-detail-img"><img src="data/${esc(p.image)}" alt="${esc(p.name)}"></div><div><p class="ed-brand">${esc(p.brand)}</p><h2 id="edit-dialog-title">${esc(p.name)}</h2>
    <p>${esc(p.enriched?.what || p.category)}</p><dl>${facts(p).map(([name,value])=>`<dt>${esc(name)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>${retailer(p)}</div></div>
    <div class="ed-panel-actions"><button data-save="${esc(p.id)}" aria-pressed="${saved.has(p.id)}">${saved.has(p.id) ? 'Remove from saved' : 'Save product'}</button><button data-pick="${esc(p.id)}">${selected.includes(p.id) ? 'Remove from comparison' : 'Add to comparison'}</button></div><p class="ed-source">Source: Olive Young Global listing · April 13, 2026.</p>`);
  }
  function showComparison() {
    const items = selected.map(lookup).filter(Boolean);
    if (items.length !== 2) return;
    openPanel(`<div class="ed-kicker">PRODUCT COMPARISON</div><h2 id="edit-dialog-title">Side by side<span>.</span></h2>
      <table class="ed-comparison"><thead><tr><td></td>${items.map(p=>`<th scope="col"><img src="data/${esc(p.image)}" alt=""><span>${esc(p.brand)}</span>${esc(p.name)}<button data-remove="${esc(p.id)}">Remove</button></th>`).join('')}</tr></thead>
      <tbody>${facts(items[0]).map(([name],i)=>`<tr><th scope="row">${esc(name)}</th>${items.map(p=>`<td>${esc(facts(p)[i][1])}</td>`).join('')}</tr>`).join('')}
      <tr><th scope="row">Shop</th>${items.map(p=>`<td>${retailer(p)}</td>`).join('')}</tr></tbody></table><p class="ed-source">Source: Olive Young Global listings · April 13, 2026.</p>`);
  }
  function goShelf() { $('discover').scrollIntoView({behavior:'smooth'}); }
  function refresh() { limit = 8; render(); }
  const cats = document.querySelector('.ed-cats');
  Object.keys(categories).forEach(key=>{
    const button = document.createElement('button');button.dataset.editCategory = key;button.textContent = key;cats.append(button);
    button.onclick = () => {category=key; alternatives=null;refresh();};
  });
  $('edit-search').oninput = refresh;
  for (const id of ['edit-skin','edit-budget','edit-sort']) $(id).onchange = refresh;
  $('edit-reset').onclick = () => {reset();render();};
  $('shelf-nav').onclick = () => {const next=!savedOnly;reset();savedOnly=next;render();goShelf();};
  $('edit-more').onclick = () => {limit+=8;render();};
  compareButton.onclick = showComparison;
  dialog.querySelector('.ed-close').onclick = () => dialog.close();
  dialog.addEventListener('click', e => {if(e.target===dialog) dialog.close();});
  function handleClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-clear')) {reset();render();return;}
    const {detail,save,pick,remove} = b.dataset;
    if(detail) showDetail(lookup(detail));
    if(save) {toggleSave(save);if(dialog.open) showDetail(lookup(save));}
    if(pick) {const wasFull=selected.length===2 && !selected.includes(pick);toggleCompare(pick);if(dialog.open && !wasFull) {if(selected.length===2) showComparison();else showDetail(lookup(pick));}}
    if(remove) {toggleCompare(remove);dialog.close();}
  }
  grid.addEventListener('click',handleClick);
  dialog.addEventListener('click',handleClick);
  document.addEventListener('compare-alternatives',({detail:p})=>{
    reset();alternatives=p;category=categoryName(p);selected=[p.id];render();goShelf();
  });
  document.addEventListener('catalog-ready',render);
  document.addEventListener('catalog-error',()=>{$('edit-count').textContent='The catalog could not load. Refresh to try again.';});
  if(catalog.length) render();
})();
