// 83 GUYS — Manager Dashboard
// Talks to the routes in routes/manager.js (mounted at /api/manager).
 
const API = '/api/manager';
const SVG_NS = 'http://www.w3.org/2000/svg';
const TOP_ITEMS = 12;
 
const state = {
    menu: [],
    inventory: [],
    inventoryInfo: { usageWindowDays: 14, lowDaysLeft: 3, units: ['g', 'oz', 'each'] },
    menuLoaded: false,
    inventoryLoaded: false,
    editingMenuId: null,
    lastReports: null
};
 
// ---------- Small helpers ----------
 
const $ = id => document.getElementById(id);
 
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const wholeMoney = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
});
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
 
function formatMoney(value) {
    return money.format(value);
}
 
function formatCompactMoney(value) {
    return Math.abs(value) >= 1000 ? wholeMoney.format(value) : money.format(value);
}
 
function formatAmount(value, unit) {
    return `${number.format(value)} ${unit ?? ''}`.trim();
}
 
function formatHour(hour) {
    const suffix = hour < 12 ? 'am' : 'pm';
    const twelve = hour % 12 === 0 ? 12 : hour % 12;
    return `${twelve}${suffix}`;
}
 
// Builds an element. Text is always set with textContent, never innerHTML.
function el(tag, attributes = {}, children = []) {
    const node = document.createElement(tag);
 
    for (const [key, value] of Object.entries(attributes)) {
        if (value === null || value === undefined || value === false) {
            continue;
        }
 
        if (key === 'text') {
            node.textContent = value;
        } else if (key === 'class') {
            node.className = value;
        } else if (key.startsWith('on')) {
            node.addEventListener(key.slice(2), value);
        } else if (value === true) {
            node.setAttribute(key, '');
        } else {
            node.setAttribute(key, value);
        }
    }
 
    for (const child of [].concat(children)) {
        if (child !== null && child !== undefined) {
            node.append(child);
        }
    }
 
    return node;
}
 
function svg(tag, attributes = {}) {
    const node = document.createElementNS(SVG_NS, tag);
 
    for (const [key, value] of Object.entries(attributes)) {
        if (key === 'text') {
            node.textContent = value;
        } else {
            node.setAttribute(key, value);
        }
    }
 
    return node;
}
 
async function api(path, options = {}) {
    const response = await fetch(API + path, {
        method: options.method || 'GET',
        headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined
    });
 
    let data = null;
 
    try {
        data = await response.json();
    } catch {
        // Some errors don't send JSON back.
    }
 
    if (!response.ok) {
        throw new Error(data?.message || `Request failed (${response.status}).`);
    }
 
    return data;
}
 
let noticeTimer = null;
 
function showNotice(message, isError = false) {
    const notice = $('notice');
    notice.textContent = message;
    notice.classList.toggle('error', isError);
    notice.hidden = false;
 
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
        notice.hidden = true;
    }, isError ? 6000 : 3000);
}
 
// YYYY-MM-DD in the browser's own time zone.
function toDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
 
function formatDateLabel(value) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
    });
}
 
function emptyMessage(text) {
    return el('p', { class: 'empty', text });
}
 
// ---------- Clock ----------
 
function tickClock() {
    $('clock').textContent = new Date().toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
    });
}
 
// ---------- Tabs (arrow keys move between them) ----------
 
const tabs = [...document.querySelectorAll('[role="tab"]')];
 
function selectTab(tab, moveFocus = false) {
    for (const other of tabs) {
        const selected = other === tab;
        other.setAttribute('aria-selected', String(selected));
        other.tabIndex = selected ? 0 : -1;
        $(other.getAttribute('aria-controls')).hidden = !selected;
    }
 
    if (moveFocus) {
        tab.focus();
    }
 
    if (tab.id === 'tab-menu' && !state.menuLoaded) {
        loadMenu();
    }
 
    if (tab.id === 'tab-inventory' && !state.inventoryLoaded) {
        loadInventory();
    }
}
 
tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
 
    tab.addEventListener('keydown', event => {
        let next = null;
 
        if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
        if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
        if (event.key === 'Home') next = tabs[0];
        if (event.key === 'End') next = tabs[tabs.length - 1];
 
        if (next) {
            event.preventDefault();
            selectTab(next, true);
        }
    });
});
 
// ---------- Tooltip ----------
 
const tooltip = $('tooltip');
 
function showTooltip(lines, x, y) {
    tooltip.replaceChildren(
        el('strong', { text: lines[0] }),
        ...lines.slice(1).map(line => el('span', { text: line }))
    );
    tooltip.hidden = false;
 
    const box = tooltip.getBoundingClientRect();
    const left = Math.min(x + 14, window.innerWidth - box.width - 8);
    const top = y - box.height - 12 < 8 ? y + 16 : y - box.height - 12;
 
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}
 
function hideTooltip() {
    tooltip.hidden = true;
}
 
// Hover and keyboard focus both show the same tooltip for a bar.
function wireBar(chart, hit, bar, lines) {
    const activate = (x, y) => {
        chart.classList.add('hovering');
        bar.classList.add('active');
        showTooltip(lines, x, y);
    };
 
    const deactivate = () => {
        chart.classList.remove('hovering');
        bar.classList.remove('active');
        hideTooltip();
    };
 
    hit.addEventListener('pointermove', event => activate(event.clientX, event.clientY));
    hit.addEventListener('pointerleave', deactivate);
    hit.addEventListener('focus', () => {
        const box = bar.getBoundingClientRect();
        activate(box.left + box.width / 2, box.top);
    });
    hit.addEventListener('blur', deactivate);
}
 
// A rect with 4px rounded corners only on the end away from the baseline.
function barPath(x, y, width, height, horizontal) {
    const r = Math.min(4, horizontal ? height / 2 : width / 2, horizontal ? width : height);
 
    if (horizontal) {
        return `M${x},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r}
                V${y + height - r} Q${x + width},${y + height} ${x + width - r},${y + height}
                H${x} Z`;
    }
 
    return `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y}
            H${x + width - r} Q${x + width},${y} ${x + width},${y + r}
            V${y + height} Z`;
}
 
function niceMax(value) {
    if (value <= 0) return 1;
    const power = 10 ** Math.floor(Math.log10(value));
    const scaled = value / power;
    const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
    return step * power;
}
 
// ---------- Charts ----------
 
// Horizontal bars: one per drink, longest at the top.
function drawSalesChart(rows) {
    const chart = $('sales-chart');
    chart.replaceChildren();
 
    if (rows.length === 0) {
        chart.append(emptyMessage('No sales in this date range.'));
        return;
    }
 
    const top = rows.slice(0, TOP_ITEMS);
    const width = 1000;
    const labelWidth = 220;
    const valueRoom = 90;
    const rowHeight = 30;
    const barHeight = 20;
    const axisHeight = 24;
    const plotWidth = width - labelWidth - valueRoom;
    const height = top.length * rowHeight + axisHeight;
    const max = niceMax(Math.max(...top.map(row => row.revenue)));
 
    const root = svg('svg', {
        viewBox: `0 0 ${width} ${height}`,
        'aria-label': `Bar chart of the top ${top.length} drinks by revenue.`
    });
 
    // Recessive grid with 4 steps.
    for (let i = 0; i <= 4; i++) {
        const x = labelWidth + (plotWidth * i) / 4;
        root.append(
            svg('line', { class: 'grid-line', x1: x, x2: x, y1: 0, y2: height - axisHeight }),
            svg('text', {
                class: 'axis-text', x, y: height - 6, 'text-anchor': 'middle',
                text: formatCompactMoney((max * i) / 4)
            })
        );
    }
 
    top.forEach((row, index) => {
        const y = index * rowHeight + (rowHeight - barHeight) / 2;
        const barWidth = Math.max(2, (row.revenue / max) * plotWidth);
        const name = row.name.length > 28 ? `${row.name.slice(0, 27)}…` : row.name;
 
        root.append(svg('text', {
            class: 'label-text', x: labelWidth - 10, y: y + barHeight / 2 + 4,
            'text-anchor': 'end', text: name
        }));
 
        const bar = svg('path', {
            class: 'bar', d: barPath(labelWidth, y, barWidth, barHeight, true)
        });
 
        const hit = svg('rect', {
            class: 'hit', x: 0, y: index * rowHeight, width, height: rowHeight,
            tabindex: 0, role: 'img',
            'aria-label': `${row.name}: ${formatMoney(row.revenue)} from ${row.quantity} sold`
        });
 
        root.append(hit, bar);
 
        root.append(svg('text', {
            class: 'value-text', x: labelWidth + barWidth + 8, y: y + barHeight / 2 + 4,
            text: formatCompactMoney(row.revenue)
        }));
 
        wireBar(chart, hit, bar, [
            formatMoney(row.revenue),
            row.name,
            `${number.format(row.quantity)} sold · ${row.category}`
        ]);
    });
 
    chart.append(root);
}
 
// Vertical columns: one per hour, from the first to the last hour with sales.
function drawHourlyChart(rows) {
    const chart = $('hourly-chart');
    chart.replaceChildren();
 
    if (rows.length === 0) {
        chart.append(emptyMessage('No sales in this date range.'));
        return;
    }
 
    const first = Math.min(...rows.map(row => row.hour));
    const last = Math.max(...rows.map(row => row.hour));
    const hours = [];
 
    for (let hour = first; hour <= last; hour++) {
        hours.push(rows.find(row => row.hour === hour) ||
            { hour, orderCount: 0, revenue: 0 });
    }
 
    const width = 1000;
    const height = 260;
    const left = 64;
    const bottom = 28;
    const topPad = 10;
    const plotWidth = width - left - 8;
    const plotHeight = height - bottom - topPad;
    const slot = plotWidth / hours.length;
    const barWidth = Math.max(4, Math.min(48, slot - 2));
    const max = niceMax(Math.max(...hours.map(row => row.revenue)));
 
    const root = svg('svg', {
        viewBox: `0 0 ${width} ${height}`,
        'aria-label': 'Column chart of sales for each hour of the day.'
    });
 
    for (let i = 0; i <= 4; i++) {
        const y = topPad + plotHeight - (plotHeight * i) / 4;
        root.append(
            svg('line', { class: 'grid-line', x1: left, x2: width - 8, y1: y, y2: y }),
            svg('text', {
                class: 'axis-text', x: left - 8, y: y + 4, 'text-anchor': 'end',
                text: formatCompactMoney((max * i) / 4)
            })
        );
    }
 
    // Peak hour gets a direct label; the rest are in the tooltip and table.
    const peak = hours.reduce((best, row) => (row.revenue > best.revenue ? row : best));
 
    hours.forEach((row, index) => {
        const centerX = left + slot * index + slot / 2;
        const barHeight = (row.revenue / max) * plotHeight;
        const x = centerX - barWidth / 2;
        const y = topPad + plotHeight - barHeight;
 
        const bar = svg('path', {
            class: 'bar', d: barPath(x, y, barWidth, Math.max(barHeight, 0), false)
        });
 
        const hit = svg('rect', {
            class: 'hit', x: left + slot * index, y: topPad, width: slot, height: plotHeight,
            tabindex: 0, role: 'img',
            'aria-label': `${formatHour(row.hour)}: ${formatMoney(row.revenue)} from ` +
                `${row.orderCount} orders`
        });
 
        root.append(hit, bar, svg('text', {
            class: 'axis-text', x: centerX, y: height - 8, 'text-anchor': 'middle',
            text: formatHour(row.hour)
        }));
 
        if (row === peak && row.revenue > 0) {
            root.append(svg('text', {
                class: 'value-text', x: centerX, y: y - 6, 'text-anchor': 'middle',
                text: `Peak ${formatCompactMoney(row.revenue)}`
            }));
        }
 
        wireBar(chart, hit, bar, [
            formatMoney(row.revenue),
            `${formatHour(row.hour)} – ${formatHour((row.hour + 1) % 24)}`,
            `${number.format(row.orderCount)} orders`
        ]);
    });
 
    chart.append(root);
}
 
// ---------- Tables ----------
 
function buildTable(caption, columns, rows) {
    if (rows.length === 0) {
        return emptyMessage('Nothing to show for this date range.');
    }
 
    return el('table', { class: 'data-table' }, [
        el('caption', { class: 'sr-only', text: caption }),
        el('thead', {}, el('tr', {}, columns.map(column => {
            return el('th', { scope: 'col', class: column.numeric ? 'num' : null, text: column.label });
        }))),
        el('tbody', {}, rows.map(row => el('tr', {}, columns.map(column => {
            const value = column.value(row);
            return el('td', { class: column.numeric ? 'num' : null },
                value instanceof Node ? value : String(value));
        }))))
    ]);
}
 
function statusBadge(item) {
    if (item.onHand <= 0) {
        return el('span', { class: 'badge bad', text: '✕ Out of stock' });
    }
 
    if (item.isLow) {
        return el('span', { class: 'badge warn', text: '! Restock soon' });
    }
 
    return el('span', { class: 'badge good', text: '✓ OK' });
}
 
function formatDaysLeft(item) {
    return item.daysLeft === null ? '—' : number.format(item.daysLeft);
}
 
function renderReportTables(sales, hourly, usage, inventory) {
    $('sales-table-wrap').replaceChildren(buildTable('Sales by drink', [
        { label: 'Drink', value: row => row.name },
        { label: 'Category', value: row => row.category },
        { label: 'Sold', numeric: true, value: row => number.format(row.quantity) },
        { label: 'Revenue', numeric: true, value: row => formatMoney(row.revenue) }
    ], sales));
 
    $('hourly-table-wrap').replaceChildren(buildTable('Sales by hour', [
        { label: 'Hour', value: row => `${formatHour(row.hour)} – ${formatHour((row.hour + 1) % 24)}` },
        { label: 'Orders', numeric: true, value: row => number.format(row.orderCount) },
        { label: 'Sales', numeric: true, value: row => formatMoney(row.revenue) }
    ], hourly));
 
    $('usage-table-wrap').replaceChildren(buildTable('Product usage', [
        { label: 'Ingredient', value: row => row.name },
        { label: 'Category', value: row => row.category },
        { label: 'Used', numeric: true, value: row => formatAmount(row.used, row.unit) }
    ], usage));
 
    const low = inventory.filter(item => item.isLow);
 
    $('restock-table-wrap').replaceChildren(low.length === 0
        ? emptyMessage('Everything is stocked. Nothing to reorder.')
        : buildTable('Items to restock', [
            { label: 'Item', value: row => row.name },
            { label: 'On hand', numeric: true, value: row => formatAmount(row.onHand, row.unit) },
            { label: 'Days left', numeric: true, value: formatDaysLeft },
            { label: 'Status', value: statusBadge }
        ], low));
}
 
document.querySelectorAll('[data-toggle-table]').forEach(button => {
    button.addEventListener('click', () => {
        const key = button.dataset.toggleTable;
        const wrap = $(`${key}-table-wrap`);
        const chart = $(`${key}-chart`);
        const showTable = wrap.hidden;
 
        wrap.hidden = !showTable;
        chart.hidden = showTable;
        button.setAttribute('aria-expanded', String(showTable));
        button.textContent = showTable ? 'Show as chart' : 'Show as table';
    });
});
 
// ---------- Reports ----------
 
function setRange(daysBack) {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - daysBack);
 
    $('range-start').value = toDateInput(start);
    $('range-end').value = toDateInput(end);
 
    document.querySelectorAll('.chip[data-days]').forEach(chip => {
        chip.setAttribute('aria-pressed', String(Number(chip.dataset.days) === daysBack));
    });
}
 
async function runReports() {
    const start = $('range-start').value;
    const end = $('range-end').value;
 
    if (!start || !end) {
        showNotice('Pick a start date and an end date.', true);
        return;
    }
 
    if (start > end) {
        showNotice('The start date must be on or before the end date.', true);
        return;
    }
 
    const query = `?start=${start}&end=${end}`;
    $('range-label').textContent = 'Loading reports…';
 
    try {
        const [summary, sales, hourly, usage, inventory] = await Promise.all([
            api(`/reports/summary${query}`),
            api(`/reports/sales-by-item${query}`),
            api(`/reports/hourly${query}`),
            api(`/reports/product-usage${query}`),
            api('/inventory')
        ]);
 
        state.inventory = inventory.items;
        state.inventoryInfo = inventory;
        state.inventoryLoaded = true;
 
        $('range-label').textContent = start === end
            ? `Showing ${formatDateLabel(start)}`
            : `Showing ${formatDateLabel(start)} – ${formatDateLabel(end)}`;
 
        $('kpi-sales').textContent = formatMoney(summary.subtotal);
        $('kpi-orders').textContent = number.format(summary.orderCount);
        $('kpi-drinks').textContent = number.format(summary.drinks);
        $('kpi-average').textContent = formatMoney(summary.averageTicket);
        $('kpi-tax').textContent = formatMoney(summary.tax);
 
        $('restock-note').textContent =
            'Items at or below their reorder level, or with ' +
            `${inventory.lowDaysLeft} days or less left at the last ` +
            `${inventory.usageWindowDays} days' rate.`;
 
        drawSalesChart(sales.rows);
        drawHourlyChart(hourly.rows);
        renderReportTables(sales.rows, hourly.rows, usage.rows, inventory.items);
        renderInventory();
    } catch (error) {
        $('range-label').textContent = 'Could not load reports.';
        showNotice(error.message, true);
    }
}
 
$('range-form').addEventListener('submit', event => {
    event.preventDefault();
    runReports();
});
 
document.querySelectorAll('.chip[data-days]').forEach(chip => {
    chip.addEventListener('click', () => {
        setRange(Number(chip.dataset.days));
        runReports();
    });
});
 
['range-start', 'range-end'].forEach(id => {
    $(id).addEventListener('change', () => {
        document.querySelectorAll('.chip[data-days]').forEach(chip => {
            chip.setAttribute('aria-pressed', 'false');
        });
    });
});
 
$('go-inventory').addEventListener('click', () => {
    $('inventory-low-only').checked = true;
    renderInventory();
    selectTab($('tab-inventory'), true);
});
 
// ---------- Menu ----------
 
async function loadMenu() {
    try {
        const [menu, inventory] = await Promise.all([
            api('/menu'),
            state.inventoryLoaded ? null : api('/inventory')
        ]);
 
        state.menu = menu.items;
        state.menuLoaded = true;
 
        if (inventory) {
            state.inventory = inventory.items;
            state.inventoryInfo = inventory;
            state.inventoryLoaded = true;
            renderInventory();
        }
 
        renderCategoryOptions();
        renderMenu();
    } catch (error) {
        showNotice(error.message, true);
    }
}
 
function renderCategoryOptions() {
    const categories = [...new Set(state.menu.map(item => item.category))].sort();
    const filter = $('menu-category-filter');
    const current = filter.value;
 
    filter.replaceChildren(
        el('option', { value: '', text: 'All categories' }),
        ...categories.map(category => el('option', { value: category, text: category }))
    );
    filter.value = categories.includes(current) ? current : '';
 
    $('category-options').replaceChildren(
        ...categories.map(category => el('option', { value: category }))
    );
}
 
function recipeSummary(item) {
    if (item.recipe.length === 0) {
        return 'No recipe yet';
    }
 
    return item.recipe.map(line => line.name).join(', ');
}
 
function renderMenu() {
    const search = $('menu-search').value.trim().toLowerCase();
    const category = $('menu-category-filter').value;
    const showInactive = $('menu-show-inactive').checked;
 
    const items = state.menu.filter(item => {
        return item.name.toLowerCase().includes(search) &&
            (!category || item.category === category) &&
            (showInactive || item.isActive);
    });
 
    const body = $('menu-rows');
 
    if (items.length === 0) {
        body.replaceChildren(el('tr', {}, el('td', { colspan: 6 },
            emptyMessage(state.menu.length === 0 ? 'No menu items yet.' : 'No drinks match.'))));
        return;
    }
 
    body.replaceChildren(...items.map(item => {
        const priceInput = el('input', {
            type: 'number', min: '0.01', max: '100', step: '0.01',
            value: item.price.toFixed(2), 'aria-label': `Price for ${item.name}`
        });
 
        const saveButton = el('button', {
            type: 'button', class: 'button small primary', text: 'Save', disabled: true,
            'aria-label': `Save price for ${item.name}`
        });
 
        priceInput.addEventListener('input', () => {
            saveButton.disabled = Number(priceInput.value) === item.price;
        });
 
        const savePrice = async () => {
            if (saveButton.disabled) return;
            saveButton.disabled = true;
 
            try {
                await api(`/menu/${item.id}`, { method: 'PATCH', body: { price: priceInput.value } });
                item.price = Number(Number(priceInput.value).toFixed(2));
                priceInput.value = item.price.toFixed(2);
                showNotice(`${item.name} is now ${formatMoney(item.price)}.`);
            } catch (error) {
                saveButton.disabled = false;
                showNotice(error.message, true);
            }
        };
 
        saveButton.addEventListener('click', savePrice);
        priceInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') savePrice();
        });
 
        const activeToggle = el('input', {
            type: 'checkbox', checked: item.isActive,
            'aria-label': `${item.name} is on sale`
        });
 
        activeToggle.addEventListener('change', async () => {
            const isActive = activeToggle.checked;
 
            try {
                await api(`/menu/${item.id}`, { method: 'PATCH', body: { isActive } });
                item.isActive = isActive;
                showNotice(isActive
                    ? `${item.name} is back on the menu.`
                    : `${item.name} is off the menu. Kiosk and cashier won't show it.`);
                renderMenu();
            } catch (error) {
                activeToggle.checked = !isActive;
                showNotice(error.message, true);
            }
        });
 
        return el('tr', { class: item.isActive ? null : 'inactive' }, [
            el('td', {}, el('strong', { text: item.name })),
            el('td', { text: item.category }),
            el('td', {}, el('div', { class: 'price-cell' }, [priceInput, saveButton])),
            el('td', {}, el('label', { class: 'check' }, [
                activeToggle,
                el('span', { class: item.isActive ? 'badge good' : 'badge off',
                    text: item.isActive ? 'On sale' : 'Hidden' })
            ])),
            el('td', { class: 'recipe-summary', text: recipeSummary(item) }),
            el('td', {}, el('button', {
                type: 'button', class: 'button small', text: 'Edit',
                'aria-label': `Edit ${item.name}`, onclick: () => openMenuDialog(item)
            }))
        ]);
    }));
}
 
['menu-search', 'menu-category-filter', 'menu-show-inactive'].forEach(id => {
    $(id).addEventListener('input', renderMenu);
});
 
// ---------- Menu dialog ----------
 
function inventorySelect(selectedId) {
    const select = el('select', { 'aria-label': 'Ingredient', required: true });
    select.append(el('option', { value: '', text: 'Choose an ingredient…' }));
 
    const byCategory = new Map();
 
    for (const item of state.inventory) {
        if (!byCategory.has(item.category)) byCategory.set(item.category, []);
        byCategory.get(item.category).push(item);
    }
 
    for (const [category, items] of byCategory) {
        select.append(el('optgroup', { label: category }, items.map(item => {
            return el('option', { value: item.id, text: item.name });
        })));
    }
 
    if (selectedId) {
        select.value = String(selectedId);
    }
 
    return select;
}
 
function addRecipeLine(line = null) {
    const select = inventorySelect(line?.inventoryId);
    const quantity = el('input', {
        type: 'number', min: '0', step: 'any', value: line ? line.quantity : '',
        'aria-label': 'Amount per drink', placeholder: 'Amount'
    });
    const unit = el('span', { class: 'unit' });
 
    const updateUnit = () => {
        const item = state.inventory.find(option => option.id === Number(select.value));
        unit.textContent = item ? item.unit : '';
    };
 
    select.addEventListener('change', updateUnit);
    updateUnit();
 
    const row = el('div', { class: 'recipe-line' }, [select, quantity, unit]);
 
    row.append(el('button', {
        type: 'button', class: 'button small', text: 'Remove',
        'aria-label': 'Remove this ingredient',
        onclick: () => {
            row.remove();
            $('add-recipe-line').focus();
        }
    }));
 
    $('recipe-lines').append(row);
    return select;
}
 
function openMenuDialog(item = null) {
    state.editingMenuId = item ? item.id : null;
 
    $('menu-dialog-title').textContent = item ? `Edit ${item.name}` : 'Add menu item';
    $('menu-name').value = item ? item.name : '';
    $('menu-category').value = item ? item.category : '';
    $('menu-price').value = item ? item.price.toFixed(2) : '';
    $('menu-active').checked = item ? item.isActive : true;
    $('menu-form-error').textContent = '';
    $('recipe-lines').replaceChildren();
 
    document.querySelectorAll('#menu-form [aria-invalid]').forEach(input => {
        input.removeAttribute('aria-invalid');
    });
 
    (item ? item.recipe : []).forEach(line => addRecipeLine(line));
 
    $('menu-dialog').showModal();
    $('menu-name').focus();
}
 
function readRecipeLines() {
    const lines = [];
 
    for (const row of $('recipe-lines').children) {
        const [select, quantityInput] = row.querySelectorAll('select, input');
 
        if (!select.value) {
            select.focus();
            throw new Error('Choose an ingredient for every recipe line, or remove it.');
        }
 
        const quantity = Number(quantityInput.value);
 
        if (!(quantity > 0)) {
            quantityInput.focus();
            throw new Error('Every ingredient needs an amount above 0.');
        }
 
        lines.push({ inventoryId: Number(select.value), quantity });
    }
 
    return lines;
}
 
function checkRequired(ids) {
    for (const id of ids) {
        const input = $(id);
        const empty = input.value.trim() === '';
        const badNumber = input.type === 'number' && !input.checkValidity();
 
        if (empty || badNumber) {
            input.setAttribute('aria-invalid', 'true');
            input.focus();
            const label = document.querySelector(`label[for="${id}"]`).textContent;
            throw new Error(empty ? `${label} is required.` : `${label} is not valid.`);
        }
 
        input.removeAttribute('aria-invalid');
    }
}
 
$('menu-form').addEventListener('submit', async event => {
    event.preventDefault();
    const error = $('menu-form-error');
    error.textContent = '';
 
    let body;
 
    try {
        checkRequired(['menu-name', 'menu-category', 'menu-price']);
 
        body = {
            name: $('menu-name').value,
            category: $('menu-category').value,
            price: $('menu-price').value,
            isActive: $('menu-active').checked,
            recipe: readRecipeLines()
        };
    } catch (problem) {
        error.textContent = problem.message;
        return;
    }
 
    const saveButton = $('menu-save');
    saveButton.disabled = true;
 
    try {
        if (state.editingMenuId) {
            await api(`/menu/${state.editingMenuId}`, { method: 'PATCH', body });
            showNotice(`Saved ${body.name.trim()}.`);
        } else {
            await api('/menu', { method: 'POST', body });
            showNotice(`Added ${body.name.trim()} to the menu.`);
        }
 
        $('menu-dialog').close();
        state.menuLoaded = false;
        await loadMenu();
    } catch (problem) {
        error.textContent = problem.message;
    } finally {
        saveButton.disabled = false;
    }
});
 
$('add-recipe-line').addEventListener('click', () => addRecipeLine().focus());
$('add-menu-item').addEventListener('click', () => openMenuDialog());
$('menu-cancel').addEventListener('click', () => $('menu-dialog').close());
 
// ---------- Inventory ----------
 
async function loadInventory() {
    try {
        const inventory = await api('/inventory');
        state.inventory = inventory.items;
        state.inventoryInfo = inventory;
        state.inventoryLoaded = true;
        renderInventory();
    } catch (error) {
        showNotice(error.message, true);
    }
}
 
function renderInventory() {
    const search = $('inventory-search').value.trim().toLowerCase();
    const lowOnly = $('inventory-low-only').checked;
 
    const items = state.inventory.filter(item => {
        return item.name.toLowerCase().includes(search) && (!lowOnly || item.isLow);
    });
 
    const body = $('inventory-rows');
 
    if (items.length === 0) {
        body.replaceChildren(el('tr', {}, el('td', { colspan: 7 },
            emptyMessage(lowOnly ? 'Nothing needs restocking.' : 'No inventory items match.'))));
        return;
    }
 
    body.replaceChildren(...items.map(item => {
        const amount = el('input', {
            type: 'number', min: '0', step: 'any', placeholder: `+ ${item.unit}`,
            'aria-label': `Amount of ${item.name} to add, in ${item.unit}`
        });
 
        const restock = async () => {
            const add = Number(amount.value);
 
            if (!(add > 0)) {
                showNotice('Enter an amount above 0 to restock.', true);
                amount.focus();
                return;
            }
 
            try {
                await api(`/inventory/${item.id}`, { method: 'PATCH', body: { add } });
                showNotice(`Added ${formatAmount(add, item.unit)} of ${item.name}.`);
                await loadInventory();
                $('inventory-search').focus();
            } catch (error) {
                showNotice(error.message, true);
            }
        };
 
        amount.addEventListener('keydown', event => {
            if (event.key === 'Enter') restock();
        });
 
        return el('tr', {}, [
            el('td', {}, el('strong', { text: item.name })),
            el('td', { text: item.category }),
            el('td', { class: 'num', text: formatAmount(item.onHand, item.unit) }),
            el('td', { class: 'num muted', text: formatAmount(item.threshold, item.unit) }),
            el('td', { class: 'num', text: formatDaysLeft(item) }),
            el('td', {}, statusBadge(item)),
            el('td', {}, el('div', { class: 'restock-cell' }, [
                amount,
                el('button', {
                    type: 'button', class: 'button small primary', text: 'Restock',
                    'aria-label': `Restock ${item.name}`, onclick: restock
                })
            ]))
        ]);
    }));
}
 
['inventory-search', 'inventory-low-only'].forEach(id => {
    $(id).addEventListener('input', renderInventory);
});
 
function openInventoryDialog() {
    const categories = [...new Set(state.inventory.map(item => item.category))].sort();
 
    $('inventory-category-options').replaceChildren(
        ...categories.map(category => el('option', { value: category }))
    );
    $('inventory-unit').replaceChildren(
        ...state.inventoryInfo.units.map(unit => el('option', { value: unit, text: unit }))
    );
 
    $('inventory-name').value = '';
    $('inventory-category').value = '';
    $('inventory-on-hand').value = '0';
    $('inventory-form-error').textContent = '';
 
    $('inventory-dialog').showModal();
    $('inventory-name').focus();
}
 
$('inventory-form').addEventListener('submit', async event => {
    event.preventDefault();
    const error = $('inventory-form-error');
    error.textContent = '';
 
    try {
        checkRequired(['inventory-name', 'inventory-category', 'inventory-on-hand']);
 
        const name = $('inventory-name').value.trim();
 
        await api('/inventory', {
            method: 'POST',
            body: {
                name,
                category: $('inventory-category').value,
                unit: $('inventory-unit').value,
                onHand: Number($('inventory-on-hand').value)
            }
        });
 
        $('inventory-dialog').close();
        showNotice(`Added ${name} to inventory.`);
        await loadInventory();
    } catch (problem) {
        error.textContent = problem.message;
    }
});
 
$('add-inventory-item').addEventListener('click', openInventoryDialog);
$('inventory-cancel').addEventListener('click', () => $('inventory-dialog').close());
 
// ---------- Start ----------
 
tickClock();
setInterval(tickClock, 30000);
setRange(29);
runReports();
 