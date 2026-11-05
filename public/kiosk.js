const MENU_URL = "/api/kiosk/menu";
const ORDERS_URL = "/api/kiosk/orders";
const POPULAR_CATEGORY = "Popular";
const NOTICE_DURATION_MS = 1800;
const ORDER_PLACED_NOTICE_MS = 6000;

// Where the cup illustration draws toppings and ice cubes.
const TOPPING_POSITIONS = [
    [42, 142], [54, 142], [66, 142], [78, 142],
    [36, 131], [48, 131], [60, 131], [72, 131], [84, 131]
];
const ICE_POSITIONS = [
    [38, 68], [66, 66], [52, 84], [74, 88]
];

// Everything the server sends about the menu, set by loadMenu().
let shop = null;

let activeCategory = POPULAR_CATEGORY;
const order = new Map();

// The drink and choices currently open in the customizer.
let customizingItem = null;
let customization = null;

let isPlacingOrder = false;

const layout = document.getElementById("layout");
const categoriesElement = document.getElementById("categories");
const menuGrid = document.getElementById("menu-grid");
const orderItems = document.getElementById("order-items");
const checkout = document.getElementById("checkout");
const notice = document.getElementById("notice");
const customizer = document.getElementById("customizer");
const customizerCup = document.getElementById("customizer-cup");
const customizerOptions = document.getElementById("customizer-options");
const customizerSubmit = document.getElementById("customizer-submit");

let noticeTimeout;

function money(amount) {
    return "$" + amount.toFixed(2);
}

function findOption(options, id) {
    return options.find(option => option.id === id);
}

function describeRecipe(item) {
    return item.ingredients.join(", ");
}

// "toppings" holds only the extras; included toppings come with the drink.
function getDefaultCustomization() {
    return { ...shop.defaultChoices, toppings: [] };
}

function getUnitPrice(item, choices) {
    const toppingTotal = choices.toppings.reduce((sum, id) => {
        return sum + findOption(shop.toppings, id).price;
    }, 0);

    return item.price +
        findOption(shop.sizes, choices.size).upcharge +
        toppingTotal;
}

function describeCustomization(choices) {
    const toppingNames = choices.toppings.map(id => {
        return "+ " + findOption(shop.toppings, id).name;
    });

    return [
        findOption(shop.sizes, choices.size).label,
        findOption(shop.sugarLevels, choices.sugar).label + " sugar",
        findOption(shop.iceLevels, choices.ice).label,
        ...toppingNames
    ].join(" · ");
}

// Identical drinks share an order line, so the key covers every choice.
function getOrderKey(item, choices) {
    return [
        item.id,
        choices.size,
        choices.sugar,
        choices.ice,
        [...choices.toppings].sort().join("+")
    ].join("|");
}

function createCupSvg(item, choices) {
    const colors = [...item.includedToppingIds, ...choices.toppings]
        .map(id => getToppingColor(findOption(shop.toppings, id)));

    const toppings = colors.length === 0 ? "" : TOPPING_POSITIONS
        .map(([x, y], index) => {
            const color = colors[index % colors.length];
            return `<circle class="cup-topping" cx="${x}" cy="${y}" r="5.5" fill="${color}"/>`;
        })
        .join("");

    const cubes = ICE_POSITIONS
        .slice(0, ICE_CUBE_COUNTS[choices.ice])
        .map(([x, y]) => {
            return `<rect class="cup-ice" x="${x}" y="${y}" width="14" height="14" rx="3"/>`;
        })
        .join("");

    return `
        <svg viewBox="0 0 120 160" focusable="false">
            <line class="cup-straw" x1="66" y1="50" x2="80" y2="5"/>
            <path class="cup-lid" d="M24 44 Q60 4 96 44 Z"/>
            <polygon points="25,56 95,56 88,152 32,152" fill="${getDrinkColor(item)}"/>
            ${cubes}
            ${toppings}
            <polygon class="cup-outline" points="24,44 96,44 88,152 32,152"/>
            <line class="cup-rim" x1="20" y1="44" x2="100" y2="44"/>
        </svg>
    `;
}

function getCategories() {
    const categories = shop.items.map(item => item.category);

    return [POPULAR_CATEGORY, ...new Set(categories)];
}

function renderCategories() {
    categoriesElement.innerHTML = "";

    getCategories().forEach(category => {
        const button = document.createElement("button");
        button.type = "button";
        button.className =
            "category" + (activeCategory === category ? " active" : "");
        button.textContent = category;
        button.setAttribute(
            "aria-pressed",
            String(activeCategory === category)
        );

        button.addEventListener("click", () => {
            activeCategory = category;
            renderCategories();
            renderMenu();
        });

        categoriesElement.appendChild(button);
    });
}

function renderMenu() {
    const items = activeCategory === POPULAR_CATEGORY
        ? shop.items.filter(item => item.popular)
        : shop.items.filter(item => item.category === activeCategory);

    document.getElementById("menu-title").textContent =
        activeCategory === POPULAR_CATEGORY
            ? "Popular Drinks"
            : activeCategory;

    menuGrid.innerHTML = "";

    items.forEach(item => {
        const card = document.createElement("article");
        card.className = "item-card";

        const image = document.createElement("div");
        image.className = "item-image";
        image.innerHTML = createCupSvg(item, getDefaultCustomization());
        image.setAttribute("aria-hidden", "true");

        const name = document.createElement("h3");
        name.textContent = item.name;

        const description = document.createElement("p");
        description.textContent = describeRecipe(item);

        const bottom = document.createElement("div");
        bottom.className = "item-bottom";

        const price = document.createElement("span");
        price.className = "price";
        price.textContent = money(item.price);

        const customizeButton = document.createElement("button");
        customizeButton.type = "button";
        customizeButton.className = "add-button";
        customizeButton.textContent = "Customize";
        customizeButton.setAttribute("aria-label", "Customize " + item.name);

        customizeButton.addEventListener("click", () => {
            openCustomizer(item);
        });

        bottom.append(price, customizeButton);
        card.append(image, name, description, bottom);
        menuGrid.appendChild(card);
    });
}

// Shows a loading or error message where the drinks would be.
function renderMenuMessage(message, showRetry) {
    menuGrid.innerHTML = "";

    const box = document.createElement("div");
    box.className = "menu-message";
    box.textContent = message;

    if (showRetry) {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "add-button";
        retry.textContent = "Try again";
        retry.addEventListener("click", loadMenu);
        box.appendChild(retry);
    }

    menuGrid.appendChild(box);
}

// Builds one group of radio buttons or checkboxes for the customizer.
function createChoiceGroup({
    legend, type, name, options, isChecked, isDisabled, onChange
}) {
    const group = document.createElement("fieldset");
    group.className = "choice-group";

    const title = document.createElement("legend");
    title.textContent = legend;
    group.appendChild(title);

    options.forEach(option => {
        const label = document.createElement("label");
        label.className = "choice";

        const input = document.createElement("input");
        input.type = type;
        input.name = name;
        input.value = option.id;
        input.checked = isChecked(option);
        input.disabled = isDisabled ? isDisabled(option) : false;
        input.addEventListener("change", () => {
            onChange(option, input.checked);
            updateCustomizerSummary();
        });

        const text = document.createElement("span");
        text.className = "choice-text";
        text.textContent = option.label;

        if (option.detail) {
            const detail = document.createElement("small");
            detail.textContent = option.detail;
            text.appendChild(detail);
        }

        label.append(input, text);
        group.appendChild(label);
    });

    return group;
}

function getSizeOptions() {
    return shop.sizes.map(size => ({
        ...size,
        detail: size.upcharge > 0
            ? size.detail + " · +" + money(size.upcharge)
            : size.detail
    }));
}

function getToppingOptions(item) {
    return shop.toppings.map(topping => ({
        ...topping,
        label: topping.name,
        detail: item.includedToppingIds.includes(topping.id)
            ? "Included"
            : "+" + money(topping.price)
    }));
}

function toggleTopping(topping, selected) {
    customization.toppings = customization.toppings
        .filter(id => id !== topping.id);

    if (selected) {
        customization.toppings.push(topping.id);
    }
}

function renderCustomizerOptions(item) {
    customizerOptions.innerHTML = "";

    customizerOptions.append(
        createChoiceGroup({
            legend: "Size",
            type: "radio",
            name: "size",
            options: getSizeOptions(),
            isChecked: size => size.id === customization.size,
            onChange: size => {
                customization.size = size.id;
            }
        }),
        createChoiceGroup({
            legend: "Sugar level",
            type: "radio",
            name: "sugar",
            options: shop.sugarLevels,
            isChecked: level => level.id === customization.sugar,
            onChange: level => {
                customization.sugar = level.id;
            }
        }),
        createChoiceGroup({
            legend: "Ice level",
            type: "radio",
            name: "ice",
            options: shop.iceLevels,
            isChecked: level => level.id === customization.ice,
            onChange: level => {
                customization.ice = level.id;
            }
        }),
        createChoiceGroup({
            legend: "Add toppings",
            type: "checkbox",
            name: "toppings",
            options: getToppingOptions(item),
            isChecked: topping => {
                return item.includedToppingIds.includes(topping.id);
            },
            isDisabled: topping => {
                return item.includedToppingIds.includes(topping.id);
            },
            onChange: toggleTopping
        })
    );
}

function updateCustomizerSummary() {
    customizerCup.innerHTML = createCupSvg(customizingItem, customization);
    customizerSubmit.textContent =
        "Add to order · " +
        money(getUnitPrice(customizingItem, customization));
}

function openCustomizer(item) {
    customizingItem = item;
    customization = getDefaultCustomization();

    document.getElementById("customizer-title").textContent = item.name;
    document.getElementById("customizer-description").textContent =
        describeRecipe(item);

    renderCustomizerOptions(item);
    updateCustomizerSummary();
    customizer.showModal();
}

function addToOrder(item, choices) {
    const key = getOrderKey(item, choices);
    const current = order.get(key);

    order.set(key, {
        item,
        choices,
        unitPrice: getUnitPrice(item, choices),
        quantity: current ? current.quantity + 1 : 1
    });

    renderOrder();
    showNotice(item.name + " added to your order");
}

function changeQuantity(key, change) {
    const entry = order.get(key);
    if (!entry) return;

    entry.quantity += change;

    if (entry.quantity <= 0) {
        order.delete(key);
    } else {
        order.set(key, entry);
    }

    renderOrder();
}

function calculateTotals() {
    let subtotal = 0;
    let count = 0;

    order.forEach(({ unitPrice, quantity }) => {
        subtotal += unitPrice * quantity;
        count += quantity;
    });

    // Round to cents the same way the server does, so the totals always match.
    const subtotalCents = Math.round(subtotal * 100);
    const taxCents = Math.round(subtotalCents * shop.taxRate);

    return {
        subtotal: subtotalCents / 100,
        tax: taxCents / 100,
        total: (subtotalCents + taxCents) / 100,
        count
    };
}

function renderOrder() {
    orderItems.innerHTML = "";

    if (order.size === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-order";
        empty.innerHTML =
            '<div class="icon" aria-hidden="true">🧋</div>' +
            '<strong>Your order is empty</strong>' +
            '<div>Add something delicious!</div>';
        orderItems.appendChild(empty);
    } else {
        order.forEach(({ item, choices, unitPrice, quantity }, key) => {
            const row = document.createElement("div");
            row.className = "order-row";

            const details = document.createElement("div");

            const name = document.createElement("div");
            name.className = "order-item-name";
            name.textContent = item.name;

            const choiceText = describeCustomization(choices);

            const choiceSummary = document.createElement("div");
            choiceSummary.className = "order-item-choices";
            choiceSummary.textContent = choiceText;

            const itemPrice = document.createElement("div");
            itemPrice.className = "order-item-price";
            itemPrice.textContent = money(unitPrice) + " each";

            const controls = document.createElement("div");
            controls.className = "quantity-controls";

            const minus = document.createElement("button");
            minus.type = "button";
            minus.textContent = "−";
            minus.setAttribute(
                "aria-label", "Remove one " + item.name + ", " + choiceText
            );
            minus.addEventListener("click", () => {
                changeQuantity(key, -1);
            });

            const quantityLabel = document.createElement("span");
            quantityLabel.className = "quantity";
            quantityLabel.textContent = quantity;

            const plus = document.createElement("button");
            plus.type = "button";
            plus.textContent = "+";
            plus.setAttribute(
                "aria-label", "Add one " + item.name + ", " + choiceText
            );
            plus.addEventListener("click", () => {
                changeQuantity(key, 1);
            });

            controls.append(minus, quantityLabel, plus);
            details.append(name, choiceSummary, itemPrice, controls);

            const lineTotal = document.createElement("div");
            lineTotal.className = "line-total";
            lineTotal.textContent = money(unitPrice * quantity);

            row.append(details, lineTotal);
            orderItems.appendChild(row);
        });
    }

    const totals = calculateTotals();

    document.getElementById("item-count").textContent =
        totals.count + (totals.count === 1 ? " item" : " items");

    document.getElementById("subtotal").textContent =
        money(totals.subtotal);
    document.getElementById("tax").textContent = money(totals.tax);
    document.getElementById("total").textContent = money(totals.total);

    checkout.textContent = isPlacingOrder
        ? "Placing your order…"
        : "Checkout · " + money(totals.total);
    checkout.disabled = totals.count === 0 || isPlacingOrder;
}

function showNotice(message, duration = NOTICE_DURATION_MS) {
    clearTimeout(noticeTimeout);
    notice.textContent = message;
    notice.hidden = false;

    noticeTimeout = setTimeout(() => {
        notice.hidden = true;
    }, duration);
}

function getOrderRequest() {
    const items = [...order.values()].map(({ item, choices, quantity }) => ({
        menuItemId: item.id,
        quantity,
        size: choices.size,
        sugar: choices.sugar,
        ice: choices.ice,
        toppingIds: choices.toppings
    }));

    return { items };
}

async function submitOrder() {
    const response = await fetch(ORDERS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getOrderRequest())
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.message);
    }

    return result;
}

// The order is locked while it saves, so what's on screen is what gets placed.
function setPlacingOrder(placing) {
    isPlacingOrder = placing;
    layout.inert = placing;
    renderOrder();
}

async function loadMenu() {
    renderMenuMessage("Loading the menu…", false);

    try {
        const response = await fetch(MENU_URL);

        if (!response.ok) {
            throw new Error("Menu request failed: " + response.status);
        }

        shop = await response.json();
    } catch (error) {
        console.error(error);
        renderMenuMessage("We couldn't load the menu right now.", true);
        return;
    }

    document.getElementById("tax-label").textContent =
        "Tax (" + (shop.taxRate * 100).toFixed(2) + "%)";

    renderCategories();
    renderMenu();
    renderOrder();
}

document.getElementById("customizer-form").addEventListener("submit", event => {
    event.preventDefault();

    addToOrder(customizingItem, customization);
    customizer.close();
});

document.getElementById("customizer-cancel").addEventListener("click", () => {
    customizer.close();
});

document.getElementById("clear-order").addEventListener("click", () => {
    if (order.size === 0) return;

    order.clear();
    renderOrder();
    showNotice("Order cleared");
});

checkout.addEventListener("click", async () => {
    if (order.size === 0 || isPlacingOrder) return;

    setPlacingOrder(true);

    try {
        const result = await submitOrder();

        order.clear();
        showNotice(
            "Order #" + result.orderId + " placed. Total: $" + result.total,
            ORDER_PLACED_NOTICE_MS
        );
    } catch (error) {
        console.error(error);
        showNotice("We couldn't place your order. Please try again.");
    }

    setPlacingOrder(false);
});

loadMenu();
