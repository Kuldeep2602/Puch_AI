// background.js
// Handles fetching Swiggy restaurant data and messaging

// Example Swiggy API endpoints (replace with actual endpoint/tool if needed)
function buildListUrl(lat, lng) {
	const useLat = lat || '12.9351929';
	const useLng = lng || '77.62448069999999';
	return `https://www.swiggy.com/dapi/restaurants/list/v5?lat=${useLat}&lng=${useLng}&page_type=DESKTOP_WEB_LISTING`;
}
let cache = { listKey: '', list: null, menus: {} };
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
let cacheTimes = { list: 0, menus: {} };
const now = () => Date.now();
const SWIGGY_MENU_API_URL = (restaurantId, lat, lng) => `https://www.swiggy.com/dapi/menu/pl?page-type=REGULAR_MENU&complete-menu=true&lat=${lat || '12.9351929'}&lng=${lng || '77.62448069999999'}&restaurantId=${restaurantId}`;

// Construct Swiggy image URLs; media-assets is the current host
function swiggyImgUrl(imageId, w = 200, h = 150) {
	if (!imageId) return '';
	return `https://media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_${w},h_${h},c_fill/${imageId}`;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
		if (request.type === 'FETCH_SWIGGY_RESTAURANTS') {
			const url = buildListUrl(request.lat, request.lng);
			const key = url;
			if (cache.list && cache.listKey === key && now() - cacheTimes.list < CACHE_TTL_MS) {
				sendResponse({ success: true, restaurants: cache.list });
				return true;
			}
			fetch(url)
			.then(res => res.json())
			.then(data => {
				// Parse restaurant data from Swiggy response
				const restaurants = (data?.data?.cards || [])
					.flatMap(card => card.card?.card?.gridElements?.infoWithStyle?.restaurants || [])
					.map(r => ({
						id: r.info?.id,
						name: r.info?.name,
					image: swiggyImgUrl(r.info?.cloudinaryImageId, 160, 120),
						rating: r.info?.avgRating,
						// Try to capture Swiggy's official restaurant URL when present
						ctaLink: r.cta?.link || r.info?.cta?.link || null,
						menu: [] // Menus require a separate API call per restaurant
					}));
					cache.listKey = key;
					cache.list = restaurants;
					cacheTimes.list = now();
					sendResponse({ success: true, restaurants });
			})
			.catch(err => sendResponse({ success: false, error: err.message }));
		return true; // Keep the message channel open for async response
	}
		if (request.type === 'FETCH_SWIGGY_MENU' && request.restaurantId) {
			if (cache.menus[request.restaurantId] && now() - (cacheTimes.menus[request.restaurantId] || 0) < CACHE_TTL_MS) {
				sendResponse({ success: true, menu: cache.menus[request.restaurantId] });
				return true;
			}
			fetch(SWIGGY_MENU_API_URL(request.restaurantId, request.lat, request.lng))
			.then(res => res.json())
			.then(data => {
					// Parse menu items from Swiggy menu response (handle multiple shapes)
					const cards = data?.data?.cards || [];
					let items = [];

					// Helper to push items from itemCards array
					function pushItemCards(itemCards) {
						(itemCards || []).forEach(ic => {
							const info = ic.card?.info || ic.info;
							if (!info) return;
										items.push({
											name: info.name,
											price: (info.price || info.defaultPrice || 0) / 100,
											image: swiggyImgUrl(info.imageId, 120, 90),
										});
						});
					}

					// 1) Regular grouped cards
					cards.forEach(c => {
						const regular = c.groupedCard?.cardGroupMap?.REGULAR?.cards || [];
						regular.forEach(rc => {
							const cc = rc.card?.card || rc.card;
							if (!cc) return;
							if (cc.itemCards) pushItemCards(cc.itemCards);
							if (cc.categories) {
								(cc.categories || []).forEach(cat => pushItemCards(cat.itemCards));
							}
						});
					});

					// 2) Items directly on cards
					cards.forEach(c => {
						const cc = c.card?.card || c.card;
						if (!cc) return;
						if (cc.itemCards) pushItemCards(cc.itemCards);
						if (cc.categories) (cc.categories || []).forEach(cat => pushItemCards(cat.itemCards));
					});

					// De-duplicate by name + price
					const seen = new Set();
					items = items.filter(it => {
						const key = `${it.name}|${it.price}`;
						if (seen.has(key)) return false;
						seen.add(key);
						return true;
					});
			cache.menus[request.restaurantId] = items;
			cacheTimes.menus[request.restaurantId] = now();
			sendResponse({ success: true, menu: items });
			})
			.catch(err => sendResponse({ success: false, error: err.message }));
		return true;
	}
});
