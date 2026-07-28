/* Cookie consent banner — design: Cookie Banner.dc.html (final).
   Rules (copy-privacy.md build notes, AEPD guidance):
   - No analytics cookie may be set before Accept; Reject is equally easy.
   - Persistent "Cookie settings" link in the footer reopens the banner on any
     visit. (Site feedback July 2026: after deciding, the banner disappears
     completely — no post-decision chip; the footer link is the only reopen.)
   - Policy link targets privacy.html#cookies. */

const KEY = 'fs-cookie-consent';
type Consent = 'accept' | 'reject' | null;

function readConsent(): Consent {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'accept' || v === 'reject' ? v : null;
  } catch {
    return null;
  }
}

function storeConsent(v: Exclude<Consent, null>) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* private mode: decision only lasts the page view */
  }
}

let analyticsLoaded = false;
function loadAnalytics() {
  if (analyticsLoaded) return;
  analyticsLoaded = true;
  // TODO(analytics): provider not confirmed yet (see copy-privacy.md bracketed
  // items). Inject the analytics snippet HERE and nowhere else — this function
  // only ever runs after the visitor accepts analytics cookies. When the
  // provider is chosen, also fill the cookie table + retention periods in
  // privacy.html.
}

let card: HTMLDivElement | null = null;

function removeCard() {
  card?.remove();
  card = null;
}

function showCard() {
  if (card) return;
  card = document.createElement('div');
  card.className = 'cb-card';
  card.setAttribute('data-noresolve', '');
  card.innerHTML =
    '<div class="cb-title">Cookies</div>' +
    '<p class="cb-copy">We use analytics cookies to improve this site. See our ' +
    '<a href="privacy.html#cookies">cookies policy</a>.</p>' +
    '<div class="cb-actions">' +
    '<button type="button" class="cb-btn" data-cb="accept">Accept</button>' +
    '<button type="button" class="cb-btn" data-cb="reject">Reject</button>' +
    '</div>';
  card.querySelectorAll<HTMLButtonElement>('[data-cb]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const decision = btn.dataset.cb as 'accept' | 'reject';
      storeConsent(decision);
      if (decision === 'accept') loadAnalytics();
      removeCard();
    });
  });
  document.body.appendChild(card);
}

/* Boot the consent layer. The experience page defers the first-visit banner
   until the entrance loader has faded (so its rise animation is seen);
   static pages show it immediately. */
export function initCookieBanner() {
  const consent = readConsent();
  if (consent === 'accept') loadAnalytics();
  if (consent === null) showCard();
}

/* Footer "Cookie settings" links are live from page load, independent of the
   deferred banner. */
export function bindCookieSettings() {
  document.querySelectorAll('[data-cookie-settings]').forEach((el) => {
    el.addEventListener('click', () => {
      showCard();
    });
  });
}
