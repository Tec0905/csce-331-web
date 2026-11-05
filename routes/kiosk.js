const express = require('express');
const pool = require('../db');

const router = express.Router();

// Pricing rules match the Project 2 cashier so both record sales the same way.
const TAX_RATE = 0.0825;
const LARGE_UPCHARGE_CENTS = 75;
const TOPPING_PRICE_CENTS = 75;

const PAYMENT_METHOD = 'card';
const ORDER_STATUS = 'completed';
const TIP_CENTS = 0;

const POPULAR_ITEM_COUNT = 6;
const MAX_QUANTITY_PER_LINE = 50;

// Used for toppings that no recipe uses yet, so they have no usual portion.
const DEFAULT_TOPPING_PORTIONS = { g: 60, oz: 2, each: 1 };

// These ids are the exact values stored in the order_items table.
const SIZES = [
    { id: 'M', label: 'Medium', detail: '16 oz', upcharge: 0 },
    { id: 'L', label: 'Large', detail: '24 oz', upcharge: LARGE_UPCHARGE_CENTS / 100 }
];

const SUGAR_LEVELS = ['0%', '25%', '50%', '75%', '100%'].map(level => ({
    id: level,
    label: level
}));

const ICE_LEVELS = [
    { id: 'none', label: 'No ice' },
    { id: 'less', label: 'Less ice' },
    { id: 'regular', label: 'Regular ice' }
];

const DEFAULT_CHOICES = { size: 'M', sugar: '100%', ice: 'regular' };

// Thrown when the order itself is wrong, so the kiosk gets a 400 and not a 500.
class InvalidOrderError extends Error {}

function toCents(price) {
    return Math.round(Number(price) * 100);
}

function toDollars(cents) {
    return (cents / 100).toFixed(2);
}

// Kiosk orders have no cashier. KIOSK_EMPLOYEE_ID can name one to credit them to.
function getKioskEmployeeId() {
    return process.env.KIOSK_EMPLOYEE_ID
        ? Number(process.env.KIOSK_EMPLOYEE_ID)
        : null;
}

async function getActiveMenuItems(db) {
    const result = await db.query(
        `SELECT menu_item_id, name, category, base_price
         FROM menu_items
         WHERE is_active = true
         ORDER BY category, name`
    );

    return result.rows;
}

// Everything a customer would care about in a recipe: no ice, cups, or straws.
async function getRecipeLines(db) {
    const result = await db.query(
        `SELECT mii.menu_item_id, i.inventory_id, i.name, i.category
         FROM menu_item_ingredients mii
         JOIN inventory i ON i.inventory_id = mii.inventory_id
         WHERE i.category <> 'supply' AND i.name <> 'Ice'
         ORDER BY i.category, i.inventory_id`
    );

    return result.rows;
}

// A topping's portion is however much of it the recipes usually use.
async function getToppings(db) {
    const result = await db.query(
        `SELECT i.inventory_id, i.name, i.unit,
                AVG(mii.quantity_used) AS usual_portion
         FROM inventory i
         LEFT JOIN menu_item_ingredients mii
             ON mii.inventory_id = i.inventory_id
         WHERE i.category = 'topping'
         GROUP BY i.inventory_id, i.name, i.unit
         ORDER BY i.inventory_id`
    );

    return result.rows.map(topping => ({
        id: topping.inventory_id,
        name: topping.name,
        portion: topping.usual_portion === null
            ? DEFAULT_TOPPING_PORTIONS[topping.unit]
            : Number(topping.usual_portion)
    }));
}

async function getPopularItemIds(db) {
    const result = await db.query(
        `SELECT oi.menu_item_id
         FROM order_items oi
         JOIN menu_items m ON m.menu_item_id = oi.menu_item_id
         WHERE m.is_active = true
         GROUP BY oi.menu_item_id
         ORDER BY SUM(oi.quantity) DESC, oi.menu_item_id
         LIMIT $1`,
        [POPULAR_ITEM_COUNT]
    );

    return new Set(result.rows.map(row => row.menu_item_id));
}

function validateLine(line) {
    const validChoices =
        SIZES.some(size => size.id === line.size) &&
        SUGAR_LEVELS.some(level => level.id === line.sugar) &&
        ICE_LEVELS.some(level => level.id === line.ice);

    const validQuantity =
        Number.isInteger(line.quantity) &&
        line.quantity >= 1 &&
        line.quantity <= MAX_QUANTITY_PER_LINE;

    if (
        !Number.isInteger(line.menuItemId) ||
        !validChoices ||
        !validQuantity ||
        !Array.isArray(line.toppingIds) ||
        !line.toppingIds.every(Number.isInteger)
    ) {
        throw new InvalidOrderError('This order has an invalid drink in it.');
    }
}

function validateOrder(body) {
    if (!Array.isArray(body?.items) || body.items.length === 0) {
        throw new InvalidOrderError('This order has no drinks in it.');
    }

    body.items.forEach(line => {
        if (line === null || typeof line !== 'object') {
            throw new InvalidOrderError('This order has an invalid drink in it.');
        }

        validateLine(line);
    });
}

// Prices come from the database, never from the browser, so they can't be faked.
function priceOrder(lines, menuItems, toppings, recipeLines) {
    return lines.map(line => {
        const menuItem = menuItems.find(item => {
            return item.menu_item_id === line.menuItemId;
        });

        if (!menuItem) {
            throw new InvalidOrderError(
                'A drink in this order is no longer available.'
            );
        }

        const includedIds = recipeLines
            .filter(recipe => {
                return recipe.menu_item_id === line.menuItemId &&
                    recipe.category === 'topping';
            })
            .map(recipe => recipe.inventory_id);

        // A topping already in the recipe is free and used up by the recipe.
        const extraToppings = [...new Set(line.toppingIds)]
            .filter(id => !includedIds.includes(id))
            .map(id => {
                const topping = toppings.find(option => option.id === id);

                if (!topping) {
                    throw new InvalidOrderError(
                        'A topping in this order is no longer available.'
                    );
                }

                return topping;
            });

        const unitPriceCents =
            toCents(menuItem.base_price) +
            (line.size === 'L' ? LARGE_UPCHARGE_CENTS : 0) +
            extraToppings.length * TOPPING_PRICE_CENTS;

        return { ...line, extraToppings, unitPriceCents };
    });
}

function calculateTotals(pricedLines) {
    const subtotalCents = pricedLines.reduce((sum, line) => {
        return sum + line.unitPriceCents * line.quantity;
    }, 0);

    const taxCents = Math.round(subtotalCents * TAX_RATE);

    return {
        subtotalCents,
        taxCents,
        totalCents: subtotalCents + taxCents + TIP_CENTS
    };
}

async function insertOrder(client, totals) {
    const result = await client.query(
        `INSERT INTO orders
             (order_time, employee_id, subtotal, tax, tip, total,
              payment_method, status)
         VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7)
         RETURNING order_id`,
        [
            getKioskEmployeeId(),
            toDollars(totals.subtotalCents),
            toDollars(totals.taxCents),
            toDollars(TIP_CENTS),
            toDollars(totals.totalCents),
            PAYMENT_METHOD,
            ORDER_STATUS
        ]
    );

    return result.rows[0].order_id;
}

async function insertOrderLine(client, orderId, line) {
    await client.query(
        `INSERT INTO order_items
             (order_id, menu_item_id, quantity, size, sugar_level, ice_level,
              unit_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
            orderId,
            line.menuItemId,
            line.quantity,
            line.size,
            line.sugar,
            line.ice,
            toDollars(line.unitPriceCents)
        ]
    );
}

// Subtracts the drink's recipe and extra toppings, never going below 0.
async function subtractInventory(client, line) {
    await client.query(
        `UPDATE inventory i
         SET quantity_on_hand =
             GREATEST(i.quantity_on_hand - mii.quantity_used * $1, 0)
         FROM menu_item_ingredients mii
         WHERE mii.inventory_id = i.inventory_id
           AND mii.menu_item_id = $2`,
        [line.quantity, line.menuItemId]
    );

    for (const topping of line.extraToppings) {
        await client.query(
            `UPDATE inventory
             SET quantity_on_hand = GREATEST(quantity_on_hand - $1, 0)
             WHERE inventory_id = $2`,
            [topping.portion * line.quantity, topping.id]
        );
    }
}

// All of an order is saved, or none of it is.
async function saveOrder(pricedLines, totals) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const orderId = await insertOrder(client, totals);

        for (const line of pricedLines) {
            await insertOrderLine(client, orderId, line);
            await subtractInventory(client, line);
        }

        await client.query('COMMIT');

        return orderId;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

router.get('/menu', async (req, res) => {
    try {
        const [menuItems, recipeLines, toppings, popularIds] = await Promise.all([
            getActiveMenuItems(pool),
            getRecipeLines(pool),
            getToppings(pool),
            getPopularItemIds(pool)
        ]);

        const items = menuItems.map(item => {
            const recipe = recipeLines.filter(line => {
                return line.menu_item_id === item.menu_item_id;
            });

            return {
                id: item.menu_item_id,
                name: item.name,
                category: item.category,
                price: Number(item.base_price),
                popular: popularIds.has(item.menu_item_id),
                ingredients: recipe.map(line => {
                    return line.name.replace(' (brewed)', '');
                }),
                includedToppingIds: recipe
                    .filter(line => line.category === 'topping')
                    .map(line => line.inventory_id)
            };
        });

        res.json({
            items,
            toppings: toppings.map(({ id, name }) => ({
                id,
                name,
                price: TOPPING_PRICE_CENTS / 100
            })),
            sizes: SIZES,
            sugarLevels: SUGAR_LEVELS,
            iceLevels: ICE_LEVELS,
            defaultChoices: DEFAULT_CHOICES,
            taxRate: TAX_RATE
        });
    } catch (error) {
        console.error('Could not load the kiosk menu:', error);

        res.status(500).json({ message: 'Could not load the menu.' });
    }
});

router.post('/orders', async (req, res) => {
    try {
        validateOrder(req.body);

        const [menuItems, toppings, recipeLines] = await Promise.all([
            getActiveMenuItems(pool),
            getToppings(pool),
            getRecipeLines(pool)
        ]);

        const pricedLines =
            priceOrder(req.body.items, menuItems, toppings, recipeLines);
        const totals = calculateTotals(pricedLines);
        const orderId = await saveOrder(pricedLines, totals);

        res.status(201).json({
            orderId,
            subtotal: toDollars(totals.subtotalCents),
            tax: toDollars(totals.taxCents),
            total: toDollars(totals.totalCents)
        });
    } catch (error) {
        if (error instanceof InvalidOrderError) {
            res.status(400).json({ message: error.message });
            return;
        }

        console.error('Could not save the kiosk order:', error);

        res.status(500).json({ message: 'Could not place your order.' });
    }
});

module.exports = router;
