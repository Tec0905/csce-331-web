// How the kiosk draws drinks. The database stores no colors, so they are
// chosen here from each drink's name, category, and toppings.

// The first keyword found in a drink's name picks its color.
const DRINK_COLORS = [
    ["Taro", "#b9a0d0"],
    ["Matcha", "#9dbb6a"],
    ["Thai", "#e0883a"],
    ["Coffee", "#8a5a35"],
    ["Oreo", "#8d8580"],
    ["Halo Halo", "#c39bd3"],
    ["Lava Flow", "#e8604c"],
    ["Strawberry", "#ea7a8a"],
    ["Mango", "#f2b84b"],
    ["Passion", "#e9b02f"],
    ["Peach", "#eea37a"],
    ["Lychee", "#f0b9c4"],
    ["Berry", "#b4506e"],
    ["Wintermelon", "#d8c777"],
    ["Coconut", "#efe3cf"],
    ["Honey", "#dba53f"]
];

const CATEGORY_COLORS = {
    "Milk Tea": "#c49a6c",
    "Fruit Tea": "#d9a05b",
    "Matcha": "#9dbb6a",
    "Coffee": "#8a5a35",
    "Lemonade": "#f3dc7a",
    "Specialty": "#c49a6c"
};

const DEFAULT_DRINK_COLOR = "#c49a6c";

const TOPPING_COLORS = {
    "Tapioca Pearls": "#2e1a12",
    "Honey Jelly": "#e0a93a",
    "Coffee Jelly": "#4b2c1a",
    "Lychee Jelly": "#f7d9de",
    "Coconut Jelly": "#fbf6ea",
    "Egg Pudding": "#f0c64e",
    "Red Bean": "#7c2d2a",
    "Aloe Vera": "#d7e8c0",
    "Crystal Boba": "#f1e6c8",
    "Mango Popping Boba": "#f4a62a",
    "Strawberry Popping Boba": "#d8344a",
    "Vanilla Ice Cream": "#fff8e7",
    "Oreo Cookie Crumbs": "#3a3331",
    "Creama (Cheese Foam)": "#fff4d6"
};

const DEFAULT_TOPPING_COLOR = "#fbf6ea";

// How many ice cubes the cup illustration draws for each ice level.
const ICE_CUBE_COUNTS = { none: 0, less: 2, regular: 4 };

function getDrinkColor(item) {
    const match = DRINK_COLORS.find(([keyword]) => {
        return item.name.includes(keyword);
    });

    return match
        ? match[1]
        : CATEGORY_COLORS[item.category] || DEFAULT_DRINK_COLOR;
}

function getToppingColor(topping) {
    return TOPPING_COLORS[topping.name] || DEFAULT_TOPPING_COLOR;
}
