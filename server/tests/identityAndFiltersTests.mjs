import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { newDb } from 'pg-mem';

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awlad_selim_identity_filters_test_'));
process.env.AWLAD_DATA_DIR = tempDataDir;
process.env.JWT_SECRET = 'test_jwt_secret_key_for_identity_and_filters_suite_2026_secure';

const { createApiApp, initializeServerRuntime } = await import('../app.js');
const { setInjectedPool, initializeSchema } = await import('../db/postgres.js');
const { resetPgModeCache } = await import('../db/stores/mode.js');
const { runSafeIdentityAuditAndBackfill } = await import('../db/identityManager.js');
const { readJsonDatabase, writeJsonDatabase } = await import('../db/jsonLedger.js');

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(err);
    throw err;
  }
}

async function req(baseUrl, method, urlPath, { token, body } = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function createPgMemPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const pgAdapter = db.adapters.createPg();
  const MemPool = pgAdapter.Pool;
  const memPool = new MemPool();
  return {
    async query(sql, params) {
      return memPool.query(sql, params);
    },
    async connect() {
      const client = await memPool.connect();
      return {
        query(sql, params) {
          return client.query(sql, params);
        },
        release() {
          client.release();
        },
      };
    },
  };
}

async function runSuite(modeLabel, pgPool = null) {
  console.log(`\n=== Unified Identity & Report Filters Test Suite (${modeLabel}) ===`);
  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Bootstrap admin
    const bootRes = await req(baseUrl, 'POST', '/api/auth/bootstrap-admin', {
      body: { fullName: 'مدير النظام العام', username: 'id_admin', password: 'Password123!' },
    });
    assert.equal(bootRes.status, 201);
    const loginAdmin = await req(baseUrl, 'POST', '/api/auth/login', {
      body: { username: 'id_admin', password: 'Password123!' },
    });
    assert.equal(loginAdmin.status, 200);
    const adminToken = loginAdmin.json.accessToken;

    // Create warehouse, cashbox, product
    const whRes = await req(baseUrl, 'POST', '/api/inventory/warehouses', {
      token: adminToken,
      body: { name: 'المخزن الرئيسي', code: 'WH-MAIN', location: 'القاهرة', isDefault: true },
    });
    assert.equal(whRes.status, 201);
    const whId = whRes.json.warehouse.id;

    const cbRes = await req(baseUrl, 'POST', '/api/admin/cashboxes', {
      token: adminToken,
      body: { name: 'الخزينة الرئيسية', type: 'cashbox', openingBalance: 5000, isDefault: true },
    });
    assert.equal(cbRes.status, 201);
    const cbId = cbRes.json.cashbox.id;

    const prodRes = await req(baseUrl, 'POST', '/api/products', {
      token: adminToken,
      body: {
        name: 'شاي العروسة 250 جم',
        code: 'TEA-250',
        barcode: '622998877',
        category: 'مشروبات',
        baseUnit: 'علبة',
        purchasePrice: 45,
        sellingPrice: 60,
        stockPerWarehouse: { [whId]: 100 },
      },
    });
    assert.equal(prodRes.status, 201);
    const prodId = prodRes.json.product.id;

    let emp1Id;
    let emp1IdentityId;
    let staffUser1Id;
    let staffUser1Token;

    await test(`[${modeLabel}] 1. Employee-first creation then User linkage shares identityId with 0 duplicate employees`, async () => {
      const eRes = await req(baseUrl, 'POST', '/api/admin/employees', {
        token: adminToken,
        body: {
          code: 'EMP-901',
          name: 'طارق عبد الله',
          phone: '01012345678',
          nationalId: '29501011234567',
          jobTitle: 'أمين مخزن ومبيعات',
          department: 'المبيعات',
          basicSalary: 6500,
        },
      });
      assert.equal(eRes.status, 201);
      emp1Id = eRes.json.employee.id;
      emp1IdentityId = eRes.json.employee.identityId;
      assert.ok(emp1IdentityId, 'Employee must receive a unified identityId');

      const uRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'طارق عبد الله',
          username: 'tarek_sales',
          password: 'Password123!',
          phone: '01012345678',
          role: 'sales',
          jobTitle: 'مسؤول مبيعات',
          department: 'المبيعات',
          linkedEmployeeId: emp1Id,
          permissions: {
            canView: true,
            canAdd: true,
            canManageSales: true,
            canViewReports: true,
            canPrint: true,
          },
        },
      });
      assert.equal(uRes.status, 201);
      staffUser1Id = uRes.json.user.id;
      assert.equal(uRes.json.user.employeeId, emp1Id);
      assert.equal(uRes.json.user.identityId, emp1IdentityId);

      // Verify zero duplicate employees were created
      const idnRes = await req(baseUrl, 'GET', '/api/admin/identities', { token: adminToken });
      assert.equal(idnRes.status, 200);
      const tarekIdn = idnRes.json.identities.find((i) => i.id === emp1IdentityId);
      assert.ok(tarekIdn);
      const roleTypes = (tarekIdn.roles || []).map((r) => r.linkedRecordType);
      assert.ok(roleTypes.includes('employee'));
      assert.ok(roleTypes.includes('user'));

      const loginStaff = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'tarek_sales', password: 'Password123!' },
      });
      assert.equal(loginStaff.status, 200);
      staffUser1Token = loginStaff.json.accessToken;
    });

    await test(`[${modeLabel}] 2. Duplicate nationalId on employee blocks with 409 CONFLICT`, async () => {
      const dupEmpRes = await req(baseUrl, 'POST', '/api/admin/employees', {
        token: adminToken,
        body: {
          code: 'EMP-902',
          name: 'شخص مكرر بالرقم القومي',
          phone: '01099887766',
          nationalId: '29501011234567',
          jobTitle: 'موظف',
          department: 'المبيعات',
          basicSalary: 4000,
        },
      });
      assert.equal(dupEmpRes.status, 409);
      assert.equal(dupEmpRes.json.code, 'DUPLICATE_EMPLOYEE_NATIONAL_ID');
    });

    let cust1Id;
    let cust2Id;
    let supp1Id;

    await test(`[${modeLabel}] 3. Customer-first + self-registration linkage & shared-phone separate identities`, async () => {
      const c1 = await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: { name: 'ماركت الأمانة', phone: '01055566677', openingBalance: 200 },
      });
      assert.equal(c1.status, 201);
      cust1Id = c1.json.customer.id;
      const c1IdentityId = c1.json.customer.identityId;
      assert.ok(c1IdentityId);

      // Creating customer B with allowPhoneOverlap shares phone cleanly without merging identities
      const c2 = await req(baseUrl, 'POST', '/api/customers', {
        token: adminToken,
        body: { name: 'ماركت الأخوة', phone: '01055566677', allowPhoneOverlap: true, openingBalance: 0 },
      });
      assert.equal(c2.status, 201);
      cust2Id = c2.json.customer.id;
      assert.notEqual(c2.json.customer.identityId, c1IdentityId, 'Shared-phone distinct customers remain separate identities');

      // Mobile customer self-registration links to existing user/customer safely or creates dedicated customer identity
      const regCust = await req(baseUrl, 'POST', '/api/auth/register', {
        body: {
          role: 'customer',
          fullName: 'حساب عميل مستقل',
          username: 'cust_self_1',
          password: 'Password123!',
          phone: '01233445566',
        },
      });
      assert.equal(regCust.status, 201);
      assert.ok(regCust.json.user.identityId);

      // Supplier
      const s1 = await req(baseUrl, 'POST', '/api/admin/suppliers', {
        token: adminToken,
        body: { name: 'مورد السلام للتجارة', phone: '01122334455', openingBalance: 0 },
      });
      assert.equal(s1.status, 201);
      supp1Id = s1.json.supplier.id;
    });

    let repEmpId;
    let repUserId;
    let repId;
    let repTokenNoPurchase;

    await test(`[${modeLabel}] 4. Multi-role Employee + Representative shares identityId while keeping RBAC isolated`, async () => {
      const empRepRes = await req(baseUrl, 'POST', '/api/admin/employees', {
        token: adminToken,
        body: {
          code: 'EMP-903',
          name: 'كريم المندوب',
          phone: '01511223344',
          jobTitle: 'مندوب توزيع ميداني',
          department: 'التوزيع',
          basicSalary: 5500,
        },
      });
      assert.equal(empRepRes.status, 201);
      repEmpId = empRepRes.json.employee.id;
      const empRepIdn = empRepRes.json.employee.identityId;

      const uRepRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'كريم المندوب',
          username: 'karim_rep',
          password: 'Password123!',
          phone: '01511223344',
          role: 'representative',
          linkedEmployeeId: repEmpId,
          autoCreateRepProfile: true,
          permissions: {
            canView: true,
            canAdd: true,
            canManageSales: true,
            canCreatePurchase: false,
            canViewReports: true,
          },
        },
      });
      assert.equal(uRepRes.status, 201);
      repUserId = uRepRes.json.user.id;
      repId = uRepRes.json.user?.linkedRepresentativeId || uRepRes.json.linkedRepresentativeId;
      assert.ok(repId);
      assert.equal(uRepRes.json.user.employeeId, repEmpId);
      assert.equal(uRepRes.json.user.identityId, empRepIdn);

      const loginRep = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'karim_rep', password: 'Password123!' },
      });
      assert.equal(loginRep.status, 200);
      repTokenNoPurchase = loginRep.json.accessToken;
    });

    await test(`[${modeLabel}] 5. Transactions stamp actorIdentityId & report filters keep Employee strictly separate from User`, async () => {
      const today = new Date().toISOString().split('T')[0];

      // Sale created by staffUser1 (linked to emp1Id) for cust1Id
      const sInv = await req(baseUrl, 'POST', '/api/invoices/sales', {
        token: staffUser1Token,
        body: {
          date: today,
          customerId: cust1Id,
          customerName: 'ماركت الأمانة',
          warehouseId: whId,
          warehouseName: 'المخزن الرئيسي',
          cashboxId: cbId,
          paymentType: 'cash',
          paidAmount: 120,
          items: [
            {
              productId: prodId,
              productName: 'شاي العروسة 250 جم',
              unit: 'علبة',
              unitFactor: 1,
              quantity: 2,
              unitPrice: 60,
              purchasePriceAtTime: 45,
              discount: 0,
              total: 120,
            },
          ],
        },
      });
      assert.equal(sInv.status, 201);
      assert.equal(sInv.json.invoice.actorEmployeeId, emp1Id);
      assert.equal(sInv.json.invoice.actorIdentityId, emp1IdentityId);

      // Purchase invoice created by admin for supp1Id
      const pInv = await req(baseUrl, 'POST', '/api/invoices/purchase', {
        token: adminToken,
        body: {
          date: today,
          supplierId: supp1Id,
          supplierName: 'مورد السلام للتجارة',
          warehouseId: whId,
          warehouseName: 'المخزن الرئيسي',
          cashboxId: cbId,
          paymentType: 'cash',
          paidAmount: 450,
          items: [
            {
              productId: prodId,
              productName: 'شاي العروسة 250 جم',
              unit: 'علبة',
              unitFactor: 1,
              quantity: 10,
              unitPrice: 45,
              purchasePriceAtTime: 45,
              discount: 0,
              total: 450,
            },
          ],
        },
      });
      assert.equal(pInv.status, 201);

      // Filter by employeeId = emp1Id returns sales row created by staffUser1 (not purchase created by admin)
      const byEmp = await req(
        baseUrl,
        'GET',
        `/api/reports/comprehensive?reportType=all&dateFrom=${today}&dateTo=${today}&employeeId=${encodeURIComponent(emp1Id)}`,
        { token: adminToken }
      );
      assert.equal(byEmp.status, 200);
      const empRows = byEmp.json.report.sections.flatMap((s) => s.rows);
      assert.ok(empRows.length >= 1);
      assert.ok(empRows.every((r) => r.employeeId === emp1Id || r.actorEmployeeId === emp1Id));

      // Filter by userId = adminUser vs staffUser1 stays strictly distinct
      const byUser = await req(
        baseUrl,
        'GET',
        `/api/reports/comprehensive?reportType=all&dateFrom=${today}&dateTo=${today}&userId=${encodeURIComponent(staffUser1Id)}`,
        { token: adminToken }
      );
      assert.equal(byUser.status, 200);
      const userRows = byUser.json.report.sections.flatMap((s) => s.rows);
      assert.ok(userRows.length >= 1);
      assert.ok(userRows.every((r) => r.docType !== 'purchase_invoice' && r.movementCategory !== 'purchase'));

      // Filter by unified partyKey=customer:<id> and partyKey=supplier:<id>
      const byCustParty = await req(
        baseUrl,
        'GET',
        `/api/reports/comprehensive?reportType=all&partyKey=customer:${encodeURIComponent(cust1Id)}`,
        { token: adminToken }
      );
      assert.equal(byCustParty.status, 200);
      const custPartyRows = byCustParty.json.report.sections.flatMap((s) => s.rows);
      assert.ok(custPartyRows.some((r) => r.docType === 'sales_invoice' || r.movementCategory === 'sales'));
      assert.ok(custPartyRows.every((r) => r.customerId === cust1Id));

      const bySuppParty = await req(
        baseUrl,
        'GET',
        `/api/reports/comprehensive?reportType=all&partyKey=supplier:${encodeURIComponent(supp1Id)}`,
        { token: adminToken }
      );
      assert.equal(bySuppParty.status, 200);
      const suppPartyRows = bySuppParty.json.report.sections.flatMap((s) => s.rows);
      assert.ok(suppPartyRows.some((r) => r.docType === 'purchase_invoice' || r.movementCategory === 'purchase'));
      assert.ok(suppPartyRows.every((r) => r.supplierId === supp1Id));

      // Filter by movementType=purchase returns only purchases
      const byMove = await req(
        baseUrl,
        'GET',
        `/api/reports/comprehensive?reportType=all&movementType=purchase`,
        { token: adminToken }
      );
      assert.equal(byMove.status, 200);
      const moveRows = byMove.json.report.sections.flatMap((s) => s.rows);
      assert.ok(moveRows.length >= 1);
      assert.ok(moveRows.every((r) => r.docType === 'purchase_invoice' || r.movementCategory === 'purchase'));

      // Filter by product barcode / productId
      const byBarcode = await req(
        baseUrl,
        'GET',
        `/api/reports/comprehensive?reportType=all&barcode=622998877`,
        { token: adminToken }
      );
      assert.equal(byBarcode.status, 200);
      assert.ok(byBarcode.json.report.sections.flatMap((s) => s.rows).length >= 2);

      // Rep without purchase permission is strictly blocked from querying supplier partyKey
      const repBlocked = await req(
        baseUrl,
        'GET',
        `/api/reports/rep-summary?partyKey=supplier:${encodeURIComponent(supp1Id)}`,
        { token: repTokenNoPurchase }
      );
      assert.equal(repBlocked.status, 403);
    });

    await test(`[${modeLabel}] 6. Safe identity audit does NOT auto-merge name-only ambiguities & admin conflict resolution works`, async () => {
      // Create two distinct-phone employees sharing identical Arabic name — should NOT auto-merge
      const empA = await req(baseUrl, 'POST', '/api/admin/employees', {
        token: adminToken,
        body: { code: 'EMP-AMB-1', name: 'محمد حسن علي', phone: '01077711101', jobTitle: 'سائق', department: 'التوزيع', basicSalary: 4000 },
      });
      const empB = await req(baseUrl, 'POST', '/api/admin/employees', {
        token: adminToken,
        body: { code: 'EMP-AMB-2', name: 'محمد حسن علي', phone: '01077711102', jobTitle: 'أمين مخزن', department: 'المخازن', basicSalary: 4200 },
      });
      assert.equal(empA.status, 201);
      assert.equal(empB.status, 201);
      assert.notEqual(empA.json.employee.identityId, empB.json.employee.identityId);

      // Run safe audit via admin endpoint
      const auditRes = await req(baseUrl, 'POST', '/api/admin/identities/audit', {
        token: adminToken,
        body: { createBackup: true },
      });
      assert.equal(auditRes.status, 200);
      assert.equal(auditRes.json.ok, true);

      // Ambiguous same-name candidates remain separate and appear in conflicts or separate identities
      const idnAfter = await req(baseUrl, 'GET', '/api/admin/identities', { token: adminToken });
      assert.equal(idnAfter.status, 200);
      const idnA = idnAfter.json.identities.find((i) => (i.roles || []).some((r) => r.linkedRecordId === empA.json.employee.id));
      const idnB = idnAfter.json.identities.find((i) => (i.roles || []).some((r) => r.linkedRecordId === empB.json.employee.id));
      assert.ok(idnA && idnB);
      assert.notEqual(idnA.id, idnB.id, 'Name-only ambiguous records must NEVER be auto-merged');

      if (idnAfter.json.conflicts.length > 0) {
        const cfId = idnAfter.json.conflicts[0].id;
        const resolveRes = await req(baseUrl, 'POST', `/api/admin/identities/conflicts/${encodeURIComponent(cfId)}/resolve`, {
          token: adminToken,
          body: { status: 'dismissed', resolutionNotes: 'اسمان متشابهان لشخصين مختلفين' },
        });
        assert.equal(resolveRes.status, 200);
        assert.equal(resolveRes.json.conflict.status, 'dismissed');
      }

      // Direct runSafeIdentityAuditAndBackfill smoke check
      const directRes = await runSafeIdentityAuditAndBackfill({ executedBy: 'test_suite', createBackup: false });
      assert.equal(directRes.ok, true);
    });

    await test(`[${modeLabel}] 7. Operational actor attribution (actorIdentityId, actorEmployeeId, actingRole) across stores & startup backfill`, async () => {
      // Create linked HR employee + system user acting as sales/inventory operator
      const opEmpRes = await req(baseUrl, 'POST', '/api/admin/employees', {
        token: adminToken,
        body: { code: 'EMP-ACTOR-1', name: 'أحمد أمين المخزن', phone: '01088811199', jobTitle: 'أمين مخزن', department: 'المخازن', basicSalary: 5000 },
      });
      assert.equal(opEmpRes.status, 201);
      const opEmpId = opEmpRes.json.employee.id;
      const opIdentityId = opEmpRes.json.employee.identityId;
      assert.ok(opIdentityId);

      const opUserRes = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'أحمد أمين المخزن',
          username: 'actor_wh_user',
          password: 'Password123!',
          role: 'warehouse',
          phone: '01088811199',
          linkedEmployeeId: opEmpId,
          permissions: {
            canManageInventory: true,
            canManageCashboxes: true,
            canManageAccounts: true,
            canAdd: true,
            canEdit: true,
          },
        },
      });
      assert.equal(opUserRes.status, 201);
      assert.equal(opUserRes.json.user.identityId, opIdentityId);
      assert.equal(opUserRes.json.user.employeeId, opEmpId);

      const loginOp = await req(baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'actor_wh_user', password: 'Password123!' },
      });
      assert.equal(loginOp.status, 200);
      const opToken = loginOp.json.accessToken;

      // 1) Create product with opening balance -> stock_movements stamped with actor identity
      const prodOpRes = await req(baseUrl, 'POST', '/api/products', {
        token: opToken,
        body: {
          code: 'PRD-ACT-1',
          barcode: '622000111222',
          name: 'صنف اختبار الهوية',
          category: 'عام',
          baseUnit: 'قطعة',
          purchasePrice: 50,
          sellingPrice: 70,
          stockPerWarehouse: { [whId]: 25 },
        },
      });
      assert.equal(prodOpRes.status, 201);

      // 2) Record damaged stock -> stock_movements stamped with actor identity
      const dmgRes = await req(baseUrl, 'POST', '/api/inventory/damaged', {
        token: opToken,
        body: { productId: prodOpRes.json.product.id, warehouseId: whId, quantity: 2, reason: 'اختبار تالف' },
      });
      assert.equal(dmgRes.status, 200);

      // 3) Record expense -> expenses_incomes & financial_transactions stamped with actor identity
      const cashOpRes = await req(baseUrl, 'POST', '/api/admin/expenses', {
        token: opToken,
        body: {
          type: 'expense',
          category: 'مصروفات تشغيل',
          amount: 125,
          cashboxId: cbId,
          description: 'اختبار مصروف بهوية',
        },
      });
      assert.equal(cashOpRes.status, 201);

      // Verify actor attribution directly in underlying store (PG or JSON)
      if (pgPool) {
        const movs = await pgPool.query(
          `SELECT actor_identity_id, actor_employee_id, acting_role FROM stock_movements WHERE product_id = $1`,
          [prodOpRes.json.product.id]
        );
        assert.ok(movs.rows.length >= 2);
        for (const r of movs.rows) {
          assert.equal(r.actor_identity_id, opIdentityId);
          assert.equal(r.actor_employee_id, opEmpId);
          assert.equal(r.acting_role, 'warehouse');
        }

        const expRows = await pgPool.query(
          `SELECT actor_identity_id, actor_employee_id, acting_role FROM expenses_incomes WHERE id = $1`,
          [cashOpRes.json.record.id]
        );
        assert.equal(expRows.rows.length, 1);
        assert.equal(expRows.rows[0].actor_identity_id, opIdentityId);
        assert.equal(expRows.rows[0].actor_employee_id, opEmpId);
        assert.equal(expRows.rows[0].acting_role, 'warehouse');

        const ftRows = await pgPool.query(
          `SELECT actor_identity_id, actor_employee_id, acting_role FROM financial_transactions WHERE amount = 125 AND type = 'expense'`
        );
        assert.equal(ftRows.rows.length, 1);
        assert.equal(ftRows.rows[0].actor_identity_id, opIdentityId);
        assert.equal(ftRows.rows[0].actor_employee_id, opEmpId);
        assert.equal(ftRows.rows[0].acting_role, 'warehouse');

        const auditRows = await pgPool.query(
          `SELECT actor_identity_id, actor_employee_id, acting_role FROM audit_logs WHERE user_id = $1`,
          [opUserRes.json.user.id]
        );
        assert.ok(auditRows.rows.length >= 1);
        assert.ok(auditRows.rows.every((r) => r.actor_identity_id === opIdentityId && r.actor_employee_id === opEmpId && r.acting_role === 'warehouse'));

        // Simulate legacy row without identity_id and verify startup backfill fixes it safely
        await pgPool.query(`UPDATE employees SET identity_id = NULL WHERE id = $1`, [opEmpId]);
        await initializeServerRuntime();
        const afterBoot = await pgPool.query(`SELECT identity_id FROM employees WHERE id = $1`, [opEmpId]);
        assert.equal(afterBoot.rows[0].identity_id, opIdentityId);
      } else {
        const db = readJsonDatabase();
        const movs = (db.stockMovements || []).filter((m) => m.productId === prodOpRes.json.product.id);
        assert.ok(movs.length >= 2);
        for (const m of movs) {
          assert.equal(m.actorIdentityId, opIdentityId);
          assert.equal(m.actorEmployeeId, opEmpId);
          assert.equal(m.actingRole, 'warehouse');
        }
        const expRow = (db.expenseIncomes || []).find((e) => e.description === 'اختبار مصروف بهوية');
        assert.ok(expRow);
        assert.equal(expRow.actorIdentityId, opIdentityId);
        assert.equal(expRow.actorEmployeeId, opEmpId);
        assert.equal(expRow.actingRole, 'warehouse');

        const ftRow = (db.financialTransactions || []).find((f) => f.amount === 125 && f.type === 'expense');
        assert.ok(ftRow);
        assert.equal(ftRow.actorIdentityId, opIdentityId);
        assert.equal(ftRow.actorEmployeeId, opEmpId);
        assert.equal(ftRow.actingRole, 'warehouse');

        // Simulate legacy JSON record without identityId and verify startup backfill fixes it safely
        const empRec = (db.employees || []).find((e) => e.id === opEmpId);
        assert.ok(empRec);
        delete empRec.identityId;
        writeJsonDatabase(db);
        await initializeServerRuntime();
        const dbAfterBoot = readJsonDatabase();
        const repairedEmp = (dbAfterBoot.employees || []).find((e) => e.id === opEmpId);
        assert.equal(repairedEmp.identityId, opIdentityId);
      }
    });

    let isoEmpAId;
    let isoEmpBId;
    let isoUserAId;
    let isoUserFreeId;

    await test(`[${modeLabel}] 8. Strict 1:1 Employee<->User uniqueness, symmetric conflict blocking, and customer-employee role guard`, async () => {
      const eA = await req(baseUrl, 'POST', '/api/admin/employees', {
        token: adminToken,
        body: { code: 'EMP-1TO1-A', name: 'موظف واحد لواحد أ', phone: '01091000001', jobTitle: 'محاسب', department: 'المالية', basicSalary: 5000 },
      });
      assert.equal(eA.status, 201);
      isoEmpAId = eA.json.employee.id;

      const eB = await req(baseUrl, 'POST', '/api/admin/employees', {
        token: adminToken,
        body: { code: 'EMP-1TO1-B', name: 'موظف واحد لواحد ب', phone: '01091000002', jobTitle: 'بائع', department: 'المبيعات', basicSalary: 4500 },
      });
      assert.equal(eB.status, 201);
      isoEmpBId = eB.json.employee.id;

      // Customer role cannot be linked to an employee
      const custWithEmp = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'عميل مرفوض مع موظف',
          username: 'cust_with_emp_err',
          password: 'Password123!',
          phone: '01091000099',
          role: 'customer',
          linkedEmployeeId: isoEmpBId,
        },
      });
      assert.equal(custWithEmp.status, 400);
      assert.equal(custWithEmp.json.code, 'INVALID_ROLE_EMPLOYEE_LINK');

      // Link userA -> empA
      const uA = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'مستخدم واحد لواحد أ',
          username: 'user_1to1_a',
          password: 'Password123!',
          phone: '01091000001',
          role: 'sales',
          linkedEmployeeId: isoEmpAId,
        },
      });
      assert.equal(uA.status, 201);
      isoUserAId = uA.json.user.id;
      assert.equal(uA.json.user.employeeId, isoEmpAId);
      assert.equal(uA.json.user.identityId, eA.json.employee.identityId);

      // Creating a second user linked to empA -> 409 EMPLOYEE_ALREADY_LINKED
      const uDup = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'مستخدم مكرر على نفس الموظف',
          username: 'user_1to1_dup',
          password: 'Password123!',
          phone: '01091000003',
          role: 'sales',
          linkedEmployeeId: isoEmpAId,
        },
      });
      assert.equal(uDup.status, 409);
      assert.equal(uDup.json.code, 'EMPLOYEE_ALREADY_LINKED');

      // Create unlinked userFree, then try stealing empA -> 409
      const uFree = await req(baseUrl, 'POST', '/api/admin/users', {
        token: adminToken,
        body: {
          fullName: 'مستخدم حر',
          username: 'user_1to1_free',
          password: 'Password123!',
          phone: '01091000004',
          role: 'sales',
        },
      });
      assert.equal(uFree.status, 201);
      isoUserFreeId = uFree.json.user.id;

      const stealFromUserPut = await req(baseUrl, 'PUT', `/api/admin/users/${isoUserFreeId}`, {
        token: adminToken,
        body: { linkedEmployeeId: isoEmpAId },
      });
      assert.equal(stealFromUserPut.status, 409);
      assert.equal(stealFromUserPut.json.code, 'EMPLOYEE_ALREADY_LINKED');

      // Employee-side create/update linking to already-linked userA -> 409 USER_ALREADY_LINKED_TO_EMPLOYEE
      const empCreateSteal = await req(baseUrl, 'POST', '/api/admin/employees', {
        token: adminToken,
        body: { code: 'EMP-1TO1-STEAL', name: 'موظف يسرق مستخدم', phone: '01091000005', jobTitle: 'بائع', userId: isoUserAId },
      });
      assert.equal(empCreateSteal.status, 409);
      assert.equal(empCreateSteal.json.code, 'USER_ALREADY_LINKED_TO_EMPLOYEE');

      const empUpdateSteal = await req(baseUrl, 'PUT', `/api/admin/employees/${isoEmpBId}`, {
        token: adminToken,
        body: { userId: isoUserAId },
      });
      assert.equal(empUpdateSteal.status, 409);
      assert.equal(empUpdateSteal.json.code, 'USER_ALREADY_LINKED_TO_EMPLOYEE');

      // Employee linked to customer user -> 400 INVALID_ROLE_EMPLOYEE_LINK
      const bootSnap = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
      const custUser = (bootSnap.json.data.users || []).find((u) => u.role === 'customer');
      assert.ok(custUser);
      const empCustErr = await req(baseUrl, 'PUT', `/api/admin/employees/${isoEmpBId}`, {
        token: adminToken,
        body: { userId: custUser.id },
      });
      assert.equal(empCustErr.status, 400);
      assert.equal(empCustErr.json.code, 'INVALID_ROLE_EMPLOYEE_LINK');

      // Manual identity endpoint must also reject stealing linked entity
      const manualSteal = await req(baseUrl, 'POST', '/api/admin/identities/link', {
        token: adminToken,
        body: { targetType: 'employee', targetId: isoEmpBId, linkUserId: isoUserAId },
      });
      assert.equal(manualSteal.status, 409);
    });

    await test(`[${modeLabel}] 9. Clean null unlink splits shared identity and allows re-link without DUPLICATE_IDENTITY_ROLE`, async () => {
      // Unlink userA from empA via explicit null
      const unlinkFromUser = await req(baseUrl, 'PUT', `/api/admin/users/${isoUserAId}`, {
        token: adminToken,
        body: { linkedEmployeeId: null },
      });
      assert.equal(unlinkFromUser.status, 200);
      assert.ok(!unlinkFromUser.json.user.employeeId, 'userA employeeId must be cleared after null unlink');

      let bootAfterUnlink = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
      const empAAfterUnlink = bootAfterUnlink.json.data.employees.find((e) => e.id === isoEmpAId);
      const userAAfterUnlink = bootAfterUnlink.json.data.users.find((u) => u.id === isoUserAId);
      assert.ok(!empAAfterUnlink.userId, 'empA userId must be cleared symmetrically');
      assert.notEqual(
        empAAfterUnlink.identityId,
        userAAfterUnlink.identityId,
        'Detaching employee from user must split into distinct identities cleanly'
      );

      // Re-link userA to empB cleanly (previously caused DUPLICATE_IDENTITY_ROLE before identity split)
      const relinkToEmpB = await req(baseUrl, 'PUT', `/api/admin/users/${isoUserAId}`, {
        token: adminToken,
        body: { linkedEmployeeId: isoEmpBId },
      });
      assert.equal(relinkToEmpB.status, 200);
      assert.equal(relinkToEmpB.json.user.employeeId, isoEmpBId);

      // Now unlink from employee side via userId: null
      const unlinkFromEmp = await req(baseUrl, 'PUT', `/api/admin/employees/${isoEmpBId}`, {
        token: adminToken,
        body: { userId: null },
      });
      assert.equal(unlinkFromEmp.status, 200);

      let bootAfterEmpUnlink = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
      const empBAfter = bootAfterEmpUnlink.json.data.employees.find((e) => e.id === isoEmpBId);
      const userAAfterEmpUnlink = bootAfterEmpUnlink.json.data.users.find((u) => u.id === isoUserAId);
      assert.ok(!empBAfter.userId, 'empB userId must be cleared');
      assert.ok(!userAAfterEmpUnlink.employeeId, 'userA employeeId must be cleared when employee unlinks');
      assert.notEqual(empBAfter.identityId, userAAfterEmpUnlink.identityId);

      // Re-link empA -> userA from Employees side
      const relinkFromEmpSide = await req(baseUrl, 'PUT', `/api/admin/employees/${isoEmpAId}`, {
        token: adminToken,
        body: { userId: isoUserAId },
      });
      assert.equal(relinkFromEmpSide.status, 200);
      const bootFinal = await req(baseUrl, 'GET', '/api/admin/bootstrap', { token: adminToken });
      const empAFinal = bootFinal.json.data.employees.find((e) => e.id === isoEmpAId);
      const userAFinal = bootFinal.json.data.users.find((u) => u.id === isoUserAId);
      assert.equal(empAFinal.userId, isoUserAId);
      assert.equal(userAFinal.employeeId, isoEmpAId);
      assert.equal(empAFinal.identityId, userAFinal.identityId);
    });

    if (pgPool) {
      await test(`[${modeLabel}] 10. Direct PG constraints block raw duplicate 1:1 links, allow multiple NULLs, and v14 preserves conflicts non-destructively`, async () => {
        // Multiple NULLs allowed on both tables
        await pgPool.query(
          `INSERT INTO employees (id, code, full_name, job_title, hire_date, status) VALUES ('EMP-SQL-N1', 'SQL-N1', 'حر 1', 'موظف', '2026-11-24', 'active'), ('EMP-SQL-N2', 'SQL-N2', 'حر 2', 'موظف', '2026-11-24', 'active')`
        );
        await pgPool.query(
          `INSERT INTO users (id, full_name, username, password_hash, role) VALUES ('USR-SQL-N1', 'مستخدم حر 1', 'sql_null_1', 'h', 'sales'), ('USR-SQL-N2', 'مستخدم حر 2', 'sql_null_2', 'h', 'sales')`
        );

        // Raw duplicate employee_id on users blocked by idx_users_employee_id_unique (23505)
        await assert.rejects(
          pgPool.query(
            `INSERT INTO users (id, full_name, username, password_hash, role, employee_id) VALUES ('USR-SQL-DUP', 'مستخدم مكرر', 'sql_dup_emp', 'h', 'sales', $1)`,
            [isoEmpAId]
          ),
          (err) => String(err?.code) === '23505' || /unique/i.test(String(err?.message || ''))
        );

        // Raw duplicate user_id on employees blocked by idx_employees_user_id_unique (23505)
        await assert.rejects(
          pgPool.query(
            `INSERT INTO employees (id, code, full_name, job_title, hire_date, user_id, status) VALUES ('EMP-SQL-DUP', 'SQL-DUP', 'موظف مكرر', 'بائع', '2026-11-24', $1, 'active')`,
            [isoUserAId]
          ),
          (err) => String(err?.code) === '23505' || /unique/i.test(String(err?.message || ''))
        );

        // Non-destructive v14 migration test on an isolated PG instance with legacy conflicting rows
        const legacyPool = createPgMemPool();
        setInjectedPool(legacyPool);
        resetPgModeCache();
        try {
          const baseInit = await initializeSchema();
          assert.equal(baseInit.success, true, baseInit.error || 'Base init for legacy test must succeed');

          // Drop v14 unique indexes to simulate pre-v14 legacy state and insert duplicate/asymmetric rows
          await legacyPool.query(`DROP INDEX IF EXISTS idx_users_employee_id_unique`);
          await legacyPool.query(`DROP INDEX IF EXISTS idx_employees_user_id_unique`);
          await legacyPool.query(`DELETE FROM identity_conflicts`);
          await legacyPool.query(`DELETE FROM users`);
          await legacyPool.query(`DELETE FROM employees`);

          await legacyPool.query(`
            INSERT INTO employees (id, code, full_name, job_title, hire_date, user_id) VALUES
              ('E-LEG-1', 'LEG-1', 'موظف متضارب', 'بائع', '2026-11-24', NULL),
              ('E-LEG-OK', 'LEG-OK', 'موظف سليم', 'بائع', '2026-11-24', NULL)
          `);
          await legacyPool.query(`
            INSERT INTO users (id, full_name, username, password_hash, role, employee_id) VALUES
              ('U-LEG-1', 'تضارب 1', 'leg1', 'h', 'sales', 'E-LEG-1'),
              ('U-LEG-2', 'تضارب 2', 'leg2', 'h', 'sales', 'E-LEG-1'),
              ('U-LEG-OK', 'سليم 1', 'legok', 'h', 'sales', 'E-LEG-OK')
          `);
          await legacyPool.query(`UPDATE employees SET user_id = 'U-LEG-1' WHERE id = 'E-LEG-1'`);

          const initRes = await initializeSchema();
          assert.equal(initRes.success, true, initRes.error || 'Legacy non-destructive v14 schema init must succeed');

          // Zero deletions allowed!
          const uCnt = await legacyPool.query(`SELECT COUNT(*)::int AS cnt FROM users`);
          const eCnt = await legacyPool.query(`SELECT COUNT(*)::int AS cnt FROM employees`);
          assert.equal(Number(uCnt.rows[0].cnt), 3);
          assert.equal(Number(eCnt.rows[0].cnt), 2);

          // Conflict must be logged into identity_conflicts
          const conflictsRes = await legacyPool.query(
            `SELECT * FROM identity_conflicts WHERE conflict_type = 'employee_user_link_conflict'`
          );
          assert.ok(conflictsRes.rows.length >= 1, 'Duplicate user->employee legacy rows must be flagged in identity_conflicts');

          // Unambiguous E-LEG-OK -> U-LEG-OK backfilled safely
          const okEmpRes = await legacyPool.query(`SELECT user_id FROM employees WHERE id = 'E-LEG-OK'`);
          assert.equal(okEmpRes.rows[0].user_id, 'U-LEG-OK');
        } finally {
          setInjectedPool(pgPool);
          resetPgModeCache();
        }
      });
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

try {
  setInjectedPool(null);
  resetPgModeCache();
  await runSuite('JSON Ledger', null);

  const memPool = createPgMemPool();
  setInjectedPool(memPool);
  resetPgModeCache();
  await initializeSchema();
  await runSuite('PostgreSQL pg-mem', memPool);

  console.log(`\nALL IDENTITY & FILTERS TESTS PASSED (${passed} assertion groups)!`);
} finally {
  fs.rmSync(tempDataDir, { recursive: true, force: true });
}
