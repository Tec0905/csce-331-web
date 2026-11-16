# Team 83 - Kitchen Display integration

Source reviewed from Tec0905/csce-331-web `main` on November 9, 2026.

## Includes
- `public/kitchen.html`: accessible Kitchen Display HTML.
- `public/kitchen.css`: matching 83 GUYS visual style, responsive board.
- `public/kitchen.js`: 5-second refresh, ticket rendering and stage changes.
- `routes/kitchen.js`: PostgreSQL-backed GET and PATCH API.
- `install-kitchen.js`: idempotent small patch adding kitchen route to `index.js`.
- `tests/kitchen.test.js`: four isolated backend tests using Node built-in test runner.

## Windows PowerShell installation
From a fresh, up-to-date branch of your local clone:

```powershell
cd C:\Users\Hoang\csce-331-web
git switch main
git pull origin main
git switch -c elijah-functional-kitchen
Expand-Archive "$env:USERPROFILE\Downloads\team83-kitchen-display.zip" -DestinationPath . -Force
node install-kitchen.js
node --check index.js
node --check routes/kitchen.js
node --check public/kitchen.js
node --test tests/kitchen.test.js
git diff -- index.js
```

**Note:** If this ZIP lives elsewhere, replace the Downloads path. The archive will overwrite only `public/kitchen.html` and introduce the new kitchen files. It does not replace any other view.

## Backend setup
`index.js` must import the Kitchen router and mount it at `/api/kitchen`, as `install-kitchen.js` does. Run the application with the SAME command used by the Render service (normally `node index.js`). The repository's `package.json` currently has a `start` script referencing `server.js`, which is not in the inspected root; check Render's configured start command before changing anything.

The API creates `kitchen_order_status` with `CREATE TABLE IF NOT EXISTS` on first access. It requires the app's PostgreSQL user to have CREATE privilege in the target schema. If not, ask the database owner to run the following once:

```sql
CREATE TABLE IF NOT EXISTS kitchen_order_status (
    order_id BIGINT PRIMARY KEY REFERENCES orders(order_id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'preparing', 'ready', 'served')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The Kitchen uses a **separate** table so it won't change the existing POS payment and reporting `orders.status` field. It shows the 120 most recently placed, non-void orders within 24 hours; only paid/completed orders currently enter this feed via the existing Kiosk and Cashier POST `/api/kiosk/orders` route.

For publicly deployed demos, consider setting `KITCHEN_ACCESS_CODE` in Render environment variables. When set, the first stage change asks kitchen staff to enter that access code; it is kept in memory for the current page, not in source code. Without it, state-changing requests are unauthenticated, so **do not treat the demo as production-secure**. GET currently exposes order item details without authentication and should also be protected before production use.

## Test plan
1. Load `/kitchen.html`. It should show an empty queue or recently submitted orders.
2. Open `/kiosk.html` or `/cashier.html`, add a drink, and submit an actual order (not just preview checkout). Avoid repeatedly placing test orders in production accounting; test on a separate database when possible.
3. Within 5 seconds, a ticket should appear under **New orders**.
4. Click **Start preparing**, **Mark ready**, then **Complete pickup**.
5. Refresh the Kitchen page. The completed order should remain in the expandable **Completed orders** list, proving persistence.
6. Confirm the Manager's sales report still functions, and no `orders.status` values were changed by the kitchen route.

## Important limitations
- Kiosk and Cashier currently save order-line size, sugar, and ice, but **not extra topping choices**. This display cannot show toppings until the shared order API is extended to persist them.
- The ticket board polls every 5 seconds, rather than using WebSockets.
- There is no staff authentication/role-based access control yet; the optional access code is only a minimal demo safeguard.
- The database, Render deployment, and end-to-end order flow have not been tested here because no remote database credentials are available.

## Git contribution
```powershell
git add index.js public/kitchen.html public/kitchen.css public/kitchen.js routes/kitchen.js tests/kitchen.test.js README-KITCHEN.md
git commit -m "Implement database-backed Kitchen Display order board"
git push -u origin elijah-functional-kitchen
```

Then open the GitHub pull request shown after pushing and request a teammate review. Merge before expecting Render's `main` deployment to update.
