import React, { useState, useMemo, useEffect } from 'react';
import {
  Wallet, Plus, ArrowLeftRight, TrendingDown, TrendingUp,
  Printer, Download, CheckCircle2, AlertCircle, Landmark,
  FileText, Phone, ArrowDownLeft, ArrowUpRight, Eye, ShieldAlert, DollarSign
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber } from '../../../i18n/translator';
import {
  Customer, Supplier, CustomerStatementResponse, SupplierStatementResponse,
  CustomerStatementEntry, SupplierStatementEntry, Invoice, InvoiceItem
} from '../../../types';
import { Modal } from '../../common/Modal';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';
import { exportToExcel } from '../../common/ExcelExporter';
import {
  AccountsLedgerIcon, SafeVaultIcon, CustomersGroupIcon,
  SuppliersTruckIcon, ExpensesCashIcon
} from '../../common/AppIcons';

interface FinanceViewProps {
  initialTab?: 'cashboxes' | 'transfer' | 'expenses' | 'customer-accounts' | 'supplier-accounts';
}

type FinanceTabKey = 'cashboxes' | 'transactions' | 'expenses' | 'customer-accounts' | 'supplier-accounts';

export const FinanceView: React.FC<FinanceViewProps> = ({ initialTab }) => {
  const {
    cashboxes, financialTransactions, expenseIncomes, settings,
    customers, suppliers, invoices, invoiceReturns,
    addCashbox, transferBetweenCashboxes, addExpenseIncome,
    getCustomerStatement, getSupplierStatement,
    recordCustomerPayment, recordSupplierPayment, settleSupplierAdvance,
  } = useData();
  const { currentUser, hasPermission } = useAuth();
  const { registerHandler, consumePendingAction } = useShortcuts();
  const { t, language } = usePreferences();

  const resolveTabFromInitial = (tab?: FinanceViewProps['initialTab']): FinanceTabKey => {
    if (tab === 'expenses') return 'expenses';
    if (tab === 'customer-accounts') return 'customer-accounts';
    if (tab === 'supplier-accounts') return 'supplier-accounts';
    return 'cashboxes';
  };

  const [activeTab, setActiveTab] = useState<FinanceTabKey>(resolveTabFromInitial(initialTab));
  const [searchTerm, setSearchTerm] = useState('');
  const [expenseTypeFilter, setExpenseTypeFilter] = useState<'all' | 'expense' | 'income'>('all');
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Customer Accounts Filter / Sort / Modals
  const [custSearch, setCustSearch] = useState('');
  const [custDirFilter, setCustDirFilter] = useState<'all' | 'debt' | 'credit' | 'settled'>('all');
  const [custSort, setCustSort] = useState<'balance_desc' | 'balance_asc' | 'name'>('balance_desc');
  const [custPaymentTarget, setCustPaymentTarget] = useState<Customer | null>(null);
  const [custPayAmount, setCustPayAmount] = useState<number>(0);
  const [custPayCashboxId, setCustPayCashboxId] = useState<string>(cashboxes[0]?.id || '');
  const [custPayMethod, setCustPayMethod] = useState<'cash' | 'bank' | 'cheque'>('cash');
  const [custPayNotes, setCustPayNotes] = useState<string>('');
  const [custPayError, setCustPayError] = useState<string | null>(null);
  const [isSubmittingCustPay, setIsSubmittingCustPay] = useState(false);

  // Customer Statement Modal
  const [custStatementTarget, setCustStatementTarget] = useState<Customer | null>(null);
  const [custStatementData, setCustStatementData] = useState<CustomerStatementResponse | null>(null);
  const [isLoadingCustStatement, setIsLoadingCustStatement] = useState(false);

  // Supplier Accounts Filter / Sort / Modals
  const [suppSearch, setSuppSearch] = useState('');
  const [suppDirFilter, setSuppDirFilter] = useState<'all' | 'payable' | 'advance' | 'settled'>('all');
  const [suppSort, setSuppSort] = useState<'balance_desc' | 'balance_asc' | 'name'>('balance_desc');
  const [suppPaymentTarget, setSuppPaymentTarget] = useState<Supplier | null>(null);
  const [suppPayAmount, setSuppPayAmount] = useState<number>(0);
  const [suppPayCashboxId, setSuppPayCashboxId] = useState<string>(cashboxes[0]?.id || '');
  const [suppPayNotes, setSuppPayNotes] = useState<string>('');
  const [suppPayError, setSuppPayError] = useState<string | null>(null);
  const [isSubmittingSuppPay, setIsSubmittingSuppPay] = useState(false);

  // Supplier Advance Settlement Modal
  const [settleSupplierTarget, setSettleSupplierTarget] = useState<Supplier | null>(null);
  const [settleInvoiceId, setSettleInvoiceId] = useState<string>('');
  const [settleAmount, setSettleAmount] = useState<number>(0);
  const [settleNotes, setSettleNotes] = useState<string>('');
  const [settleError, setSettleError] = useState<string | null>(null);
  const [isConfirmingSettle, setIsConfirmingSettle] = useState(false);
  const [isSettlingAdvance, setIsSettlingAdvance] = useState(false);

  // Supplier Statement Modal
  const [suppStatementTarget, setSuppStatementTarget] = useState<Supplier | null>(null);
  const [suppStatementData, setSuppStatementData] = useState<SupplierStatementResponse | null>(null);
  const [isLoadingSuppStatement, setIsLoadingSuppStatement] = useState(false);

  // Shared Document Preview Sub-Modal (from Customer / Supplier statements)
  const [previewStatementDoc, setPreviewStatementDoc] = useState<{
    title: string;
    docNumber: string;
    date: string;
    badge: string;
    description: string;
    invoice?: Invoice;
    extraLines?: Array<{ label: string; value: string }>;
  } | null>(null);

  // Transfer modal
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(initialTab === 'transfer');
  const [fromCbId, setFromCbId] = useState(cashboxes[0]?.id || '');
  const [toCbId, setToCbId] = useState(cashboxes[1]?.id || cashboxes[0]?.id || '');
  const [transferAmount, setTransferAmount] = useState<number | ''>('');
  const [transferNotes, setTransferNotes] = useState('');
  const [transferError, setTransferError] = useState<string | null>(null);
  const [isSubmittingTransfer, setIsSubmittingTransfer] = useState(false);

  // Add Cashbox modal
  const [isAddCashboxOpen, setIsAddCashboxOpen] = useState(false);
  const [newCbName, setNewCbName] = useState('');
  const [newCbType, setNewCbType] = useState<'cashbox' | 'bank'>('cashbox');
  const [newCbAccount, setNewCbAccount] = useState('');
  const [newCbOpening, setNewCbOpening] = useState<number | ''>('');
  const [cashboxError, setCashboxError] = useState<string | null>(null);
  const [isSubmittingCashbox, setIsSubmittingCashbox] = useState(false);

  // Expense / Income modal
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [recordType, setRecordType] = useState<'expense' | 'income'>('expense');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [selectedCashboxId, setSelectedCashboxId] = useState(cashboxes[0]?.id || '');
  const [recipientOrPayer, setRecipientOrPayer] = useState('');
  const [notes, setNotes] = useState('');
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [isSubmittingExpense, setIsSubmittingExpense] = useState(false);

  // Print modal
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // Read-only Detail Modal for cashboxes / transactions / expenses
  const [previewFinanceItem, setPreviewFinanceItem] = useState<{
    kind: 'cashbox' | 'transaction' | 'expense';
    item: any;
  } | null>(null);

  const canApproveSupplierOverpayment =
    currentUser?.role === 'admin' ||
    currentUser?.role === 'manager' ||
    hasPermission('canApprove');

  useEffect(() => {
    const openExpenseShortcut = () => {
      setExpenseError(null);
      setRecordType('expense');
      setIsExpenseModalOpen(true);
    };
    if (consumePendingAction('action:add_expense')) {
      openExpenseShortcut();
    }
    return registerHandler('action:add_expense', openExpenseShortcut);
  }, [registerHandler, consumePendingAction]);

  useEffect(() => {
    if (initialTab === 'transfer') {
      setActiveTab('cashboxes');
      setTransferError(null);
      setIsTransferModalOpen(true);
    } else if (initialTab) {
      setActiveTab(resolveTabFromInitial(initialTab));
    }
  }, [initialTab]);

  useEffect(() => {
    if (cashboxes.length === 0) return;
    if (!fromCbId || !cashboxes.some((c) => c.id === fromCbId)) {
      setFromCbId(cashboxes[0].id);
    }
    if (!toCbId || !cashboxes.some((c) => c.id === toCbId)) {
      setToCbId(cashboxes[1]?.id || cashboxes[0].id);
    }
    if (!selectedCashboxId || !cashboxes.some((c) => c.id === selectedCashboxId)) {
      setSelectedCashboxId(cashboxes[0].id);
    }
    if (!custPayCashboxId || !cashboxes.some((c) => c.id === custPayCashboxId)) {
      setCustPayCashboxId(cashboxes[0].id);
    }
    if (!suppPayCashboxId || !cashboxes.some((c) => c.id === suppPayCashboxId)) {
      setSuppPayCashboxId(cashboxes[0].id);
    }
  }, [cashboxes, fromCbId, toCbId, selectedCashboxId, custPayCashboxId, suppPayCashboxId]);

  const totalLiquidity = useMemo(
    () => cashboxes.reduce((acc, c) => acc + Number(c.currentBalance || 0), 0),
    [cashboxes]
  );

  // Customer Accounts KPIs (Strictly separated: NEVER net لنا and علينا together)
  const customerKpis = useMemo(() => {
    let receivableTotal = 0; // لنا عند العملاء (> 0)
    let advanceTotal = 0;    // علينا / دفعات مقدمة للعملاء (< 0)
    let debtorsCount = 0;
    let creditorsCount = 0;
    for (const c of customers) {
      const bal = Number(c.currentBalance || 0);
      if (bal > 0.005) {
        receivableTotal += bal;
        debtorsCount++;
      } else if (bal < -0.005) {
        advanceTotal += Math.abs(bal);
        creditorsCount++;
      }
    }
    const confirmedSales = invoices.filter((i) => i.type === 'sales' && i.status === 'confirmed');
    const confirmedIds = new Set(confirmedSales.map((i) => i.id));
    const totalCollections =
      confirmedSales.reduce(
        (s, i) => s + Math.max(0, Number(i.paidAmount || 0) - Number(i.appliedAdvanceAmount || 0)),
        0
      ) +
      financialTransactions
        .filter(
          (tx) =>
            tx.type === 'customer_payment' &&
            !(tx.relatedDocType === 'sales' && tx.relatedDocId && confirmedIds.has(tx.relatedDocId))
        )
        .reduce((s, tx) => s + Number(tx.amount || 0), 0);

    return {
      receivableTotal: Number(receivableTotal.toFixed(2)),
      advanceTotal: Number(advanceTotal.toFixed(2)),
      totalCollections: Number(totalCollections.toFixed(2)),
      totalCount: customers.length,
      debtorsCount,
      creditorsCount,
    };
  }, [customers, invoices, financialTransactions]);

  const filteredCustomersList = useMemo(() => {
    const q = custSearch.trim().toLowerCase();
    return customers
      .filter((c) => {
        const matchQ =
          !q ||
          c.name.toLowerCase().includes(q) ||
          (c.shopName || '').toLowerCase().includes(q) ||
          (c.code || '').toLowerCase().includes(q) ||
          (c.phone || '').includes(q);
        const bal = Number(c.currentBalance || 0);
        const matchDir =
          custDirFilter === 'all'
            ? true
            : custDirFilter === 'debt'
            ? bal > 0.005
            : custDirFilter === 'credit'
            ? bal < -0.005
            : Math.abs(bal) <= 0.005;
        return matchQ && matchDir;
      })
      .sort((a, b) => {
        if (custSort === 'balance_desc') return Number(b.currentBalance || 0) - Number(a.currentBalance || 0);
        if (custSort === 'balance_asc') return Number(a.currentBalance || 0) - Number(b.currentBalance || 0);
        return (a.shopName || a.name).localeCompare(b.shopName || b.name, language);
      });
  }, [customers, custSearch, custDirFilter, custSort, language]);

  // Supplier Accounts KPIs (Strictly separated: NEVER net علينا and لنا together)
  const supplierKpis = useMemo(() => {
    let payableTotal = 0; // علينا للموردين (> 0)
    let advanceTotal = 0; // لنا / دفعات مقدمة عند الموردين (< 0)
    let payablesCount = 0;
    let advancesCount = 0;
    for (const s of suppliers) {
      const bal = Number(s.currentBalance || 0);
      if (bal > 0.005) {
        payableTotal += bal;
        payablesCount++;
      } else if (bal < -0.005) {
        advanceTotal += Math.abs(bal);
        advancesCount++;
      }
    }
    const confirmedPurchases = invoices.filter((i) => i.type === 'purchase' && i.status === 'confirmed');
    const confirmedIds = new Set(confirmedPurchases.map((i) => i.id));
    const totalPayments =
      confirmedPurchases.reduce((s, i) => {
        const cashPart =
          Array.isArray(i.payments) && i.payments.length > 0
            ? i.payments
                .filter((p) => (p.paymentMethod as string) !== 'advance_settlement')
                .reduce((ps, p) => ps + Number(p.amount || 0), 0)
            : Number(i.paidAtInvoice ?? i.paidAmount ?? 0);
        return s + cashPart;
      }, 0) +
      financialTransactions
        .filter(
          (tx) =>
            tx.type === 'supplier_payment' &&
            !(tx.relatedDocType === 'purchase' && tx.relatedDocId && confirmedIds.has(tx.relatedDocId))
        )
        .reduce((s, tx) => s + Number(tx.amount || 0), 0);

    return {
      payableTotal: Number(payableTotal.toFixed(2)),
      advanceTotal: Number(advanceTotal.toFixed(2)),
      totalPayments: Number(totalPayments.toFixed(2)),
      totalCount: suppliers.length,
      payablesCount,
      advancesCount,
    };
  }, [suppliers, invoices, financialTransactions]);

  const filteredSuppliersList = useMemo(() => {
    const q = suppSearch.trim().toLowerCase();
    return suppliers
      .filter((s) => {
        const matchQ =
          !q ||
          s.name.toLowerCase().includes(q) ||
          (s.code || '').toLowerCase().includes(q) ||
          (s.phone || '').includes(q);
        const bal = Number(s.currentBalance || 0);
        const matchDir =
          suppDirFilter === 'all'
            ? true
            : suppDirFilter === 'payable'
            ? bal > 0.005
            : suppDirFilter === 'advance'
            ? bal < -0.005
            : Math.abs(bal) <= 0.005;
        return matchQ && matchDir;
      })
      .sort((a, b) => {
        if (suppSort === 'balance_desc') return Number(b.currentBalance || 0) - Number(a.currentBalance || 0);
        if (suppSort === 'balance_asc') return Number(a.currentBalance || 0) - Number(b.currentBalance || 0);
        return a.name.localeCompare(b.name, language);
      });
  }, [suppliers, suppSearch, suppDirFilter, suppSort, language]);

  const getSupplierAdvanceInfo = (supp: Supplier) => {
    const openInvoices = invoices.filter(
      (i) =>
        i.supplierId === supp.id &&
        i.type === 'purchase' &&
        i.status === 'confirmed' &&
        Number(i.remainingAmount || 0) > 0
    );
    const openInvoicesRemaining = openInvoices.reduce((s, i) => s + Number(i.remainingAmount || 0), 0);
    const availableAdvance = Math.max(0, Number((openInvoicesRemaining - Number(supp.currentBalance || 0)).toFixed(2)));
    return { openInvoices, openInvoicesRemaining, availableAdvance };
  };

  const handleOpenCustomerStatement = async (cust: Customer) => {
    setCustStatementTarget(cust);
    setCustStatementData(null);
    setIsLoadingCustStatement(true);
    try {
      const st = await getCustomerStatement(cust.id);
      setCustStatementData(st);
    } finally {
      setIsLoadingCustStatement(false);
    }
  };

  const handleOpenSupplierStatement = async (supp: Supplier) => {
    setSuppStatementTarget(supp);
    setSuppStatementData(null);
    setIsLoadingSuppStatement(true);
    try {
      const st = await getSupplierStatement(supp.id);
      setSuppStatementData(st);
    } finally {
      setIsLoadingSuppStatement(false);
    }
  };

  const handleSubmitCustomerPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!custPaymentTarget || isSubmittingCustPay) return;
    setCustPayError(null);
    if (custPayAmount <= 0) {
      setCustPayError(t('يرجى إدخال مبلغ تحصيل أكبر من صفر.', 'Please enter a collection amount greater than zero.'));
      return;
    }
    if (!custPayCashboxId) {
      setCustPayError(t('يرجى اختيار الخزينة أو الحساب البنكي.', 'Please select a cashbox or bank account.'));
      return;
    }
    setIsSubmittingCustPay(true);
    try {
      const res = await recordCustomerPayment(
        custPaymentTarget.id,
        custPayAmount,
        custPayCashboxId,
        custPayNotes || t(`تحصيل دفعة حساب من ${custPaymentTarget.name}`, `Account payment collection from ${custPaymentTarget.name}`),
        custPayMethod
      );
      if (!res.success) {
        setCustPayError(res.error ? t(res.error) : t('تعذر تسجيل التحصيل', 'Failed to record collection'));
        return;
      }
      const nextBal = Number((Number(custPaymentTarget.currentBalance || 0) - custPayAmount).toFixed(2));
      const currLabel = t(settings.currency);
      setStatusBanner({
        type: 'success',
        text:
          nextBal < 0
            ? t(
                `تم تحصيل ${formatLocaleNumber(custPayAmount)} ${currLabel} من (${custPaymentTarget.name}) — تم قيد الزيادة كرصيد دائن / دفعة مقدمة للعميل (${formatLocaleNumber(Math.abs(nextBal))} ${currLabel}).`,
                `Collected ${formatLocaleNumber(custPayAmount)} ${currLabel} from (${custPaymentTarget.name}) — excess recorded as customer credit / advance (${formatLocaleNumber(Math.abs(nextBal))} ${currLabel}).`
              )
            : t(
                `تم تحصيل ${formatLocaleNumber(custPayAmount)} ${currLabel} من العميل (${custPaymentTarget.name}) بنجاح.`,
                `Successfully collected ${formatLocaleNumber(custPayAmount)} ${currLabel} from customer (${custPaymentTarget.name}).`
              ),
      });
      if (custStatementTarget?.id === custPaymentTarget.id) {
        handleOpenCustomerStatement({ ...custPaymentTarget, currentBalance: nextBal });
      }
      setCustPaymentTarget(null);
      setCustPayAmount(0);
      setCustPayNotes('');
    } finally {
      setIsSubmittingCustPay(false);
    }
  };

  const handleSubmitSupplierPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suppPaymentTarget || isSubmittingSuppPay) return;
    setSuppPayError(null);
    if (suppPayAmount <= 0) {
      setSuppPayError(t('يرجى إدخال مبلغ سداد أكبر من صفر.', 'Please enter a payment amount greater than zero.'));
      return;
    }
    if (!suppPayCashboxId) {
      setSuppPayError(t('يرجى اختيار الخزينة المسدد منها.', 'Please select the source cashbox.'));
      return;
    }
    const debt = Math.max(0, Number(suppPaymentTarget.currentBalance || 0));
    const overpayment = Math.max(0, Number((suppPayAmount - debt).toFixed(2)));
    if (overpayment > 0.009 && !canApproveSupplierOverpayment) {
      setSuppPayError(
        t(
          'يتجاوز المبلغ المستحق للمورد — يتطلب سداد الدفعة المقدمة موافقة المدير العام أو مدير الفرع أو صلاحية الاعتماد.',
          'Exceeds amount due to supplier — advance overpayment requires General Manager, Branch Manager, or approval permission.'
        )
      );
      return;
    }
    setIsSubmittingSuppPay(true);
    try {
      const res = await recordSupplierPayment(
        suppPaymentTarget.id,
        suppPayAmount,
        suppPayCashboxId,
        suppPayNotes || t(`سداد دفعة للمورد ${suppPaymentTarget.name}`, `Payment to supplier ${suppPaymentTarget.name}`)
      );
      if (!res.success) {
        setSuppPayError(res.error ? t(res.error) : t('تعذر تسجيل السداد للمورد', 'Failed to record supplier payment'));
        return;
      }
      const currLabel = t(settings.currency);
      setStatusBanner({
        type: 'success',
        text: res.isAdvancePayment
          ? t(
              `تم سداد ${formatLocaleNumber(suppPayAmount)} ${currLabel} للمورد (${suppPaymentTarget.name}) وقيد الزيادة كدفعة مقدمة لنا عند المورد.`,
              `Paid ${formatLocaleNumber(suppPayAmount)} ${currLabel} to supplier (${suppPaymentTarget.name}) and recorded excess as our advance payment.`
            )
          : t(
              `تم سداد مبلغ ${formatLocaleNumber(suppPayAmount)} ${currLabel} للمورد (${suppPaymentTarget.name}) بنجاح.`,
              `Successfully paid ${formatLocaleNumber(suppPayAmount)} ${currLabel} to supplier (${suppPaymentTarget.name}).`
            ),
      });
      if (suppStatementTarget?.id === suppPaymentTarget.id) {
        const nextBal = Number((Number(suppPaymentTarget.currentBalance || 0) - suppPayAmount).toFixed(2));
        handleOpenSupplierStatement({ ...suppPaymentTarget, currentBalance: nextBal });
      }
      setSuppPaymentTarget(null);
      setSuppPayAmount(0);
      setSuppPayNotes('');
    } finally {
      setIsSubmittingSuppPay(false);
    }
  };

  const handleConfirmSettleAdvance = async () => {
    if (!settleSupplierTarget || !settleInvoiceId || settleAmount <= 0 || isSettlingAdvance) return;
    setIsSettlingAdvance(true);
    setSettleError(null);
    try {
      const res = await settleSupplierAdvance(settleSupplierTarget.id, {
        invoiceId: settleInvoiceId,
        amount: settleAmount,
        notes: settleNotes,
      });
      if (res.success) {
        setStatusBanner({
          type: 'success',
          text: t(
            `تمت تسوية دفعة مقدمة بمبلغ ${formatLocaleNumber(settleAmount)} ${t(settings.currency)} للمورد (${settleSupplierTarget.name}) دون حركة خزينة.`,
            `Settled an advance payment of ${formatLocaleNumber(settleAmount)} ${t(settings.currency)} for supplier (${settleSupplierTarget.name}) without cashbox movement.`
          ),
        });
        setIsConfirmingSettle(false);
        setSettleSupplierTarget(null);
      } else {
        setIsConfirmingSettle(false);
        setSettleError(res.error ? t(res.error) : t('تعذر تسوية الدفعة المقدمة', 'Failed to settle advance payment'));
      }
    } finally {
      setIsSettlingAdvance(false);
    }
  };

  const inspectCustomerEntry = (entry: CustomerStatementEntry) => {
    const linkedInv =
      entry.docType === 'sales'
        ? invoices.find((i) => i.id === entry.docId || i.invoiceNumber === entry.docNumber)
        : undefined;
    const linkedRet =
      entry.docType === 'sales_return'
        ? invoiceReturns.find((r) => r.id === entry.docId || r.returnNumber === entry.docNumber)
        : undefined;
    setPreviewStatementDoc({
      title: linkedInv
        ? `${t('تفاصيل فاتورة مبيعات', 'Sales Invoice Details')} ${linkedInv.invoiceNumber}`
        : `${t(entry.label)} (${entry.docNumber})`,
      docNumber: entry.docNumber,
      date: entry.date,
      badge: t(entry.label),
      description: entry.description ? t(entry.description) : '',
      invoice: linkedInv,
      extraLines: linkedRet
        ? [
            { label: t('الفاتورة الأصلية', 'Original Invoice'), value: linkedRet.originalInvoiceNumber },
            { label: t('طريقة التسوية', 'Settlement Method'), value: linkedRet.refundType === 'cash' ? t('رد نقدي', 'Cash Refund') : t('خصم من الرصيد', 'Balance Credit') },
            { label: t('إجمالي المرتجع', 'Return Total'), value: `${formatLocaleNumber(Number(linkedRet.grandTotal || 0))} ${t(settings.currency)}` },
          ]
        : [
            { label: t('مدين (مستحق لنا)', 'Debit (Receivable)'), value: `${formatLocaleNumber(Number(entry.debit || 0))} ${t(settings.currency)}` },
            { label: t('دائن (تحصيل/سداد)', 'Credit (Paid)'), value: `${formatLocaleNumber(Number(entry.credit || 0))} ${t(settings.currency)}` },
            { label: t('الرصيد بعد الحركة', 'Balance After Entry'), value: `${formatLocaleNumber(Math.abs(Number(entry.runningBalance || 0)))} ${t(settings.currency)}` },
          ],
    });
  };

  const inspectSupplierEntry = (entry: SupplierStatementEntry) => {
    const linkedInv =
      entry.docType === 'purchase'
        ? invoices.find((i) => i.id === entry.docId || i.invoiceNumber === entry.docNumber)
        : undefined;
    const linkedRet =
      entry.docType === 'purchase_return'
        ? invoiceReturns.find((r) => r.id === entry.docId || r.returnNumber === entry.docNumber)
        : undefined;
    setPreviewStatementDoc({
      title: linkedInv
        ? `${t('تفاصيل فاتورة مشتريات', 'Purchase Invoice Details')} ${linkedInv.invoiceNumber}`
        : `${t(entry.label)} (${entry.docNumber})`,
      docNumber: entry.docNumber,
      date: entry.date,
      badge: t(entry.label),
      description: entry.description ? t(entry.description) : '',
      invoice: linkedInv,
      extraLines: linkedRet
        ? [
            { label: t('الفاتورة الأصلية', 'Original Invoice'), value: linkedRet.originalInvoiceNumber },
            { label: t('طريقة التسوية', 'Settlement Method'), value: linkedRet.refundType === 'cash' ? t('استرداد نقدي', 'Cash Refund') : t('خصم من رصيد المورد', 'Deducted from Supplier Balance') },
            { label: t('إجمالي المرتجع', 'Return Total'), value: `${formatLocaleNumber(Number(linkedRet.grandTotal || 0))} ${t(settings.currency)}` },
          ]
        : [
            { label: t('له / مشتريات', 'Credit / Purchases'), value: `${formatLocaleNumber(Number(entry.credit || 0))} ${t(settings.currency)}` },
            { label: t('سداد / مرتجع', 'Payment / Return'), value: `${formatLocaleNumber(Number(entry.debit || 0))} ${t(settings.currency)}` },
            { label: t('الرصيد بعد الحركة', 'Balance After Entry'), value: `${formatLocaleNumber(Math.abs(Number(entry.runningBalance || 0)))} ${t(settings.currency)}` },
          ],
    });
  };

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingTransfer) return;
    setTransferError(null);
    const numTransferAmount = Number(transferAmount || 0);
    if (!fromCbId || !toCbId) {
      setTransferError(t('يرجى تحديد الخزينة المحول منها والمحول إليها.', 'Please select source and target cashboxes.'));
      return;
    }
    if (fromCbId === toCbId) {
      setTransferError(t('لا يمكن التحويل من نفس الخزينة إلى نفسها.', 'Cannot transfer from a cashbox to itself.'));
      return;
    }
    if (numTransferAmount <= 0) {
      setTransferError(t('يرجى إدخال مبلغ تحويل أكبر من صفر.', 'Please enter a transfer amount greater than zero.'));
      return;
    }
    setIsSubmittingTransfer(true);
    try {
      const res = await transferBetweenCashboxes(fromCbId, toCbId, numTransferAmount, transferNotes || t('تحويل مالي بين الخزائن', 'Financial transfer between cashboxes'));
      if (!res.success) {
        setTransferError(res.error ? t(res.error) : t('فشل التحويل', 'Transfer failed'));
      } else {
        setIsTransferModalOpen(false);
        setTransferAmount('');
        setTransferNotes('');
        setStatusBanner({
          type: 'success',
          text: t(
            `تم تنفيذ التحويل المالي بمبلغ ${formatLocaleNumber(numTransferAmount)} ${t(settings.currency)} بنجاح.`,
            `Successfully transferred ${formatLocaleNumber(numTransferAmount)} ${t(settings.currency)}.`
          ),
        });
      }
    } finally {
      setIsSubmittingTransfer(false);
    }
  };

  const handleAddCashboxSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingCashbox) return;
    setCashboxError(null);
    if (!newCbName.trim()) {
      setCashboxError(t('يرجى إدخال اسم الخزينة أو الحساب البنكي.', 'Please enter the cashbox or bank account name.'));
      return;
    }
    setIsSubmittingCashbox(true);
    try {
      await addCashbox({
        name: newCbName.trim(),
        type: newCbType,
        accountNumber: newCbType === 'bank' ? newCbAccount.trim() : undefined,
        openingBalance: Number(newCbOpening) || 0,
        isDefault: false,
      });
      setIsAddCashboxOpen(false);
      setStatusBanner({ type: 'success', text: t(`تمت إضافة (${newCbName.trim()}) بنجاح.`, `Successfully added (${newCbName.trim()}).`) });
      setNewCbName('');
      setNewCbAccount('');
      setNewCbOpening('');
    } catch (err: any) {
      setCashboxError(err?.message ? t(err.message) : t('تعذر إنشاء الخزينة أو الحساب البنكي', 'Failed to create cashbox or bank account'));
    } finally {
      setIsSubmittingCashbox(false);
    }
  };

  const handleAddExpenseIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingExpense) return;
    setExpenseError(null);
    const numAmount = Number(amount || 0);
    if (!category.trim()) {
      setExpenseError(
        recordType === 'expense'
          ? t('يرجى إدخال بند المصروف.', 'Please enter the expense category.')
          : t('يرجى إدخال بند الإيراد.', 'Please enter the income category.')
      );
      return;
    }
    if (numAmount <= 0) {
      setExpenseError(t('يرجى إدخال مبلغ أكبر من صفر.', 'Please enter an amount greater than zero.'));
      return;
    }
    if (!selectedCashboxId) {
      setExpenseError(t('يرجى اختيار الخزينة المتأثرة.', 'Please select the affected cashbox.'));
      return;
    }
    const cb = cashboxes.find((c) => c.id === selectedCashboxId);

    setIsSubmittingExpense(true);
    try {
      await addExpenseIncome({
        type: recordType,
        category: category.trim(),
        amount: numAmount,
        date: new Date().toISOString().split('T')[0],
        cashboxId: selectedCashboxId,
        cashboxName: cb?.name || '',
        paymentMethod: 'نقدي',
        recipientOrPayer: recipientOrPayer.trim() || (recordType === 'expense' ? t('جهة صرف', 'Disbursement Party') : t('جهة تحصيل', 'Collection Party')),
        notes: notes.trim(),
      });

      setIsExpenseModalOpen(false);
      setAmount('');
      setCategory('');
      setRecipientOrPayer('');
      setNotes('');
      setStatusBanner({
        type: 'success',
        text:
          recordType === 'expense'
            ? t(
                `تم تسجيل سند صرف (${category.trim()}) بمبلغ ${formatLocaleNumber(numAmount)} ${t(settings.currency)}.`,
                `Recorded expense voucher (${category.trim()}) for ${formatLocaleNumber(numAmount)} ${t(settings.currency)}.`
              )
            : t(
                `تم تسجيل سند قبض إيراد (${category.trim()}) بمبلغ ${formatLocaleNumber(numAmount)} ${t(settings.currency)}.`,
                `Recorded income voucher (${category.trim()}) for ${formatLocaleNumber(numAmount)} ${t(settings.currency)}.`
              ),
      });

      setPrintData({
        title: recordType === 'expense' ? t('سند صرف مصروفات', 'Expense Payment Voucher') : t('سند قبض إيرادات', 'Income Receipt Voucher'),
        docNumber: `${recordType === 'expense' ? 'EXP' : 'INC'}-${Date.now().toString().slice(-6)}`,
        docType: recordType === 'expense' ? t('سند صرف', 'Expense Voucher') : t('سند قبض', 'Receipt Voucher'),
        date: new Date().toISOString().split('T')[0],
        partyName: recipientOrPayer,
        grandTotal: numAmount,
        paidAmount: numAmount,
        notes: `${category.trim()} - ${notes}`,
      });
      setIsPrintModalOpen(true);
    } catch (err: any) {
      setExpenseError(err?.message ? t(err.message) : t('تعذر تسجيل السند المالي', 'Failed to record financial voucher'));
    } finally {
      setIsSubmittingExpense(false);
    }
  };

  const filteredTransactions = useMemo(() => {
    return financialTransactions.filter(
      (tx) =>
        tx.transactionNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tx.cashboxName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tx.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tx.description.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [financialTransactions, searchTerm]);

  const filteredExpenses = useMemo(() => {
    return expenseIncomes.filter((rec) => {
      const matchType = expenseTypeFilter === 'all' || rec.type === expenseTypeFilter;
      const q = searchTerm.toLowerCase();
      const matchSearch =
        !q ||
        (rec.recordNumber || '').toLowerCase().includes(q) ||
        rec.category.toLowerCase().includes(q) ||
        rec.cashboxName.toLowerCase().includes(q) ||
        (rec.recipientOrPayer || '').toLowerCase().includes(q) ||
        (rec.notes || '').toLowerCase().includes(q);
      return matchType && matchSearch;
    });
  }, [expenseIncomes, expenseTypeFilter, searchTerm]);

  const formatCustomerBalBadge = (bal: number) => {
    if (bal > 0.005) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-50 text-red-800 border border-red-200 text-[10px] font-black tabular-nums">
          {t('لنا (مستحق):', 'Receivable:')} {formatLocaleNumber(bal)} {t(settings.currency)}
        </span>
      );
    }
    if (bal < -0.005) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-black tabular-nums">
          {t('علينا (دفعة مقدمة):', 'Credit (Advance):')} {formatLocaleNumber(Math.abs(bal))} {t(settings.currency)}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-bold">
        {t('متوازن (0)', 'Settled (0)')}
      </span>
    );
  };

  const formatSupplierBalBadge = (bal: number) => {
    if (bal > 0.005) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200 text-[10px] font-black tabular-nums">
          {t('علينا للمورد:', 'Payable to Supplier:')} {formatLocaleNumber(bal)} {t(settings.currency)}
        </span>
      );
    }
    if (bal < -0.005) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-black tabular-nums">
          {t('لنا (دفعة مقدمة):', 'Our Advance:')} {formatLocaleNumber(Math.abs(bal))} {t(settings.currency)}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-bold">
        {t('متوازن (0)', 'Settled (0)')}
      </span>
    );
  };

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white dark:bg-[#0E1C36] px-2.5 py-2 rounded-lg border border-slate-200 dark:border-[#21375C]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] flex items-center justify-center shrink-0">
            <AccountsLedgerIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-900 dark:text-[#F3F7FC] tracking-tight">
              {t('مركز الحسابات والعملاء والموردين والخزائن', 'Accounts, Customers, Suppliers & Cashboxes Center')}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-[#97AECE]">
              {t('كشوف الحسابات التفصيلية للعملاء والموردين، السيولة النقدية', 'Detailed customer & supplier statements, cash liquidity')} ({formatLocaleNumber(totalLiquidity)} {t(settings.currency)}){t('، وسندات الصرف والقبض', ', and payment/receipt vouchers')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => {
              setExpenseError(null);
              setRecordType('expense');
              setIsExpenseModalOpen(true);
            }}
            className="h-8 flex items-center gap-1 px-2.5 bg-amber-700 hover:bg-amber-800 text-white rounded-md text-xs font-bold transition-all cursor-pointer"
          >
            <TrendingDown className="w-3.5 h-3.5" />
            <span>{t('سند صرف مصروف', 'Expense Voucher')}</span>
          </button>

          <button
            onClick={() => {
              setExpenseError(null);
              setRecordType('income');
              setIsExpenseModalOpen(true);
            }}
            className="h-8 flex items-center gap-1 px-2.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md text-xs font-bold transition-all cursor-pointer"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>{t('سند قبض إيراد', 'Income Voucher')}</span>
          </button>

          <button
            onClick={() => {
              setTransferError(null);
              setIsTransferModalOpen(true);
            }}
            className="h-8 flex items-center gap-1 px-2.5 bg-[#011E58] hover:bg-[#002160] text-white rounded-md text-xs font-bold transition-all cursor-pointer"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>{t('تحويل بين الخزائن', 'Transfer Between Cashboxes')}</span>
          </button>
        </div>
      </div>

      {statusBanner && (
        <div
          className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold flex items-center justify-between gap-2 ${
            statusBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{statusBanner.text}</span>
          </div>
          <button onClick={() => setStatusBanner(null)} className="underline text-[11px] cursor-pointer">
            {t('إغلاق', 'Close')}
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap border-b border-slate-200 dark:border-[#21375C] text-xs font-bold gap-2 sm:gap-3 bg-white dark:bg-[#0E1C36] px-2.5 pt-1 rounded-t-lg">
        {[
          { key: 'customer-accounts' as const, label: `${t('حسابات العملاء', 'Customer Accounts')} (${customers.length})`, Icon: CustomersGroupIcon },
          { key: 'supplier-accounts' as const, label: `${t('حسابات الموردين', 'Supplier Accounts')} (${suppliers.length})`, Icon: SuppliersTruckIcon },
          { key: 'cashboxes' as const, label: `${t('الخزائن والبنوك', 'Cashboxes & Banks')} (${cashboxes.length})`, Icon: SafeVaultIcon },
          { key: 'transactions' as const, label: `${t('الحركات المالية', 'Financial Transactions')} (${financialTransactions.length})`, Icon: AccountsLedgerIcon },
          { key: 'expenses' as const, label: `${t('المصروفات والإيرادات', 'Expenses & Income')} (${expenseIncomes.length})`, Icon: ExpensesCashIcon },
        ].map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 pb-2 pt-1 px-1.5 transition-colors border-b-2 cursor-pointer ${
                isActive
                  ? 'border-blue-900 dark:border-[#60A5FA] text-blue-950 dark:text-[#85B8FF] font-black'
                  : 'border-transparent text-slate-500 dark:text-[#97AECE] hover:text-slate-800 dark:hover:text-[#F3F7FC]'
              }`}
            >
              <tab.Icon className="w-4 h-4 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB: CUSTOMER ACCOUNTS */}
      {activeTab === 'customer-accounts' && (
        <div className="space-y-2">
          {/* Separated KPI Strip: NEVER net لنا & علينا */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 dark:bg-[#21375C] border border-slate-200 dark:border-[#21375C] rounded-lg overflow-hidden text-xs">
            <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
              <span className="text-[10px] font-bold text-slate-600 dark:text-[#A9BCD9] block">{t('إجمالي مستحقاتنا عند العملاء (لنا)', 'Total Customer Receivables (Due to Us)')}</span>
              <div className="text-sm font-black font-mono tabular-nums text-red-700 dark:text-rose-400">
                {formatLocaleNumber(customerKpis.receivableTotal)} <span className="text-[10px] font-sans text-slate-500 dark:text-[#97AECE]">{t(settings.currency)}</span>
              </div>
              <span className="text-[10px] font-bold text-red-600 dark:text-rose-300">{t('عدد', 'Count:')} {customerKpis.debtorsCount} {t('عميل مدين', 'debtor customers')}</span>
            </div>

            <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
              <span className="text-[10px] font-bold text-slate-600 dark:text-[#A9BCD9] block">{t('إجمالي الدفعات المقدمة للعملاء (علينا)', 'Total Customer Advances (Credit Liability)')}</span>
              <div className="text-sm font-black font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                {formatLocaleNumber(customerKpis.advanceTotal)} <span className="text-[10px] font-sans text-slate-500 dark:text-[#97AECE]">{t(settings.currency)}</span>
              </div>
              <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">{t('عدد', 'Count:')} {customerKpis.creditorsCount} {t('عميل برصيد دائن', 'credit-balance customers')}</span>
            </div>

            <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
              <span className="text-[10px] font-bold text-slate-600 dark:text-[#A9BCD9] block">{t('إجمالي التحصيلات من العملاء', 'Total Collections from Customers')}</span>
              <div className="text-sm font-black font-mono tabular-nums text-blue-950 dark:text-[#85B8FF]">
                {formatLocaleNumber(customerKpis.totalCollections)} <span className="text-[10px] font-sans text-slate-500 dark:text-[#97AECE]">{t(settings.currency)}</span>
              </div>
              <span className="text-[10px] text-slate-500 dark:text-[#97AECE]">{t('نقدي الفواتير + سندات القبض', 'Invoice Cash + Receipt Vouchers')}</span>
            </div>

            <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
              <span className="text-[10px] font-bold text-slate-600 dark:text-[#A9BCD9] block">{t('إجمالي عدد العملاء', 'Total Customers')}</span>
              <div className="text-sm font-black font-mono tabular-nums text-slate-900 dark:text-[#F3F7FC]">
                {formatLocaleNumber(customerKpis.totalCount)}
              </div>
              <span className="text-[10px] text-slate-500 dark:text-[#97AECE]">{t('ملفات العملاء النشطة والمسجلة', 'Active & registered customer files')}</span>
            </div>
          </div>

          <UnifiedDataTable<Customer>
            title={t('حسابات العملاء التفصيلية', 'Detailed Customer Accounts')}
            subtitle={t('كشوف الحسابات والتحصيل النقدي والبنكي', 'Account statements and cash/bank collections')}
            data={filteredCustomersList}
            rowKey={(c) => c.id}
            onRowClick={(c) => handleOpenCustomerStatement(c)}
            compact
            searchValue={custSearch}
            onSearchChange={setCustSearch}
            searchPlaceholder={t('بحث باسم العميل أو المحل أو الكود أو الموبايل...', 'Search by customer, shop, code, or phone...')}
            exportFilename={`${t('حسابات_العملاء', 'Customer_Accounts')}_${new Date().toISOString().split('T')[0]}`}
            pdfTitle={t('حسابات العملاء التفصيلية', 'Detailed Customer Accounts')}
            emptyTitle={t('لا يوجد عملاء مطابقون لمعايير البحث أو التصفية', 'No customers match the search or filter criteria')}
            toolbarFilters={
              <div className="flex flex-nowrap items-center gap-1.5 text-xs shrink-0">
                <select
                  value={custDirFilter}
                  onChange={(e) => setCustDirFilter(e.target.value as any)}
                  className="h-8 shrink-0 bg-slate-50 border border-slate-300 rounded-md px-2 text-xs font-bold text-slate-700"
                >
                  <option value="all">{t('جميع الأرصدة', 'All Balances')} ({customers.length})</option>
                  <option value="debt">{t('مدينون لنا فقط', 'Debtors Only')} ({customerKpis.debtorsCount})</option>
                  <option value="credit">{t('دفعات مقدمة / علينا', 'Advances / Credits')} ({customerKpis.creditorsCount})</option>
                  <option value="settled">{t('حسابات متوازنة (0)', 'Settled Accounts (0)')}</option>
                </select>
                <select
                  value={custSort}
                  onChange={(e) => setCustSort(e.target.value as any)}
                  className="h-8 shrink-0 bg-slate-50 border border-slate-300 rounded-md px-2 text-xs font-bold text-slate-700"
                >
                  <option value="balance_desc">{t('الأعلى مديونية', 'Highest Receivable')}</option>
                  <option value="balance_asc">{t('الأعلى رصيداً مقدماً', 'Highest Advance Credit')}</option>
                  <option value="name">{t('ترتيب أبجدي', 'Alphabetical')}</option>
                </select>
              </div>
            }
            columns={[
              {
                key: 'code',
                header: t('الكود', 'Code'),
                sortable: true,
                sortValue: (c) => c.code,
                exportValue: (c) => c.code,
                render: (c) => <span className="font-mono font-bold text-blue-900">{c.code}</span>,
              },
              {
                key: 'name',
                header: t('اسم العميل / المحل', 'Customer / Shop'),
                sortable: true,
                sortValue: (c) => c.shopName || c.name,
                exportValue: (c) => (c.shopName ? `${c.shopName} (${c.name})` : c.name),
                render: (c) => (
                  <div>
                    <div className="font-black text-slate-900">{c.shopName || c.name}</div>
                    {c.shopName && c.shopName !== c.name && (
                      <div className="text-[11px] text-slate-500">{c.name}</div>
                    )}
                  </div>
                ),
              },
              {
                key: 'phone',
                header: t('رقم الهاتف', 'Phone'),
                exportValue: (c) => c.phone || '-',
                render: (c) => (
                  <div className="font-mono">
                    {c.phone ? (
                      <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 text-[#003589] hover:underline font-bold">
                        <Phone className="w-3 h-3" />
                        <span>{c.phone}</span>
                      </a>
                    ) : '-'}
                  </div>
                ),
              },
              {
                key: 'currentBalance',
                header: t('موقف الحساب (لنا / علينا)', 'Balance Status'),
                align: 'center',
                sortable: true,
                sortValue: (c) => Number(c.currentBalance || 0),
                exportValue: (c) => Number(c.currentBalance || 0),
                render: (c) => <span className="font-mono tabular-nums">{formatCustomerBalBadge(Number(c.currentBalance || 0))}</span>,
              },
              {
                key: 'actions',
                header: t('الإجراءات', 'Actions'),
                align: 'center',
                render: (c) => (
                  <div className="flex items-center justify-center gap-1 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleOpenCustomerStatement(c)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-bold cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5 text-[#003589]" />
                      <span>{t('كشف حساب', 'Statement')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCustPayError(null);
                        setCustPayNotes('');
                        setCustPayMethod('cash');
                        setCustPaymentTarget(c);
                        setCustPayAmount(c.currentBalance > 0 ? c.currentBalance : 0);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#003589] hover:bg-[#0049B0] text-white rounded-lg font-bold cursor-pointer"
                    >
                      <ArrowDownLeft className="w-3.5 h-3.5" />
                      <span>{t('تحصيل دفعة', 'Collect Payment')}</span>
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* TAB: SUPPLIER ACCOUNTS */}
      {activeTab === 'supplier-accounts' && (
        <div className="space-y-3">
          {/* Separated KPI Strip: NEVER net علينا & لنا */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden text-xs">
            <div className="bg-white px-3 py-2">
              <span className="text-[10px] font-bold text-slate-600 block">{t('إجمالي مستحقات الموردين (علينا)', 'Total Supplier Payables (Due)')}</span>
              <div className="text-base font-black font-mono tabular-nums text-amber-800">
                {formatLocaleNumber(supplierKpis.payableTotal)} <span className="text-[10px] font-sans text-slate-500">{t(settings.currency)}</span>
              </div>
              <span className="text-[10px] font-bold text-amber-700">{t('عدد', 'Count:')} {supplierKpis.payablesCount} {t('مورد مستحق لهم', 'suppliers payable')}</span>
            </div>

            <div className="bg-white px-3 py-2">
              <span className="text-[10px] font-bold text-slate-600 block">{t('إجمالي الدفعات المقدمة عند الموردين (لنا)', 'Total Advances with Suppliers (Our Credit)')}</span>
              <div className="text-base font-black font-mono tabular-nums text-emerald-700">
                {formatLocaleNumber(supplierKpis.advanceTotal)} <span className="text-[10px] font-sans text-slate-500">{t(settings.currency)}</span>
              </div>
              <span className="text-[10px] font-bold text-emerald-700">{t('عدد', 'Count:')} {supplierKpis.advancesCount} {t('مورد لديهم رصيد لنا', 'suppliers with advance credit')}</span>
            </div>

            <div className="bg-white px-3 py-2">
              <span className="text-[10px] font-bold text-slate-600 block">{t('إجمالي المدفوعات للموردين', 'Total Paid to Suppliers')}</span>
              <div className="text-base font-black font-mono tabular-nums text-blue-950">
                {formatLocaleNumber(supplierKpis.totalPayments)} <span className="text-[10px] font-sans text-slate-500">{t(settings.currency)}</span>
              </div>
              <span className="text-[10px] text-slate-500">{t('سداد فواتير الشراء + سندات الصرف', 'Purchase Invoices + Payment Vouchers')}</span>
            </div>

            <div className="bg-white px-3 py-2">
              <span className="text-[10px] font-bold text-slate-600 block">{t('إجمالي عدد الموردين', 'Total Suppliers')}</span>
              <div className="text-base font-black font-mono tabular-nums text-slate-900">
                {formatLocaleNumber(supplierKpis.totalCount)}
              </div>
              <span className="text-[10px] text-slate-500">{t('شركات ومصانع التوريد المسجلة', 'Registered supply companies & factories')}</span>
            </div>
          </div>

          <UnifiedDataTable<Supplier>
            title={t('حسابات الموردين التفصيلية', 'Detailed Supplier Accounts')}
            subtitle={t('كشوف الحسابات وسداد المستحقات وتسوية الدفعات المقدمة', 'Account statements, payments, and advance settlements')}
            data={filteredSuppliersList}
            rowKey={(s) => s.id}
            onRowClick={(s) => handleOpenSupplierStatement(s)}
            compact
            searchValue={suppSearch}
            onSearchChange={setSuppSearch}
            searchPlaceholder={t('بحث باسم المورد أو الكود أو رقم الهاتف...', 'Search by supplier name, code, or phone...')}
            exportFilename={`${t('حسابات_الموردين', 'Supplier_Accounts')}_${new Date().toISOString().split('T')[0]}`}
            pdfTitle={t('حسابات الموردين التفصيلية', 'Detailed Supplier Accounts')}
            emptyTitle={t('لا يوجد موردون مطابقون لمعايير البحث أو التصفية', 'No suppliers match the search or filter criteria')}
            toolbarFilters={
              <div className="flex flex-nowrap items-center gap-1.5 text-xs shrink-0">
                <select
                  value={suppDirFilter}
                  onChange={(e) => setSuppDirFilter(e.target.value as any)}
                  className="h-8 shrink-0 bg-slate-50 border border-slate-300 rounded-md px-2 text-xs font-bold text-slate-700"
                >
                  <option value="all">{t('جميع الموردين', 'All Suppliers')} ({suppliers.length})</option>
                  <option value="payable">{t('مستحق للمورد (علينا)', 'Payable to Supplier')} ({supplierKpis.payablesCount})</option>
                  <option value="advance">{t('دفعة مقدمة لنا', 'Our Advance')} ({supplierKpis.advancesCount})</option>
                  <option value="settled">{t('حسابات متوازنة (0)', 'Settled Accounts (0)')}</option>
                </select>
                <select
                  value={suppSort}
                  onChange={(e) => setSuppSort(e.target.value as any)}
                  className="h-8 shrink-0 bg-slate-50 border border-slate-300 rounded-md px-2 text-xs font-bold text-slate-700"
                >
                  <option value="balance_desc">{t('الأعلى مستحقات علينا', 'Highest Payable')}</option>
                  <option value="balance_asc">{t('الأعلى دفعات مقدمة لنا', 'Highest Advance Credit')}</option>
                  <option value="name">{t('ترتيب أبجدي', 'Alphabetical')}</option>
                </select>
              </div>
            }
            columns={[
              {
                key: 'code',
                header: t('الكود', 'Code'),
                sortable: true,
                sortValue: (s) => s.code,
                exportValue: (s) => s.code,
                render: (s) => <span className="font-mono font-bold text-[#011E58]">{s.code}</span>,
              },
              {
                key: 'name',
                header: t('اسم المورد / الشركة', 'Supplier / Company'),
                sortable: true,
                sortValue: (s) => s.name,
                exportValue: (s) => s.name,
                render: (s) => (
                  <div>
                    <div className="font-black text-slate-900">{s.name}</div>
                    {s.address && <div className="text-[11px] text-slate-500">{s.address}</div>}
                  </div>
                ),
              },
              {
                key: 'phone',
                header: t('رقم الهاتف', 'Phone'),
                exportValue: (s) => s.phone || '-',
                render: (s) => (
                  <div className="font-mono">
                    {s.phone ? (
                      <a href={`tel:${s.phone}`} className="inline-flex items-center gap-1 text-[#003589] hover:underline font-bold">
                        <Phone className="w-3 h-3" />
                        <span>{s.phone}</span>
                      </a>
                    ) : '-'}
                  </div>
                ),
              },
              {
                key: 'currentBalance',
                header: t('موقف الحساب (علينا / لنا)', 'Balance Status'),
                align: 'center',
                sortable: true,
                sortValue: (s) => Number(s.currentBalance || 0),
                exportValue: (s) => Number(s.currentBalance || 0),
                render: (s) => <span className="font-mono tabular-nums">{formatSupplierBalBadge(Number(s.currentBalance || 0))}</span>,
              },
              {
                key: 'actions',
                header: t('الإجراءات', 'Actions'),
                align: 'center',
                render: (s) => {
                  const { openInvoices, availableAdvance } = getSupplierAdvanceInfo(s);
                  return (
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleOpenSupplierStatement(s)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-bold cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5 text-[#003589]" />
                        <span>{t('كشف حساب', 'Statement')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSuppPayError(null);
                          setSuppPayNotes('');
                          setSuppPaymentTarget(s);
                          setSuppPayAmount(s.currentBalance > 0 ? s.currentBalance : 0);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#011E58] hover:bg-[#002160] text-white rounded-lg font-bold cursor-pointer"
                      >
                        <ArrowUpRight className="w-3.5 h-3.5" />
                        <span>{t('سداد دفعة', 'Pay Supplier')}</span>
                      </button>
                      {availableAdvance > 0 && openInvoices.length > 0 && (currentUser?.role === 'admin' || hasPermission('canManageAccounts')) && (
                        <button
                          type="button"
                          onClick={() => {
                            const firstInv = openInvoices[0];
                            setSettleError(null);
                            setSettleNotes(t('تسوية دفعة مقدمة على فاتورة المشتريات', 'Settle advance payment against purchase invoice'));
                            setSettleSupplierTarget(s);
                            setSettleInvoiceId(firstInv?.id || '');
                            setSettleAmount(firstInv ? Math.min(availableAdvance, Number(firstInv.remainingAmount || 0)) : 0);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] rounded-lg font-bold cursor-pointer"
                        >
                          <DollarSign className="w-3.5 h-3.5" />
                          <span>{t('تسوية مقدم', 'Settle Advance')}</span>
                        </button>
                      )}
                    </div>
                  );
                },
              },
            ]}
          />
        </div>
      )}

      {/* Tab 1: Cashboxes List */}
      {activeTab === 'cashboxes' && (
        <UnifiedDataTable
          title={t('الخزائن والحسابات البنكية', 'Cashboxes & Bank Accounts')}
          subtitle={t('أرصدة النقدية بالخزائن والحسابات البنكية المسجلة', 'Cash balances in registered cashboxes and bank accounts')}
          data={cashboxes}
          rowKey={(cb) => cb.id}
          onRowClick={(cb) => setPreviewFinanceItem({ kind: 'cashbox', item: cb })}
          compact
          searchPlaceholder={t('بحث باسم الخزينة أو رقم الحساب...', 'Search by cashbox name or account #...')}
          searchFilter={(cb, q) => `${cb.name} ${cb.accountNumber || ''}`.toLowerCase().includes(q)}
          exportFilename="AWLAD_SELIM_Cashboxes"
          pdfTitle={t('الخزائن والحسابات البنكية', 'Cashboxes & Bank Accounts')}
          headerActions={
            <button
              type="button"
              onClick={() => setIsAddCashboxOpen(true)}
              className="px-3 py-1 rounded-lg bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('إضافة خزينة / حساب بنكي', 'Add Cashbox / Bank Account')}</span>
            </button>
          }
          columns={[
            {
              key: 'name',
              header: t('الخزينة / الحساب', 'Cashbox / Account'),
              sortable: true,
              sortValue: (cb) => cb.name,
              exportValue: (cb) => cb.name,
              render: (cb) => (
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded bg-blue-50 text-blue-900 flex items-center justify-center shrink-0">
                    {cb.type === 'bank' ? <Landmark className="w-3.5 h-3.5" /> : <Wallet className="w-3.5 h-3.5" />}
                  </span>
                  <span className="font-bold text-slate-900">{cb.name}</span>
                </div>
              ),
            },
            {
              key: 'type',
              header: t('النوع', 'Type'),
              exportValue: (cb) => (cb.type === 'bank' ? t('حساب بنكي', 'Bank Account') : t('خزينة نقدية', 'Cashbox')),
              render: (cb) => (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                  {cb.type === 'bank' ? t('حساب بنكي', 'Bank Account') : t('خزينة نقدية', 'Cashbox')}
                </span>
              ),
            },
            {
              key: 'accountNumber',
              header: t('رقم الحساب', 'Account #'),
              exportValue: (cb) => cb.accountNumber || '-',
              render: (cb) => <span className="font-mono text-slate-600">{cb.accountNumber || '-'}</span>,
            },
            {
              key: 'currentBalance',
              header: t('الرصيد المتاح', 'Available Balance'),
              align: 'center',
              sortable: true,
              sortValue: (cb) => (cb.balanceHidden ? 0 : Number(cb.currentBalance ?? 0)),
              exportValue: (cb) => (cb.balanceHidden ? t('محجوب', 'Hidden') : Number(cb.currentBalance ?? 0)),
              render: (cb) => (
                <span className="font-mono text-sm font-black text-blue-950 tabular-nums">
                  {cb.balanceHidden ? t('محجوب', 'Hidden') : `${formatLocaleNumber(cb.currentBalance ?? 0)} ${t(settings.currency)}`}
                </span>
              ),
            },
          ]}
        />
      )}

      {/* Tab 2: Financial Transactions */}
      {activeTab === 'transactions' && (
        <UnifiedDataTable
          title={t('حركة الخزائن والبنوك', 'Cashbox & Bank Transactions')}
          data={filteredTransactions}
          rowKey={(tx) => tx.id}
          onRowClick={(tx) => setPreviewFinanceItem({ kind: 'transaction', item: tx })}
          compact
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder={t('بحث برقم الحركة، الخزينة، أو البيان...', 'Search by tx #, cashbox, or description...')}
          exportFilename="AWLAD_SELIM_FinancialTransactions"
          pdfTitle={t('سجل حركات الخزائن والبنوك', 'Cashbox & Bank Transactions Log')}
          columns={[
            {
              key: 'transactionNumber',
              header: t('رقم الحركة', 'Tx #'),
              sortable: true,
              sortValue: (tx) => tx.transactionNumber,
              exportValue: (tx) => tx.transactionNumber,
              render: (tx) => <span className="font-mono font-bold text-blue-900">{tx.transactionNumber}</span>,
            },
            {
              key: 'date',
              header: t('التاريخ', 'Date'),
              sortable: true,
              sortValue: (tx) => tx.date,
              exportValue: (tx) => tx.date,
              render: (tx) => <span className="font-mono text-slate-600">{tx.date}</span>,
            },
            {
              key: 'cashboxName',
              header: t('الخزينة', 'Cashbox'),
              exportValue: (tx) => tx.cashboxName,
              render: (tx) => <span className="font-semibold">{tx.cashboxName}</span>,
            },
            {
              key: 'category',
              header: t('نوع الحركة', 'Transaction Type'),
              exportValue: (tx) => t(tx.category),
              render: (tx) => <span className="font-bold text-slate-800">{t(tx.category)}</span>,
            },
            {
              key: 'description',
              header: t('البيان', 'Description'),
              exportValue: (tx) => tx.description,
              render: (tx) => <span className="text-slate-600">{tx.description}</span>,
            },
            {
              key: 'amount',
              header: t('المبلغ', 'Amount'),
              align: 'center',
              sortable: true,
              sortValue: (tx) => tx.amount,
              exportValue: (tx) => tx.amount,
              render: (tx) => (
                <span className="font-mono font-black text-sm text-blue-950 tabular-nums">
                  {formatLocaleNumber(tx.amount)} {t(settings.currency)}
                </span>
              ),
            },
            {
              key: 'createdBy',
              header: t('المستخدم المسؤول', 'Created By'),
              exportValue: (tx) => tx.createdBy,
              render: (tx) => <span className="text-slate-500">{tx.createdBy}</span>,
            },
          ]}
        />
      )}

      {/* Tab 3: Expenses & Income */}
      {activeTab === 'expenses' && (
        <UnifiedDataTable
          title={t('سندات المصروفات والإيرادات', 'Expenses & Income Vouchers')}
          data={filteredExpenses}
          rowKey={(rec) => rec.id}
          onRowClick={(rec) => setPreviewFinanceItem({ kind: 'expense', item: rec })}
          compact
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder={t('بحث برقم السند، البند، الخزينة، أو الجهة...', 'Search by voucher #, category, cashbox, or party...')}
          exportFilename={`${t('المصروفات_والإيرادات', 'Expenses_and_Income')}_${new Date().toISOString().split('T')[0]}`}
          pdfTitle={t('سندات المصروفات والإيرادات', 'Expenses & Income Vouchers')}
          emptyTitle={t('لا توجد مصروفات أو إيرادات مسجلة مطابقة للبحث', 'No expenses or income vouchers match the search')}
          toolbarFilters={
            <select
              value={expenseTypeFilter}
              onChange={(e) => setExpenseTypeFilter(e.target.value as any)}
              className="h-8 shrink-0 bg-slate-50 border border-slate-300 rounded-md px-2 text-xs font-bold text-slate-700 outline-hidden"
            >
              <option value="all">{t('الكل (مصروفات وإيرادات)', 'All (Expenses & Income)')}</option>
              <option value="expense">{t('المصروفات فقط', 'Expenses Only')}</option>
              <option value="income">{t('الإيرادات فقط', 'Income Only')}</option>
            </select>
          }
          columns={[
            {
              key: 'recordNumber',
              header: t('رقم السند', 'Voucher #'),
              sortable: true,
              sortValue: (rec) => rec.recordNumber,
              exportValue: (rec) => rec.recordNumber,
              render: (rec) => <span className="font-mono font-bold text-blue-900">{rec.recordNumber}</span>,
            },
            {
              key: 'date',
              header: t('التاريخ', 'Date'),
              sortable: true,
              sortValue: (rec) => rec.date,
              exportValue: (rec) => rec.date,
              render: (rec) => <span className="font-mono text-slate-600">{rec.date}</span>,
            },
            {
              key: 'type',
              header: t('النوع', 'Type'),
              exportValue: (rec) => (rec.type === 'expense' ? t('مصروف', 'Expense') : t('إيراد', 'Income')),
              render: (rec) =>
                rec.type === 'expense' ? (
                  <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200 font-bold text-[10px]">
                    {t('سند صرف (مصروف)', 'Payment Voucher (Expense)')}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold text-[10px]">
                    {t('سند قبض (إيراد)', 'Receipt Voucher (Income)')}
                  </span>
                ),
            },
            {
              key: 'category',
              header: t('البند / التصنيف', 'Category'),
              sortable: true,
              sortValue: (rec) => rec.category,
              exportValue: (rec) => rec.category,
              render: (rec) => <span className="font-bold text-slate-800">{rec.category}</span>,
            },
            {
              key: 'cashboxName',
              header: t('الخزينة', 'Cashbox'),
              exportValue: (rec) => rec.cashboxName,
              render: (rec) => <span className="font-semibold text-slate-700">{rec.cashboxName}</span>,
            },
            {
              key: 'recipientOrPayer',
              header: t('الجهة المستلمة / الدافعة', 'Recipient / Payer'),
              exportValue: (rec) => rec.recipientOrPayer,
              render: (rec) => <span className="text-slate-700">{rec.recipientOrPayer}</span>,
            },
            {
              key: 'amount',
              header: t('المبلغ', 'Amount'),
              align: 'center',
              sortable: true,
              sortValue: (rec) => rec.amount,
              exportValue: (rec) => rec.amount,
              render: (rec) => (
                <span className={`font-mono font-black text-sm tabular-nums ${rec.type === 'expense' ? 'text-amber-800' : 'text-emerald-700'}`}>
                  {formatLocaleNumber(rec.amount)} {t(settings.currency)}
                </span>
              ),
            },
            {
              key: 'notes',
              header: t('ملاحظات', 'Notes'),
              exportValue: (rec) => rec.notes || '-',
              render: (rec) => <span className="text-slate-500">{rec.notes || '-'}</span>,
            },
          ]}
        />
      )}

      {/* CUSTOMER ACCOUNT STATEMENT MODAL */}
      {custStatementTarget && (
        <Modal
          isOpen={!!custStatementTarget}
          onClose={() => setCustStatementTarget(null)}
          title={t(
            `كشف حساب العميل التفصيلي: ${custStatementTarget.shopName || custStatementTarget.name}`,
            `Detailed Customer Statement: ${custStatementTarget.shopName || custStatementTarget.name}`
          )}
          subtitle={`${custStatementTarget.code}${custStatementTarget.phone ? ` · ${custStatementTarget.phone}` : ''}`}
          maxWidth="6xl"
        >
          {isLoadingCustStatement || !custStatementData ? (
            <div className="p-4 text-center text-xs font-bold text-slate-500">{t('جاري تحميل كشف حساب العميل...', 'Loading customer statement...')}</div>
          ) : (
            <div className="space-y-2 text-xs">
              {/* Summary Strip (Separated Debt vs Advance Credit) */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-slate-200 dark:bg-[#21375C] border border-slate-200 dark:border-[#21375C] rounded-lg overflow-hidden">
                <div className="px-2.5 py-2 bg-slate-50 dark:bg-[#132544]">
                  <span className="text-[10px] font-bold text-slate-500 dark:text-[#A9BCD9] block">{t('رصيد أول المدة', 'Opening Balance')}</span>
                  <span className="font-mono font-black text-sm text-slate-900 dark:text-[#F3F7FC]">
                    {formatLocaleNumber(Number(custStatementData.summary.openingBalance || 0))} {t(settings.currency)}
                  </span>
                </div>
                <div className="px-2.5 py-2 bg-blue-50 dark:bg-[#16366B]/60">
                  <span className="text-[10px] font-bold text-blue-700 dark:text-[#85B8FF] block">{t('إجمالي المبيعات', 'Total Sales')}</span>
                  <span className="font-mono font-black text-sm text-blue-950 dark:text-[#F3F7FC]">
                    {formatLocaleNumber(Number(custStatementData.summary.totalSales ?? custStatementData.summary.totalDebit ?? 0))} {t(settings.currency)}
                  </span>
                </div>
                <div className="px-2.5 py-2 bg-emerald-50 dark:bg-emerald-950/40">
                  <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 block">{t('إجمالي المدفوعات', 'Total Payments')}</span>
                  <span className="font-mono font-black text-sm text-emerald-900 dark:text-emerald-200">
                    {formatLocaleNumber(Number(custStatementData.summary.totalPaid ?? custStatementData.summary.totalCredit ?? 0))} {t(settings.currency)}
                  </span>
                </div>
                <div className="px-2.5 py-2 bg-red-50 dark:bg-rose-950/40">
                  <span className="text-[10px] font-bold text-red-700 dark:text-rose-300 block">{t('مستحق لنا (لنا)', 'Receivable (Owed to Us)')}</span>
                  <span className="font-mono font-black text-sm text-red-700 dark:text-rose-200">
                    {formatLocaleNumber(Number(custStatementData.summary.debtAmount ?? Math.max(0, Number(custStatementData.summary.currentBalance || 0))))} {t(settings.currency)}
                  </span>
                </div>
                <div className="px-2.5 py-2 bg-[#EEF3FA] dark:bg-[#132544]">
                  <span className="text-[10px] font-bold text-[#003589] dark:text-[#85B8FF] block">{t('رصيد دائن للعميل (علينا)', 'Customer Credit (We Owe)')}</span>
                  <span className="font-mono font-black text-sm text-[#011E58] dark:text-[#F3F7FC]">
                    {formatLocaleNumber(Number(custStatementData.summary.creditAmount ?? Math.max(0, -Number(custStatementData.summary.currentBalance || 0))))} {t(settings.currency)}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 bg-slate-50 dark:bg-[#132544] rounded-lg border border-slate-200 dark:border-[#21375C]">
                <div className="text-[11px] text-slate-600 dark:text-[#A9BCD9] font-bold">
                  {t('آخر فاتورة', 'Last Invoice')}: {custStatementData.summary.lastInvoiceNumber || '-'} ({custStatementData.summary.lastInvoiceDate || '-'})
                  {' | '}
                  {t('آخر حركة', 'Last Activity')}: {custStatementData.summary.lastTransactionDate || '-'}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const headers = [
                        t('التاريخ', 'Date'),
                        t('رقم المستند', 'Document No.'),
                        t('النوع', 'Type'),
                        t('البيان', 'Description'),
                        t('مدين (لنا)', 'Debit (Receivable)'),
                        t('دائن (سداد)', 'Credit (Paid)'),
                        t('الرصيد التراكمي', 'Running Balance'),
                        t('الاتجاه', 'Direction'),
                      ];
                      const rows = custStatementData.entries.map((en) => [
                        en.date,
                        en.docNumber,
                        t(en.label),
                        t(en.description),
                        en.debit || 0,
                        en.credit || 0,
                        Math.abs(Number(en.runningBalance || 0)),
                        Number(en.runningBalance || 0) > 0.005 ? t('لنا', 'Receivable') : Number(en.runningBalance || 0) < -0.005 ? t('علينا', 'Credit') : t('متوازن', 'Settled'),
                      ]);
                      exportToExcel(`${t('كشف_حساب_عميل', 'Customer_Statement')}_${custStatementTarget.name}_${new Date().toISOString().split('T')[0]}`, headers, rows);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-300 rounded-lg font-bold text-emerald-800 hover:bg-slate-100 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Excel</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPrintData({
                        title: t('كشف حساب عميل معتمد', 'Certified Customer Account Statement'),
                        docNumber: custStatementTarget.code,
                        docType: t('كشف حساب', 'Account Statement'),
                        date: new Date().toISOString().split('T')[0],
                        partyName: custStatementTarget.shopName || custStatementTarget.name,
                        partyPhone: custStatementTarget.phone,
                        partyAddress: custStatementTarget.address,
                        previousBalance: Number(custStatementData.summary.openingBalance || 0),
                        currentBalance: Number(custStatementData.summary.currentBalance || 0),
                        grandTotal: Math.abs(Number(custStatementData.summary.currentBalance || 0)),
                        tableHeaders: [
                          t('م', '#'),
                          t('البيان', 'Description'),
                          t('التاريخ', 'Date'),
                          t('العدد', 'Count'),
                          t('مدين (لنا)', 'Debit (Receivable)'),
                          t('دائن (سداد)', 'Credit (Paid)'),
                          t('الرصيد التراكمي', 'Running Balance'),
                        ],
                        items: custStatementData.entries.map((en) => ({
                          name: `${t(en.label)} (${en.docNumber}) - ${t(en.description)}`,
                          unit: en.date,
                          quantity: 1,
                          price: Number(en.debit || 0),
                          discount: Number(en.credit || 0),
                          total: Number(en.runningBalance || 0),
                        })),
                      });
                      setIsPrintModalOpen(true);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 bg-blue-900 text-white rounded-lg font-bold hover:bg-blue-950 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>{t('طباعة', 'Print')}</span>
                  </button>
                </div>
              </div>

              <UnifiedDataTable<CustomerStatementEntry>
                title={t('سجل حركات كشف حساب العميل', 'Customer Account Statement Entries')}
                data={custStatementData.entries}
                rowKey={(entry) => entry.id}
                compact
                searchable={false}
                defaultPageSize={25}
                onRowClick={(entry) => inspectCustomerEntry(entry)}
                emptyTitle={t('لا توجد حركات مسجلة لهذا العميل حتى الآن', 'No transactions recorded for this customer yet')}
                columns={[
                  {
                    key: 'date',
                    header: t('التاريخ', 'Date'),
                    render: (entry) => <span className="font-mono text-slate-600">{entry.date}</span>,
                  },
                  {
                    key: 'docNumber',
                    header: t('رقم المستند', 'Document No.'),
                    render: (entry) => <span className="font-mono font-bold text-blue-900">{entry.docNumber}</span>,
                  },
                  {
                    key: 'label',
                    header: t('نوع الحركة', 'Transaction Type'),
                    render: (entry) => <span className="font-bold">{t(entry.label)}</span>,
                  },
                  {
                    key: 'description',
                    header: t('البيان', 'Description'),
                    render: (entry) => <span className="text-slate-700">{t(entry.description)}</span>,
                  },
                  {
                    key: 'debit',
                    header: t('مدين (لنا)', 'Debit (Receivable)'),
                    align: 'center',
                    render: (entry) => (
                      <span className="font-mono font-bold text-red-700 tabular-nums">
                        {Number(entry.debit || 0) > 0 ? formatLocaleNumber(Number(entry.debit)) : '-'}
                      </span>
                    ),
                  },
                  {
                    key: 'credit',
                    header: t('دائن (سداد)', 'Credit (Paid)'),
                    align: 'center',
                    render: (entry) => (
                      <span className="font-mono font-bold text-emerald-700 tabular-nums">
                        {Number(entry.credit || 0) > 0 ? formatLocaleNumber(Number(entry.credit)) : '-'}
                      </span>
                    ),
                  },
                  {
                    key: 'runningBalance',
                    header: t('الرصيد التراكمي', 'Running Balance'),
                    align: 'center',
                    render: (entry) => (
                      <span className="font-mono font-black tabular-nums">
                        {formatLocaleNumber(Math.abs(Number(entry.runningBalance || 0)))}
                      </span>
                    ),
                  },
                  {
                    key: 'direction',
                    header: t('الحالة', 'Status'),
                    align: 'center',
                    render: (entry) => {
                      const rb = Number(entry.runningBalance || 0);
                      return (
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-black border ${
                            rb > 0.005
                              ? 'bg-red-50 text-red-700 border-red-200'
                              : rb < -0.005
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {rb > 0.005 ? t('لنا', 'Receivable') : rb < -0.005 ? t('علينا', 'Credit') : t('متوازن', 'Settled')}
                        </span>
                      );
                    },
                  },
                  {
                    key: 'view',
                    header: t('عرض', 'View'),
                    align: 'center',
                    render: () => <Eye className="w-4 h-4 text-blue-800 inline" />,
                  },
                ]}
              />
            </div>
          )}
        </Modal>
      )}

      {/* SUPPLIER ACCOUNT STATEMENT MODAL */}
      {suppStatementTarget && (
        <Modal
          isOpen={!!suppStatementTarget}
          onClose={() => setSuppStatementTarget(null)}
          title={t(`كشف حساب المورد التفصيلي: ${suppStatementTarget.name}`, `Detailed Supplier Statement: ${suppStatementTarget.name}`)}
          subtitle={`${suppStatementTarget.code}${suppStatementTarget.phone ? ` · ${suppStatementTarget.phone}` : ''}`}
          maxWidth="6xl"
        >
          {isLoadingSuppStatement || !suppStatementData ? (
            <div className="p-4 text-center text-xs font-bold text-slate-500">{t('جاري تحميل كشف حساب المورد...', 'Loading supplier statement...')}</div>
          ) : (
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-slate-200 dark:bg-[#21375C] border border-slate-200 dark:border-[#21375C] rounded-lg overflow-hidden">
                <div className="px-2.5 py-2 bg-slate-50 dark:bg-[#132544]">
                  <span className="text-[10px] font-bold text-slate-500 dark:text-[#A9BCD9] block">{t('رصيد أول المدة', 'Opening Balance')}</span>
                  <span className="font-mono font-black text-sm text-slate-900 dark:text-[#F3F7FC]">
                    {formatLocaleNumber(Number(suppStatementData.summary.openingBalance || 0))} {t(settings.currency)}
                  </span>
                </div>
                <div className="px-2.5 py-2 bg-[#EEF3FA] dark:bg-[#16366B]/60">
                  <span className="text-[10px] font-bold text-[#003589] dark:text-[#85B8FF] block">{t('إجمالي المشتريات', 'Total Purchases')}</span>
                  <span className="font-mono font-black text-sm text-[#011E58] dark:text-[#F3F7FC]">
                    {formatLocaleNumber(Number(suppStatementData.summary.totalPurchases || 0))} {t(settings.currency)}
                  </span>
                </div>
                <div className="px-2.5 py-2 bg-emerald-50 dark:bg-emerald-950/40">
                  <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 block">{t('إجمالي المدفوعات', 'Total Payments')}</span>
                  <span className="font-mono font-black text-sm text-emerald-900 dark:text-emerald-200">
                    {formatLocaleNumber(Number(suppStatementData.summary.totalPaid || 0))} {t(settings.currency)}
                  </span>
                </div>
                <div className="px-2.5 py-2 bg-amber-50 dark:bg-amber-950/40">
                  <span className="text-[10px] font-bold text-amber-800 dark:text-amber-300 block">{t('مستحق للمورد (علينا)', 'Payable (We Owe)')}</span>
                  <span className="font-mono font-black text-sm text-amber-900 dark:text-amber-200">
                    {formatLocaleNumber(Number(suppStatementData.summary.payableAmount || 0))} {t(settings.currency)}
                  </span>
                </div>
                <div className="px-2.5 py-2 bg-emerald-50/70 dark:bg-emerald-950/30">
                  <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 block">{t('دفعة مقدمة عند المورد (لنا)', 'Advance Credit (For Us)')}</span>
                  <span className="font-mono font-black text-sm text-emerald-900 dark:text-emerald-200">
                    {formatLocaleNumber(Number(suppStatementData.summary.advanceCreditAmount || 0))} {t(settings.currency)}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 bg-slate-50 dark:bg-[#132544] rounded-lg border border-slate-200 dark:border-[#21375C]">
                <div className="text-[11px] text-slate-600 dark:text-[#A9BCD9] font-bold">
                  {t('آخر فاتورة شراء', 'Last Purchase Invoice')}: {suppStatementData.summary.lastInvoiceNumber || '-'} ({suppStatementData.summary.lastInvoiceDate || '-'})
                  {' | '}
                  {t('آخر حركة', 'Last Activity')}: {suppStatementData.summary.lastTransactionDate || '-'}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const headers = [
                        t('التاريخ', 'Date'),
                        t('رقم المستند', 'Document No.'),
                        t('النوع', 'Type'),
                        t('البيان', 'Description'),
                        t('له / مشتريات', 'Credit / Purchases'),
                        t('سداد / مرتجع', 'Payment / Return'),
                        t('الرصيد التراكمي', 'Running Balance'),
                        t('الحالة', 'Status'),
                      ];
                      const rows = suppStatementData.entries.map((en) => [
                        en.date,
                        en.docNumber,
                        t(en.label),
                        t(en.description),
                        en.credit || 0,
                        en.debit || 0,
                        Math.abs(Number(en.runningBalance || 0)),
                        Number(en.runningBalance || 0) > 0.005 ? t('علينا', 'Payable') : Number(en.runningBalance || 0) < -0.005 ? t('لنا (مقدم)', 'Advance Credit') : t('متوازن', 'Settled'),
                      ]);
                      exportToExcel(`${t('كشف_حساب_مورد', 'Supplier_Statement')}_${suppStatementTarget.name}_${new Date().toISOString().split('T')[0]}`, headers, rows);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-300 rounded-lg font-bold text-emerald-800 hover:bg-slate-100 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Excel</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPrintData({
                        title: t('كشف حساب مورد معتمد', 'Certified Supplier Account Statement'),
                        docNumber: suppStatementTarget.code,
                        docType: t('كشف حساب', 'Account Statement'),
                        date: new Date().toISOString().split('T')[0],
                        partyName: suppStatementTarget.name,
                        partyPhone: suppStatementTarget.phone,
                        partyAddress: suppStatementTarget.address,
                        previousBalance: Number(suppStatementData.summary.openingBalance || 0),
                        currentBalance: Number(suppStatementData.summary.currentBalance || 0),
                        grandTotal: Math.abs(Number(suppStatementData.summary.currentBalance || 0)),
                        tableHeaders: [
                          t('م', '#'),
                          t('البيان', 'Description'),
                          t('التاريخ', 'Date'),
                          t('العدد', 'Count'),
                          t('له / مشتريات', 'Credit / Purchases'),
                          t('سداد / مرتجع', 'Payment / Return'),
                          t('الرصيد التراكمي', 'Running Balance'),
                        ],
                        items: suppStatementData.entries.map((en) => ({
                          name: `${t(en.label)} (${en.docNumber}) - ${t(en.description)}`,
                          unit: en.date,
                          quantity: 1,
                          price: Number(en.credit || 0),
                          discount: Number(en.debit || 0),
                          total: Number(en.runningBalance || 0),
                        })),
                      });
                      setIsPrintModalOpen(true);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 bg-blue-900 text-white rounded-lg font-bold hover:bg-blue-950 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>{t('طباعة', 'Print')}</span>
                  </button>
                </div>
              </div>

              <UnifiedDataTable<SupplierStatementEntry>
                title={t('سجل حركات كشف حساب المورد', 'Supplier Account Statement Entries')}
                data={suppStatementData.entries}
                rowKey={(entry) => entry.id}
                compact
                searchable={false}
                defaultPageSize={25}
                onRowClick={(entry) => inspectSupplierEntry(entry)}
                emptyTitle={t('لا توجد حركات مسجلة لهذا المورد حتى الآن', 'No transactions recorded for this supplier yet')}
                columns={[
                  {
                    key: 'date',
                    header: t('التاريخ', 'Date'),
                    render: (entry) => <span className="font-mono text-slate-600">{entry.date}</span>,
                  },
                  {
                    key: 'docNumber',
                    header: t('رقم المستند', 'Document No.'),
                    render: (entry) => <span className="font-mono font-bold text-[#011E58]">{entry.docNumber}</span>,
                  },
                  {
                    key: 'label',
                    header: t('نوع الحركة', 'Transaction Type'),
                    render: (entry) => <span className="font-bold">{t(entry.label)}</span>,
                  },
                  {
                    key: 'description',
                    header: t('البيان', 'Description'),
                    render: (entry) => <span className="text-slate-700">{t(entry.description)}</span>,
                  },
                  {
                    key: 'credit',
                    header: t('له / مشتريات', 'Credit / Purchases'),
                    align: 'center',
                    render: (entry) => (
                      <span className="font-mono font-bold text-slate-900 tabular-nums">
                        {Number(entry.credit || 0) > 0 ? formatLocaleNumber(Number(entry.credit)) : '-'}
                      </span>
                    ),
                  },
                  {
                    key: 'debit',
                    header: t('سداد / مرتجع', 'Payment / Return'),
                    align: 'center',
                    render: (entry) => (
                      <span className="font-mono font-bold text-emerald-700 tabular-nums">
                        {Number(entry.debit || 0) > 0 ? formatLocaleNumber(Number(entry.debit)) : '-'}
                      </span>
                    ),
                  },
                  {
                    key: 'runningBalance',
                    header: t('الرصيد التراكمي', 'Running Balance'),
                    align: 'center',
                    render: (entry) => (
                      <span className="font-mono font-black tabular-nums">
                        {formatLocaleNumber(Math.abs(Number(entry.runningBalance || 0)))}
                      </span>
                    ),
                  },
                  {
                    key: 'direction',
                    header: t('الحالة', 'Status'),
                    align: 'center',
                    render: (entry) => {
                      const rb = Number(entry.runningBalance || 0);
                      return (
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-black border ${
                            rb > 0.005
                              ? 'bg-amber-50 text-amber-900 border-amber-200'
                              : rb < -0.005
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {rb > 0.005 ? t('علينا', 'Payable') : rb < -0.005 ? t('لنا (مقدم)', 'Advance Credit') : t('متوازن', 'Settled')}
                        </span>
                      );
                    },
                  },
                  {
                    key: 'view',
                    header: t('عرض', 'View'),
                    align: 'center',
                    render: () => <Eye className="w-4 h-4 text-[#003589] inline" />,
                  },
                ]}
              />
            </div>
          )}
        </Modal>
      )}

      {/* INLINE DOCUMENT PREVIEW SUB-MODAL */}
      {previewStatementDoc && (
        <Modal
          isOpen={!!previewStatementDoc}
          onClose={() => setPreviewStatementDoc(null)}
          title={previewStatementDoc.title}
          subtitle={`${t('رقم المستند', 'Document No.')}: ${previewStatementDoc.docNumber} · ${t('التاريخ', 'Date')}: ${previewStatementDoc.date}`}
          maxWidth="4xl"
        >
          <div className="space-y-3 text-xs">
            <div className="px-2.5 py-2 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-950 font-black text-[11px] border border-blue-200">
                {previewStatementDoc.badge}
              </span>
              <span className="text-slate-700 font-semibold">{previewStatementDoc.description}</span>
            </div>

            {previewStatementDoc.invoice ? (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 px-2.5 py-2 rounded-lg border border-slate-200 font-bold">
                  <div>{t('المستودع', 'Warehouse')}: {previewStatementDoc.invoice.warehouseName || '-'}</div>
                  <div>{t('المدفوع', 'Paid')}: {formatLocaleNumber(Number(previewStatementDoc.invoice.paidAmount || 0))} {t(settings.currency)}</div>
                  <div>{t('المتبقي', 'Remaining')}: {formatLocaleNumber(Number(previewStatementDoc.invoice.remainingAmount || 0))} {t(settings.currency)}</div>
                  <div>{t('الإجمالي', 'Total')}: {formatLocaleNumber(Number(previewStatementDoc.invoice.grandTotal || 0))} {t(settings.currency)}</div>
                </div>
                <UnifiedDataTable<InvoiceItem>
                  title={t('أصناف المستند', 'Document Items')}
                  data={previewStatementDoc.invoice.items || []}
                  rowKey={(it, idx) => `${it.productId || it.productName}-${idx}`}
                  compact
                  searchable={false}
                  defaultPageSize={25}
                  columns={[
                    {
                      key: 'productName',
                      header: t('الصنف', 'Item'),
                      render: (it) => <span className="font-bold">{it.productName}</span>,
                    },
                    {
                      key: 'unit',
                      header: t('الوحدة', 'Unit'),
                      render: (it) => <span>{t(it.unit)}</span>,
                    },
                    {
                      key: 'quantity',
                      header: t('الكمية', 'Qty'),
                      align: 'center',
                      render: (it) => <span className="font-mono font-bold tabular-nums">{formatLocaleNumber(it.quantity)}</span>,
                    },
                    {
                      key: 'unitPrice',
                      header: t('السعر', 'Price'),
                      align: 'center',
                      render: (it) => <span className="font-mono tabular-nums">{formatLocaleNumber(Number(it.unitPrice || 0))}</span>,
                    },
                    {
                      key: 'total',
                      header: t('الإجمالي', 'Total'),
                      align: 'center',
                      render: (it) => <span className="font-mono font-bold tabular-nums">{formatLocaleNumber(Number(it.total || 0))}</span>,
                    },
                  ]}
                />
              </div>
            ) : (
              previewStatementDoc.extraLines && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {previewStatementDoc.extraLines.map((line, idx) => (
                    <div key={idx} className="px-2.5 py-2 rounded-lg bg-slate-50 border border-slate-200">
                      <span className="text-[11px] font-bold text-slate-500 block">{line.label}</span>
                      <span className="font-mono font-black text-slate-900">{line.value}</span>
                    </div>
                  ))}
                </div>
              )
            )}

            <div className="flex justify-end pt-2 border-t">
              <button
                type="button"
                onClick={() => setPreviewStatementDoc(null)}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold cursor-pointer"
              >
                {t('إغلاق المعاينة', 'Close Preview')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* CUSTOMER PAYMENT MODAL */}
      {custPaymentTarget && (
        <Modal
          isOpen={!!custPaymentTarget}
          onClose={() => setCustPaymentTarget(null)}
          title={t(`تحصيل دفعة من العميل: ${custPaymentTarget.shopName || custPaymentTarget.name}`, `Collect Payment from Customer: ${custPaymentTarget.shopName || custPaymentTarget.name}`)}
          subtitle={
            custPaymentTarget.currentBalance > 0
              ? `${t('المديونية الحالية (لنا)', 'Current Debt (Receivable)')}: ${formatLocaleNumber(custPaymentTarget.currentBalance)} ${t(settings.currency)}`
              : custPaymentTarget.currentBalance < 0
              ? `${t('رصيد دائن للعميل حالياً (علينا)', 'Current Customer Credit (We Owe)')}: ${formatLocaleNumber(Math.abs(custPaymentTarget.currentBalance))} ${t(settings.currency)}`
              : t('الحساب متوازن حالياً (0)', 'Account currently settled (0)')
          }
          maxWidth="md"
        >
          <form onSubmit={handleSubmitCustomerPayment} className="space-y-3 text-xs">
            {custPayError && (
              <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{custPayError}</span>
              </div>
            )}

            <div>
              <label className="block font-bold mb-1">{t(`المبلغ المحصل (${t(settings.currency)}):`, `Collected Amount (${t(settings.currency)}):`)}</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={custPayAmount || ''}
                onChange={(e) => setCustPayAmount(Number(e.target.value))}
                className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1 text-center font-mono font-black text-emerald-800 text-base"
              />
            </div>

            {custPayAmount > Math.max(0, Number(custPaymentTarget.currentBalance || 0)) + 0.009 && (
              <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 font-bold leading-relaxed">
                {t(
                  `تنبيه محاسبي: المبلغ المحصل يتجاوز المديونية الحالية (${formatLocaleNumber(Math.max(0, Number(custPaymentTarget.currentBalance || 0)))} ${t(settings.currency)}). سيتم حفظ الزيادة كـ "رصيد دائن / دفعة مقدمة للعميل (علينا)" دون تصفير الرصيد السالب.`,
                  `Accounting notice: Collected amount exceeds current debt (${formatLocaleNumber(Math.max(0, Number(custPaymentTarget.currentBalance || 0)))} ${t(settings.currency)}). Excess will be saved as customer advance credit without zeroing the negative balance.`
                )}
              </div>
            )}

            <div>
              <label className="block font-bold mb-1">{t('وسيلة التحصيل:', 'Collection Method:')}</label>
              <div className="grid grid-cols-3 gap-2 font-bold">
                {[
                  { id: 'cash' as const, label: t('نقدي', 'Cash') },
                  { id: 'bank' as const, label: t('تحويل بنكي', 'Bank Transfer') },
                  { id: 'cheque' as const, label: t('شيك', 'Cheque') },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setCustPayMethod(m.id)}
                    className={`py-1.5 px-2 rounded-lg border cursor-pointer ${
                      custPayMethod === m.id ? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-bold mb-1">{t('الخزينة المودع بها:', 'Deposit Cashbox:')}</label>
              <select
                value={custPayCashboxId}
                onChange={(e) => setCustPayCashboxId(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1 font-bold"
              >
                {cashboxes.map((cb) => (
                  <option key={cb.id} value={cb.id}>
                    {cb.balanceHidden
                      ? `${cb.name} (${t('رصيد محجوب', 'Balance hidden')})`
                      : `${cb.name} (${t('رصيدها:', 'Balance:')} ${formatLocaleNumber(cb.currentBalance ?? 0)})`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold mb-1">{t('البيان والملاحظات:', 'Description & Notes:')}</label>
              <input
                type="text"
                value={custPayNotes}
                onChange={(e) => setCustPayNotes(e.target.value)}
                placeholder={t('تحصيل نقدي من حساب العميل...', 'Cash collection from customer account...')}
                className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setCustPaymentTarget(null)} className="px-3.5 py-1.5 border rounded-lg font-bold cursor-pointer">
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={isSubmittingCustPay}
                className="px-4 py-1.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-lg font-bold cursor-pointer disabled:opacity-50"
              >
                {isSubmittingCustPay ? t('جاري التسجيل...', 'Recording...') : t('تأكيد التحصيل', 'Confirm Collection')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* SUPPLIER PAYMENT MODAL (WITH OVERPAYMENT GUARD) */}
      {suppPaymentTarget && (
        <Modal
          isOpen={!!suppPaymentTarget}
          onClose={() => setSuppPaymentTarget(null)}
          title={t(`سداد دفعة للمورد: ${suppPaymentTarget.name}`, `Pay Supplier: ${suppPaymentTarget.name}`)}
          subtitle={
            suppPaymentTarget.currentBalance > 0
              ? `${t('المستحق للمورد (علينا)', 'Payable to Supplier (We Owe)')}: ${formatLocaleNumber(suppPaymentTarget.currentBalance)} ${t(settings.currency)}`
              : suppPaymentTarget.currentBalance < 0
              ? `${t('دفعة مقدمة لنا عند المورد', 'Our Advance Credit with Supplier')}: ${formatLocaleNumber(Math.abs(suppPaymentTarget.currentBalance))} ${t(settings.currency)}`
              : t('حساب المورد متوازن حالياً (0)', 'Supplier account currently settled (0)')
          }
          maxWidth="md"
        >
          <form onSubmit={handleSubmitSupplierPayment} className="space-y-3 text-xs">
            {suppPayError && (
              <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{suppPayError}</span>
              </div>
            )}

            <div>
              <label className="block font-bold mb-1">{t(`المبلغ المسدد (${t(settings.currency)}):`, `Paid Amount (${t(settings.currency)}):`)}</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={suppPayAmount || ''}
                onChange={(e) => setSuppPayAmount(Number(e.target.value))}
                className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1 text-center text-[#011E58] font-mono font-black text-base"
              />
            </div>

            {(() => {
              const debt = Math.max(0, Number(suppPaymentTarget.currentBalance || 0));
              const overpayment = Math.max(0, Number((suppPayAmount - debt).toFixed(2)));
              if (overpayment <= 0.009) return null;
              return (
                <div
                  className={`p-2.5 rounded-lg border font-bold leading-relaxed space-y-1 ${
                    canApproveSupplierOverpayment
                      ? 'bg-amber-50 border-amber-200 text-amber-950'
                      : 'bg-red-50 border-red-200 text-red-900'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-black">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>
                      {canApproveSupplierOverpayment
                        ? t('تنبيه دفعة مقدمة للمورد (رصيد لنا)', 'Supplier Advance Payment Notice (Credit for Us)')
                        : t('سداد يتجاوز المستحق يتطلب صلاحية اعتماد إدارية', 'Overpayment requires administrative approval permission')}
                    </span>
                  </div>
                  <p>
                    {t(
                      `المبلغ الزائد (${formatLocaleNumber(overpayment)} ${t(settings.currency)}) يتجاوز المديونية الحالية (${formatLocaleNumber(debt)} ${t(settings.currency)}) وسيُسجل كـ "دفعة مقدمة للمورد (لنا)" لحين تسويته مع فواتير مشتريات قادمة.`,
                      `The excess amount (${formatLocaleNumber(overpayment)} ${t(settings.currency)}) exceeds current debt (${formatLocaleNumber(debt)} ${t(settings.currency)}) and will be recorded as supplier advance credit until settled against future purchase invoices.`
                    )}
                  </p>
                  {!canApproveSupplierOverpayment && (
                    <p className="text-[11px] underline">
                      {t(
                        'لا تملك صلاحية اعتماد الدفعة الزائدة للمورد (مسموح للمدير العام / مدير الفرع / صلاحية الاعتماد فقط).',
                        'You do not have permission to approve supplier overpayments (allowed for General Manager / Branch Manager / Approver only).'
                      )}
                    </p>
                  )}
                </div>
              );
            })()}

            <div>
              <label className="block font-bold mb-1">{t('الخزينة أو الحساب المسدد منه:', 'Paying Cashbox / Account:')}</label>
              <select
                value={suppPayCashboxId}
                onChange={(e) => setSuppPayCashboxId(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1 font-bold"
              >
                {cashboxes.map((cb) => (
                  <option key={cb.id} value={cb.id}>
                    {cb.balanceHidden
                      ? `${cb.name} (${t('رصيد محجوب', 'Balance hidden')})`
                      : `${cb.name} (${t('رصيدها:', 'Balance:')} ${formatLocaleNumber(cb.currentBalance ?? 0)})`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold mb-1">{t('ملاحظات الصرف:', 'Payment Notes:')}</label>
              <input
                type="text"
                value={suppPayNotes}
                onChange={(e) => setSuppPayNotes(e.target.value)}
                placeholder={t('سداد دفعة من حساب المورد...', 'Payment to supplier account...')}
                className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setSuppPaymentTarget(null)} className="px-3.5 py-1.5 border rounded-lg font-bold cursor-pointer">
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={
                  isSubmittingSuppPay ||
                  (suppPayAmount - Math.max(0, Number(suppPaymentTarget.currentBalance || 0)) > 0.009 &&
                    !canApproveSupplierOverpayment)
                }
                className="px-4 py-1.5 bg-[#011E58] hover:bg-[#002160] text-white rounded-lg font-bold cursor-pointer disabled:opacity-50"
              >
                {isSubmittingSuppPay ? t('جاري الصرف...', 'Processing...') : t('تأكيد الصرف للمورد', 'Confirm Supplier Payment')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* SUPPLIER ADVANCE SETTLEMENT MODAL */}
      {settleSupplierTarget && (
        <Modal
          isOpen={!!settleSupplierTarget}
          onClose={() => !isSettlingAdvance && setSettleSupplierTarget(null)}
          title={t(`تسوية دفعة مقدمة للمورد: ${settleSupplierTarget.name}`, `Settle Supplier Advance: ${settleSupplierTarget.name}`)}
          subtitle={t(
            'تسوية داخلية من الرصيد المقدم المتاح على فاتورة مشتريات دون التأثير على الخزائن',
            'Internal settlement from available advance balance onto a purchase invoice without affecting cashboxes'
          )}
          maxWidth="md"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const { availableAdvance, openInvoices } = getSupplierAdvanceInfo(settleSupplierTarget);
              const inv = openInvoices.find((i) => i.id === settleInvoiceId);
              if (!inv) {
                setSettleError(t('يرجى اختيار فاتورة مشتريات مفتوحة للتسوية.', 'Please select an open purchase invoice to settle.'));
                return;
              }
              if (settleAmount <= 0 || settleAmount > Math.min(availableAdvance, inv.remainingAmount) + 0.01) {
                setSettleError(t('مبلغ التسوية يتجاوز المسموح به على الفاتورة أو الرصيد المقدم المتاح.', 'Settlement amount exceeds invoice remaining balance or available advance credit.'));
                return;
              }
              setSettleError(null);
              setIsConfirmingSettle(true);
            }}
            className="space-y-3 text-xs"
          >
            {settleError && (
              <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{settleError}</span>
              </div>
            )}
            <div>
              <label className="block font-bold mb-1">{t('فاتورة المشتريات المفتوحة:', 'Open Purchase Invoice:')}</label>
              <select
                value={settleInvoiceId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSettleInvoiceId(id);
                  const { openInvoices, availableAdvance } = getSupplierAdvanceInfo(settleSupplierTarget);
                  const found = openInvoices.find((i) => i.id === id);
                  if (found) setSettleAmount(Math.min(availableAdvance, Number(found.remainingAmount || 0)));
                }}
                className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1 font-bold"
              >
                {getSupplierAdvanceInfo(settleSupplierTarget).openInvoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoiceNumber} — {t('متبقي:', 'Remaining:')} {formatLocaleNumber(Number(inv.remainingAmount || 0))} {t(settings.currency)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold mb-1">
                {t(`مبلغ التسوية (${t(settings.currency)}) — المتاح:`, `Settlement Amount (${t(settings.currency)}) — Available:`)} {formatLocaleNumber(getSupplierAdvanceInfo(settleSupplierTarget).availableAdvance)}
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={settleAmount || ''}
                onChange={(e) => setSettleAmount(Number(e.target.value))}
                className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1 text-center font-mono font-black text-emerald-800 text-sm"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">{t('ملاحظات التسوية:', 'Settlement Notes:')}</label>
              <input
                type="text"
                value={settleNotes}
                onChange={(e) => setSettleNotes(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setSettleSupplierTarget(null)} className="px-3.5 py-1.5 border rounded-lg font-bold cursor-pointer">
                {t('إلغاء', 'Cancel')}
              </button>
              <button
                type="submit"
                disabled={isSettlingAdvance}
                className="px-4 py-1.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-lg font-bold cursor-pointer disabled:opacity-50"
              >
                {t('تنفيذ التسوية', 'Execute Settlement')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmDialog
        isOpen={isConfirmingSettle}
        onClose={() => !isSettlingAdvance && setIsConfirmingSettle(false)}
        onConfirm={handleConfirmSettleAdvance}
        variant="warning"
        isLoading={isSettlingAdvance}
        title={t('تأكيد تسوية الدفعة المقدمة', 'Confirm Advance Settlement')}
        message={
          settleSupplierTarget
            ? t(
                `سيتم تسوية مبلغ ${formatLocaleNumber(settleAmount)} ${t(settings.currency)} من رصيد الدفعة المقدمة لحساب المورد (${settleSupplierTarget.name}) على الفاتورة المحددة دون أي سحب جديد من الخزينة.`,
                `An amount of ${formatLocaleNumber(settleAmount)} ${t(settings.currency)} will be settled from supplier (${settleSupplierTarget.name}) advance balance onto the selected invoice with no new cashbox withdrawal.`
              )
            : ''
        }
        confirmLabel={t('تأكيد التسوية', 'Confirm Settlement')}
      />

      {/* Transfer Modal */}
      <Modal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        title={t('تحويل نقدية بين الخزائن والبنوك', 'Transfer Funds Between Cashboxes & Banks')}
        maxWidth="md"
      >
        <form onSubmit={handleExecuteTransfer} className="space-y-3 text-xs">
          {transferError && (
            <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{transferError}</span>
            </div>
          )}
          <div>
            <label className="block font-bold mb-1">{t('من الخزينة / الحساب:', 'From Cashbox / Account:')}</label>
            <select
              value={fromCbId}
              onChange={(e) => setFromCbId(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1 font-bold"
            >
              {cashboxes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({t('رصيدها:', 'Balance:')} {c.balanceHidden ? t('محجوب', 'Hidden') : formatLocaleNumber(c.currentBalance ?? 0)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold mb-1">{t('إلى الخزينة / الحساب:', 'To Cashbox / Account:')}</label>
            <select
              value={toCbId}
              onChange={(e) => setToCbId(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1 font-bold"
            >
              {cashboxes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({t('رصيدها:', 'Balance:')} {c.balanceHidden ? t('محجوب', 'Hidden') : formatLocaleNumber(c.currentBalance ?? 0)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold mb-1">{t(`المبلغ المراد تحويله (${t(settings.currency)}):`, `Amount to Transfer (${t(settings.currency)}):`)}</label>
            <input
              type="number"
              min="1"
              required
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1 font-mono font-black text-center text-sm"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">{t('البيان:', 'Description:')}</label>
            <input
              type="text"
              value={transferNotes}
              onChange={(e) => setTransferNotes(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsTransferModalOpen(false)} className="px-3.5 py-1.5 border rounded-lg font-bold cursor-pointer">
              {t('إلغاء', 'Cancel')}
            </button>
            <button type="submit" disabled={isSubmittingTransfer} className="px-4 py-1.5 bg-blue-900 text-white rounded-lg font-bold cursor-pointer disabled:opacity-50">
              {isSubmittingTransfer ? t('جاري التنفيذ...', 'Executing...') : t('تنفيذ التحويل المالي', 'Execute Transfer')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Cashbox Modal */}
      <Modal
        isOpen={isAddCashboxOpen}
        onClose={() => setIsAddCashboxOpen(false)}
        title={t('إضافة خزينة أو حساب بنكي', 'Add Cashbox or Bank Account')}
        maxWidth="md"
      >
        <form onSubmit={handleAddCashboxSubmit} className="space-y-3 text-xs">
          {cashboxError && (
            <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{cashboxError}</span>
            </div>
          )}
          <div>
            <label className="block font-bold mb-1">{t('نوع الحساب:', 'Account Type:')}</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNewCbType('cashbox')}
                className={`py-1.5 px-2 border rounded-lg font-bold cursor-pointer ${newCbType === 'cashbox' ? 'bg-blue-900 text-white' : 'bg-slate-50'}`}
              >
                {t('خزينة نقدية', 'Cashbox')}
              </button>
              <button
                type="button"
                onClick={() => setNewCbType('bank')}
                className={`py-1.5 px-2 border rounded-lg font-bold cursor-pointer ${newCbType === 'bank' ? 'bg-blue-900 text-white' : 'bg-slate-50'}`}
              >
                {t('حساب بنكي', 'Bank Account')}
              </button>
            </div>
          </div>

          <div>
            <label className="block font-bold mb-1">{t('اسم الخزينة أو البنك:', 'Cashbox or Bank Name:')}</label>
            <input
              type="text"
              required
              value={newCbName}
              onChange={(e) => setNewCbName(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1 font-bold"
            />
          </div>

          {newCbType === 'bank' && (
            <div>
              <label className="block font-bold mb-1">{t('رقم الحساب أو الآيبان:', 'Account Number / IBAN:')}</label>
              <input
                type="text"
                dir="ltr"
                value={newCbAccount}
                onChange={(e) => setNewCbAccount(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1 font-mono"
              />
            </div>
          )}

          <div>
            <label className="block font-bold mb-1">{t('الرصيد الافتتاحي:', 'Opening Balance:')}</label>
            <input
              type="number"
              value={newCbOpening}
              onChange={(e) => setNewCbOpening(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1 font-mono font-bold"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsAddCashboxOpen(false)} className="px-3.5 py-1.5 border rounded-lg font-bold cursor-pointer">
              {t('إلغاء', 'Cancel')}
            </button>
            <button type="submit" disabled={isSubmittingCashbox} className="px-4 py-1.5 bg-blue-900 text-white rounded-lg font-bold cursor-pointer disabled:opacity-50">
              {isSubmittingCashbox ? t('جاري الحفظ...', 'Saving...') : t('حفظ الحساب', 'Save Account')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Expense/Income Voucher Modal */}
      <Modal
        isOpen={isExpenseModalOpen}
        onClose={() => setIsExpenseModalOpen(false)}
        title={recordType === 'expense' ? t('تسجيل سند صرف مصروفات', 'Record Expense Voucher') : t('تسجيل سند قبض إيرادات', 'Record Income Voucher')}
        maxWidth="md"
      >
        <form onSubmit={handleAddExpenseIncome} className="space-y-3 text-xs">
          {expenseError && (
            <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{expenseError}</span>
            </div>
          )}
          <div>
            <label className="block font-bold mb-1">
              {recordType === 'expense' ? t('بند المصروف:', 'Expense Category:') : t('بند الإيراد:', 'Income Category:')}
            </label>
            <input
              type="text"
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1 font-bold"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">{t(`المبلغ (${t(settings.currency)}):`, `Amount (${t(settings.currency)}):`)}</label>
            <input
              type="number"
              min="1"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1 font-mono font-black text-center text-sm"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">{t('الخزينة المتأثرة:', 'Affected Cashbox:')}</label>
            <select
              value={selectedCashboxId}
              onChange={(e) => setSelectedCashboxId(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1 font-bold"
            >
              {cashboxes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({t('رصيدها:', 'Balance:')} {c.balanceHidden ? t('محجوب', 'Hidden') : formatLocaleNumber(c.currentBalance ?? 0)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold mb-1">
              {recordType === 'expense' ? t('الجهة المستلمة للمصروف:', 'Expense Recipient:') : t('الجهة المسددة للإيراد:', 'Income Payer:')}
            </label>
            <input
              type="text"
              required
              value={recipientOrPayer}
              onChange={(e) => setRecipientOrPayer(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5 py-1"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">{t('ملاحظات السند:', 'Voucher Notes:')}</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-2.5 py-1.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsExpenseModalOpen(false)} className="px-3.5 py-1.5 border rounded-lg font-bold cursor-pointer">
              {t('إلغاء', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmittingExpense}
              className={`px-4 py-1.5 text-white rounded-lg font-bold shadow-xs cursor-pointer disabled:opacity-50 ${
                recordType === 'expense' ? 'bg-amber-700 hover:bg-amber-800' : 'bg-[#003589] hover:bg-[#0049B0]'
              }`}
            >
              {isSubmittingExpense ? t('جاري الاعتماد...', 'Approving...') : t('اعتماد السند وطباعته', 'Approve & Print Voucher')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Read-only Finance Record Detail Modal */}
      <Modal
        isOpen={!!previewFinanceItem}
        onClose={() => setPreviewFinanceItem(null)}
        title={
          previewFinanceItem?.kind === 'cashbox'
            ? t(`تفاصيل الخزينة / الحساب: ${previewFinanceItem.item.name}`, `Cashbox / Account Details: ${previewFinanceItem.item.name}`)
            : previewFinanceItem?.kind === 'transaction'
            ? t(`تفاصيل الحركة المالية: ${previewFinanceItem.item.transactionNumber}`, `Transaction Details: ${previewFinanceItem.item.transactionNumber}`)
            : previewFinanceItem?.kind === 'expense'
            ? t(`تفاصيل السند المالي: ${previewFinanceItem.item.recordNumber}`, `Voucher Details: ${previewFinanceItem.item.recordNumber}`)
            : t('تفاصيل السجل المالي', 'Financial Record Details')
        }
        maxWidth="md"
      >
        {previewFinanceItem && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
              {previewFinanceItem.kind === 'cashbox' && (
                <>
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('الاسم', 'Name')}</span>
                    <strong>{previewFinanceItem.item.name}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('النوع', 'Type')}</span>
                    <strong>{previewFinanceItem.item.type === 'bank' ? t('حساب بنكي', 'Bank Account') : t('خزينة نقدية', 'Cashbox')}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('رقم الحساب', 'Account Number')}</span>
                    <strong className="font-mono">{previewFinanceItem.item.accountNumber || '—'}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('الرصيد المتاح', 'Available Balance')}</span>
                    <strong className="font-mono tabular-nums text-[#003589] dark:text-[#85B8FF]">
                      {previewFinanceItem.item.balanceHidden
                        ? t('محجوب', 'Hidden')
                        : `${formatLocaleNumber(Number(previewFinanceItem.item.currentBalance ?? 0))} ${t(settings.currency)}`}
                    </strong>
                  </div>
                </>
              )}
              {previewFinanceItem.kind === 'transaction' && (
                <>
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('رقم الحركة', 'Transaction No.')}</span>
                    <strong className="font-mono">{previewFinanceItem.item.transactionNumber}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('التاريخ', 'Date')}</span>
                    <strong className="font-mono tabular-nums">{previewFinanceItem.item.date}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('الخزينة', 'Cashbox')}</span>
                    <strong>{previewFinanceItem.item.cashboxName}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('نوع الحركة', 'Transaction Type')}</span>
                    <strong>{t(previewFinanceItem.item.category)}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('المبلغ', 'Amount')}</span>
                    <strong className="font-mono tabular-nums text-[#003589] dark:text-[#85B8FF]">
                      {formatLocaleNumber(Number(previewFinanceItem.item.amount || 0))} {t(settings.currency)}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('المسؤول', 'Created By')}</span>
                    <strong>{previewFinanceItem.item.createdBy}</strong>
                  </div>
                </>
              )}
              {previewFinanceItem.kind === 'expense' && (
                <>
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('رقم السند', 'Voucher No.')}</span>
                    <strong className="font-mono">{previewFinanceItem.item.recordNumber}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('التاريخ', 'Date')}</span>
                    <strong className="font-mono tabular-nums">{previewFinanceItem.item.date}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('النوع', 'Type')}</span>
                    <strong>{previewFinanceItem.item.type === 'expense' ? t('سند صرف (مصروف)', 'Expense Voucher') : t('سند قبض (إيراد)', 'Income Voucher')}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('البند / التصنيف', 'Category')}</span>
                    <strong>{t(previewFinanceItem.item.category)}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('الخزينة', 'Cashbox')}</span>
                    <strong>{previewFinanceItem.item.cashboxName}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('المبلغ', 'Amount')}</span>
                    <strong className="font-mono tabular-nums text-[#003589] dark:text-[#85B8FF]">
                      {formatLocaleNumber(Number(previewFinanceItem.item.amount || 0))} {t(settings.currency)}
                    </strong>
                  </div>
                </>
              )}
            </div>
            {(previewFinanceItem.item.description || previewFinanceItem.item.recipientOrPayer || previewFinanceItem.item.notes) && (
              <div className="p-2 rounded-md bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] space-y-1">
                {previewFinanceItem.item.recipientOrPayer && (
                  <div>
                    <span className="font-bold text-slate-600 dark:text-[#97AECE]">{t('الجهة:', 'Party:')} </span>
                    <span>{previewFinanceItem.item.recipientOrPayer}</span>
                  </div>
                )}
                {previewFinanceItem.item.description && (
                  <div>
                    <span className="font-bold text-slate-600 dark:text-[#97AECE]">{t('البيان:', 'Description:')} </span>
                    <span>{t(previewFinanceItem.item.description)}</span>
                  </div>
                )}
                {previewFinanceItem.item.notes && (
                  <div>
                    <span className="font-bold text-slate-600 dark:text-[#97AECE]">{t('ملاحظات:', 'Notes:')} </span>
                    <span>{t(previewFinanceItem.item.notes)}</span>
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-[#21375C]">
              <button
                type="button"
                onClick={() => setPreviewFinanceItem(null)}
                className="h-8 px-3 rounded-md border border-slate-300 dark:border-[#2A436E] font-bold cursor-pointer"
              >
                {t('إغلاق', 'Close')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Print Document Modal */}
      <PrintDocumentModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        data={printData}
      />
    </div>
  );
};
