// Cashier register. Uses the same menu and orders endpoints as the kiosk, so
// every order goes through the same server-side pricing, sales, and inventory.
const MENU_URL = '/api/kiosk/menu';
const ORDERS_URL = '/api/kiosk/orders';

const CATEGORY_COLORS = ['#a32a1c', '#f4b942', '#5b8a72', '#6b7fa8', '#b5679a', '#c47a3d'];
const POPULAR = 'Popular';

const state = {
    menu: null,
    category: null,
    lines: [],
    selectedUid: null,
    nextUid: 1,
    submitting: false
};

const el = id => document.getElementById(id);
const categoriesEl = el('categories');
const menuGridEl = el('menu-grid');
const optionsPaneEl = el('options-pane');
const ticketLinesEl = el('ticket-lines');
const submitButton = el('submit-order');
const noticeEl = el('notice');

let noticeTimer = null;

function money(cents) {
    return '$' + (cents / 100).toFixed(2);
}

function toCents(dollars) {
    return Math.round(Number(dollars) * 100);
}

function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function showNotice(message, isError) {
    clearTimeout(noticeTimer);
    noticeEl.textContent = message;
    noticeEl.classList.toggle('error', Boolean(isError));
    noticeEl.hidden = false;
    noticeTimer = setTimeout(() => { noticeEl.hidden = true; }, 4000);
}

/* ---------- Pricing (display only; the server prices the real order) ---------- */

function sizeInfo(id) {
    return state.menu.sizes.find(size => size.id === id);
}

function extraToppingCents() {
    return toCents(state.menu.toppings[0] ? state.menu.toppings[0].price : 0);
}

function unitCents(line) {
    return toCents(line.item.price) +
        toCents(sizeInfo(line.size).upcharge) +
        line.extras.length * extraToppingCents();
}

function totals() {
    const subtotal = state.lines.reduce((sum, line) => {
        return sum + unitCents(line) * line.qty;
    }, 0);
    const tax = Math.round(subtotal * state.menu.taxRate);
    return { subtotal, tax, total: subtotal + tax };
}

/* ---------- Ticket ---------- */

function lineKey(line) {
    return [line.item.id, line.size, line.sugar, line.ice,
        [...line.extras].sort().join(',')].join('|');
}

function selectedLine() {
    return state.lines.find(line => line.uid === state.selectedUid) || null;
}

function addDrink(item) {
    const defaults = state.menu.defaultChoices;
    const fresh = {
        uid: state.nextUid++,
        item,
        size: defaults.size,
        sugar: defaults.sugar,
        ice: defaults.ice,
        extras: [],
        qty: 1
    };

    // Same drink with the same choices just adds one more.
    const match = state.lines.find(line => lineKey(line) === lineKey(fresh));

    if (match) {
        match.qty += 1;
        state.selectedUid = match.uid;
    } else {
        state.lines.push(fresh);
        state.selectedUid = fresh.uid;
    }

    renderTicket();
    renderOptions();
}

function changeQty(line, delta) {
    line.qty += delta;

    if (line.qty < 1) {
        removeLine(line);
        return;
    }

    if (line.qty > 50) line.qty = 50;
    renderTicket();
}

function removeLine(line) {
    state.lines = state.lines.filter(other => other !== line);

    if (state.selectedUid === line.uid) {
        state.selectedUid = state.lines.length
            ? state.lines[state.lines.length - 1].uid
            : null;
    }

    renderTicket();
    renderOptions();
}

function clearOrder() {
    state.lines = [];
    state.selectedUid = null;
    renderTicket();
    renderOptions();
}

function choiceSummary(line) {
    const parts = [
        sizeInfo(line.size).label,
        line.sugar + ' sugar',
        state.menu.iceLevels.find(level => level.id === line.ice).label
    ];

    line.extras.forEach(id => {
        const topping = state.menu.toppings.find(option => option.id === id);
        if (topping) parts.push('+ ' + topping.name);
    });

    return parts.join(' · ');
}

function renderTicket() {
    ticketLinesEl.replaceChildren();

    if (state.lines.length === 0) {
        ticketLinesEl.append(make('div', 'ticket-empty',
            'No drinks yet. Tap a drink to add it.'));
    }

    state.lines.forEach(line => {
        const row = make('div', 'ticket-line');
        row.classList.toggle('selected', line.uid === state.selectedUid);
        row.tabIndex = 0;
        row.setAttribute('role', 'button');

        const select = () => {
            state.selectedUid = line.uid;
            renderTicket();
            renderOptions();
        };

        row.addEventListener('click', select);
        row.addEventListener('keydown', event => {
            if (event.target === row && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                select();
            }
        });

        row.append(
            make('div', 'line-name', line.item.name),
            make('div', 'line-total', money(unitCents(line) * line.qty)),
            make('div', 'line-choices', choiceSummary(line))
        );

        const controls = make('div', 'line-controls');
        const minus = make('button', '', '−');
        const plus = make('button', '', '+');
        const remove = make('button', 'remove', 'Remove');

        minus.type = plus.type = remove.type = 'button';
        minus.setAttribute('aria-label', 'One fewer ' + line.item.name);
        plus.setAttribute('aria-label', 'One more ' + line.item.name);

        // Buttons handle their own taps without also selecting the row.
        minus.addEventListener('click', e => { e.stopPropagation(); changeQty(line, -1); });
        plus.addEventListener('click', e => { e.stopPropagation(); changeQty(line, 1); });
        remove.addEventListener('click', e => { e.stopPropagation(); removeLine(line); });

        controls.append(minus, make('span', 'line-qty', String(line.qty)), plus, remove);
        row.append(controls);
        ticketLinesEl.append(row);
    });

    const count = state.lines.reduce((sum, line) => sum + line.qty, 0);
    const { subtotal, tax, total } = totals();

    el('item-count').textContent = count + (count === 1 ? ' drink' : ' drinks');
    el('subtotal').textContent = money(subtotal);
    el('tax').textContent = money(tax);
    el('total').textContent = money(total);
    el('tax-label').textContent =
        'Tax (' + (state.menu.taxRate * 100).toFixed(2) + '%)';

    submitButton.disabled = count === 0 || state.submitting;
    submitButton.textContent = count === 0
        ? 'Submit order'
        : 'Submit order · ' + money(total);
}

/* ---------- Drink options ---------- */

function optionButton(label, detail, pressed, disabled, onPick) {
    const button = make('button', 'option', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(pressed));
    button.disabled = disabled;

    if (detail) button.append(make('small', '', detail));

    button.addEventListener('click', onPick);
    return button;
}

function optionGroup(title, buttons) {
    const group = make('fieldset', 'option-group');
    group.append(make('legend', '', title));

    const row = make('div', 'option-row');
    row.append(...buttons);
    group.append(row);
    return group;
}

function renderOptions() {
    optionsPaneEl.replaceChildren();
    const line = selectedLine();

    if (!line) {
        optionsPaneEl.append(make('div', 'options-empty',
            'Select a drink on the order to change its size, sugar, ice, or toppings.'));
        return;
    }

    const update = change => {
        change();
        renderTicket();
        renderOptions();
    };

    const menu = state.menu;

    optionsPaneEl.append(
        make('h2', 'options-heading', line.item.name),

        optionGroup('Size', menu.sizes.map(size => optionButton(
            size.label,
            size.detail + (size.upcharge ? ' · +' + money(toCents(size.upcharge)) : ''),
            line.size === size.id, false,
            () => update(() => { line.size = size.id; })
        ))),

        optionGroup('Sugar', menu.sugarLevels.map(level => optionButton(
            level.label, '', line.sugar === level.id, false,
            () => update(() => { line.sugar = level.id; })
        ))),

        optionGroup('Ice', menu.iceLevels.map(level => optionButton(
            level.label, '', line.ice === level.id, false,
            () => update(() => { line.ice = level.id; })
        ))),

        optionGroup('Toppings', menu.toppings.map(topping => {
            const included = line.item.includedToppingIds.includes(topping.id);
            const picked = line.extras.includes(topping.id);

            return optionButton(
                topping.name,
                included ? 'Included' : '+' + money(toCents(topping.price)),
                included || picked,
                included,
                () => update(() => {
                    line.extras = picked
                        ? line.extras.filter(id => id !== topping.id)
                        : [...line.extras, topping.id];
                })
            );
        }))
    );
}

/* ---------- Menu ---------- */

function categoryNames() {
    const names = [...new Set(state.menu.items.map(item => item.category))].sort();
    return state.menu.items.some(item => item.popular) ? [POPULAR, ...names] : names;
}

function categoryColor(name) {
    const index = categoryNames().filter(n => n !== POPULAR).indexOf(name);
    return CATEGORY_COLORS[(index < 0 ? 0 : index) % CATEGORY_COLORS.length];
}

function renderCategories() {
    categoriesEl.replaceChildren();

    categoryNames().forEach(name => {
        const button = make('button', 'category', name);
        button.type = 'button';
        button.classList.toggle('active', name === state.category);
        button.addEventListener('click', () => {
            state.category = name;
            renderCategories();
            renderMenu();
        });
        categoriesEl.append(button);
    });
}

function renderMenu() {
    menuGridEl.replaceChildren();

    const items = state.menu.items.filter(item => {
        return state.category === POPULAR ? item.popular : item.category === state.category;
    });

    if (items.length === 0) {
        menuGridEl.append(make('div', 'menu-message', 'No drinks in this category.'));
        return;
    }

    items.forEach(item => {
        const button = make('button', 'drink-button');
        button.type = 'button';
        button.style.setProperty('--category-color', categoryColor(item.category));
        button.append(
            make('span', 'drink-name', item.name),
            make('span', 'drink-price', money(toCents(item.price)))
        );
        button.addEventListener('click', () => addDrink(item));
        menuGridEl.append(button);
    });
}

/* ---------- Submit ---------- */

async function submitOrder() {
    if (state.lines.length === 0 || state.submitting) return;

    state.submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting…';

    const body = {
        items: state.lines.map(line => ({
            menuItemId: line.item.id,
            quantity: line.qty,
            size: line.size,
            sugar: line.sugar,
            ice: line.ice,
            toppingIds: line.extras
        }))
    };

    try {
        const response = await fetch(ORDERS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.message || 'Could not submit the order.');
        }

        clearOrder();
        showNotice('Order #' + data.orderId + ' submitted · ' + money(toCents(data.total)));
    } catch (error) {
        showNotice(error.message + ' The order is still here. Try again.', true);
    } finally {
        state.submitting = false;
        renderTicket();
    }
}

/* ---------- Startup ---------- */

function showMenuError() {
    menuGridEl.replaceChildren();

    const message = make('div', 'menu-message', 'The menu did not load.');
    const retry = make('button', '', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', loadMenu);

    message.append(retry);
    menuGridEl.append(message);
}

async function loadMenu() {
    menuGridEl.replaceChildren(make('div', 'menu-message', 'Loading menu…'));

    try {
        const response = await fetch(MENU_URL);
        if (!response.ok) throw new Error('Menu request failed');

        state.menu = await response.json();
        state.category = categoryNames()[0];

        renderCategories();
        renderMenu();
        renderTicket();
        renderOptions();
    } catch (error) {
        console.error(error);
        showMenuError();
    }
}

function tickClock() {
    el('clock').textContent = new Date().toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit'
    });
}

el('clear-order').addEventListener('click', () => {
    if (state.menu) clearOrder();
});
submitButton.addEventListener('click', submitOrder);

tickClock();
setInterval(tickClock, 15000);
loadMenu();
