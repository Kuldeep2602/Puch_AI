// content.js
// Inject order summary text into WhatsApp Web input and optionally send

function findWhatsAppInput() {
	// WhatsApp Web uses a contenteditable div for the message composer
	return document.querySelector('[contenteditable="true"][data-tab="10"], div[contenteditable="true"][role="textbox"]');
}

function setComposerText(text) {
	const box = findWhatsAppInput();
	if (!box) return false;
	box.focus();
	// Use clipboard as a robust way to insert multi-line text
	try {
		const dt = new DataTransfer();
		dt.setData('text/plain', text);
		const pasteEvent = new ClipboardEvent('paste', { clipboardData: dt });
		box.dispatchEvent(pasteEvent);
	} catch {
		// Fallback: set innerText
		box.textContent = text;
	}
	return true;
}

function clickSendButton() {
	// Send button selector on WhatsApp Web
	const sendBtn = document.querySelector('span[data-icon="send"]')?.closest('button');
	if (sendBtn) {
		sendBtn.click();
		return true;
	}
	return false;
}

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
	if (req?.type === 'WA_INSERT_AND_SEND') {
		const ok = setComposerText(req.text || '');
		if (!ok) return sendResponse({ success: false, error: 'Composer not found. Open a chat on web.whatsapp.com.' });
		let sent = false;
		if (req.autoSend) {
			// Small delay to allow paste/render
			setTimeout(() => {
				sent = clickSendButton();
				sendResponse({ success: true, sent });
			}, 200);
			return true; // async
		}
		sendResponse({ success: true, sent });
		return true;
	}
});
