// popup.js

document.addEventListener('DOMContentLoaded', async () => {
  const restaurantList = document.getElementById('restaurant-list');
  const orderStatus = document.getElementById('order-status');
  // Location controls removed
  const searchInput = document.getElementById('search');
  const wantInput = document.getElementById('want');
  const findItemsBtn = document.getElementById('find-items');
  const cartItemsEl = document.getElementById('cart-items');
  const cartTotalEl = document.getElementById('cart-total');
  const copySummaryBtn = document.getElementById('copy-summary');
  const checkoutBtn = document.getElementById('checkout-swiggy');
  const matchesEl = document.getElementById('matches');
  // Payment elements
  const upiVpaEl = document.getElementById('upi-vpa');
  const upiAmountEl = document.getElementById('upi-amount');
  const genQrBtn = document.getElementById('gen-qr');
  const qrPreview = document.getElementById('qr-preview');
  let upiUrl = '';

  // Persist simple payment prefs
  function savePaymentPrefs(vpa, amount) {
    try { chrome.storage && chrome.storage.local.set({ upiVpa: vpa || '', upiAmount: String(amount || '') }); } catch {}
  }
  function loadPaymentPrefs() {
    try {
      chrome.storage && chrome.storage.local.get(['upiVpa', 'upiAmount'], (res) => {
        if (upiVpaEl && res.upiVpa) upiVpaEl.value = res.upiVpa;
        if (upiAmountEl && res.upiAmount) upiAmountEl.value = res.upiAmount;
      });
    } catch {}
  }
  function escHtml(s) { return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }

  let restaurants = [];
  let cart = [];
  let allMenus = {}; // restaurantId -> items
  let currentLat = null;
  let currentLng = null;
  const pageSize = 20;
  const menuPageIndex = {}; // restaurantId -> page index

  function saveCart() {
    try { chrome.storage && chrome.storage.local.set({ cart }); } catch {}
  }

  function loadCart() {
    try {
      chrome.storage && chrome.storage.local.get(['cart'], (res) => {
        if (Array.isArray(res.cart)) { cart = res.cart; renderCart(); }
      });
    } catch {}
  }

  // Keep cart in sync if changed by another view
  try {
    chrome.storage && chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.cart) {
        cart = Array.isArray(changes.cart.newValue) ? changes.cart.newValue : [];
        renderCart();
      }
    });
  } catch {}

  function renderCart() {
    if (!cart.length) {
      cartItemsEl.innerHTML = '<li><em>Cart is empty</em></li>';
      cartTotalEl.textContent = '';
      return;
    }
    cartItemsEl.innerHTML = cart.map((c, i) => `
      <li>
        ${c.name} - ₹${c.price} <button data-i="${i}" class="remove-cart">x</button>
      </li>
    `).join('');
    const total = cart.reduce((s, c) => s + (Number(c.price) || 0), 0);
    cartTotalEl.textContent = `Total: ₹${total}`;
    document.querySelectorAll('.remove-cart').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-i'));
        cart.splice(idx, 1);
        saveCart();
        renderCart();
      });
    });
    saveCart();
  }

  function renderMenu(menu, restaurantId) {
    if (!menu || !menu.length) return '<li><em>Menu unavailable</em></li>';
    const idx = menuPageIndex[restaurantId] || 0;
    const start = idx * pageSize;
    const end = start + pageSize;
    const page = menu.slice(start, end);
    const list = page.map(item => `
      <li>
        ${item.name} - ₹${item.price} <button class="add-to-cart" data-id="${restaurantId}" data-name="${item.name}" data-price="${item.price}">Add</button>
      </li>
    `).join('');
    const totalPages = Math.max(1, Math.ceil(menu.length / pageSize));
    const pager = `
      <div class="pager" data-id="${restaurantId}" style="display:flex;gap:8px;margin-top:6px;align-items:center;">
        <button class="menu-prev" ${idx<=0?'disabled':''}>Prev</button>
        <span style="font-size:12px;color:#555;">Page ${idx+1} / ${totalPages}</span>
        <button class="menu-next" ${end>=menu.length?'disabled':''}>Next</button>
      </div>
    `;
    return list + pager;
  }

  function renderRestaurants(list) {
    restaurantList.innerHTML = list.map((r, idx) => `
      <div class="restaurant" data-id="${r.id}" data-idx="${idx}">
        <h2>${r.name} <span>⭐${r.rating || 'N/A'}</span></h2>
        ${r.image ? `<img src="${r.image}" alt="${r.name}" style="width:100px;height:75px;object-fit:cover;">` : ''}
        <button class="show-menu-btn" data-id="${r.id}" data-idx="${idx}">Show Menu</button>
        <ul id="menu-${r.id}"><li><em>Menu unavailable</em></li></ul>
      </div>
    `).join('');
  }

  // Event delegation for Show Menu and Add to Cart inside restaurant list
  restaurantList.addEventListener('click', (e) => {
    const showBtn = e.target.closest('.show-menu-btn');
    if (showBtn) {
      const restaurantId = showBtn.getAttribute('data-id');
      const menuUl = document.getElementById(`menu-${restaurantId}`);
      menuUl.innerHTML = '<li>Loading menu...</li>';
  chrome.runtime.sendMessage({ type: 'FETCH_SWIGGY_MENU', restaurantId, lat: currentLat, lng: currentLng }, (menuResp) => {
        if (menuResp && menuResp.success) {
          const filtered = (menuResp.menu || []).filter(m => Number(m.price) > 0);
          allMenus[restaurantId] = filtered;
          menuUl.innerHTML = renderMenu(filtered, restaurantId);
        } else {
          const errMsg = (menuResp && menuResp.error) ? menuResp.error : 'Menu unavailable';
          menuUl.innerHTML = `<li><em>${errMsg}. Try again or choose another restaurant.</em></li>`;
        }
      });
      return;
    }
    const addBtn = e.target.closest('.add-to-cart');
    if (addBtn) {
      const name = addBtn.getAttribute('data-name');
      const price = Number(addBtn.getAttribute('data-price')) || 0;
      const rid = addBtn.getAttribute('data-id');
      const rname = (restaurants.find(r => String(r.id) === String(rid)) || {}).name || 'Unknown';
      cart.push({ name, price, restaurant: rname });
      saveCart();
      renderCart();
      return;
    }

    const pager = e.target.closest('.menu-prev, .menu-next');
    if (pager) {
      const container = e.target.closest('.pager');
      const rid = container.getAttribute('data-id');
      const menu = allMenus[rid] || [];
      const cur = menuPageIndex[rid] || 0;
      if (e.target.classList.contains('menu-prev') && cur > 0) menuPageIndex[rid] = cur - 1;
      if (e.target.classList.contains('menu-next') && (cur+1) * pageSize < menu.length) menuPageIndex[rid] = cur + 1;
      const menuUl = document.getElementById(`menu-${rid}`);
      menuUl.innerHTML = renderMenu(menu, rid);
      return;
    }
  });

  function searchAcrossMenus(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) { matchesEl.innerHTML = ''; return; }
    // Aggregate items
    const results = [];
    Object.entries(allMenus).forEach(([rid, items]) => {
      items.forEach(item => {
        const hay = `${item.name || ''}`.toLowerCase();
        if (hay.includes(q)) {
          const rest = restaurants.find(r => String(r.id) === String(rid));
          results.push({
            restaurantId: rid,
            restaurantName: rest?.name || 'Unknown',
            name: item.name,
            price: item.price,
            image: item.image
          });
        }
      });
    });
    if (!results.length) { matchesEl.innerHTML = '<div><em>No matching items found. Click a few restaurants to load their menus first.</em></div>'; return; }
  matchesEl.innerHTML = results.slice(0, 25).map(r => `
      <div class="match">
        <div class="info">
          <div>
            <div><strong>${r.name}</strong> – ₹${r.price}</div>
            <div style="font-size:12px;color:#555;">from ${r.restaurantName}</div>
          </div>
        </div>
    <button class="add-match btn-primary" data-name="${r.name}" data-price="${r.price}" data-restaurant="${r.restaurantName}">Add</button>
      </div>
    `).join('');
    // Event delegation handles add-clicks below
  }

  // Event delegation for add from matches
  matchesEl.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.add-match');
    if (addBtn) {
  cart.push({ name: addBtn.getAttribute('data-name'), price: Number(addBtn.getAttribute('data-price')) || 0, restaurant: addBtn.getAttribute('data-restaurant') || 'Unknown' });
      saveCart();
      renderCart();
    }
  });

  // Debounce helper for realtime search
  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function ensureMenusForRestaurants(restos, limit = 6, onEach) {
    const toGet = restos.filter(r => !allMenus[r.id]).slice(0, limit);
    toGet.forEach(r => {
      chrome.runtime.sendMessage({ type: 'FETCH_SWIGGY_MENU', restaurantId: r.id, lat: currentLat, lng: currentLng }, (resp) => {
        if (resp && resp.success) {
          allMenus[r.id] = (resp.menu || []).filter(m => Number(m.price) > 0);
          if (onEach) onEach(r.id);
        }
      });
    });
  }

  const debouncedUnified = debounce((q) => {
    const query = (q || '').trim();
    // Filter restaurants by name for the list view
    const filtered = query ? restaurants.filter(r => r.name.toLowerCase().includes(query.toLowerCase())) : restaurants;
    renderRestaurants(filtered);
    // Prefetch menus for top matches to power item search, then search
    matchesEl.innerHTML = query ? '<div>Searching items…</div>' : '';
    ensureMenusForRestaurants(filtered, 8, () => searchAcrossMenus(query));
    // Immediate search across already loaded menus
    searchAcrossMenus(query);
  }, 250);

  function copySummary() {
    const lines = [
      'Order for Puch AI:',
  ...cart.map(c => `- ${c.name}: ₹${c.price} (from ${c.restaurant || 'Unknown'})`),
  cart.length ? `Total: ₹${cart.reduce((s, c) => s + (Number(c.price) || 0), 0)}` : 'No items yet.',
  upiUrl ? `Pay via UPI: ${upiUrl}` : ''
    ];
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      orderStatus.textContent = 'Copied order summary to clipboard. Paste into Puch AI chat.';
    }).catch(() => {
      orderStatus.textContent = 'Failed to copy. Select and copy manually.';
    });
  }

  copySummaryBtn.addEventListener('click', copySummary);

  // Send to WhatsApp Web: open or focus a tab, then inject message via content script
  const sendBtn = document.getElementById('send-whatsapp');
  function buildOrderText() {
    return [
      'Order for Puch AI:',
      ...cart.map(c => `- ${c.name}: ₹${c.price} (from ${c.restaurant || 'Unknown'})`),
      cart.length ? `Total: ₹${cart.reduce((s, c) => s + (Number(c.price) || 0), 0)}` : 'No items yet.',
      upiUrl ? `Pay via UPI: ${upiUrl}` : ''
    ].join('\n');
  }

  // Preferred: open WhatsApp via API deep link with your Puch AI number
  const WA_PHONE = '919998881729'; // provided number without the leading +
  function sendToWhatsAppApi() {
    const text = buildOrderText();
    if (!text || !text.trim()) {
      orderStatus.textContent = 'Cart is empty.';
      return;
    }
    const encoded = encodeURIComponent(text);
    const url = `https://api.whatsapp.com/send/?phone=${encodeURIComponent('+' + WA_PHONE)}&text=${encoded}&type=phone_number&app_absent=0`;
    chrome.tabs.create({ url });
    orderStatus.textContent = 'Opening WhatsApp with your order…';
  }

  function sendToWhatsApp(autoSend = false) {
    const text = buildOrderText();
    if (!text || !text.trim()) {
      orderStatus.textContent = 'Cart is empty.';
      return;
    }
    chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
      const target = tabs && tabs[0];
      const doSend = (tabId) => {
        chrome.tabs.sendMessage(tabId, { type: 'WA_INSERT_AND_SEND', text, autoSend }, (resp) => {
          if (resp && resp.success) {
            orderStatus.textContent = resp.sent ? 'Sent to WhatsApp.' : 'Inserted into WhatsApp composer.';
          } else {
            orderStatus.textContent = (resp && resp.error) || 'Could not insert text. Open a chat in WhatsApp Web.';
          }
        });
      };
      if (target) {
        chrome.tabs.update(target.id, { active: true }, () => doSend(target.id));
      } else {
        chrome.tabs.create({ url: 'https://web.whatsapp.com' }, (tab) => {
          // Wait briefly for the UI to load
          const start = Date.now();
          const check = () => {
            if (Date.now() - start > 15000) {
              orderStatus.textContent = 'Open a chat in WhatsApp Web, then click Send again.';
              return;
            }
            chrome.tabs.sendMessage(tab.id, { type: 'WA_INSERT_AND_SEND', text, autoSend }, (resp) => {
              if (resp && resp.success) {
                orderStatus.textContent = resp.sent ? 'Sent to WhatsApp.' : 'Inserted into WhatsApp composer.';
              } else {
                setTimeout(check, 800);
              }
            });
          };
          setTimeout(check, 1500);
        });
      }
    });
  }

  if (sendBtn) {
    // Use API deep link path by default
    sendBtn.addEventListener('click', () => sendToWhatsAppApi());
  }

  // Payment: Generate UPI QR
  function makeUpiUrl(vpa, amount, note = 'Puch AI Order') {
    const params = new URLSearchParams({ pa: vpa, pn: 'Puch AI', am: String(amount || ''), tn: note, cu: 'INR' });
    // upi://pay isn't directly scannable via plain img, so we encode the string into a QR via an image API
    return 'upi://pay?' + params.toString();
  }
  function renderQr(text, vpa, amount) {
    if (!text) { qrPreview.innerHTML = ''; return; }
    const api = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(text);
    const caption = `<div style="font-size:12px;color:#555;margin-top:6px;">Pay to: ${escHtml(vpa || '')}${amount?` • Amount: ₹${escHtml(amount)}`:''}</div>`;
    qrPreview.innerHTML = `<img src="${api}" alt="UPI QR" width="180" height="180" />${caption}`;
  }
  if (genQrBtn) {
    genQrBtn.addEventListener('click', () => {
      const vpa = (upiVpaEl?.value || '').trim();
      const amt = Number(upiAmountEl?.value || 0) || cart.reduce((s, c) => s + (Number(c.price) || 0), 0);
      if (!vpa) { orderStatus.textContent = 'Enter a UPI ID to generate QR.'; return; }
      upiUrl = makeUpiUrl(vpa, amt);
      renderQr(upiUrl, vpa, amt);
      savePaymentPrefs(vpa, amt);
      orderStatus.textContent = 'UPI QR ready to scan.';
    });
  }

  // Reset state on popup open to avoid showing last session data
  function resetStateOnOpen() {
    try {
      chrome.storage && chrome.storage.local.set({ cart: [], upiVpa: '', upiAmount: '' });
    } catch {}
    cart = [];
    upiUrl = '';
    if (upiVpaEl) upiVpaEl.value = '';
    if (upiAmountEl) upiAmountEl.value = '';
  }

  // Optional: Checkout in Swiggy (opens restaurant pages for items in your cart)
  async function validateCartAndCheckout() {
    if (!cart.length) { orderStatus.textContent = 'Cart is empty.'; return; }
    orderStatus.textContent = 'Validating items with restaurants…';
    // Group items by restaurant
    const groups = cart.reduce((acc, c) => {
      const key = c.restaurant || 'Unknown';
      acc[key] = acc[key] || { name: key, items: [] };
      acc[key].items.push(c);
      return acc;
    }, {});

    // Ensure we have menus for these restaurants to validate availability
    const missingMenus = [];
    Object.keys(groups).forEach(rname => {
      const r = restaurants.find(x => x.name === rname);
      if (r && !allMenus[r.id]) missingMenus.push(r);
    });
    await Promise.all(missingMenus.map(r => new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'FETCH_SWIGGY_MENU', restaurantId: r.id, lat: currentLat, lng: currentLng }, (resp) => {
        if (resp && resp.success) allMenus[r.id] = (resp.menu || []).filter(m => Number(m.price) > 0);
        resolve();
      });
    })));

    // Check which items are still present (by fuzzy name match)
    const unavailable = [];
    Object.entries(groups).forEach(([rname, grp]) => {
      const r = restaurants.find(x => x.name === rname);
      const menu = r ? (allMenus[r.id] || []) : [];
      grp.items.forEach(it => {
        const nm = (it.name || '').toLowerCase();
        const ok = menu.some(mi => (mi.name || '').toLowerCase() === nm || (mi.name || '').toLowerCase().includes(nm));
        if (!ok) unavailable.push(`${it.name} (${rname})`);
      });
    });

    if (unavailable.length) {
      orderStatus.textContent = `Some items may be unavailable now: ${unavailable.slice(0,4).join(', ')}${unavailable.length>4?'…':''}`;
    } else {
      orderStatus.textContent = 'Items look available. Opening Swiggy…';
    }

    // Open each restaurant page so you can add items and checkout with your Swiggy account
    const opened = new Set();
    Object.keys(groups).forEach(rname => {
      const r = restaurants.find(x => x.name === rname);
      if (r && r.ctaLink && !opened.has(r.ctaLink)) {
        opened.add(r.ctaLink);
        chrome.tabs.create({ url: r.ctaLink });
      }
    });
  }

  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', validateCartAndCheckout);
  }

  function loadRestaurants() {
    chrome.runtime.sendMessage({ type: 'FETCH_SWIGGY_RESTAURANTS', lat: currentLat, lng: currentLng }, (response) => {
      if (response && response.success) {
        restaurants = response.restaurants;
        renderRestaurants(restaurants);
        orderStatus.textContent = 'Restaurants loaded. Prefetching menus...';
        // Prefetch menus for first few restaurants to power search
        const toPrefetch = restaurants.slice(0, 8);
        let done = 0;
        if (!toPrefetch.length) {
          orderStatus.textContent = 'No restaurants found for this location.';
          return;
        }
        toPrefetch.forEach(r => {
          chrome.runtime.sendMessage({ type: 'FETCH_SWIGGY_MENU', restaurantId: r.id, lat: currentLat, lng: currentLng }, (menuResp) => {
            done += 1;
            if (menuResp && menuResp.success) {
              allMenus[r.id] = menuResp.menu;
            }
            if (done === toPrefetch.length) {
              orderStatus.textContent = 'Menus ready. Tell me what you want to eat.';
              if (wantInput.value.trim()) searchAcrossMenus(wantInput.value);
            }
          });
        });
      } else {
        restaurantList.innerHTML = '<div style="color:red;">Failed to load restaurants.</div>';
      }
    });
  }

  // No manual load button; auto-load below

  searchInput.addEventListener('input', () => debouncedUnified(searchInput.value));

  findItemsBtn.addEventListener('click', () => debouncedUnified(wantInput.value));
  wantInput.addEventListener('input', () => debouncedUnified(wantInput.value));
  wantInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') debouncedUnified(wantInput.value); });

  // Request geolocation once; if denied, try IP-based approximate location; else fallback to defaults
  function tryIpLocation() {
    fetch('https://ipapi.co/json/')
      .then(r => r.json())
      .then(j => {
        if (j && j.latitude && j.longitude) {
          currentLat = j.latitude;
          currentLng = j.longitude;
          orderStatus.textContent = 'Using approximate location based on IP.';
        } else {
          orderStatus.textContent = 'Using default location.';
        }
      })
      .catch(() => {
        orderStatus.textContent = 'Using default location.';
      })
      .finally(() => loadRestaurants());
  }

  // Geolocation init with Permissions API to surface clear status
  function requestGeoAndLoad() {
    navigator.geolocation.getCurrentPosition((pos) => {
      currentLat = pos.coords.latitude;
      currentLng = pos.coords.longitude;
      orderStatus.textContent = 'Using your current location.';
      loadRestaurants();
    }, (err) => {
      orderStatus.textContent = 'Location denied or unavailable; resolving approximate location…';
      tryIpLocation();
    }, { timeout: 8000, maximumAge: 0, enableHighAccuracy: false });
  }

  if (navigator.geolocation) {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((status) => {
        if (status.state === 'granted' || status.state === 'prompt') {
          requestGeoAndLoad();
        } else {
          orderStatus.textContent = 'Location is blocked. Click "Use my location" to retry, or allow location for this extension in Chrome settings.';
          tryIpLocation();
        }
        status.onchange = () => {
          // If user flips permission while popup is open
          if (status.state === 'granted') requestGeoAndLoad();
        };
      }).catch(() => requestGeoAndLoad());
    } else {
      requestGeoAndLoad();
    }
  } else {
    tryIpLocation();
  }

  // Removed manual retry button; automatic geolocation/IP fallback remains

  // Initial UI
  resetStateOnOpen();
  renderCart();
  orderStatus.textContent = 'Tell me what you want to eat; I’ll find it nearby.';
  loadCart();
  loadPaymentPrefs();
});
