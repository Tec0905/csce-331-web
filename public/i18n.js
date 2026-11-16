// Site-wide English/Spanish switch.
//
// Two layers work together:
//   1. Google's free website translation widget translates the page.
//   2. A curated glossary (glossary-es.json) protects our menu vocabulary.
//      Before the widget sees the page, every glossary term is swapped for
//      its curated Spanish and marked "notranslate", so drink, topping, and
//      ingredient names are never mangled by machine translation.
//
// The page is switched in place without reloading, so the cart stays. If the
// widget cannot switch back to English by itself, the page reloads and the
// kiosk restores its saved cart.
(function () {
    const STORAGE_KEY = 'lang';
    const GLOSSARY_URL = '/glossary-es.json';
    const WIDGET_SRC =
        'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    // "font" is how the widget wraps text it has already translated.
    const SKIP = 'script, style, noscript, textarea, option, font, .notranslate, [translate="no"]';
    const COMBO_WAIT_MS = 5000;
    const REVERT_CHECK_MS = 1500;

    let lang = 'en';
    try {
        lang = localStorage.getItem(STORAGE_KEY) === 'es' ? 'es' : 'en';
    } catch (error) { /* storage blocked: stay in English */ }

    const terms = new Map();   // lowercase English term -> curated Spanish
    const exact = new Map();   // same, but only for text that is exactly the term
    let splitter = null;       // matches any glossary term
    let widgetPromise = null;
    let button = null;

    function escapeRegExp(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /* ---------- Glossary: swap terms for curated Spanish ---------- */

    function buildMatcher(entries) {
        const keys = Object.keys(entries).sort((a, b) => b.length - a.length);

        keys.forEach(key => terms.set(key.toLowerCase(), entries[key]));

        // Longest terms first, so "Coffee Jelly" wins over "Coffee".
        splitter = keys.length === 0 ? null : new RegExp(
            '(?<!\\w)(' + keys.map(escapeRegExp).join('|') + ')(?!\\w)',
            'i'
        );
    }

    function termSpan(english, spanish) {
        const span = document.createElement('span');
        span.className = 'notranslate i18n-term';
        span.setAttribute('translate', 'no');
        span.dataset.en = english;
        span.textContent = spanish;
        return span;
    }

    // Short words like "Large" or "No ice" are only swapped when they are the
    // whole text of an element, so they never change longer sentences.
    function protectExact(node) {
        const text = node.nodeValue;
        const spanish = exact.get(text.trim().toLowerCase());
        if (!spanish) return false;

        const lead = text.match(/^\s*/)[0];
        const trail = text.match(/\s*$/)[0];
        const fragment = document.createDocumentFragment();

        if (lead) fragment.append(document.createTextNode(lead));
        fragment.append(termSpan(text.trim(), spanish));
        if (trail) fragment.append(document.createTextNode(trail));

        node.replaceWith(fragment);
        return true;
    }

    function protect(node) {
        const parent = node.parentElement;

        if (!parent || parent.closest(SKIP) || !node.nodeValue.trim()) return;
        if (protectExact(node) || !splitter) return;

        // split() with a capture group alternates plain text and glossary terms.
        const parts = node.nodeValue.split(splitter);
        if (parts.length === 1) return;

        const fragment = document.createDocumentFragment();

        parts.forEach((part, index) => {
            if (index % 2 === 0) {
                if (part) fragment.append(document.createTextNode(part));
                return;
            }

            fragment.append(termSpan(part, terms.get(part.toLowerCase())));
        });

        node.replaceWith(fragment);
    }

    function protectTree(root) {
        if (!splitter && exact.size === 0) return;

        if (root.nodeType === Node.TEXT_NODE) {
            protect(root);
            return;
        }

        if (root.nodeType !== Node.ELEMENT_NODE || root.closest(SKIP)) return;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(protect);
    }

    function restoreTerms() {
        document.querySelectorAll('span.i18n-term').forEach(span => {
            span.replaceWith(document.createTextNode(span.dataset.en));
        });
    }

    /* ---------- Google's widget ---------- */

    function setCookie(language) {
        const value = language === 'en' ? '' : '/en/' + language;
        const expires = language === 'en'
            ? '; expires=Thu, 01 Jan 1970 00:00:00 GMT'
            : '';

        document.cookie = `googtrans=${value}; path=/${expires}`;

        if (location.hostname.includes('.')) {
            document.cookie =
                `googtrans=${value}; path=/; domain=${location.hostname}${expires}`;
        }
    }

    function loadWidget() {
        if (widgetPromise) return widgetPromise;

        widgetPromise = new Promise((resolve, reject) => {
            const holder = document.createElement('div');
            holder.id = 'google_translate_element';
            holder.className = 'notranslate';
            document.body.append(holder);

            window.googleTranslateElementInit = () => {
                new google.translate.TranslateElement({
                    pageLanguage: 'en',
                    includedLanguages: 'en,es',
                    autoDisplay: false
                }, 'google_translate_element');
                resolve();
            };

            const script = document.createElement('script');
            script.src = WIDGET_SRC;
            script.onerror = () => reject(new Error('The translate widget did not load.'));
            document.body.append(script);
        });

        return widgetPromise;
    }

    function waitForCombo() {
        return new Promise((resolve, reject) => {
            const startedAt = Date.now();

            const timer = setInterval(() => {
                const combo = document.querySelector('select.goog-te-combo');

                if (combo) {
                    clearInterval(timer);
                    resolve(combo);
                } else if (Date.now() - startedAt > COMBO_WAIT_MS) {
                    clearInterval(timer);
                    reject(new Error('The translate widget is not ready.'));
                }
            }, 100);
        });
    }

    async function widgetTo(code) {
        await loadWidget();
        const combo = await waitForCombo();

        combo.value = code;
        combo.dispatchEvent(new Event('change'));
    }

    /* ---------- Language switch ---------- */

    function updateButton() {
        const next = lang === 'es' ? 'en' : 'es';

        button.textContent = next === 'es' ? 'Español' : 'English';
        button.lang = next;
        button.setAttribute('aria-label',
            next === 'es' ? 'Ver esta página en español' : 'View this page in English');
    }

    async function setLang(next) {
        lang = next;

        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch (error) { /* storage blocked: choice lasts for this page only */ }

        document.documentElement.lang = next;
        updateButton();
        setCookie(next);

        if (next === 'es') {
            protectTree(document.body);

            try {
                await widgetTo('es');
            } catch (error) {
                console.warn(error.message);
            }

            return;
        }

        restoreTerms();

        try {
            await widgetTo('en');

            // If the widget did not fully switch back, reload. The cookie is
            // already cleared, and the kiosk restores its saved cart.
            setTimeout(() => {
                if (document.documentElement.classList.contains('translated-ltr')) {
                    location.reload();
                }
            }, REVERT_CHECK_MS);
        } catch (error) {
            location.reload();
        }
    }

    function buildButton() {
        const style = document.createElement('style');
        style.textContent = `
            /* Hide the widget's own banner and highlights. */
            iframe.skiptranslate, .goog-te-banner-frame { display: none !important; }
            body { top: 0 !important; }
            #goog-gt-tt, .goog-te-balloon-frame { display: none !important; }
            .goog-text-highlight { background: none !important; box-shadow: none !important; }
            #google_translate_element {
                position: absolute; left: -9999px; top: 0;
                width: 1px; height: 1px; overflow: hidden;
            }

            .header-end { display: flex; align-items: center; gap: 16px; }
            .lang-toggle {
                min-height: 44px; padding: 0 18px;
                border: 2px solid currentColor; border-radius: 10px;
                background: transparent; color: inherit;
                font: inherit; font-weight: 800;
                cursor: pointer; touch-action: manipulation;
            }
            .lang-toggle:focus-visible { outline: 3px solid #f4b942; outline-offset: 2px; }
            .lang-floating {
                position: fixed; top: 12px; right: 16px; z-index: 50;
                background: #fffdf8; color: #2e1a12;
            }
        `;
        document.head.append(style);

        button = document.createElement('button');
        button.type = 'button';
        button.className = 'lang-toggle notranslate';
        button.addEventListener('click', () => setLang(lang === 'es' ? 'en' : 'es'));

        const header = document.querySelector('header');
        const isFlex = header && getComputedStyle(header).display === 'flex';

        if (isFlex && header.children.length > 1) {
            // Keep the logo on the left and group the rest on the right.
            const group = document.createElement('div');
            group.className = 'header-end';
            group.append(header.lastElementChild, button);
            header.append(group);
        } else if (isFlex) {
            button.style.marginLeft = 'auto';
            header.append(button);
        } else {
            button.classList.add('lang-floating');
            document.body.append(button);
        }
    }

    async function start() {
        // The brand name is never translated.
        document.querySelectorAll('.logo').forEach(logo => {
            logo.classList.add('notranslate');
            logo.setAttribute('translate', 'no');
        });

        buildButton();
        updateButton();
        document.documentElement.lang = lang;

        try {
            const response = await fetch(GLOSSARY_URL, { cache: 'no-cache' });
            const data = await response.json();
            buildMatcher({ ...data.menu, ...data.ui });

            Object.entries(data.exact || {}).forEach(([english, spanish]) => {
                exact.set(english.toLowerCase(), spanish);
            });
        } catch (error) {
            console.warn('The glossary did not load.', error);
        }

        // Protect terms in anything the page adds later (menu, cart, pop-ups)
        // before the widget gets to translate it.
        new MutationObserver(mutations => {
            if (lang !== 'es') return;

            mutations.forEach(mutation => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => protectTree(node));
                } else if (mutation.type === 'characterData') {
                    protectTree(mutation.target);
                }
            });
        }).observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });

        if (lang === 'es') {
            // Terms are protected first so the widget never sees them.
            setCookie('es');
            protectTree(document.body);
            loadWidget().catch(error => console.warn(error.message));
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
