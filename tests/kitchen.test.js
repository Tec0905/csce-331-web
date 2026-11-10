'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const handlers = {};
const db = {
    calls: [],
    async query(sql, params = []) {
        this.calls.push({ sql, params });
        if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return { rows: [], rowCount: 0 };
        if (/WITH recent AS/.test(sql)) {
            return {
                rows: [
                    { order_id: 42, placed_time: '03:04 PM', age_seconds: 55,
                      kitchen_status: 'new', quantity: 1, size: 'M',
                      sugar_level: '75%', ice_level: 'less', item_name: 'Milk Tea' },
                    { order_id: 42, placed_time: '03:04 PM', age_seconds: 55,
                      kitchen_status: 'new', quantity: 2, size: 'L',
                      sugar_level: '0%', ice_level: 'none', item_name: 'Fruit Tea' }
                ], rowCount: 2
            };
        }
        if (/SELECT o.order_id FROM orders/.test(sql)) return { rows: [{order_id:42}], rowCount: 1 };
        if (/INSERT INTO kitchen_order_status/.test(sql)) return { rows: [{ status: params[1] }], rowCount: 1 };
        throw new Error('Unrecognized SQL: ' + sql.slice(0, 70));
    }
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'express') {
        return { Router() {
            return {
                get(url, fn) { handlers['GET ' + url] = fn; },
                patch(url, fn) { handlers['PATCH ' + url] = fn; }
            };
        }};
    }
    if (request === '../db' && parent?.filename.endsWith(path.join('routes', 'kitchen.js'))) return db;
    return originalLoad.apply(this, arguments);
};
require('../routes/kitchen');
Module._load = originalLoad;

function fakeRes() {
    return {
        code: 200,
        response: undefined,
        status(code) { this.code = code; return this; },
        set() { return this; },
        json(data) { this.response = data; return this; }
    };
}

test('GET groups multiple line items under a single kitchen ticket', async () => {
    const res = fakeRes();
    await handlers['GET /orders']({}, res);
    assert.equal(res.code, 200);
    assert.equal(res.response.orders.length, 1);
    assert.equal(res.response.orders[0].items.length, 2);
    assert.equal(res.response.orders[0].status, 'new');
    assert.equal(res.response.orders[0].id, 42);
});

test('PATCH allows only valid next-stage changes', async () => {
    const res = fakeRes();
    await handlers['PATCH /orders/:id/status']({
        params: {id: '42'}, body: {expectedStatus: 'new', nextStatus: 'preparing'},
        get() {return undefined;}
    }, res);
    assert.equal(res.code, 200);
    assert.deepEqual(res.response, {id:42,status:'preparing'});
    assert.ok(db.calls.some(c => /ON CONFLICT/.test(c.sql)));
});

test('PATCH rejects skipped stages and bad ids', async () => {
    for (const [id, expectedStatus, nextStatus] of [
        ['42', 'new', 'ready'],
        ['abc', 'new', 'preparing']
    ]) {
        const res = fakeRes();
        await handlers['PATCH /orders/:id/status']({
            params: {id}, body: {expectedStatus,nextStatus}
        }, res);
        assert.equal(res.code, 400);
    }
});

test('PATCH requires the configured kitchen access code', async () => {
    process.env.KITCHEN_ACCESS_CODE = 'some-demo-code';
    try {
        const res = fakeRes();
        await handlers['PATCH /orders/:id/status']({
            params: {id:'42'},
            body: {expectedStatus:'new',nextStatus:'preparing'},
            get() {return 'incorrect';}
        }, res);
        assert.equal(res.code, 401);
    } finally { delete process.env.KITCHEN_ACCESS_CODE; }
});
