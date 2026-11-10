'use strict';

const express = require('express');
const pool = require('../db');

const router = express.Router();
const ORDER_WINDOW_HOURS = 24;
const MAX_ORDERS = 120;
const NEXT_STATUS = Object.freeze({
    new: 'preparing',
    preparing: 'ready',
    ready: 'served'
});

// Track kitchen workflow separately from orders.status (which represents payment).
// This is created on first access; the database account needs CREATE permission.
let tableReady;
function ensureTable() {
    if (!tableReady) {
        tableReady = pool.query(`
            CREATE TABLE IF NOT EXISTS kitchen_order_status (
                order_id BIGINT PRIMARY KEY REFERENCES orders(order_id) ON DELETE CASCADE,
                status VARCHAR(20) NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new', 'preparing', 'ready', 'served')),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `).catch(error => {
            tableReady = null; // Allow retry after a transient database error.
            throw error;
        });
    }
    return tableReady;
}

// Orders are stored in America/Chicago local time by the existing POS system.
const RECENT_ORDER_WHERE = `
    o.order_time >=
        (CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago') - INTERVAL '24 hours'
    AND LOWER(COALESCE(o.status, '')) NOT IN
        ('void', 'voided', 'cancelled', 'canceled', 'refunded')
`;

router.get('/orders', async (req, res) => {
    try {
        await ensureTable();
        const result = await pool.query(`
            WITH recent AS (
                SELECT o.order_id, o.order_time
                FROM orders o
                WHERE ${RECENT_ORDER_WHERE}
                ORDER BY o.order_time DESC, o.order_id DESC
                LIMIT $1
            )
            SELECT r.order_id,
                   TO_CHAR(r.order_time, 'HH12:MI AM') AS placed_time,
                   GREATEST(0, EXTRACT(EPOCH FROM (
                       (CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago') -
                       r.order_time
                   )))::int AS age_seconds,
                   COALESCE(k.status, 'new') AS kitchen_status,
                   oi.quantity,
                   oi.size,
                   oi.sugar_level,
                   oi.ice_level,
                   COALESCE(m.name, 'Item #' || oi.menu_item_id::text)
                       AS item_name
            FROM recent r
            JOIN order_items oi ON oi.order_id = r.order_id
            LEFT JOIN menu_items m ON m.menu_item_id = oi.menu_item_id
            LEFT JOIN kitchen_order_status k ON k.order_id = r.order_id
            ORDER BY r.order_time ASC, r.order_id ASC, oi.menu_item_id
        `, [MAX_ORDERS]);

        const ordersById = new Map();
        for (const row of result.rows) {
            const id = Number(row.order_id);
            if (!ordersById.has(id)) {
                ordersById.set(id, {
                    id,
                    placedTime: row.placed_time,
                    ageSeconds: Number(row.age_seconds),
                    status: row.kitchen_status,
                    items: []
                });
            }
            ordersById.get(id).items.push({
                name: row.item_name,
                quantity: Number(row.quantity),
                size: row.size,
                sugarLevel: row.sugar_level,
                iceLevel: row.ice_level
            });
        }
        res.set('Cache-Control', 'no-store');
        res.json({ orders: Array.from(ordersById.values()) });
    } catch (error) {
        console.error('Kitchen: could not load orders:', error);
        res.status(500).json({ message: 'Could not load kitchen orders.' });
    }
});

router.patch('/orders/:id/status', async (req, res) => {
    const idText = req.params.id;
    const id = Number(idText);
    const expectedStatus = req.body?.expectedStatus;
    const nextStatus = req.body?.nextStatus;

    if (!/^[1-9]\d*$/.test(idText) || !Number.isSafeInteger(id) ||
            NEXT_STATUS[expectedStatus] !== nextStatus) {
        return res.status(400).json({ message: 'Invalid order or status transition.' });
    }

    // Optional shared code for a classroom demo. Configure KITCHEN_ACCESS_CODE
    // on Render before deploying outside a controlled classroom environment.
    if (process.env.KITCHEN_ACCESS_CODE &&
            req.get('X-Kitchen-Code') !== process.env.KITCHEN_ACCESS_CODE) {
        return res.status(401).json({ message: 'Kitchen access code required.' });
    }

    try {
        await ensureTable();
        const order = await pool.query(`
            SELECT o.order_id FROM orders o
            WHERE o.order_id = $1 AND ${RECENT_ORDER_WHERE}
        `, [id]);
        if (order.rowCount === 0) {
            return res.status(404).json({ message: 'Order is no longer in the kitchen queue.' });
        }

        // The WHERE clause prevents one station from overwriting a newer status.
        const changed = await pool.query(`
            INSERT INTO kitchen_order_status (order_id, status, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (order_id) DO UPDATE
                SET status = EXCLUDED.status, updated_at = NOW()
                WHERE kitchen_order_status.status = $3
            RETURNING status
        `, [id, nextStatus, expectedStatus]);

        if (changed.rowCount === 0) {
            return res.status(409).json({
                message: 'Someone else already moved this order. Refresh to see its status.'
            });
        }
        res.set('Cache-Control', 'no-store');
        return res.json({ id, status: changed.rows[0].status });
    } catch (error) {
        console.error('Kitchen: could not update order:', error);
        return res.status(500).json({ message: 'Could not update kitchen order.' });
    }
});

module.exports = router;
