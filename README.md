# Pharmacy Inventory System — MySQL Backend Setup

## Database Setup (database.sql)

1. Open **phpMyAdmin** at `http://localhost/phpmyadmin` (or MySQL CLI)
2. Import `database.sql` — it creates the `pharmacy_inventory` database with all tables
3. Tables created:
   - `drugs` — drug master records
   - `suppliers` — vendor directory
   - `categories` — therapeutic classification
   - `purchase_orders` / `purchase_order_items` — procurement
   - `dispensing_log` — sales/filling audit trail
   - `users` — staff login (default: **admin** / **admin123**)
   - `audit_log` — change tracking

## Backend API (api.php)

1. Place `api.php` in your web server root, e.g. `htdocs/pharmacy_inventory_system/api.php`
2. Edit the `$host`, `$dbname`, `$username`, `$password` variables (line 28) for your MySQL credentials:
   ```php
   $host = 'localhost';
   $dbname = 'pharmacy_inventory';
   $username = 'root';
   $password = 'your_password';
   ```
3. Ensure the **JSON** extension and **CORS** support are enabled in your PHP config (default PHP ≥ 7.0 has them)

## Connect HTML to API

Open `pharmacy_inventory_system.html` and change at the top of the script:

```javascript
const USE_API = true;
const API_BASE = 'api.php';
```

When `USE_API = true` the app fetches from the API.
When `USE_API = false` it runs in standalone mode with local data (current default).

## API Endpoints Available

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/drugs?page=&limit=&search=&schedule=&status=` | List drugs |
| POST | `/drugs` | Add drug |
| PUT | `/drugs/:id` | Update drug |
| DELETE | `/drugs/:id` | Delete drug |
| GET | `/alerts` | Get active alerts |
| GET | `/reports?type=summary` | Summary stats |
| GET | `/reports?type=by-schedule` | Schedule breakdown |
| GET | `/reports?type=by-expiry` | Expiry window breakdown |
| GET | `/reports?type=by-category` | Category breakdown |
| POST | `/auth/login` | Staff login |
| GET | `/categories` | List categories |
| POST | `/categories` | Add category |
| GET | `/suppliers` | List suppliers |
| POST | `/suppliers` | Add supplier |
| POST | `/purchase-orders` | Create PO |
| GET | `/purchase-orders` | List POs |
| POST | `/dispensing` | Record dispensing |
| GET | `/dispensing` | List dispensing log |

## Security Notes

- Change the default admin password immediately (`admin123`)
- In production: add HTTPS, session-based auth instead of bearer tokens, input sanitization, and IP logging
- The audit log stores every INSERT/UPDATE/DELETE on `drugs`, `purchase_orders`, and `dispensing_log`

## Quick Start

```bash
# Terminal
cd /path/to/your/web/root
mysql -u root -p < database.sql
cp api.php /path/to/web/root/pharmacy/
# Update credentials in api.php line 28
# Open pharmacy_inventory_system.html in browser (with USE_API=true)
```
