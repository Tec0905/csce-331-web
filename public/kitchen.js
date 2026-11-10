'use strict';

const ORDERS_API = '/api/kitchen/orders';
const REFRESH_MS = 5000;
const URGENT_AFTER_MINUTES = 10;
const STAGES = [
    { id: 'new', next: 'preparing', button: 'Start preparing' },
    { id: 'preparing', next: 'ready', button: 'Mark ready' },
    { id: 'ready', next: 'served', button: 'Complete pickup' }
];

const stageContainers = Object.fromEntries(
    ['new', 'preparing', 'ready', 'served'].map(stage => [
        stage, document.getElementById(stage + '-orders')
    ])
);

let orders = [];
let lastReadAt = Date.now();
let loading = false;
let accessCode = '';
let toastTimer;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function formatOptions(item) {
    const details = [];
    if (item.size) {
        details.push({ M: 'Medium', L: 'Large' }[item.size] || item.size);
    }
    if (item.sugarLevel) details.push(item.sugarLevel + ' sugar');
    if (item.iceLevel) {
        details.push({ none: 'No ice', less: 'Less ice', regular: 'Regular ice' }[item.iceLevel]
            || item.iceLevel + ' ice');
    }
    return details.join(' · ');
}

function elapsedMinutes(order) {
    const elapsed = (Date.now() - lastReadAt) / 1000;
    return Math.max(0, Math.floor((order.ageSeconds + elapsed) / 60));
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
}

function createCard(order, isCompleted = false) {
    const card = el('article', 'order-card');
    const age = elapsedMinutes(order);
    if (!isCompleted && order.status !== 'ready' && age >= URGENT_AFTER_MINUTES) {
        card.classList.add('urgent');
    }

    const heading = el('div', 'ticket-head');
    heading.append(el('h3', '', 'Order #' + order.id));
    const meta = el('div', 'ticket-meta');
    meta.append(el('span', '', order.placedTime || ''));
    meta.append(el('span', 'elapsed', age + ' min ago'));
    heading.append(meta);
    card.append(heading);

    const lines = el('div', 'ticket-lines');
    for (const item of order.items) {
        const line = el('div', 'ticket-line');
        line.append(el('span', 'quantity', item.quantity + '×'));
        const details = el('div');
        details.append(el('span', 'item-name', item.name));
        const options = formatOptions(item);
        if (options) details.append(el('span', 'item-options', options));
        line.append(details);
        lines.append(line);
    }
    card.append(lines);

    const stage = STAGES.find(candidate => candidate.id === order.status);
    if (stage && !isCompleted) {
        const button = el('button', 'ticket-action', stage.button);
        button.type = 'button';
        button.addEventListener('click', () => advanceOrder(order, stage, button));
        card.append(button);
    }
    return card;
}

function render() {
    // Use textContent, not innerHTML, for database-backed item names.
    for (const container of Object.values(stageContainers)) container.replaceChildren();
    for (const stage of ['new', 'preparing', 'ready', 'served']) {
        const stageOrders = orders.filter(order => order.status === stage)
            .sort((a, b) => b.ageSeconds - a.ageSeconds);
        if (stageOrders.length === 0) {
            stageContainers[stage].append(el('p', 'empty',
                stage === 'served' ? 'No completed orders yet.' : 'No orders here yet.'));
        } else {
            for (const order of stageOrders) {
                stageContainers[stage].append(createCard(order, stage === 'served'));
            }
        }
        document.getElementById(stage + '-count').textContent = stageOrders.length;
        const pill = document.getElementById(stage + '-pill');
        if (pill) pill.textContent = stageOrders.length;
    }
}

function setConnection(connected) {
    const label = document.getElementById('connection');
    label.className = connected ? 'connection online' : 'connection offline';
    label.textContent = connected ? '● Live updates' : '● Connection lost';
}

async function loadOrders() {
    if (loading) return;
    loading = true;
    const errorBox = document.getElementById('error');
    try {
        const response = await fetch(ORDERS_API, { cache: 'no-store' });
        if (!response.ok) throw new Error('Server returned ' + response.status);
        const data = await response.json();
        if (!Array.isArray(data.orders)) throw new Error('Invalid order response');
        orders = data.orders;
        lastReadAt = Date.now();
        errorBox.hidden = true;
        setConnection(true);
        render();
    } catch (error) {
        setConnection(false);
        errorBox.textContent = 'Could not load kitchen orders (' + error.message +
            '). Check the Render backend, PostgreSQL connection, and kitchen database permissions.';
        errorBox.hidden = false;
    } finally {
        loading = false;
    }
}

async function advanceOrder(order, stage, button, retry = true) {
    button.disabled = true;
    button.textContent = 'Updating…';
    try {
        const response = await fetch(ORDERS_API + '/' + order.id + '/status', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                ...(accessCode ? { 'X-Kitchen-Code': accessCode } : {})
            },
            body: JSON.stringify({ expectedStatus: stage.id, nextStatus: stage.next })
        });
        if (response.status === 401 && retry) {
            const entered = prompt('Enter the Kitchen access code:');
            if (entered === null) return;
            accessCode = entered;
            return await advanceOrder(order, stage, button, false);
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Update failed');
        showToast('Order #' + order.id + ' moved to ' + stage.next + '.');
        await loadOrders();
    } catch (error) {
        showToast(error.message);
        await loadOrders();
    } finally {
        button.disabled = false;
        button.textContent = stage.button;
    }
}

function updateClock() {
    document.getElementById('clock').textContent =
        new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

document.getElementById('refresh').addEventListener('click', loadOrders);
updateClock();
loadOrders();
setInterval(() => { if (!document.hidden) loadOrders(); }, REFRESH_MS);
setInterval(updateClock, 15000);
