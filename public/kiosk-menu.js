// Demo menu data for the customer kiosk. Edit these lists to change what
// the kiosk sells until the menu is loaded from the database.

const SIZES = [
    { id: "regular", label: "Regular", detail: "16 oz", upcharge: 0 },
    { id: "large", label: "Large", detail: "24 oz", upcharge: 0.8 }
];

const SUGAR_LEVELS = [
    { id: "0", label: "0%" },
    { id: "25", label: "25%" },
    { id: "50", label: "50%" },
    { id: "75", label: "75%" },
    { id: "100", label: "100%" }
];

// "cubes" is how many ice cubes the cup illustration draws.
const ICE_LEVELS = [
    { id: "none", label: "No ice", cubes: 0 },
    { id: "less", label: "Less ice", cubes: 2 },
    { id: "regular", label: "Regular ice", cubes: 4 },
    { id: "extra", label: "Extra ice", cubes: 6 }
];

// "color" is how the topping is drawn at the bottom of the cup.
const TOPPINGS = [
    { id: "pearls", label: "Boba Pearls", price: 0.75, color: "#2e1a12" },
    { id: "crystal", label: "Crystal Boba", price: 0.75, color: "#f1e6c8" },
    { id: "lychee", label: "Lychee Jelly", price: 0.75, color: "#f7d9de" },
    { id: "mango", label: "Mango Popping Boba", price: 0.85, color: "#f4a62a" },
    { id: "strawberry", label: "Strawberry Popping Boba", price: 0.85, color: "#d8344a" },
    { id: "pudding", label: "Egg Pudding", price: 0.95, color: "#f0c64e" },
    { id: "foam", label: "Cheese Foam", price: 1.25, color: "#fff4d6" }
];

const DEFAULT_CUSTOMIZATION = { size: "regular", sugar: "100", ice: "regular" };

// "includedToppings" come with the drink at no extra charge.
const menu = [
    {
        id: 1,
        name: "Classic Pearl Milk Tea",
        description: "Black tea and creamy milk with chewy boba pearls.",
        price: 5.25,
        category: "Milk Tea",
        teaColor: "#c49a6c",
        includedToppings: ["pearls"],
        popular: true
    },
    {
        id: 2,
        name: "Brown Sugar Pearl Milk",
        description: "Warm brown sugar syrup and fresh milk over soft pearls.",
        price: 6.25,
        category: "Milk Tea",
        teaColor: "#b57a45",
        includedToppings: ["pearls"],
        popular: true
    },
    {
        id: 3,
        name: "Taro Milk Tea",
        description: "Sweet, nutty taro blended with jasmine milk tea.",
        price: 5.75,
        category: "Milk Tea",
        teaColor: "#b9a0d0",
        includedToppings: [],
        popular: true
    },
    {
        id: 4,
        name: "Thai Milk Tea",
        description: "Bold spiced black tea finished with sweet cream.",
        price: 5.50,
        category: "Milk Tea",
        teaColor: "#e0883a",
        includedToppings: [],
        popular: false
    },
    {
        id: 5,
        name: "Matcha Milk Tea",
        description: "Stone-ground green tea whisked into cold milk.",
        price: 5.95,
        category: "Milk Tea",
        teaColor: "#9dbb6a",
        includedToppings: [],
        popular: true
    },
    {
        id: 6,
        name: "Mango Green Tea",
        description: "Jasmine green tea shaken with ripe mango.",
        price: 5.25,
        category: "Fruit Tea",
        teaColor: "#f2b84b",
        includedToppings: [],
        popular: true
    },
    {
        id: 7,
        name: "Strawberry Black Tea",
        description: "Bright strawberry puree over iced black tea.",
        price: 5.25,
        category: "Fruit Tea",
        teaColor: "#d9606b",
        includedToppings: [],
        popular: false
    },
    {
        id: 8,
        name: "Passion Fruit Green Tea",
        description: "Tart passion fruit with a clean green tea finish.",
        price: 5.50,
        category: "Fruit Tea",
        teaColor: "#e9b02f",
        includedToppings: [],
        popular: false
    },
    {
        id: 9,
        name: "Peach Oolong Tea",
        description: "Roasted oolong tea with juicy white peach.",
        price: 5.50,
        category: "Fruit Tea",
        teaColor: "#eea37a",
        includedToppings: [],
        popular: false
    },
    {
        id: 10,
        name: "Jasmine Green Tea",
        description: "Floral, fragrant green tea brewed fresh each day.",
        price: 4.25,
        category: "Brewed Tea",
        teaColor: "#d8c777",
        includedToppings: [],
        popular: false
    },
    {
        id: 11,
        name: "Roasted Oolong Tea",
        description: "Smooth, toasty oolong with a honey-like finish.",
        price: 4.25,
        category: "Brewed Tea",
        teaColor: "#a86b34",
        includedToppings: [],
        popular: false
    },
    {
        id: 12,
        name: "Mango Slush",
        description: "Frozen mango blended smooth and icy.",
        price: 6.00,
        category: "Slush",
        teaColor: "#f6ae2d",
        includedToppings: [],
        popular: true
    },
    {
        id: 13,
        name: "Strawberry Slush",
        description: "Frozen strawberries blended with a touch of cream.",
        price: 6.00,
        category: "Slush",
        teaColor: "#ea7a8a",
        includedToppings: [],
        popular: false
    }
];
