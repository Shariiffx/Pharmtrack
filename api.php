<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$host = 'localhost';
$dbname = 'pharmacy_inventory';
$username = 'root';
$password = '';

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$path = preg_replace('#^/api\.php#', '', $path);
$path = trim($path, '/');
$segments = explode('/', $path);

function sendResponse($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function getInput() {
    return json_decode(file_get_contents('php://input'), true);
}

function validateToken() {
    $headers = getallheaders();
    $auth = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    if (preg_match('/Bearer\s(\S+)/', $auth, $matches)) {
        return $matches[1];
    }
    return null;
}

function logAudit($pdo, $table, $recordId, $action, $oldValues = null, $newValues = null) {
    try {
        $stmt = $pdo->prepare("INSERT INTO audit_log (table_name, record_id, action, old_values, new_values) VALUES (?, ?, ?, ?, ?)");
        $stmt->execute([
            $table,
            $recordId,
            $action,
            $oldValues ? json_encode($oldValues) : null,
            $newValues ? json_encode($newValues) : null
        ]);
    } catch (Exception $e) {
        // Silent fail for audit log
    }
}

// AUTH ENDPOINTS
if ($segments[0] === 'auth') {
    if ($method === 'POST' && $segments[1] === 'login') {
        $input = getInput();
        $username = $input['username'] ?? '';
        $password = $input['password'] ?? '';

        $stmt = $pdo->prepare("SELECT * FROM users WHERE username = ? AND is_active = 1");
        $stmt->execute([$username]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($user && password_verify($password, $user['password_hash'])) {
            $stmt = $pdo->prepare("UPDATE users SET last_login = NOW() WHERE id = ?");
            $stmt->execute([$user['id']]);

            unset($user['password_hash']);
            $token = base64_encode($user['id'] . ':' . time() . ':' . bin2hex(random_bytes(16)));
            sendResponse([
                'token' => $token,
                'user' => $user
            ]);
        } else {
            http_response_code(401);
            sendResponse(['error' => 'Invalid credentials']);
        }
    }

    if ($method === 'POST' && $segments[1] === 'register') {
        $input = getInput();
        $username = trim($input['username'] ?? '');
        $password = $input['password'] ?? '';
        $fullName = trim($input['full_name'] ?? '');
        $role = $input['role'] ?? 'Staff';
        $email = trim($input['email'] ?? '');

        if (empty($username) || empty($password) || empty($fullName)) {
            http_response_code(400);
            sendResponse(['error' => 'Username, password, and full name are required']);
        }

        $stmt = $pdo->prepare("SELECT id FROM users WHERE username = ?");
        $stmt->execute([$username]);
        if ($stmt->fetch()) {
            http_response_code(409);
            sendResponse(['error' => 'Username already exists']);
        }

        $passwordHash = password_hash($password, PASSWORD_DEFAULT);
        $stmt = $pdo->prepare("INSERT INTO users (username, password_hash, full_name, role, email) VALUES (?, ?, ?, ?, ?)");
        $stmt->execute([$username, $passwordHash, $fullName, $role, $email]);

        sendResponse(['message' => 'User created successfully'], 201);
    }
}

// DRUG ENDPOINTS
if ($segments[0] === 'drugs') {
    if ($method === 'GET') {
        $page = max(1, isset($_GET['page']) ? (int)$_GET['page'] : 1);
        $limit = max(1, min(500, isset($_GET['limit']) ? (int)$_GET['limit'] : 50));
        $offset = ($page - 1) * $limit;

        $search = $_GET['search'] ?? '';
        $schedule = $_GET['schedule'] ?? '';
        $status = $_GET['status'] ?? '';

        $sql = "
            SELECT d.*, c.name as category_name, s.name as supplier_name
            FROM drugs d
            LEFT JOIN categories c ON d.category_id = c.id
            LEFT JOIN suppliers s ON d.supplier_id = s.id
            WHERE 1=1
        ";
        $params = [];

        if ($search) {
            $sql .= " AND (d.name LIKE ? OR d.generic_name LIKE ? OR d.batch_number LIKE ?)";
            $params[] = "%$search%";
            $params[] = "%$search%";
            $params[] = "%$search%";
        }

        if ($schedule) {
            $sql .= " AND d.schedule_type = ?";
            $params[] = $schedule;
        }

        if ($status) {
            $today = date('Y-m-d');
            if ($status === 'expired') {
                $sql .= " AND d.expiry_date < ?";
                $params[] = $today;
            } elseif ($status === 'out') {
                $sql .= " AND d.current_stock = 0";
            } elseif ($status === 'warn') {
                $sql .= " AND (d.current_stock <= d.reorder_level OR (d.expiry_date >= ? AND d.expiry_date <= DATE_ADD(?, INTERVAL 30 DAY)))";
                $params[] = $today;
                $params[] = $today;
            } elseif ($status === 'ok') {
                $sql .= " AND d.current_stock > 0 AND d.expiry_date > DATE_ADD(?, INTERVAL 30 DAY) AND d.current_stock > d.reorder_level";
                $params[] = $today;
            }
        }

        $sql .= " ORDER BY d.expiry_date ASC LIMIT $limit OFFSET $offset";

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $drugs = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $countSql = "SELECT COUNT(*) FROM drugs d WHERE 1=1";
        $countParams = [];
        if ($search) {
            $countSql .= " AND (d.name LIKE ? OR d.generic_name LIKE ? OR d.batch_number LIKE ?)";
            $countParams[] = "%$search%";
            $countParams[] = "%$search%";
            $countParams[] = "%$search%";
        }
        if ($schedule) {
            $countSql .= " AND d.schedule_type = ?";
            $countParams[] = $schedule;
        }
        if ($status) {
            if ($status === 'expired') {
                $countSql .= " AND d.expiry_date < ?";
                $countParams[] = $today;
            } elseif ($status === 'out') {
                $countSql .= " AND d.current_stock = 0";
            } elseif ($status === 'warn') {
                $countSql .= " AND (d.current_stock <= d.reorder_level OR (d.expiry_date >= ? AND d.expiry_date <= DATE_ADD(?, INTERVAL 30 DAY)))";
                $countParams[] = $today;
                $countParams[] = $today;
            } elseif ($status === 'ok') {
                $countSql .= " AND d.current_stock > 0 AND d.expiry_date > DATE_ADD(?, INTERVAL 30 DAY) AND d.current_stock > d.reorder_level";
                $countParams[] = $today;
            }
        }
        $countStmt = $pdo->prepare($countSql);
        $countStmt->execute($countParams);
        $total = $countStmt->fetchColumn();

        sendResponse([
            'drugs' => $drugs,
            'total' => $total,
            'page' => $page,
            'limit' => $limit
        ]);
    }

    if ($method === 'POST') {
        $input = getInput() ?? [];
        $nextNum = (int)$pdo->query("SELECT MAX(CAST(SUBSTRING(id, 2) AS UNSIGNED)) FROM drugs")->fetchColumn() + 1;
        $id = $input['id'] ?? ('D' . str_pad($nextNum, 3, '0', STR_PAD_LEFT));

        $categoryId = null;
        $supplierId = null;
        if (!empty($input['category_id'])) {
            $categoryId = $input['category_id'];
        } elseif (!empty($input['category'])) {
            $stmt = $pdo->prepare("SELECT id FROM categories WHERE name = ?");
            $stmt->execute([$input['category']]);
            $categoryId = $stmt->fetchColumn();
        }
        if (!empty($input['supplier_id'])) {
            $supplierId = $input['supplier_id'];
        } elseif (!empty($input['supplier'])) {
            $stmt = $pdo->prepare("SELECT id FROM suppliers WHERE name = ?");
            $stmt->execute([$input['supplier']]);
            $supplierId = $stmt->fetchColumn();
        }

        $dosageForm = !empty($input['dosage_form']) ? $input['dosage_form'] : (!empty($input['form']) ? $input['form'] : 'Tablet');

        $stmt = $pdo->prepare("INSERT INTO drugs (id, name, generic_name, hsn_code, schedule_type, category_id, dosage_form, batch_number, expiry_date, current_stock, reorder_level, purchase_price, mrp, gst_rate, supplier_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            $id,
            $input['name'] ?? '',
            $input['generic_name'] ?? $input['generic'] ?? null,
            $input['hsn_code'] ?? $input['hsn'] ?? null,
            $input['schedule_type'] ?? $input['schedule'] ?? 'OTC',
            $categoryId,
            $dosageForm,
            $input['batch_number'] ?? $input['batch'] ?? '',
            $input['expiry_date'] ?? $input['expiry'] ?? date('Y-m-d'),
            $input['current_stock'] ?? $input['stock'] ?? 0,
            $input['reorder_level'] ?? $input['reorder'] ?? 50,
            $input['purchase_price'] ?? $input['purchasePrice'] ?? 0,
            $input['mrp'] ?? 0,
            $input['gst_rate'] ?? $input['gst'] ?? 5,
            $supplierId,
            $input['notes'] ?? null
        ]);

        logAudit($pdo, 'drugs', $id, 'INSERT', null, $input);
        sendResponse(['id' => $id, 'message' => 'Drug added successfully'], 201);
    }

    if ($method === 'PUT' && isset($segments[1])) {
        $id = $segments[1];
        $input = getInput() ?? [];

        $stmt = $pdo->prepare("SELECT * FROM drugs WHERE id = ?");
        $stmt->execute([$id]);
        $oldDrug = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$oldDrug) {
            http_response_code(404);
            sendResponse(['error' => 'Drug not found']);
        }

        $stmt = $pdo->prepare("UPDATE drugs SET name=?, generic_name=?, hsn_code=?, schedule_type=?, category_id=?, dosage_form=?, batch_number=?, expiry_date=?, current_stock=?, reorder_level=?, purchase_price=?, mrp=?, gst_rate=?, supplier_id=?, notes=?, updated_at=NOW() WHERE id=?");
        $stmt->execute([
            $input['name'] ?? $oldDrug['name'],
            $input['generic_name'] ?? $input['generic'] ?? $oldDrug['generic_name'],
            $input['hsn_code'] ?? $input['hsn'] ?? $oldDrug['hsn_code'],
            $input['schedule_type'] ?? $input['schedule'] ?? $oldDrug['schedule_type'],
            $input['category_id'] ?? $oldDrug['category_id'],
            $input['dosage_form'] ?? $input['form'] ?? $oldDrug['dosage_form'],
            $input['batch_number'] ?? $input['batch'] ?? $oldDrug['batch_number'],
            $input['expiry_date'] ?? $input['expiry'] ?? $oldDrug['expiry_date'],
            $input['current_stock'] ?? $input['stock'] ?? $oldDrug['current_stock'],
            $input['reorder_level'] ?? $input['reorder'] ?? $oldDrug['reorder_level'],
            $input['purchase_price'] ?? $input['purchasePrice'] ?? $oldDrug['purchase_price'],
            $input['mrp'] ?? $oldDrug['mrp'],
            $input['gst_rate'] ?? $input['gst'] ?? $oldDrug['gst_rate'],
            $input['supplier_id'] ?? $oldDrug['supplier_id'],
            $input['notes'] ?? $oldDrug['notes'],
            $id
        ]);

        logAudit($pdo, 'drugs', $id, 'UPDATE', $oldDrug, $input);
        sendResponse(['message' => 'Drug updated successfully']);
    }

    if ($method === 'DELETE' && isset($segments[1])) {
        $id = $segments[1];

        $stmt = $pdo->prepare("SELECT * FROM drugs WHERE id = ?");
        $stmt->execute([$id]);
        $oldDrug = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$oldDrug) {
            http_response_code(404);
            sendResponse(['error' => 'Drug not found']);
        }

        $stmt = $pdo->prepare("DELETE FROM drugs WHERE id = ?");
        $stmt->execute([$id]);

        logAudit($pdo, 'drugs', $id, 'DELETE', $oldDrug, null);
        sendResponse(['message' => 'Drug deleted successfully']);
    }
}

// PURCHASE ORDERS ENDPOINTS
if ($segments[0] === 'purchase-orders') {
    if ($method === 'GET') {
        $stmt = $pdo->query("
            SELECT po.*, s.name as supplier_name
            FROM purchase_orders po
            LEFT JOIN suppliers s ON po.supplier_id = s.id
            ORDER BY po.order_date DESC
        ");
        sendResponse($stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    if ($method === 'POST') {
        $input = getInput();
        $id = $input['id'] ?? 'PO-' . date('Y') . '-' . str_pad($pdo->query("SELECT COUNT(*) FROM purchase_orders")->fetchColumn() + 1, 3, '0', STR_PAD_LEFT);

        $stmt = $pdo->prepare("INSERT INTO purchase_orders (id, supplier_id, order_date, expected_delivery, total_amount, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            $id,
            $input['supplier_id'] ?? null,
            $input['order_date'] ?? date('Y-m-d'),
            $input['expected_delivery'] ?? null,
            $input['total_amount'] ?? 0,
            $input['status'] ?? 'Draft',
            $input['notes'] ?? null
        ]);

        sendResponse(['id' => $id, 'message' => 'PO created'], 201);
    }
}

// DISPENSING LOG ENDPOINTS
if ($segments[0] === 'dispensing') {
    if ($method === 'GET') {
        $stmt = $pdo->query("
            SELECT dl.*, d.name as drug_name
            FROM dispensing_log dl
            LEFT JOIN drugs d ON dl.drug_id = d.id
            ORDER BY dl.dispensing_date DESC
            LIMIT 100
        ");
        sendResponse($stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    if ($method === 'POST') {
        $input = getInput() ?? [];
        $id = $input['id'] ?? 'DX-' . date('Ymd') . '-' . str_pad((int)$pdo->query("SELECT COUNT(*) FROM dispensing_log")->fetchColumn() + 1, 4, '0', STR_PAD_LEFT);

        $drugId = $input['drug_id'] ?? '';
        $qty = (int)($input['quantity'] ?? 0);
        $unitPrice = (float)($input['unit_price'] ?? 0);
        $totalAmt = (float)($input['total_amount'] ?? ($qty * $unitPrice));

        if (empty($drugId)) {
            http_response_code(400);
            sendResponse(['error' => 'drug_id is required']);
        }

        $stmt = $pdo->prepare("INSERT INTO dispensing_log (id, drug_id, patient_id, prescription_number, quantity, unit_price, gst_amount, total_amount, staff_name, dispensing_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            $id,
            $drugId,
            $input['patient_id'] ?? null,
            $input['prescription_number'] ?? null,
            $qty,
            $unitPrice,
            $input['gst_amount'] ?? 0,
            $totalAmt,
            $input['staff_name'] ?? null,
            $input['dispensing_date'] ?? date('Y-m-d'),
            $input['notes'] ?? null
        ]);

        $stmt = $pdo->prepare("UPDATE drugs SET current_stock = GREATEST(0, current_stock - ?) WHERE id = ?");
        $stmt->execute([$qty, $drugId]);

        sendResponse(['id' => $id, 'message' => 'Dispensing recorded'], 201);
    }
}

// CATEGORIES ENDPOINTS
if ($segments[0] === 'categories') {
    if ($method === 'GET') {
        $stmt = $pdo->query("SELECT * FROM categories ORDER BY name");
        sendResponse($stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    if ($method === 'POST') {
        $input = getInput();
        $stmt = $pdo->prepare("INSERT INTO categories (name, description) VALUES (?, ?)");
        $stmt->execute([$input['name'], $input['description'] ?? null]);
        sendResponse(['message' => 'Category added', 'id' => $pdo->lastInsertId()], 201);
    }
}

// SUPPLIERS ENDPOINTS
if ($segments[0] === 'suppliers') {
    if ($method === 'GET') {
        $stmt = $pdo->query("SELECT * FROM suppliers WHERE is_active = 1 ORDER BY name");
        sendResponse($stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    if ($method === 'POST') {
        $input = getInput();
        $stmt = $pdo->prepare("INSERT INTO suppliers (name, contact_person, phone, email, address, gstin, license_number) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            $input['name'],
            $input['contact_person'] ?? null,
            $input['phone'] ?? null,
            $input['email'] ?? null,
            $input['address'] ?? null,
            $input['gstin'] ?? null,
            $input['license_number'] ?? null
        ]);
        sendResponse(['message' => 'Supplier added', 'id' => $pdo->lastInsertId()], 201);
    }
}

// ALERTS ENDPOINT
if ($segments[0] === 'alerts') {
    if ($method === 'GET') {
        $today = date('Y-m-d');
        $stmt = $pdo->prepare("
            SELECT d.*, DATEDIFF(d.expiry_date, ?) as days_left
            FROM drugs d
            WHERE d.expiry_date < DATE_ADD(?, INTERVAL 90 DAY)
            OR d.current_stock = 0
            OR d.current_stock <= d.reorder_level
            ORDER BY d.expiry_date ASC
        ");
        $stmt->execute([$today, $today]);
        $drugs = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $alerts = [];
        foreach ($drugs as $d) {
            if ($d['days_left'] <= 0) {
                $alerts[] ['type' => 'danger', 'msg' => "<strong>{$d['name']}</strong> has EXPIRED ({$d['expiry_date']})", 'label' => 'EXPIRED', 'drug' => $d];
            } elseif ($d['days_left'] <= 30) {
                $alerts[] ['type' => 'danger', 'msg' => "<strong>{$d['name']}</strong> expires in {$d['days_left']} days", 'label' => $d['days_left'] . 'd', 'drug' => $d];
            } elseif ($d['days_left'] <= 90) {
                $alerts[] ['type' => 'warning', 'msg' => "<strong>{$d['name']}</strong> expires in {$d['days_left']} days", 'label' => $d['days_left'] . 'd', 'drug' => $d];
            }
            if ($d['current_stock'] === 0) {
                $alerts[] ['type' => 'danger', 'msg' => "<strong>{$d['name']}</strong> is OUT OF STOCK", 'label' => 'OUT', 'drug' => $d];
            } elseif ($d['current_stock'] <= $d['reorder_level']) {
                $alerts[] ['type' => 'warning', 'msg' => "<strong>{$d['name']}</strong> stock low: {$d['current_stock']} (reorder: {$d['reorder_level']})", 'label' => 'LOW', 'drug' => $d];
            }
        }
        sendResponse(['alerts' => $alerts]);
    }
}

// REPORTS ENDPOINT
if ($segments[0] === 'reports') {
    if ($method === 'GET') {
        $reportType = $_GET['type'] ?? 'summary';

        if ($reportType === 'summary') {
            $totalSKUs = $pdo->query("SELECT COUNT(*) FROM drugs")->fetchColumn();
            $totalStock = $pdo->query("SELECT SUM(current_stock) FROM drugs")->fetchColumn();
            $totalValue = $pdo->query("SELECT SUM(current_stock * mrp) FROM drugs")->fetchColumn();
            $lowStock = $pdo->query("SELECT COUNT(*) FROM drugs WHERE current_stock > 0 AND current_stock <= reorder_level")->fetchColumn();
            $outOfStock = $pdo->query("SELECT COUNT(*) FROM drugs WHERE current_stock = 0")->fetchColumn();
            $today = date('Y-m-d');
            $expired = $pdo->prepare("SELECT COUNT(*) FROM drugs WHERE expiry_date < ?");
            $expired->execute([$today]);
            $expiredCount = $expired->fetchColumn();

            sendResponse([
                'total_skus' => $totalSKUs,
                'total_stock' => $totalStock,
                'total_value' => $totalValue,
                'low_stock' => $lowStock,
                'out_of_stock' => $outOfStock,
                'expired' => $expiredCount,
                'alerts' => $lowStock + $outOfStock + $expiredCount
            ]);
        }

        if ($reportType === 'by-schedule') {
            $stmt = $pdo->query("
                SELECT schedule_type, COUNT(*) as count, ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM drugs), 1) as percentage
                FROM drugs
                GROUP BY schedule_type
                ORDER BY count DESC
            ");
            sendResponse($stmt->fetchAll(PDO::FETCH_ASSOC));
        }

        if ($reportType === 'by-expiry') {
            $today = date('Y-m-d');
            $stmt = $pdo->query("
                SELECT
                    CASE
                        WHEN expiry_date < '$today' THEN 'Expired'
                        WHEN expiry_date <= DATE_ADD('$today', INTERVAL 30 DAY) THEN '< 30 days'
                        WHEN expiry_date <= DATE_ADD('$today', INTERVAL 90 DAY) THEN '30-90 days'
                        ELSE '> 90 days'
                    END as window,
                    COUNT(*) as count
                FROM drugs
                GROUP BY window
                ORDER BY count DESC
            ");
            sendResponse($stmt->fetchAll(PDO::FETCH_ASSOC));
        }

        if ($reportType === 'by-category') {
            $stmt = $pdo->query("
                SELECT c.name as category, COUNT(d.id) as items, SUM(d.current_stock) as units, SUM(d.current_stock * d.mrp) as value
                FROM categories c
                LEFT JOIN drugs d ON c.id = d.category_id
                GROUP BY c.id, c.name
                ORDER BY items DESC
            ");
            sendResponse($stmt->fetchAll(PDO::FETCH_ASSOC));
        }

        if ($reportType === 'valuation') {
            $stmt = $pdo->query("
                SELECT d.name, d.current_stock, d.mrp, d.purchase_price, (d.mrp - d.purchase_price) as margin, (d.current_stock * d.mrp) as stock_value
                FROM drugs d
                ORDER BY stock_value DESC
            ");
            sendResponse($stmt->fetchAll(PDO::FETCH_ASSOC));
        }

        http_response_code(400);
        sendResponse(['error' => 'Invalid report type']);
    }
}

http_response_code(404);
sendResponse(['error' => 'Endpoint not found']);
