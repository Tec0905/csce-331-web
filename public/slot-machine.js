// Lucky Boba Slots: the kiosk's slot machine beyond feature.
//
// One free spin per order. The server decides every spin (see routes/coupons.js),
// so the odds can't be changed from the browser. A win gives a coupon that
// kiosk.js takes off the order before tax.
//
// kiosk.js uses: SlotMachine.update(), getCouponCode(), discountCents(),
// onChange(), finishOrder(), dropCoupon(). Load this file before kiosk.js.

const SlotMachine = (() => {
    const SPIN_URL = "/api/kiosk/spin";
    const COUPON_URL = "/api/kiosk/coupons/";
    const STORAGE_KEY = "kioskSlot";

    const SYMBOLS = {
        boba: { emoji: "🧋", name: "boba" },
        strawberry: { emoji: "🍓", name: "strawberry" },
        mango: { emoji: "🥭", name: "mango" },
        matcha: { emoji: "🍵", name: "matcha" },
        lemon: { emoji: "🍋", name: "lemon" }
    };
    const SYMBOL_IDS = Object.keys(SYMBOLS);
    const RESTING_REELS = ["boba", "mango", "matcha"];

    // Each reel spins past more symbols and stops a little later than the last.
    const REEL_STEPS = [16, 22, 28];
    const REEL_MS = [1100, 1500, 1900];

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    // spun: this order's spin is used. coupon: the prize, if any.
    let state = { spun: false, coupon: null };
    let itemCount = 0;
    let spinning = false;
    const listeners = [];

    const promo = document.getElementById("slot-promo");
    const dialog = document.getElementById("slot-dialog");
    const reels = [...dialog.querySelectorAll(".slot-strip")];
    const result = document.getElementById("slot-result");
    const spinButton = document.getElementById("slot-spin");
    const closeButton = document.getElementById("slot-close");

    // ---------- Saved state (survives a page reload, like the order does) ----------

    function save() {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (error) {
            console.error(error);
        }
    }

    function load() {
        try {
            const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");

            if (saved && typeof saved.spun === "boolean") {
                state = { spun: saved.spun, coupon: saved.coupon || null };
            }
        } catch (error) {
            console.error(error);
        }
    }

    function notify() {
        listeners.forEach(listener => listener());
    }

    // ---------- Coupon ----------

    function minutesLeft(coupon) {
        return Math.max(0, Math.ceil((coupon.expiresAt - Date.now()) / 60000));
    }

    function getCoupon() {
        if (state.coupon && Date.now() >= state.coupon.expiresAt) {
            state.coupon = null;
            save();
            renderPromo();
            notify();
        }

        return state.coupon;
    }

    function getCouponCode() {
        const coupon = getCoupon();
        return coupon ? coupon.code : null;
    }

    // Same rule as the server: never more than the subtotal.
    function discountCents(subtotalCents) {
        const coupon = getCoupon();
        if (!coupon) return 0;

        const cents = coupon.type === "percent"
            ? Math.round(subtotalCents * coupon.value / 100)
            : coupon.value;

        return Math.min(cents, subtotalCents);
    }

    function getLabel() {
        const coupon = getCoupon();
        return coupon ? coupon.label : null;
    }

    // ---------- Order panel card ----------

    function renderPromo() {
        promo.replaceChildren();
        const coupon = state.coupon;

        if (coupon) {
            const card = document.createElement("div");
            card.className = "slot-coupon";

            const title = document.createElement("strong");
            title.textContent = "🎉 " + coupon.label;

            const code = document.createElement("span");
            code.className = "notranslate";
            code.setAttribute("translate", "no");
            code.textContent = coupon.code;

            const detail = document.createElement("span");
            detail.append(
                "Code ", code,
                " · applied · expires in " + minutesLeft(coupon) + " min"
            );

            card.append(title, detail);
            promo.appendChild(card);
            return;
        }

        if (state.spun) {
            const used = document.createElement("p");
            used.className = "slot-note";
            used.textContent = "No prize this time. You get a new spin with your next order.";
            promo.appendChild(used);
            return;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "slot-open-button";
        button.disabled = itemCount === 0;
        button.addEventListener("click", openDialog);

        const icon = document.createElement("span");
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = "🎰";

        const text = document.createElement("span");
        text.textContent = itemCount === 0
            ? "Add a drink to unlock a free spin"
            : "Spin for a discount!";

        button.append(icon, text);
        promo.appendChild(button);
    }

    // ---------- Reels ----------

    function setStrip(strip, symbols) {
        strip.replaceChildren(...symbols.map(id => {
            const cell = document.createElement("span");
            cell.className = "slot-symbol";
            cell.textContent = SYMBOLS[id].emoji;
            return cell;
        }));
        strip.style.transition = "none";
        strip.style.transform = "translateY(0)";
    }

    function randomSymbol() {
        return SYMBOL_IDS[Math.floor(Math.random() * SYMBOL_IDS.length)];
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Each strip is a column of symbols ending on the result; sliding it up
    // to the last symbol looks like the reel spinning and stopping.
    async function animateReels(finalSymbols) {
        if (reducedMotion.matches) {
            reels.forEach((strip, index) => setStrip(strip, [finalSymbols[index]]));
            return;
        }

        reels.forEach((strip, index) => {
            const current = strip.lastElementChild
                ? [...strip.children].pop().textContent
                : null;
            const startId = SYMBOL_IDS.find(id => SYMBOLS[id].emoji === current) ||
                RESTING_REELS[index];

            const symbols = [startId];

            for (let i = 1; i < REEL_STEPS[index] - 1; i++) {
                symbols.push(randomSymbol());
            }

            symbols.push(finalSymbols[index]);
            setStrip(strip, symbols);
        });

        // Let the browser draw the starting position before animating.
        void reels[0].offsetHeight;

        reels.forEach((strip, index) => {
            const count = strip.children.length;
            strip.style.transition =
                `transform ${REEL_MS[index]}ms cubic-bezier(0.15, 0.6, 0.25, 1)`;
            strip.style.transform = `translateY(-${((count - 1) / count) * 100}%)`;
        });

        await wait(Math.max(...REEL_MS) + 100);
    }

    function describeReels(symbols) {
        return symbols.map(id => SYMBOLS[id].name).join(", ");
    }

    // ---------- Dialog ----------

    function openDialog() {
        if (state.spun || itemCount === 0) return;

        reels.forEach((strip, index) => setStrip(strip, [RESTING_REELS[index]]));
        result.textContent = "";
        result.className = "slot-result";
        spinButton.hidden = false;
        spinButton.disabled = false;
        closeButton.textContent = "Back to my order";

        dialog.showModal();
        spinButton.focus();
    }

    async function spin() {
        if (spinning || state.spun) return;

        spinning = true;
        spinButton.disabled = true;
        closeButton.disabled = true;
        result.className = "slot-result";
        result.textContent = "Spinning…";

        let outcome;

        try {
            const response = await fetch(SPIN_URL, { method: "POST" });
            outcome = await response.json();

            if (!response.ok) {
                throw new Error(outcome.message || "Spin failed");
            }
        } catch (error) {
            console.error(error);
            result.textContent = "The slot machine is taking a break. Please try again.";
            spinning = false;
            spinButton.disabled = false;
            closeButton.disabled = false;
            return;
        }

        state.spun = true;
        state.coupon = outcome.won
            ? {
                code: outcome.coupon.code,
                type: outcome.coupon.type,
                value: outcome.coupon.value,
                label: outcome.coupon.label,
                expiresAt: Date.now() + outcome.coupon.expiresInSeconds * 1000
            }
            : null;
        save();

        await animateReels(outcome.reels);

        const reelText = describeReels(outcome.reels) + ". ";

        if (outcome.won) {
            result.className = "slot-result win";
            result.textContent = reelText + outcome.rule + "! You won " +
                outcome.coupon.label.toLowerCase() + ". It's been added to your order.";
        } else {
            result.className = "slot-result";
            result.textContent = reelText + "No match this time. Thanks for playing!";
        }

        spinning = false;
        spinButton.hidden = true;
        closeButton.disabled = false;
        closeButton.textContent = outcome.won ? "Use my prize" : "Back to my order";
        closeButton.focus();

        renderPromo();
        notify();
    }

    spinButton.addEventListener("click", spin);
    closeButton.addEventListener("click", () => dialog.close());

    // Escape can't close the dialog in the middle of a spin.
    dialog.addEventListener("cancel", event => {
        if (spinning) event.preventDefault();
    });

    // ---------- Startup ----------

    // A saved coupon might have been used or expired since the page loaded.
    async function checkSavedCoupon() {
        const coupon = getCoupon();
        if (!coupon) return;

        try {
            const response = await fetch(COUPON_URL + encodeURIComponent(coupon.code));

            if (response.status === 404) {
                dropCoupon();
            }
        } catch (error) {
            console.error(error);
        }
    }

    // Keeps the "expires in" minutes current and removes expired coupons.
    setInterval(() => {
        if (state.coupon) {
            getCoupon();
            renderPromo();
        }
    }, 15000);

    load();
    renderPromo();
    checkSavedCoupon();

    // ---------- Used by kiosk.js ----------

    return {
        // kiosk.js calls this every time the order changes.
        update(count) {
            itemCount = count;
            renderPromo();
        },

        getCouponCode,
        getLabel,
        discountCents,

        onChange(listener) {
            listeners.push(listener);
        },

        // After an order is placed, the next order gets a new spin.
        finishOrder() {
            state = { spun: false, coupon: null };
            save();
            renderPromo();
        },

        dropCoupon,
    };

    function dropCoupon() {
        state.coupon = null;
        save();
        renderPromo();
        notify();
    }
})();