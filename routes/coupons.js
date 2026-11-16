// Slot machine coupons for the customer kiosk.
//
// The server decides every spin, so the odds can't be changed from the browser.
// A win creates a one-time coupon that expires after COUPON_MINUTES and can only
// be used on one order. Mounted inside routes/kiosk.js, so the URLs are:
//   POST /api/kiosk/spin            spin the slot machine
//   GET  /api/kiosk/coupons/:code   check a coupon is still good

const crypto = require('crypto');
const express = require('express');
const pool = require('../db');

const router = express.Router();

const COUPON_MINUTES = 15;

// Matches TOPPING_PRICE_CENTS in routes/kiosk.js.
const FREE_TOPPING_CENTS = 75;

// The reel symbols. The kiosk draws them; names are read out to screen readers.
const BOBA = 'boba';
const FRUITS = ['strawberry', 'mango', 'matcha', 'lemon'];
const SYMBOLS = [BOBA, ...FRUITS];

// weight = chance out of 100. About 1 in 3 spins wins something.
const PRIZES = [
    {
        id: 'jackpot', weight: 5, type: 'percent', value: 25,
        label: '25% off your order', rule: 'Three boba'
    },
    {
        id: 'fruit', weight: 20, type: 'percent', value: 10,
        label: '10% off your order', rule: 'Three of a kind'
    },
    {
        id: 'topping', weight: 10, type: 'fixed', value: FREE_TOPPING_CENTS,
        label: 'A free topping ($0.75 off)', rule: 'Two boba'
    },
    { id: 'none', weight: 65 }
];

// Thrown when a coupon can't be used, so the kiosk can tell the customer why.
class CouponError extends Error {}

function randomInt(max) {
    return crypto.randomInt(max);
}

function pickPrize() {
    const total = PRIZES.reduce((sum, prize) => sum + prize.weight, 0);
    let roll = randomInt(total);

    for (const prize of PRIZES) {
        if (roll < prize.weight) return prize;
        roll -= prize.weight;
    }

    return PRIZES[PRIZES.length - 1];
}

function shuffle(list) {
    const copy = [...list];

    for (let i = copy.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return copy;
}

// Picks three reel symbols that show the prize that was already decided.
function reelsFor(prize) {
    if (prize.id === 'jackpot') {
        return [BOBA, BOBA, BOBA];
    }

    if (prize.id === 'fruit') {
        const fruit = FRUITS[randomInt(FRUITS.length)];
        return [fruit, fruit, fruit];
    }

    if (prize.id === 'topping') {
        return shuffle([BOBA, BOBA, FRUITS[randomInt(FRUITS.length)]]);
    }

    // A losing spin: no three of a kind and fewer than two boba.
    while (true) {
        const reels = [0, 1, 2].map(() => SYMBOLS[randomInt(SYMBOLS.length)]);
        const allSame = reels.every(symbol => symbol === reels[0]);
        const bobaCount = reels.filter(symbol => symbol === BOBA).length;

        if (!allSame && bobaCount < 2) return reels;
    }
}

function makeCode() {
    // No 0/O or 1/I, so codes are easy to read aloud.
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'LUCKY-';

    for (let i = 0; i < 4; i++) {
        code += letters[randomInt(letters.length)];
    }

    return code;
}

function isCode(value) {
    return typeof value === 'string' && /^LUCKY-[A-Z0-9]{4}$/.test(value);
}

// Creates the coupons table the first time it's needed.
let tableReady = null;

function ensureTable() {
    if (!tableReady) {
        tableReady = pool.query(
            `CREATE TABLE IF NOT EXISTS coupons (
                 coupon_id         SERIAL PRIMARY KEY,
                 code              TEXT NOT NULL UNIQUE,
                 discount_type     TEXT NOT NULL
                                   CHECK (discount_type IN ('percent', 'fixed')),
                 discount_value    INTEGER NOT NULL,
                 label             TEXT NOT NULL,
                 created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
                 expires_at        TIMESTAMP NOT NULL,
                 redeemed_order_id INTEGER,
                 amount_off        NUMERIC(8, 2),
                 redeemed_at       TIMESTAMP
             )`
        ).catch(error => {
            tableReady = null;
            throw error;
        });
    }

    return tableReady;
}

function toCoupon(row) {
    return {
        id: row.coupon_id,
        code: row.code,
        type: row.discount_type,
        value: row.discount_value,
        label: row.label,
        expiresInSeconds: Math.max(0, Math.floor(Number(row.seconds_left)))
    };
}

// How many cents a coupon takes off a subtotal. Never more than the subtotal.
function discountCents(coupon, subtotalCents) {
    if (!coupon) return 0;

    const cents = coupon.type === 'percent'
        ? Math.round(subtotalCents * coupon.value / 100)
        : coupon.value;

    return Math.min(cents, subtotalCents);
}

async function createCoupon(prize) {
    // Retry on the rare chance a code is already taken.
    for (let attempt = 0; attempt < 5; attempt++) {
        const result = await pool.query(
            `INSERT INTO coupons (code, discount_type, discount_value, label, expires_at)
             VALUES ($1, $2, $3, $4, NOW() + ($5 || ' minutes')::interval)
             ON CONFLICT (code) DO NOTHING
             RETURNING coupon_id, code, discount_type, discount_value, label,
                       EXTRACT(EPOCH FROM expires_at - NOW()) AS seconds_left`,
            [makeCode(), prize.type, prize.value, prize.label, String(COUPON_MINUTES)]
        );

        if (result.rowCount === 1) {
            return toCoupon(result.rows[0]);
        }
    }

    throw new Error('Could not make a unique coupon code.');
}

// Called inside the order's transaction. Locks the coupon so it can't be used
// by two orders at once, and throws a CouponError if it can't be used at all.
async function lockForOrder(client, code) {
    if (!isCode(code)) {
        throw new CouponError('That coupon code is not valid.');
    }

    await ensureTable();

    const result = await client.query(
        `SELECT coupon_id, code, discount_type, discount_value, label,
                redeemed_order_id,
                EXTRACT(EPOCH FROM expires_at - NOW()) AS seconds_left
         FROM coupons
         WHERE code = $1
         FOR UPDATE`,
        [code]
    );

    const row = result.rows[0];

    if (!row) {
        throw new CouponError('That coupon code is not valid.');
    }

    if (row.redeemed_order_id !== null) {
        throw new CouponError('That coupon has already been used.');
    }

    if (Number(row.seconds_left) <= 0) {
        throw new CouponError('That coupon has expired.');
    }

    return toCoupon(row);
}

async function markRedeemed(client, coupon, orderId, centsOff) {
    await client.query(
        `UPDATE coupons
         SET redeemed_order_id = $2, amount_off = $3, redeemed_at = NOW()
         WHERE coupon_id = $1`,
        [coupon.id, orderId, (centsOff / 100).toFixed(2)]
    );
}

router.post('/spin', async (req, res) => {
    try {
        await ensureTable();

        const prize = pickPrize();
        const reels = reelsFor(prize);
        const coupon = prize.id === 'none' ? null : await createCoupon(prize);

        res.status(201).json({
            reels,
            won: coupon !== null,
            rule: prize.rule || null,
            coupon
        });
    } catch (error) {
        console.error('Could not spin the slot machine:', error);
        res.status(500).json({ message: 'The slot machine is taking a break. Try again.' });
    }
});

router.get('/coupons/:code', async (req, res) => {
    try {
        const code = req.params.code;

        if (!isCode(code)) {
            res.status(404).json({ message: 'That coupon code is not valid.' });
            return;
        }

        await ensureTable();

        const result = await pool.query(
            `SELECT coupon_id, code, discount_type, discount_value, label,
                    redeemed_order_id,
                    EXTRACT(EPOCH FROM expires_at - NOW()) AS seconds_left
             FROM coupons
             WHERE code = $1`,
            [code]
        );

        const row = result.rows[0];

        if (!row || row.redeemed_order_id !== null || Number(row.seconds_left) <= 0) {
            res.status(404).json({ message: 'That coupon can no longer be used.' });
            return;
        }

        res.json({ coupon: toCoupon(row) });
    } catch (error) {
        console.error('Could not check a coupon:', error);
        res.status(500).json({ message: 'Could not check the coupon.' });
    }
});

module.exports = {
    router,
    CouponError,
    lockForOrder,
    markRedeemed,
    discountCents,
    PRIZES
};