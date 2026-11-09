const express = require('express');
const pool = require('../db');
 
const router = express.Router();
 
// Orders with these statuses are left out of every report.
const VOID_STATUSES = ['cancelled', 'canceled', 'refunded', 'voided', 'void'];
 
// How many days of sales the restock report uses to estimate daily usage.
const USAGE_WINDOW_DAYS = 14;
 
// Days of stock left at or below which an item is flagged for restock.
const LOW_DAYS_LEFT = 3;
 
// Used when the inventory table has no reorder-level column of its own.
const DEFAULT_THRESHOLDS = { g: 2000, oz: 64, each: 100 };
 
// If the inventory table has one of these columns, it is used as the reorder level.
const THRESHOLD_COLUMNS = [
    'reorder_level', 'reorder_threshold', 'reorder_point', 'min_quantity',
    'minimum_quantity', 'par_level', 'restock_threshold', 'low_stock_threshold'
];
 
const UNITS = ['g', 'oz', 'each'];
 
// Thrown when the request itself is wrong, so the page gets a 400 and not a 500.
class BadRequestError extends Error {}
 
// ---------- Helpers ----------
 
function isDateString(value) {
    return typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(value));
}
 
function readDateRange(query) {
    const { start, end } = query;
 
    if (!isDateString(start) || !isDateString(end)) {
        throw new BadRequestError('Pick a start date and an end date.');
    }
 
    if (start > end) {
        throw new BadRequestError('The start date must be on or before the end date.');
    }
 
    return { start, end };
}
 
function readId(value) {
    const id = Number(value);
 
    if (!Number.isInteger(id) || id < 1) {
        throw new BadRequestError('That id is not valid.');
    }
 
    return id;
}
 
function readText(value, label, maxLength = 60) {
    const text = typeof value === 'string' ? value.trim() : '';
 
    if (text.length === 0) {
        throw new BadRequestError(`${label} is required.`);
    }
 
    if (text.length > maxLength) {
        throw new BadRequestError(`${label} must be ${maxLength} characters or fewer.`);
    }
 
    return text;
}
 
function readPrice(value) {
    const price = Number(value);
 
    if (!Number.isFinite(price) || price <= 0 || price > 100) {
        throw new BadRequestError('Price must be between $0.01 and $100.00.');
    }
 
    return price.toFixed(2);
}
 
function readQuantity(value, label) {
    const quantity = Number(value);
 
    if (!Number.isFinite(quantity) || quantity < 0 || quantity > 1000000) {
        throw new BadRequestError(`${label} must be a number 0 or greater.`);
    }
 
    return quantity;
}
 
// A recipe is a list of { inventoryId, quantity } lines.
function readRecipe(value) {
    if (value === undefined) {
        return undefined;
    }
 
    if (!Array.isArray(value)) {
        throw new BadRequestError('The recipe is not valid.');
    }
 
    const seen = new Set();
 
    return value.map(line => {
        const inventoryId = readId(line?.inventoryId);
        const quantity = Number(line?.quantity);
 
        if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new BadRequestError('Every ingredient needs an amount above 0.');
        }
 
        if (seen.has(inventoryId)) {
            throw new BadRequestError('An ingredient is listed twice in the recipe.');
        }
 
        seen.add(inventoryId);
 
        return { inventoryId, quantity };
    });
}
 
// Some Project 2 tables use SERIAL ids and some don't, so check before inserting.
const idDefaultCache = new Map();
 
async function idHasDefault(db, table, column) {
    const key = `${table}.${column}`;
 
    if (!idDefaultCache.has(key)) {
        const result = await db.query(
            `SELECT column_default, is_identity
             FROM information_schema.columns
             WHERE table_name = $1 AND column_name = $2
             LIMIT 1`,
            [table, column]
        );
 
        const row = result.rows[0];
 
        idDefaultCache.set(
            key,
            Boolean(row && (row.column_default || row.is_identity === 'YES'))
        );
    }
 
    return idDefaultCache.get(key);
}
 
// Inserts a row and returns its new id, whether or not the id column is SERIAL.
// Table and column names here only ever come from this file, never the browser.
async function insertRow(client, table, idColumn, values) {
    const columns = Object.keys(values);
    const params = Object.values(values);
 
    if (!(await idHasDefault(client, table, idColumn))) {
        await client.query(`LOCK TABLE ${table} IN EXCLUSIVE MODE`);
 
        const next = await client.query(
            `SELECT COALESCE(MAX(${idColumn}), 0) + 1 AS id FROM ${table}`
        );
 
        columns.unshift(idColumn);
        params.unshift(next.rows[0].id);
    }
 
    const placeholders = params.map((_, index) => `$${index + 1}`);
 
    const result = await client.query(
        `INSERT INTO ${table} (${columns.join(', ')})
         VALUES (${placeholders.join(', ')})
         RETURNING ${idColumn}`,
        params
    );
 
    return result.rows[0][idColumn];
}
 
let thresholdColumnPromise = null;
 
// Finds the inventory table's reorder-level column, if it has one.
function getThresholdColumn() {
    if (!thresholdColumnPromise) {
        thresholdColumnPromise = pool.query(
            `SELECT column_name
             FROM information_schema.columns
             WHERE table_name = 'inventory' AND column_name = ANY($1::text[])`,
            [THRESHOLD_COLUMNS]
        ).then(result => {
            const found = result.rows.map(row => row.column_name);
 
            return THRESHOLD_COLUMNS.find(name => found.includes(name)) || null;
        }).catch(error => {
            thresholdColumnPromise = null;
            throw error;
        });
    }
 
    return thresholdColumnPromise;
}
 
async function withTransaction(work) {
    const client = await pool.connect();
 
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
 
async function replaceRecipe(client, menuItemId, recipe) {
    await client.query(
        'DELETE FROM menu_item_ingredients WHERE menu_item_id = $1',
        [menuItemId]
    );
 
    for (const line of recipe) {
        await client.query(
            `INSERT INTO menu_item_ingredients (menu_item_id, inventory_id, quantity_used)
             VALUES ($1, $2, $3)`,
            [menuItemId, line.inventoryId, line.quantity]
        );
    }
}
 
async function nameIsTaken(db, table, idColumn, name, exceptId = null) {
    const result = await db.query(
        `SELECT 1 FROM ${table}
         WHERE LOWER(name) = LOWER($1) AND ($2::int IS NULL OR ${idColumn} <> $2::int)
         LIMIT 1`,
        [name, exceptId]
    );
 
    return result.rowCount > 0;
}
 
// Wraps a route so every error becomes a clear JSON message.
function handle(route) {
    return async (req, res) => {
        try {
            await route(req, res);
        } catch (error) {
            if (error instanceof BadRequestError) {
                res.status(400).json({ message: error.message });
                return;
            }
 
            // not_null_violation: a column we don't fill in needs a value.
            if (error.code === '23502') {
                res.status(400).json({
                    message: `The database needs a value for "${error.column}".`
                });
                return;
            }
 
            // foreign_key_violation: e.g. an ingredient that no longer exists.
            if (error.code === '23503') {
                res.status(400).json({
                    message: 'Something this refers to no longer exists.'
                });
                return;
            }
 
            console.error(`Manager ${req.method} ${req.originalUrl} failed:`, error);
            res.status(500).json({ message: 'Something went wrong on the server.' });
        }
    };
}
 
// SQL shared by every report: orders inside the date range that were not voided.
// $1 = start date, $2 = end date, $3 = void statuses.
const ORDER_FILTER = `
    o.order_time >= $1::date
    AND o.order_time < ($2::date + 1)
    AND LOWER(COALESCE(o.status, '')) <> ALL($3::text[])
`;
 
// ---------- Menu ----------
 
router.get('/menu', handle(async (req, res) => {
    const [items, recipeLines] = await Promise.all([
        pool.query(
            `SELECT menu_item_id, name, category, base_price, is_active
             FROM menu_items
             ORDER BY category, name`
        ),
        pool.query(
            `SELECT mii.menu_item_id, mii.inventory_id, mii.quantity_used,
                    i.name, i.unit
             FROM menu_item_ingredients mii
             JOIN inventory i ON i.inventory_id = mii.inventory_id
             ORDER BY i.category, i.name`
        )
    ]);
 
    res.json({
        items: items.rows.map(item => ({
            id: item.menu_item_id,
            name: item.name,
            category: item.category,
            price: Number(item.base_price),
            isActive: item.is_active,
            recipe: recipeLines.rows
                .filter(line => line.menu_item_id === item.menu_item_id)
                .map(line => ({
                    inventoryId: line.inventory_id,
                    name: line.name,
                    unit: line.unit,
                    quantity: Number(line.quantity_used)
                }))
        }))
    });
}));
 
router.post('/menu', handle(async (req, res) => {
    const name = readText(req.body?.name, 'Name');
    const category = readText(req.body?.category, 'Category', 40);
    const price = readPrice(req.body?.price);
    const isActive = req.body?.isActive !== false;
    const recipe = readRecipe(req.body?.recipe) || [];
 
    if (await nameIsTaken(pool, 'menu_items', 'menu_item_id', name)) {
        throw new BadRequestError(`There is already a menu item named "${name}".`);
    }
 
    const id = await withTransaction(async client => {
        const newId = await insertRow(client, 'menu_items', 'menu_item_id', {
            name,
            category,
            base_price: price,
            is_active: isActive
        });
 
        await replaceRecipe(client, newId, recipe);
 
        return newId;
    });
 
    res.status(201).json({ id });
}));
 
router.patch('/menu/:id', handle(async (req, res) => {
    const id = readId(req.params.id);
    const body = req.body || {};
    const updates = {};
 
    if (body.name !== undefined) {
        updates.name = readText(body.name, 'Name');
 
        if (await nameIsTaken(pool, 'menu_items', 'menu_item_id', updates.name, id)) {
            throw new BadRequestError(
                `There is already a menu item named "${updates.name}".`
            );
        }
    }
 
    if (body.category !== undefined) {
        updates.category = readText(body.category, 'Category', 40);
    }
 
    if (body.price !== undefined) {
        updates.base_price = readPrice(body.price);
    }
 
    if (body.isActive !== undefined) {
        updates.is_active = Boolean(body.isActive);
    }
 
    const recipe = readRecipe(body.recipe);
 
    if (Object.keys(updates).length === 0 && recipe === undefined) {
        throw new BadRequestError('Nothing was changed.');
    }
 
    const found = await withTransaction(async client => {
        const columns = Object.keys(updates);
 
        if (columns.length > 0) {
            const sets = columns.map((column, index) => `${column} = $${index + 2}`);
            const result = await client.query(
                `UPDATE menu_items SET ${sets.join(', ')} WHERE menu_item_id = $1`,
                [id, ...Object.values(updates)]
            );
 
            if (result.rowCount === 0) {
                return false;
            }
        } else {
            const result = await client.query(
                'SELECT 1 FROM menu_items WHERE menu_item_id = $1',
                [id]
            );
 
            if (result.rowCount === 0) {
                return false;
            }
        }
 
        if (recipe !== undefined) {
            await replaceRecipe(client, id, recipe);
        }
 
        return true;
    });
 
    if (!found) {
        res.status(404).json({ message: 'That menu item no longer exists.' });
        return;
    }
 
    res.json({ id });
}));
 
// ---------- Inventory ----------
 
async function loadInventory() {
    const thresholdColumn = await getThresholdColumn();
    const thresholdSelect = thresholdColumn
        ? `, i.${thresholdColumn} AS threshold`
        : ', NULL AS threshold';
 
    // Average daily usage over the last USAGE_WINDOW_DAYS days, from recipes.
    const result = await pool.query(
        `SELECT i.inventory_id, i.name, i.category, i.unit, i.quantity_on_hand
                ${thresholdSelect},
                COALESCE(usage.used, 0) AS recent_use
         FROM inventory i
         LEFT JOIN (
             SELECT mii.inventory_id, SUM(oi.quantity * mii.quantity_used) AS used
             FROM orders o
             JOIN order_items oi ON oi.order_id = o.order_id
             JOIN menu_item_ingredients mii ON mii.menu_item_id = oi.menu_item_id
             WHERE o.order_time >= NOW() - ($1 || ' days')::interval
               AND LOWER(COALESCE(o.status, '')) <> ALL($2::text[])
             GROUP BY mii.inventory_id
         ) usage ON usage.inventory_id = i.inventory_id
         ORDER BY i.category, i.name`,
        [String(USAGE_WINDOW_DAYS), VOID_STATUSES]
    );
 
    return result.rows.map(row => {
        const onHand = Number(row.quantity_on_hand);
        const threshold = row.threshold === null
            ? (DEFAULT_THRESHOLDS[row.unit] ?? 0)
            : Number(row.threshold);
        const dailyUse = Number(row.recent_use) / USAGE_WINDOW_DAYS;
        const daysLeft = dailyUse > 0 ? onHand / dailyUse : null;
 
        return {
            id: row.inventory_id,
            name: row.name,
            category: row.category,
            unit: row.unit,
            onHand,
            threshold,
            dailyUse,
            daysLeft,
            isLow: onHand <= threshold ||
                (daysLeft !== null && daysLeft <= LOW_DAYS_LEFT)
        };
    });
}
 
router.get('/inventory', handle(async (req, res) => {
    res.json({
        items: await loadInventory(),
        usageWindowDays: USAGE_WINDOW_DAYS,
        lowDaysLeft: LOW_DAYS_LEFT,
        units: UNITS
    });
}));
 
router.post('/inventory', handle(async (req, res) => {
    const name = readText(req.body?.name, 'Name');
    const category = readText(req.body?.category, 'Category', 40);
    const unit = req.body?.unit;
    const onHand = readQuantity(req.body?.onHand, 'Starting quantity');
 
    if (!UNITS.includes(unit)) {
        throw new BadRequestError(`Unit must be one of: ${UNITS.join(', ')}.`);
    }
 
    if (await nameIsTaken(pool, 'inventory', 'inventory_id', name)) {
        throw new BadRequestError(`There is already an inventory item named "${name}".`);
    }
 
    const id = await withTransaction(client => {
        return insertRow(client, 'inventory', 'inventory_id', {
            name,
            category,
            unit,
            quantity_on_hand: onHand
        });
    });
 
    res.status(201).json({ id });
}));
 
// Send { add: n } to restock by n, or { onHand: n } to set the count after a stock take.
router.patch('/inventory/:id', handle(async (req, res) => {
    const id = readId(req.params.id);
    const body = req.body || {};
    let result;
 
    if (body.add !== undefined) {
        const add = readQuantity(body.add, 'Amount to add');
 
        if (add === 0) {
            throw new BadRequestError('Amount to add must be above 0.');
        }
 
        result = await pool.query(
            `UPDATE inventory SET quantity_on_hand = quantity_on_hand + $2
             WHERE inventory_id = $1
             RETURNING quantity_on_hand`,
            [id, add]
        );
    } else if (body.onHand !== undefined) {
        result = await pool.query(
            `UPDATE inventory SET quantity_on_hand = $2
             WHERE inventory_id = $1
             RETURNING quantity_on_hand`,
            [id, readQuantity(body.onHand, 'Quantity on hand')]
        );
    } else {
        throw new BadRequestError('Send an amount to add or a new count.');
    }
 
    if (result.rowCount === 0) {
        res.status(404).json({ message: 'That inventory item no longer exists.' });
        return;
    }
 
    res.json({ id, onHand: Number(result.rows[0].quantity_on_hand) });
}));
 
// ---------- Reports ----------
 
router.get('/reports/summary', handle(async (req, res) => {
    const { start, end } = readDateRange(req.query);
 
    const [orders, drinks] = await Promise.all([
        pool.query(
            `SELECT COUNT(*) AS order_count,
                    COALESCE(SUM(o.subtotal), 0) AS subtotal,
                    COALESCE(SUM(o.tax), 0) AS tax,
                    COALESCE(SUM(o.total), 0) AS total
             FROM orders o
             WHERE ${ORDER_FILTER}`,
            [start, end, VOID_STATUSES]
        ),
        pool.query(
            `SELECT COALESCE(SUM(oi.quantity), 0) AS drinks
             FROM orders o
             JOIN order_items oi ON oi.order_id = o.order_id
             WHERE ${ORDER_FILTER}`,
            [start, end, VOID_STATUSES]
        )
    ]);
 
    const row = orders.rows[0];
    const orderCount = Number(row.order_count);
    const subtotal = Number(row.subtotal);
 
    res.json({
        orderCount,
        drinks: Number(drinks.rows[0].drinks),
        subtotal,
        tax: Number(row.tax),
        total: Number(row.total),
        averageTicket: orderCount > 0 ? subtotal / orderCount : 0
    });
}));
 
router.get('/reports/sales-by-item', handle(async (req, res) => {
    const { start, end } = readDateRange(req.query);
 
    const result = await pool.query(
        `SELECT m.menu_item_id, m.name, m.category,
                SUM(oi.quantity) AS quantity,
                SUM(oi.quantity * oi.unit_price) AS revenue
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.order_id
         JOIN menu_items m ON m.menu_item_id = oi.menu_item_id
         WHERE ${ORDER_FILTER}
         GROUP BY m.menu_item_id, m.name, m.category
         ORDER BY revenue DESC, m.name`,
        [start, end, VOID_STATUSES]
    );
 
    res.json({
        rows: result.rows.map(row => ({
            id: row.menu_item_id,
            name: row.name,
            category: row.category,
            quantity: Number(row.quantity),
            revenue: Number(row.revenue)
        }))
    });
}));
 
router.get('/reports/hourly', handle(async (req, res) => {
    const { start, end } = readDateRange(req.query);
 
    const result = await pool.query(
        `SELECT EXTRACT(HOUR FROM o.order_time)::int AS hour,
                COUNT(*) AS order_count,
                COALESCE(SUM(o.subtotal), 0) AS revenue
         FROM orders o
         WHERE ${ORDER_FILTER}
         GROUP BY hour
         ORDER BY hour`,
        [start, end, VOID_STATUSES]
    );
 
    res.json({
        rows: result.rows.map(row => ({
            hour: row.hour,
            orderCount: Number(row.order_count),
            revenue: Number(row.revenue)
        }))
    });
}));
 
// Ingredients used by recipes. Extra toppings aren't stored per order, so they
// show up in inventory counts but not in this report.
router.get('/reports/product-usage', handle(async (req, res) => {
    const { start, end } = readDateRange(req.query);
 
    const result = await pool.query(
        `SELECT i.inventory_id, i.name, i.category, i.unit,
                SUM(oi.quantity * mii.quantity_used) AS used
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.order_id
         JOIN menu_item_ingredients mii ON mii.menu_item_id = oi.menu_item_id
         JOIN inventory i ON i.inventory_id = mii.inventory_id
         WHERE ${ORDER_FILTER}
         GROUP BY i.inventory_id, i.name, i.category, i.unit
         ORDER BY i.category, used DESC`,
        [start, end, VOID_STATUSES]
    );
 
    res.json({
        rows: result.rows.map(row => ({
            id: row.inventory_id,
            name: row.name,
            category: row.category,
            unit: row.unit,
            used: Number(row.used)
        }))
    });
}));
 
module.exports = router;