'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const handlers = {};
const calls = [];
let failAt = null;

const db = {
    async query(sql, params = []) {
        return runQuery(sql, params);
    },
    async connect() {
        return {
            query: runQuery,
            release() {}
        };
    }
};

async function runQuery(sql, params = []) {
    calls.push({ sql, params });

    if (failAt && sql.includes(failAt)) {
        throw new Error('Simulated database failure');
    }

    if (/SELECT menu_item_id, name, category, base_price/.test(sql)) {
        return {
            rows: [{
                menu_item_id: 25,
                name: 'Coffee w/ Ice Cream',
                category: 'coffee',
                base_price: '6.75'
            }]
        };
    }

    if (/SELECT i.inventory_id, i.name, i.unit/.test(sql)) {
        return { rows: [] };
    }

    if (/SELECT mii.menu_item_id, i.inventory_id/.test(sql)) {
        return { rows: [] };
    }

    if (/INSERT INTO orders/.test(sql)) {
        return { rows: [{ order_id: 123 }] };
    }

    if (
        /INSERT INTO order_items/.test(sql) ||
        /UPDATE inventory/.test(sql) ||
        /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())
    ) {
        return { rows: [], rowCount: 1 };
    }

    throw new Error('Unexpected SQL: ' + sql);
}

const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
    if (request === 'express') {
        return {
            Router() {
                return {
                    use() {},
                    get(url, fn) {
                        handlers['GET ' + url] = fn;
                    },
                    post(url, fn) {
                        handlers['POST ' + url] = fn;
                    }
                };
            }
        };
    }

    if (
        request === '../db' &&
        parent?.filename.endsWith(path.join('routes', 'kiosk.js'))
    ) {
        return db;
    }

    if (
        request === './coupons' &&
        parent?.filename.endsWith(path.join('routes', 'kiosk.js'))
    ) {
        return {
            router: {},
            CouponError: class CouponError extends Error {},
            discountCents: () => 0
        };
    }

    return originalLoad.apply(this, arguments);
};

try {
    require('../routes/kiosk');
} finally {
    Module._load = originalLoad;
}

function fakeRes() {
    return {
        code: 200,
        response: null,
        status(code) {
            this.code = code;
            return this;
        },
        json(data) {
            this.response = data;
            return this;
        }
    };
}

function makeOrder() {
    return {
        body: {
            items: [{
                menuItemId: 25,
                quantity: 1,
                size: 'M',
                sugar: '100%',
                ice: 'regular',
                toppingIds: []
            }],
            couponCode: null
        }
    };
}

test('checkout inserts order and items and commits', async () => {
    calls.length = 0;
    failAt = null;

    const res = fakeRes();
    await handlers['POST /orders'](makeOrder(), res);

    assert.equal(res.code, 201);
    assert.equal(res.response.orderId, 123);
    assert.ok(calls.some(c => /INSERT INTO orders/.test(c.sql)));
    assert.ok(calls.some(c => /INSERT INTO order_items/.test(c.sql)));
    assert.ok(calls.some(c => /UPDATE inventory/.test(c.sql)));
    assert.ok(calls.some(c => c.sql === 'COMMIT'));
});

test('checkout rolls back if order item insert fails', async () => {
    calls.length = 0;
    failAt = 'INSERT INTO order_items';

    const originalError = console.error;
    console.error = () => {};

    try {
        const res = fakeRes();
        await handlers['POST /orders'](makeOrder(), res);

        assert.equal(res.code, 500);
        assert.ok(calls.some(c => c.sql === 'ROLLBACK'));
        assert.ok(!calls.some(c => c.sql === 'COMMIT'));
    } finally {
        failAt = null;
        console.error = originalError;
    }
});