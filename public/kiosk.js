const TAX_RATE = 0.0825;
const POPULAR_CATEGORY = "Popular";
const NOTICE_DURATION_MS = 1800;

// Where the cup illustration draws toppings and ice cubes.
const TOPPING_POSITIONS = [
    [42, 142], [54, 142], [66, 142], [78, 142],
    [36, 131], [48, 131], [60, 131], [72, 131], [84, 131]
];
const ICE_POSITIONS = [
    [38, 68], [66, 66], [52, 84], [74, 88], [36, 96], [58, 104]
];

let activeCategory = POPULAR_CATEGORY;
const order = new Map();

// The drink and choices currently open in the customizer.
let customizingItem = null;
let customization = null;

const categoriesElement = document.getElementById("categories");
const menuGrid = document.getElementById("menu-grid");
const orderItems = document.getElementById("order-items");
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

function getDefaultCustomization(item) {
    return {
        ...DEFAULT_CUSTOMIZATION,
        toppings: [...item.includedToppings]
    };
}

function getToppingPrice(item, topping) {
    return item.includedToppings.includes(topping.id) ? 0 : topping.price;
}

function getUnitPrice(item, choices) {
    const toppingTotal = choices.toppings.reduce((sum, id) => {
        return sum + getToppingPrice(item, findOption(TOPPINGS, id));
    }, 0);

    return item.price + findOption(SIZES, choices.size).upcharge + toppingTotal;
}

function describeCustomization(choices) {
    const toppingNames = choices.toppings.map(id => {
        return findOption(TOPPINGS, id).label;
    });

    return [
        findOption(SIZES, choices.size).label,
        findOption(SUGAR_LEVELS, choices.sugar).label + " sugar",
        findOption(ICE_LEVELS, choices.ice).label,
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
    const colors = choices.toppings.map(id => findOption(TOPPINGS, id).color);

    const toppings = colors.length === 0 ? "" : TOPPING_POSITIONS
        .map(([x, y], index) => {
            const color = colors[index % colors.length];
            return `<circle class="cup-topping" cx="${x}" cy="${y}" r="5.5" fill="${color}"/>`;
        })
        .join("");

    const cubes = ICE_POSITIONS
        .slice(0, findOption(ICE_LEVELS, choices.ice).cubes)
        .map(([x, y]) => {
            return `<rect class="cup-ice" x="${x}" y="${y}" width="14" height="14" rx="3"/>`;
        })
        .join("");

    return `
        <svg viewBox="0 0 120 160" focusable="false">
            <line class="cup-straw" x1="66" y1="50" x2="80" y2="5"/>
            <path class="cup-lid" d="M24 44 Q60 4 96 44 Z"/>
            <polygon points="25,56 95,56 88,152 32,152" fill="${item.teaColor}"/>
            ${cubes}
            ${toppings}
            <polygon class="cup-outline" points="24,44 96,44 88,152 32,152"/>
            <line class="cup-rim" x1="20" y1="44" x2="100" y2="44"/>
        </svg>
    `;
}

function getCategories() {
    return [POPULAR_CATEGORY, ...new Set(menu.map(item => item.category))];
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
        ? menu.filter(item => item.popular)
        : menu.filter(item => item.category === activeCategory);

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
        image.innerHTML = createCupSvg(item, getDefaultCustomization(item));
        image.setAttribute("aria-hidden", "true");

        const name = document.createElement("h3");
        name.textContent = item.name;

        const description = document.createElement("p");
        description.textContent = item.description;

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

// Builds one group of radio buttons or checkboxes for the customizer.
function createChoiceGroup({ legend, type, name, options, isChecked, onChange }) {
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
    return SIZES.map(size => ({
        ...size,
        detail: size.upcharge > 0
            ? size.detail + " · +" + money(size.upcharge)
            : size.detail
    }));
}

function getToppingOptions(item) {
    return TOPPINGS.map(topping => {
        const price = getToppingPrice(item, topping);

        return {
            ...topping,
            detail: price > 0 ? "+" + money(price) : "Included"
        };
    });
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
            options: SUGAR_LEVELS,
            isChecked: level => level.id === customization.sugar,
            onChange: level => {
                customization.sugar = level.id;
            }
        }),
        createChoiceGroup({
            legend: "Ice level",
            type: "radio",
            name: "ice",
            options: ICE_LEVELS,
            isChecked: level => level.id === customization.ice,
            onChange: level => {
                customization.ice = level.id;
            }
        }),
        createChoiceGroup({
            legend: "Toppings",
            type: "checkbox",
            name: "toppings",
            options: getToppingOptions(item),
            isChecked: topping => customization.toppings.includes(topping.id),
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
    customization = getDefaultCustomization(item);

    document.getElementById("customizer-title").textContent = item.name;
    document.getElementById("customizer-description").textContent =
        item.description;

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

    // Round tax to cents before adding it to the subtotal.
    subtotal = Math.round(subtotal * 100) / 100;
    const tax = Math.round(subtotal * TAX_RATE * 100) / 100;
    const total = subtotal + tax;

    return { subtotal, tax, total, count };
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

    const checkout = document.getElementById("checkout");
    checkout.textContent = "Checkout · " + money(totals.total);
    checkout.disabled = totals.count === 0;
}

function showNotice(message) {
    clearTimeout(noticeTimeout);
    notice.textContent = message;
    notice.hidden = false;

    noticeTimeout = setTimeout(() => {
        notice.hidden = true;
    }, NOTICE_DURATION_MS);
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

document.getElementById("checkout").addEventListener("click", () => {
    if (order.size === 0) return;

    const totals = calculateTotals();

    // MVP placeholder: no payment is processed.
    showNotice("Demo checkout — total: " + money(totals.total));
});

renderCategories();
renderMenu();
renderOrder();
