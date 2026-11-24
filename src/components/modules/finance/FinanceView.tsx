import React, { useState, useMemo, useEffect } from 'react';
import {
  Wallet, Plus, ArrowLeftRight, TrendingDown, TrendingUp,
  Printer, Download, CheckCircle2, AlertCircle, Landmark,
  FileText, Phone, ArrowDownLeft, ArrowUpRight, Eye, ShieldAlert, DollarSign
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { useShortcuts } from '../../../context/ShortcutsContext';
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
        return (a.shopName || a.name).localeCompare(b.shopName || b.name, 'ar');
      });
  }, [customers, custSearch, custDirFilter, custSort]);

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
        return a.name.localeCompare(b.name, 'ar');
      });
  }, [suppliers, suppSearch, suppDirFilter, suppSort]);

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
      setCustPayError('يرجى إدخال مبلغ تحصيل أكبر من صفر.');
      return;
    }
    if (!custPayCashboxId) {
      setCustPayError('يرجى اختيار الخزينة أو الحساب البنكي.');
      return;
    }
    setIsSubmittingCustPay(true);
    try {
      const res = await recordCustomerPayment(
        custPaymentTarget.id,
        custPayAmount,
        custPayCashboxId,
        custPayNotes || `تحصيل دفعة حساب من ${custPaymentTarget.name}`,
        custPayMethod
      );
      if (!res.success) {
        setCustPayError(res.error || 'تعذر تسجيل التحصيل');
        return;
      }
      const nextBal = Number((Number(custPaymentTarget.currentBalance || 0) - custPayAmount).toFixed(2));
      setStatusBanner({
        type: 'success',
        text:
          nextBal < 0
            ? `تم تحصيل ${custPayAmount.toLocaleString()} ${settings.currency} من (${custPaymentTarget.name}) — تم قيد الزيادة كرصيد دائن / دفعة مقدمة للعميل (${Math.abs(nextBal).toLocaleString()} ${settings.currency}).`
            : `تم تحصيل ${custPayAmount.toLocaleString()} ${settings.currency} من العميل (${custPaymentTarget.name}) بنجاح.`,
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
      setSuppPayError('يرجى إدخال مبلغ سداد أكبر من صفر.');
      return;
    }
    if (!suppPayCashboxId) {
      setSuppPayError('يرجى اختيار الخزينة المسدد منها.');
      return;
    }
    const debt = Math.max(0, Number(suppPaymentTarget.currentBalance || 0));
    const overpayment = Math.max(0, Number((suppPayAmount - debt).toFixed(2)));
    if (overpayment > 0.009 && !canApproveSupplierOverpayment) {
      setSuppPayError('يتجاوز المبلغ المستحق للمورد — يتطلب سداد الدفعة المقدمة موافقة المدير العام أو مدير الفرع أو صلاحية الاعتماد.');
      return;
    }
    setIsSubmittingSuppPay(true);
    try {
      const res = await recordSupplierPayment(
        suppPaymentTarget.id,
        suppPayAmount,
        suppPayCashboxId,
        suppPayNotes || `سداد دفعة للمورد ${suppPaymentTarget.name}`
      );
      if (!res.success) {
        setSuppPayError(res.error || 'تعذر تسجيل السداد للمورد');
        return;
      }
      setStatusBanner({
        type: 'success',
        text: res.isAdvancePayment
          ? `تم سداد ${suppPayAmount.toLocaleString()} ${settings.currency} للمورد (${suppPaymentTarget.name}) وقيد الزيادة كدفعة مقدمة لنا عند المورد.`
          : `تم سداد مبلغ ${suppPayAmount.toLocaleString()} ${settings.currency} للمورد (${suppPaymentTarget.name}) بنجاح.`,
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
          text: `تمت تسوية دفعة مقدمة بمبلغ ${settleAmount.toLocaleString()} ${settings.currency} للمورد (${settleSupplierTarget.name}) دون حركة خزينة.`,
        });
        setIsConfirmingSettle(false);
        setSettleSupplierTarget(null);
      } else {
        setIsConfirmingSettle(false);
        setSettleError(res.error || 'تعذر تسوية الدفعة المقدمة');
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
      title: linkedInv ? `تفاصيل فاتورة مبيعات ${linkedInv.invoiceNumber}` : `${entry.label} (${entry.docNumber})`,
      docNumber: entry.docNumber,
      date: entry.date,
      badge: entry.label,
      description: entry.description,
      invoice: linkedInv,
      extraLines: linkedRet
        ? [
            { label: 'الفاتورة الأصلية', value: linkedRet.originalInvoiceNumber },
            { label: 'طريقة التسوية', value: linkedRet.refundType === 'cash' ? 'رد نقدي' : 'خصم من الرصيد' },
            { label: 'إجمالي المرتجع', value: `${Number(linkedRet.grandTotal || 0).toLocaleString()} ${settings.currency}` },
          ]
        : [
            { label: 'مدين (مستحق لنا)', value: `${Number(entry.debit || 0).toLocaleString()} ${settings.currency}` },
            { label: 'دائن (تحصيل/سداد)', value: `${Number(entry.credit || 0).toLocaleString()} ${settings.currency}` },
            { label: 'الرصيد بعد الحركة', value: `${Math.abs(Number(entry.runningBalance || 0)).toLocaleString()} ${settings.currency}` },
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
      title: linkedInv ? `تفاصيل فاتورة مشتريات ${linkedInv.invoiceNumber}` : `${entry.label} (${entry.docNumber})`,
      docNumber: entry.docNumber,
      date: entry.date,
      badge: entry.label,
      description: entry.description,
      invoice: linkedInv,
      extraLines: linkedRet
        ? [
            { label: 'الفاتورة الأصلية', value: linkedRet.originalInvoiceNumber },
            { label: 'طريقة التسوية', value: linkedRet.refundType === 'cash' ? 'استرداد نقدي' : 'خصم من رصيد المورد' },
            { label: 'إجمالي المرتجع', value: `${Number(linkedRet.grandTotal || 0).toLocaleString()} ${settings.currency}` },
          ]
        : [
            { label: 'له / مشتريات', value: `${Number(entry.credit || 0).toLocaleString()} ${settings.currency}` },
            { label: 'سداد / مرتجع', value: `${Number(entry.debit || 0).toLocaleString()} ${settings.currency}` },
            { label: 'الرصيد بعد الحركة', value: `${Math.abs(Number(entry.runningBalance || 0)).toLocaleString()} ${settings.currency}` },
          ],
    });
  };

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingTransfer) return;
    setTransferError(null);
    const numTransferAmount = Number(transferAmount || 0);
    if (!fromCbId || !toCbId) {
      setTransferError('يرجى تحديد الخزينة المحول منها والمحول إليها.');
      return;
    }
    if (fromCbId === toCbId) {
      setTransferError('لا يمكن التحويل من نفس الخزينة إلى نفسها.');
      return;
    }
    if (numTransferAmount <= 0) {
      setTransferError('يرجى إدخال مبلغ تحويل أكبر من صفر.');
      return;
    }
    setIsSubmittingTransfer(true);
    try {
      const res = await transferBetweenCashboxes(fromCbId, toCbId, numTransferAmount, transferNotes || 'تحويل مالي بين الخزائن');
      if (!res.success) {
        setTransferError(res.error || 'فشل التحويل');
      } else {
        setIsTransferModalOpen(false);
        setTransferAmount('');
        setTransferNotes('');
        setStatusBanner({ type: 'success', text: `تم تنفيذ التحويل المالي بمبلغ ${numTransferAmount.toLocaleString()} ${settings.currency} بنجاح.` });
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
      setCashboxError('يرجى إدخال اسم الخزينة أو الحساب البنكي.');
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
      setStatusBanner({ type: 'success', text: `تمت إضافة (${newCbName.trim()}) بنجاح.` });
      setNewCbName('');
      setNewCbAccount('');
      setNewCbOpening('');
    } catch (err: any) {
      setCashboxError(err?.message || 'تعذر إنشاء الخزينة أو الحساب البنكي');
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
      setExpenseError(`يرجى إدخال بند ${recordType === 'expense' ? 'المصروف' : 'الإيراد'}.`);
      return;
    }
    if (numAmount <= 0) {
      setExpenseError('يرجى إدخال مبلغ أكبر من صفر.');
      return;
    }
    if (!selectedCashboxId) {
      setExpenseError('يرجى اختيار الخزينة المتأثرة.');
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
        recipientOrPayer: recipientOrPayer.trim() || (recordType === 'expense' ? 'جهة صرف' : 'جهة تحصيل'),
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
            ? `تم تسجيل سند صرف (${category.trim()}) بمبلغ ${numAmount.toLocaleString()} ${settings.currency}.`
            : `تم تسجيل سند قبض إيراد (${category.trim()}) بمبلغ ${numAmount.toLocaleString()} ${settings.currency}.`,
      });

      setPrintData({
        title: recordType === 'expense' ? 'سند صرف مصروفات' : 'سند قبض إيرادات',
        docNumber: `${recordType === 'expense' ? 'EXP' : 'INC'}-${Date.now().toString().slice(-6)}`,
        docType: recordType === 'expense' ? 'سند صرف' : 'سند قبض',
        date: new Date().toISOString().split('T')[0],
        partyName: recipientOrPayer,
        grandTotal: numAmount,
        paidAmount: numAmount,
        notes: `${category.trim()} - ${notes}`,
      });
      setIsPrintModalOpen(true);
    } catch (err: any) {
      setExpenseError(err?.message || 'تعذر تسجيل السند المالي');
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
          لنا (مستحق): {bal.toLocaleString()} {settings.currency}
        </span>
      );
    }
    if (bal < -0.005) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-black tabular-nums">
          علينا (دفعة مقدمة): {Math.abs(bal).toLocaleString()} {settings.currency}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-bold">
        متوازن (0)
      </span>
    );
  };

  const formatSupplierBalBadge = (bal: number) => {
    if (bal > 0.005) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-50 text-purple-900 border border-purple-200 text-[10px] font-black tabular-nums">
          علينا للمورد: {bal.toLocaleString()} {settings.currency}
        </span>
      );
    }
    if (bal < -0.005) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-black tabular-nums">
          لنا (دفعة مقدمة): {Math.abs(bal).toLocaleString()} {settings.currency}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-bold">
        متوازن (0)
      </span>
    );
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 bg-white px-3.5 py-2.5 rounded-lg border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
            <AccountsLedgerIcon className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-900 tracking-tight">مركز الحسابات والعملاء والموردين والخزائن</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              كشوف الحسابات التفصيلية للعملاء والموردين، السيولة النقدية ({totalLiquidity.toLocaleString()} {settings.currency})، وسندات الصرف والقبض
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
            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
          >
            <TrendingDown className="w-3.5 h-3.5" />
            <span>سند صرف مصروف</span>
          </button>

          <button
            onClick={() => {
              setExpenseError(null);
              setRecordType('income');
              setIsExpenseModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>سند قبض إيراد</span>
          </button>

          <button
            onClick={() => {
              setTransferError(null);
              setIsTransferModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-900 hover:bg-blue-950 text-white rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>تحويل بين الخزائن</span>
          </button>
        </div>
      </div>

      {statusBanner && (
        <div
          className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center justify-between gap-2 ${
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
            إغلاق
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap border-b border-slate-200 text-xs font-bold gap-2 sm:gap-4 bg-white px-3 pt-1.5 rounded-t-lg">
        {[
          { key: 'customer-accounts' as const, label: `حسابات العملاء (${customers.length})`, Icon: CustomersGroupIcon },
          { key: 'supplier-accounts' as const, label: `حسابات الموردين (${suppliers.length})`, Icon: SuppliersTruckIcon },
          { key: 'cashboxes' as const, label: `الخزائن والبنوك (${cashboxes.length})`, Icon: SafeVaultIcon },
          { key: 'transactions' as const, label: `الحركات المالية (${financialTransactions.length})`, Icon: AccountsLedgerIcon },
          { key: 'expenses' as const, label: `المصروفات والإيرادات (${expenseIncomes.length})`, Icon: ExpensesCashIcon },
        ].map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 pb-2 pt-1 px-1.5 transition-colors border-b-2 cursor-pointer ${
                isActive ? 'border-blue-900 text-blue-950 font-black' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <tab.Icon className="w-4 h-4 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB: CUSTOMER ACCOUNTS (حسابات جميع العملاء بالتفصيل) */}
      {activeTab === 'customer-accounts' && (
        <div className="space-y-3">
          {/* Separated KPI Strip: NEVER net لنا & علينا */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden text-xs">
            <div className="bg-white px-3 py-2">
              <span className="text-[10px] font-bold text-slate-600 block">إجمالي مستحقاتنا عند العملاء (لنا)</span>
              <div className="text-base font-black font-mono tabular-nums text-red-700">
                {customerKpis.receivableTotal.toLocaleString()} <span className="text-[10px] font-sans text-slate-500">{settings.currency}</span>
              </div>
              <span className="text-[10px] font-bold text-red-600">عدد {customerKpis.debtorsCount} عميل مدين</span>
            </div>

            <div className="bg-white px-3 py-2">
              <span className="text-[10px] font-bold text-slate-600 block">إجمالي الدفعات المقدمة للعملاء (علينا)</span>
              <div className="text-base font-black font-mono tabular-nums text-emerald-700">
                {customerKpis.advanceTotal.toLocaleString()} <span className="text-[10px] font-sans text-slate-500">{settings.currency}</span>
              </div>
              <span className="text-[10px] font-bold text-emerald-700">عدد {customerKpis.creditorsCount} عميل برصيد دائن</span>
            </div>

            <div className="bg-white px-3 py-2">
              <span className="text-[10px] font-bold text-slate-600 block">إجمالي التحصيلات من العملاء</span>
              <div className="text-base font-black font-mono tabular-nums text-blue-950">
                {customerKpis.totalCollections.toLocaleString()} <span className="text-[10px] font-sans text-slate-500">{settings.currency}</span>
              </div>
              <span className="text-[10px] text-slate-500">نقدي الفواتير + سندات القبض</span>
            </div>

            <div className="bg-white px-3 py-2">
              <span className="text-[10px] font-bold text-slate-600 block">إجمالي عدد العملاء</span>
              <div className="text-base font-black font-mono tabular-nums text-slate-900">
                {customerKpis.totalCount}
              </div>
              <span className="text-[10px] text-slate-500">ملفات العملاء النشطة والمسجلة</span>
            </div>
          </div>

          <UnifiedDataTable<Customer>
            title="حسابات العملاء التفصيلية"
            subtitle="كشوف الحسابات والتحصيل النقدي والبنكي"
            data={filteredCustomersList}
            rowKey={(c) => c.id}
            compact
            searchValue={custSearch}
            onSearchChange={setCustSearch}
            searchPlaceholder="بحث باسم العميل أو المحل أو الكود أو الموبايل..."
            exportFilename={`حسابات_العملاء_${new Date().toISOString().split('T')[0]}`}
            pdfTitle="حسابات العملاء التفصيلية"
            emptyTitle="لا يوجد عملاء مطابقون لمعايير البحث أو التصفية"
            toolbarFilters={
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <select
                  value={custDirFilter}
                  onChange={(e) => setCustDirFilter(e.target.value as any)}
                  className="h-8 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-700"
                >
                  <option value="all">جميع الأرصدة ({customers.length})</option>
                  <option value="debt">مدينون لنا فقط ({customerKpis.debtorsCount})</option>
                  <option value="credit">دفعات مقدمة / علينا ({customerKpis.creditorsCount})</option>
                  <option value="settled">حسابات متوازنة (0)</option>
                </select>
                <select
                  value={custSort}
                  onChange={(e) => setCustSort(e.target.value as any)}
                  className="h-8 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-700"
                >
                  <option value="balance_desc">الأعلى مديونية</option>
                  <option value="balance_asc">الأعلى رصيداً مقدماً</option>
                  <option value="name">ترتيب أبجدي</option>
                </select>
              </div>
            }
            columns={[
              {
                key: 'code',
                header: 'الكود',
                sortable: true,
                sortValue: (c) => c.code,
                exportValue: (c) => c.code,
                render: (c) => <span className="font-mono font-bold text-blue-900">{c.code}</span>,
              },
              {
                key: 'name',
                header: 'اسم العميل / المحل',
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
                header: 'رقم الهاتف',
                exportValue: (c) => c.phone || '-',
                render: (c) => (
                  <div className="font-mono">
                    {c.phone ? (
                      <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 text-emerald-700 hover:underline font-bold">
                        <Phone className="w-3 h-3" />
                        <span>{c.phone}</span>
                      </a>
                    ) : '-'}
                  </div>
                ),
              },
              {
                key: 'currentBalance',
                header: 'موقف الحساب (لنا / علينا)',
                align: 'center',
                sortable: true,
                sortValue: (c) => Number(c.currentBalance || 0),
                exportValue: (c) => Number(c.currentBalance || 0),
                render: (c) => <span className="font-mono tabular-nums">{formatCustomerBalBadge(Number(c.currentBalance || 0))}</span>,
              },
              {
                key: 'actions',
                header: 'الإجراءات',
                align: 'center',
                render: (c) => (
                  <div className="flex items-center justify-center gap-1 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleOpenCustomerStatement(c)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-bold cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5 text-blue-800" />
                      <span>كشف حساب</span>
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
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold cursor-pointer"
                    >
                      <ArrowDownLeft className="w-3.5 h-3.5" />
                      <span>تحصيل دفعة</span>
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* TAB: SUPPLIER ACCOUNTS (حسابات جميع الموردين بالتفصيل) */}
      {activeTab === 'supplier-accounts' && (
        <div className="space-y-3">
          {/* Separated KPI Strip: NEVER net علينا & لنا */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden text-xs">
            <div className="bg-white px-3 py-2">
              <span className="text-[10px] font-bold text-slate-600 block">إجمالي مستحقات الموردين (علينا)</span>
              <div className="text-base font-black font-mono tabular-nums text-purple-900">
                {supplierKpis.payableTotal.toLocaleString()} <span className="text-[10px] font-sans text-slate-500">{settings.currency}</span>
              </div>
              <span className="text-[10px] font-bold text-purple-700">عدد {supplierKpis.payablesCount} مورد مستحق لهم</span>
            </div>

            <div className="bg-white px-3 py-2">
              <span className="text-[10px] font-bold text-slate-600 block">إجمالي الدفعات المقدمة عند الموردين (لنا)</span>
              <div className="text-base font-black font-mono tabular-nums text-emerald-700">
                {supplierKpis.advanceTotal.toLocaleString()} <span className="text-[10px] font-sans text-slate-500">{settings.currency}</span>
              </div>
              <span className="text-[10px] font-bold text-emerald-700">عدد {supplierKpis.advancesCount} مورد لديهم رصيد لنا</span>
            </div>

            <div className="bg-white px-3 py-2">
              <span className="text-[10px] font-bold text-slate-600 block">إجمالي المدفوعات للموردين</span>
              <div className="text-base font-black font-mono tabular-nums text-blue-950">
                {supplierKpis.totalPayments.toLocaleString()} <span className="text-[10px] font-sans text-slate-500">{settings.currency}</span>
              </div>
              <span className="text-[10px] text-slate-500">سداد فواتير الشراء + سندات الصرف</span>
            </div>

            <div className="bg-white px-3 py-2">
              <span className="text-[10px] font-bold text-slate-600 block">إجمالي عدد الموردين</span>
              <div className="text-base font-black font-mono tabular-nums text-slate-900">
                {supplierKpis.totalCount}
              </div>
              <span className="text-[10px] text-slate-500">شركات ومصانع التوريد المسجلة</span>
            </div>
          </div>

          <UnifiedDataTable<Supplier>
            title="حسابات الموردين التفصيلية"
            subtitle="كشوف الحسابات وسداد المستحقات وتسوية الدفعات المقدمة"
            data={filteredSuppliersList}
            rowKey={(s) => s.id}
            compact
            searchValue={suppSearch}
            onSearchChange={setSuppSearch}
            searchPlaceholder="بحث باسم المورد أو الكود أو رقم الهاتف..."
            exportFilename={`حسابات_الموردين_${new Date().toISOString().split('T')[0]}`}
            pdfTitle="حسابات الموردين التفصيلية"
            emptyTitle="لا يوجد موردون مطابقون لمعايير البحث أو التصفية"
            toolbarFilters={
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <select
                  value={suppDirFilter}
                  onChange={(e) => setSuppDirFilter(e.target.value as any)}
                  className="h-8 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-700"
                >
                  <option value="all">جميع الموردين ({suppliers.length})</option>
                  <option value="payable">مستحق للمورد (علينا) ({supplierKpis.payablesCount})</option>
                  <option value="advance">دفعة مقدمة لنا ({supplierKpis.advancesCount})</option>
                  <option value="settled">حسابات متوازنة (0)</option>
                </select>
                <select
                  value={suppSort}
                  onChange={(e) => setSuppSort(e.target.value as any)}
                  className="h-8 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-700"
                >
                  <option value="balance_desc">الأعلى مستحقات علينا</option>
                  <option value="balance_asc">الأعلى دفعات مقدمة لنا</option>
                  <option value="name">ترتيب أبجدي</option>
                </select>
              </div>
            }
            columns={[
              {
                key: 'code',
                header: 'الكود',
                sortable: true,
                sortValue: (s) => s.code,
                exportValue: (s) => s.code,
                render: (s) => <span className="font-mono font-bold text-indigo-900">{s.code}</span>,
              },
              {
                key: 'name',
                header: 'اسم المورد / الشركة',
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
                header: 'رقم الهاتف',
                exportValue: (s) => s.phone || '-',
                render: (s) => (
                  <div className="font-mono">
                    {s.phone ? (
                      <a href={`tel:${s.phone}`} className="inline-flex items-center gap-1 text-emerald-700 hover:underline font-bold">
                        <Phone className="w-3 h-3" />
                        <span>{s.phone}</span>
                      </a>
                    ) : '-'}
                  </div>
                ),
              },
              {
                key: 'currentBalance',
                header: 'موقف الحساب (علينا / لنا)',
                align: 'center',
                sortable: true,
                sortValue: (s) => Number(s.currentBalance || 0),
                exportValue: (s) => Number(s.currentBalance || 0),
                render: (s) => <span className="font-mono tabular-nums">{formatSupplierBalBadge(Number(s.currentBalance || 0))}</span>,
              },
              {
                key: 'actions',
                header: 'الإجراءات',
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
                        <FileText className="w-3.5 h-3.5 text-blue-800" />
                        <span>كشف حساب</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSuppPayError(null);
                          setSuppPayNotes('');
                          setSuppPaymentTarget(s);
                          setSuppPayAmount(s.currentBalance > 0 ? s.currentBalance : 0);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold cursor-pointer"
                      >
                        <ArrowUpRight className="w-3.5 h-3.5" />
                        <span>سداد دفعة</span>
                      </button>
                      {availableAdvance > 0 && openInvoices.length > 0 && (currentUser?.role === 'admin' || hasPermission('canManageAccounts')) && (
                        <button
                          type="button"
                          onClick={() => {
                            const firstInv = openInvoices[0];
                            setSettleError(null);
                            setSettleNotes('تسوية دفعة مقدمة على فاتورة المشتريات');
                            setSettleSupplierTarget(s);
                            setSettleInvoiceId(firstInv?.id || '');
                            setSettleAmount(firstInv ? Math.min(availableAdvance, Number(firstInv.remainingAmount || 0)) : 0);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg font-bold cursor-pointer"
                        >
                          <DollarSign className="w-3.5 h-3.5" />
                          <span>تسوية مقدم</span>
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
          title="الخزائن والحسابات البنكية"
          subtitle="أرصدة النقدية بالخزائن والحسابات البنكية المسجلة"
          data={cashboxes}
          rowKey={(cb) => cb.id}
          compact
          searchPlaceholder="بحث باسم الخزينة أو رقم الحساب..."
          searchFilter={(cb, q) => `${cb.name} ${cb.accountNumber || ''}`.toLowerCase().includes(q)}
          exportFilename="AWLAD_SELIM_Cashboxes"
          pdfTitle="الخزائن والحسابات البنكية"
          headerActions={
            <button
              type="button"
              onClick={() => setIsAddCashboxOpen(true)}
              className="px-3 py-1 rounded-lg bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة خزينة / حساب بنكي</span>
            </button>
          }
          columns={[
            {
              key: 'name',
              header: 'الخزينة / الحساب',
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
              header: 'النوع',
              exportValue: (cb) => (cb.type === 'bank' ? 'حساب بنكي' : 'خزينة نقدية'),
              render: (cb) => (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                  {cb.type === 'bank' ? 'حساب بنكي' : 'خزينة نقدية'}
                </span>
              ),
            },
            {
              key: 'accountNumber',
              header: 'رقم الحساب',
              exportValue: (cb) => cb.accountNumber || '-',
              render: (cb) => <span className="font-mono text-slate-600">{cb.accountNumber || '-'}</span>,
            },
            {
              key: 'currentBalance',
              header: 'الرصيد المتاح',
              align: 'center',
              sortable: true,
              sortValue: (cb) => (cb.balanceHidden ? 0 : Number(cb.currentBalance ?? 0)),
              exportValue: (cb) => (cb.balanceHidden ? 'محجوب' : Number(cb.currentBalance ?? 0)),
              render: (cb) => (
                <span className="font-mono text-sm font-black text-blue-950 tabular-nums">
                  {cb.balanceHidden ? 'محجوب' : `${(cb.currentBalance ?? 0).toLocaleString()} ${settings.currency}`}
                </span>
              ),
            },
          ]}
        />
      )}

      {/* Tab 2: Financial Transactions */}
      {activeTab === 'transactions' && (
        <UnifiedDataTable
          title="حركة الخزائن والبنوك"
          data={filteredTransactions}
          rowKey={(tx) => tx.id}
          compact
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder="بحث برقم الحركة، الخزينة، أو البيان..."
          exportFilename="AWLAD_SELIM_FinancialTransactions"
          pdfTitle="سجل حركات الخزائن والبنوك"
          columns={[
            {
              key: 'transactionNumber',
              header: 'رقم الحركة',
              sortable: true,
              sortValue: (tx) => tx.transactionNumber,
              exportValue: (tx) => tx.transactionNumber,
              render: (tx) => <span className="font-mono font-bold text-blue-900">{tx.transactionNumber}</span>,
            },
            {
              key: 'date',
              header: 'التاريخ',
              sortable: true,
              sortValue: (tx) => tx.date,
              exportValue: (tx) => tx.date,
              render: (tx) => <span className="font-mono text-slate-600">{tx.date}</span>,
            },
            {
              key: 'cashboxName',
              header: 'الخزينة',
              exportValue: (tx) => tx.cashboxName,
              render: (tx) => <span className="font-semibold">{tx.cashboxName}</span>,
            },
            {
              key: 'category',
              header: 'نوع الحركة',
              exportValue: (tx) => tx.category,
              render: (tx) => <span className="font-bold text-slate-800">{tx.category}</span>,
            },
            {
              key: 'description',
              header: 'البيان',
              exportValue: (tx) => tx.description,
              render: (tx) => <span className="text-slate-600">{tx.description}</span>,
            },
            {
              key: 'amount',
              header: 'المبلغ',
              align: 'center',
              sortable: true,
              sortValue: (tx) => tx.amount,
              exportValue: (tx) => tx.amount,
              render: (tx) => (
                <span className="font-mono font-black text-sm text-blue-950 tabular-nums">
                  {tx.amount.toLocaleString()} {settings.currency}
                </span>
              ),
            },
            {
              key: 'createdBy',
              header: 'المستخدم المسؤول',
              exportValue: (tx) => tx.createdBy,
              render: (tx) => <span className="text-slate-500">{tx.createdBy}</span>,
            },
          ]}
        />
      )}

      {/* Tab 3: Expenses & Income */}
      {activeTab === 'expenses' && (
        <UnifiedDataTable
          title="سندات المصروفات والإيرادات"
          data={filteredExpenses}
          rowKey={(rec) => rec.id}
          compact
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder="بحث برقم السند، البند، الخزينة، أو الجهة..."
          exportFilename={`المصروفات_والإيرادات_${new Date().toISOString().split('T')[0]}`}
          pdfTitle="سندات المصروفات والإيرادات"
          emptyTitle="لا توجد مصروفات أو إيرادات مسجلة مطابقة للبحث"
          toolbarFilters={
            <select
              value={expenseTypeFilter}
              onChange={(e) => setExpenseTypeFilter(e.target.value as any)}
              className="h-8 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 outline-hidden"
            >
              <option value="all">الكل (مصروفات وإيرادات)</option>
              <option value="expense">المصروفات فقط</option>
              <option value="income">الإيرادات فقط</option>
            </select>
          }
          columns={[
            {
              key: 'recordNumber',
              header: 'رقم السند',
              sortable: true,
              sortValue: (rec) => rec.recordNumber,
              exportValue: (rec) => rec.recordNumber,
              render: (rec) => <span className="font-mono font-bold text-blue-900">{rec.recordNumber}</span>,
            },
            {
              key: 'date',
              header: 'التاريخ',
              sortable: true,
              sortValue: (rec) => rec.date,
              exportValue: (rec) => rec.date,
              render: (rec) => <span className="font-mono text-slate-600">{rec.date}</span>,
            },
            {
              key: 'type',
              header: 'النوع',
              exportValue: (rec) => (rec.type === 'expense' ? 'مصروف' : 'إيراد'),
              render: (rec) =>
                rec.type === 'expense' ? (
                  <span className="px-2 py-0.5 rounded bg-orange-50 text-orange-800 border border-orange-200 font-bold text-[10px]">
                    سند صرف (مصروف)
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 font-bold text-[10px]">
                    سند قبض (إيراد)
                  </span>
                ),
            },
            {
              key: 'category',
              header: 'البند / التصنيف',
              sortable: true,
              sortValue: (rec) => rec.category,
              exportValue: (rec) => rec.category,
              render: (rec) => <span className="font-bold text-slate-800">{rec.category}</span>,
            },
            {
              key: 'cashboxName',
              header: 'الخزينة',
              exportValue: (rec) => rec.cashboxName,
              render: (rec) => <span className="font-semibold text-slate-700">{rec.cashboxName}</span>,
            },
            {
              key: 'recipientOrPayer',
              header: 'الجهة المستلمة / الدافعة',
              exportValue: (rec) => rec.recipientOrPayer,
              render: (rec) => <span className="text-slate-700">{rec.recipientOrPayer}</span>,
            },
            {
              key: 'amount',
              header: 'المبلغ',
              align: 'center',
              sortable: true,
              sortValue: (rec) => rec.amount,
              exportValue: (rec) => rec.amount,
              render: (rec) => (
                <span className={`font-mono font-black text-sm tabular-nums ${rec.type === 'expense' ? 'text-orange-700' : 'text-teal-700'}`}>
                  {rec.amount.toLocaleString()} {settings.currency}
                </span>
              ),
            },
            {
              key: 'notes',
              header: 'ملاحظات',
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
          title={`كشف حساب العميل التفصيلي: ${custStatementTarget.shopName || custStatementTarget.name}`}
          subtitle={`${custStatementTarget.code}${custStatementTarget.phone ? ` · ${custStatementTarget.phone}` : ''}`}
          maxWidth="6xl"
        >
          {isLoadingCustStatement || !custStatementData ? (
            <div className="p-6 text-center text-xs font-bold text-slate-500">جاري تحميل كشف حساب العميل...</div>
          ) : (
            <div className="space-y-3 text-xs">
              {/* Summary Strip (Separated Debt vs Advance Credit) */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-2.5 py-2 bg-slate-50">
                  <span className="text-[10px] font-bold text-slate-500 block">رصيد أول المدة</span>
                  <span className="font-mono font-black text-sm text-slate-900">
                    {Number(custStatementData.summary.openingBalance || 0).toLocaleString()} {settings.currency}
                  </span>
                </div>
                <div className="px-2.5 py-2 bg-blue-50">
                  <span className="text-[10px] font-bold text-blue-700 block">إجمالي المبيعات</span>
                  <span className="font-mono font-black text-sm text-blue-950">
                    {Number(custStatementData.summary.totalSales ?? custStatementData.summary.totalDebit ?? 0).toLocaleString()} {settings.currency}
                  </span>
                </div>
                <div className="px-2.5 py-2 bg-emerald-50">
                  <span className="text-[10px] font-bold text-emerald-700 block">إجمالي المدفوعات</span>
                  <span className="font-mono font-black text-sm text-emerald-900">
                    {Number(custStatementData.summary.totalPaid ?? custStatementData.summary.totalCredit ?? 0).toLocaleString()} {settings.currency}
                  </span>
                </div>
                <div className="px-2.5 py-2 bg-red-50">
                  <span className="text-[10px] font-bold text-red-700 block">مستحق لنا (لنا)</span>
                  <span className="font-mono font-black text-sm text-red-700">
                    {Number(custStatementData.summary.debtAmount ?? Math.max(0, Number(custStatementData.summary.currentBalance || 0))).toLocaleString()} {settings.currency}
                  </span>
                </div>
                <div className="px-2.5 py-2 bg-teal-50">
                  <span className="text-[10px] font-bold text-teal-800 block">رصيد دائن للعميل (علينا)</span>
                  <span className="font-mono font-black text-sm text-teal-800">
                    {Number(custStatementData.summary.creditAmount ?? Math.max(0, -Number(custStatementData.summary.currentBalance || 0))).toLocaleString()} {settings.currency}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-[11px] text-slate-600 font-bold">
                  آخر فاتورة: {custStatementData.summary.lastInvoiceNumber || '-'} ({custStatementData.summary.lastInvoiceDate || '-'})
                  {' | '}
                  آخر حركة: {custStatementData.summary.lastTransactionDate || '-'}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const headers = ['التاريخ', 'رقم المستند', 'النوع', 'البيان', 'مدين (لنا)', 'دائن (سداد)', 'الرصيد التراكمي', 'الاتجاه'];
                      const rows = custStatementData.entries.map((en) => [
                        en.date,
                        en.docNumber,
                        en.label,
                        en.description,
                        en.debit || 0,
                        en.credit || 0,
                        Math.abs(Number(en.runningBalance || 0)),
                        Number(en.runningBalance || 0) > 0.005 ? 'لنا' : Number(en.runningBalance || 0) < -0.005 ? 'علينا' : 'متوازن',
                      ]);
                      exportToExcel(`كشف_حساب_عميل_${custStatementTarget.name}_${new Date().toISOString().split('T')[0]}`, headers, rows);
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
                        title: 'كشف حساب عميل معتمد',
                        docNumber: custStatementTarget.code,
                        docType: 'كشف حساب',
                        date: new Date().toISOString().split('T')[0],
                        partyName: custStatementTarget.shopName || custStatementTarget.name,
                        partyPhone: custStatementTarget.phone,
                        partyAddress: custStatementTarget.address,
                        previousBalance: Number(custStatementData.summary.openingBalance || 0),
                        currentBalance: Number(custStatementData.summary.currentBalance || 0),
                        grandTotal: Math.abs(Number(custStatementData.summary.currentBalance || 0)),
                        tableHeaders: ['م', 'البيان', 'التاريخ', 'العدد', 'مدين (لنا)', 'دائن (سداد)', 'الرصيد التراكمي'],
                        items: custStatementData.entries.map((en) => ({
                          name: `${en.label} (${en.docNumber}) - ${en.description}`,
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
                    <span>طباعة</span>
                  </button>
                </div>
              </div>

              <UnifiedDataTable<CustomerStatementEntry>
                title="سجل حركات كشف حساب العميل"
                data={custStatementData.entries}
                rowKey={(entry) => entry.id}
                compact
                searchable={false}
                defaultPageSize={25}
                onRowClick={(entry) => inspectCustomerEntry(entry)}
                emptyTitle="لا توجد حركات مسجلة لهذا العميل حتى الآن"
                columns={[
                  {
                    key: 'date',
                    header: 'التاريخ',
                    render: (entry) => <span className="font-mono text-slate-600">{entry.date}</span>,
                  },
                  {
                    key: 'docNumber',
                    header: 'رقم المستند',
                    render: (entry) => <span className="font-mono font-bold text-blue-900">{entry.docNumber}</span>,
                  },
                  {
                    key: 'label',
                    header: 'نوع الحركة',
                    render: (entry) => <span className="font-bold">{entry.label}</span>,
                  },
                  {
                    key: 'description',
                    header: 'البيان',
                    render: (entry) => <span className="text-slate-700">{entry.description}</span>,
                  },
                  {
                    key: 'debit',
                    header: 'مدين (لنا)',
                    align: 'center',
                    render: (entry) => (
                      <span className="font-mono font-bold text-red-700 tabular-nums">
                        {Number(entry.debit || 0) > 0 ? Number(entry.debit).toLocaleString() : '-'}
                      </span>
                    ),
                  },
                  {
                    key: 'credit',
                    header: 'دائن (سداد)',
                    align: 'center',
                    render: (entry) => (
                      <span className="font-mono font-bold text-emerald-700 tabular-nums">
                        {Number(entry.credit || 0) > 0 ? Number(entry.credit).toLocaleString() : '-'}
                      </span>
                    ),
                  },
                  {
                    key: 'runningBalance',
                    header: 'الرصيد التراكمي',
                    align: 'center',
                    render: (entry) => (
                      <span className="font-mono font-black tabular-nums">
                        {Math.abs(Number(entry.runningBalance || 0)).toLocaleString()}
                      </span>
                    ),
                  },
                  {
                    key: 'direction',
                    header: 'الحالة',
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
                          {rb > 0.005 ? 'لنا' : rb < -0.005 ? 'علينا' : 'متوازن'}
                        </span>
                      );
                    },
                  },
                  {
                    key: 'view',
                    header: 'عرض',
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
          title={`كشف حساب المورد التفصيلي: ${suppStatementTarget.name}`}
          subtitle={`${suppStatementTarget.code}${suppStatementTarget.phone ? ` · ${suppStatementTarget.phone}` : ''}`}
          maxWidth="6xl"
        >
          {isLoadingSuppStatement || !suppStatementData ? (
            <div className="p-6 text-center text-xs font-bold text-slate-500">جاري تحميل كشف حساب المورد...</div>
          ) : (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-2.5 py-2 bg-slate-50">
                  <span className="text-[10px] font-bold text-slate-500 block">رصيد أول المدة</span>
                  <span className="font-mono font-black text-sm text-slate-900">
                    {Number(suppStatementData.summary.openingBalance || 0).toLocaleString()} {settings.currency}
                  </span>
                </div>
                <div className="px-2.5 py-2 bg-indigo-50">
                  <span className="text-[10px] font-bold text-indigo-700 block">إجمالي المشتريات</span>
                  <span className="font-mono font-black text-sm text-indigo-950">
                    {Number(suppStatementData.summary.totalPurchases || 0).toLocaleString()} {settings.currency}
                  </span>
                </div>
                <div className="px-2.5 py-2 bg-emerald-50">
                  <span className="text-[10px] font-bold text-emerald-700 block">إجمالي المدفوعات</span>
                  <span className="font-mono font-black text-sm text-emerald-900">
                    {Number(suppStatementData.summary.totalPaid || 0).toLocaleString()} {settings.currency}
                  </span>
                </div>
                <div className="px-2.5 py-2 bg-purple-50">
                  <span className="text-[10px] font-bold text-purple-800 block">مستحق للمورد (علينا)</span>
                  <span className="font-mono font-black text-sm text-purple-900">
                    {Number(suppStatementData.summary.payableAmount || 0).toLocaleString()} {settings.currency}
                  </span>
                </div>
                <div className="px-2.5 py-2 bg-teal-50">
                  <span className="text-[10px] font-bold text-teal-800 block">دفعة مقدمة عند المورد (لنا)</span>
                  <span className="font-mono font-black text-sm text-teal-800">
                    {Number(suppStatementData.summary.advanceCreditAmount || 0).toLocaleString()} {settings.currency}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-[11px] text-slate-600 font-bold">
                  آخر فاتورة شراء: {suppStatementData.summary.lastInvoiceNumber || '-'} ({suppStatementData.summary.lastInvoiceDate || '-'})
                  {' | '}
                  آخر حركة: {suppStatementData.summary.lastTransactionDate || '-'}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const headers = ['التاريخ', 'رقم المستند', 'النوع', 'البيان', 'له / مشتريات', 'سداد / مرتجع', 'الرصيد التراكمي', 'الحالة'];
                      const rows = suppStatementData.entries.map((en) => [
                        en.date,
                        en.docNumber,
                        en.label,
                        en.description,
                        en.credit || 0,
                        en.debit || 0,
                        Math.abs(Number(en.runningBalance || 0)),
                        Number(en.runningBalance || 0) > 0.005 ? 'علينا' : Number(en.runningBalance || 0) < -0.005 ? 'لنا (مقدم)' : 'متوازن',
                      ]);
                      exportToExcel(`كشف_حساب_مورد_${suppStatementTarget.name}_${new Date().toISOString().split('T')[0]}`, headers, rows);
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
                        title: 'كشف حساب مورد معتمد',
                        docNumber: suppStatementTarget.code,
                        docType: 'كشف حساب',
                        date: new Date().toISOString().split('T')[0],
                        partyName: suppStatementTarget.name,
                        partyPhone: suppStatementTarget.phone,
                        partyAddress: suppStatementTarget.address,
                        previousBalance: Number(suppStatementData.summary.openingBalance || 0),
                        currentBalance: Number(suppStatementData.summary.currentBalance || 0),
                        grandTotal: Math.abs(Number(suppStatementData.summary.currentBalance || 0)),
                        tableHeaders: ['م', 'البيان', 'التاريخ', 'العدد', 'له / مشتريات', 'سداد / مرتجع', 'الرصيد التراكمي'],
                        items: suppStatementData.entries.map((en) => ({
                          name: `${en.label} (${en.docNumber}) - ${en.description}`,
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
                    <span>طباعة</span>
                  </button>
                </div>
              </div>

              <UnifiedDataTable<SupplierStatementEntry>
                title="سجل حركات كشف حساب المورد"
                data={suppStatementData.entries}
                rowKey={(entry) => entry.id}
                compact
                searchable={false}
                defaultPageSize={25}
                onRowClick={(entry) => inspectSupplierEntry(entry)}
                emptyTitle="لا توجد حركات مسجلة لهذا المورد حتى الآن"
                columns={[
                  {
                    key: 'date',
                    header: 'التاريخ',
                    render: (entry) => <span className="font-mono text-slate-600">{entry.date}</span>,
                  },
                  {
                    key: 'docNumber',
                    header: 'رقم المستند',
                    render: (entry) => <span className="font-mono font-bold text-indigo-900">{entry.docNumber}</span>,
                  },
                  {
                    key: 'label',
                    header: 'نوع الحركة',
                    render: (entry) => <span className="font-bold">{entry.label}</span>,
                  },
                  {
                    key: 'description',
                    header: 'البيان',
                    render: (entry) => <span className="text-slate-700">{entry.description}</span>,
                  },
                  {
                    key: 'credit',
                    header: 'له / مشتريات',
                    align: 'center',
                    render: (entry) => (
                      <span className="font-mono font-bold text-slate-900 tabular-nums">
                        {Number(entry.credit || 0) > 0 ? Number(entry.credit).toLocaleString() : '-'}
                      </span>
                    ),
                  },
                  {
                    key: 'debit',
                    header: 'سداد / مرتجع',
                    align: 'center',
                    render: (entry) => (
                      <span className="font-mono font-bold text-emerald-700 tabular-nums">
                        {Number(entry.debit || 0) > 0 ? Number(entry.debit).toLocaleString() : '-'}
                      </span>
                    ),
                  },
                  {
                    key: 'runningBalance',
                    header: 'الرصيد التراكمي',
                    align: 'center',
                    render: (entry) => (
                      <span className="font-mono font-black tabular-nums">
                        {Math.abs(Number(entry.runningBalance || 0)).toLocaleString()}
                      </span>
                    ),
                  },
                  {
                    key: 'direction',
                    header: 'الحالة',
                    align: 'center',
                    render: (entry) => {
                      const rb = Number(entry.runningBalance || 0);
                      return (
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-black border ${
                            rb > 0.005
                              ? 'bg-purple-50 text-purple-800 border-purple-200'
                              : rb < -0.005
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {rb > 0.005 ? 'علينا' : rb < -0.005 ? 'لنا (مقدم)' : 'متوازن'}
                        </span>
                      );
                    },
                  },
                  {
                    key: 'view',
                    header: 'عرض',
                    align: 'center',
                    render: () => <Eye className="w-4 h-4 text-indigo-800 inline" />,
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
          subtitle={`رقم المستند: ${previewStatementDoc.docNumber} · التاريخ: ${previewStatementDoc.date}`}
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
                  <div>المستودع: {previewStatementDoc.invoice.warehouseName || '-'}</div>
                  <div>المدفوع: {Number(previewStatementDoc.invoice.paidAmount || 0).toLocaleString()} {settings.currency}</div>
                  <div>المتبقي: {Number(previewStatementDoc.invoice.remainingAmount || 0).toLocaleString()} {settings.currency}</div>
                  <div>الإجمالي: {Number(previewStatementDoc.invoice.grandTotal || 0).toLocaleString()} {settings.currency}</div>
                </div>
                <UnifiedDataTable<InvoiceItem>
                  title="أصناف المستند"
                  data={previewStatementDoc.invoice.items || []}
                  rowKey={(it, idx) => `${it.productId || it.productName}-${idx}`}
                  compact
                  searchable={false}
                  defaultPageSize={25}
                  columns={[
                    {
                      key: 'productName',
                      header: 'الصنف',
                      render: (it) => <span className="font-bold">{it.productName}</span>,
                    },
                    {
                      key: 'unit',
                      header: 'الوحدة',
                      render: (it) => <span>{it.unit}</span>,
                    },
                    {
                      key: 'quantity',
                      header: 'الكمية',
                      align: 'center',
                      render: (it) => <span className="font-mono font-bold tabular-nums">{it.quantity}</span>,
                    },
                    {
                      key: 'unitPrice',
                      header: 'السعر',
                      align: 'center',
                      render: (it) => <span className="font-mono tabular-nums">{Number(it.unitPrice || 0).toLocaleString()}</span>,
                    },
                    {
                      key: 'total',
                      header: 'الإجمالي',
                      align: 'center',
                      render: (it) => <span className="font-mono font-bold tabular-nums">{Number(it.total || 0).toLocaleString()}</span>,
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
                إغلاق المعاينة
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
          title={`تحصيل دفعة من العميل: ${custPaymentTarget.shopName || custPaymentTarget.name}`}
          subtitle={
            custPaymentTarget.currentBalance > 0
              ? `المديونية الحالية (لنا): ${custPaymentTarget.currentBalance.toLocaleString()} ${settings.currency}`
              : custPaymentTarget.currentBalance < 0
              ? `رصيد دائن للعميل حالياً (علينا): ${Math.abs(custPaymentTarget.currentBalance).toLocaleString()} ${settings.currency}`
              : 'الحساب متوازن حالياً (0)'
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
              <label className="block font-bold mb-1">المبلغ المحصل ({settings.currency}):</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={custPayAmount || ''}
                onChange={(e) => setCustPayAmount(Number(e.target.value))}
                className="w-full border rounded-lg px-2.5 py-1.5 text-center font-mono font-black text-emerald-800 text-base"
              />
            </div>

            {custPayAmount > Math.max(0, Number(custPaymentTarget.currentBalance || 0)) + 0.009 && (
              <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 font-bold leading-relaxed">
                تنبيه محاسبي: المبلغ المحصل يتجاوز المديونية الحالية ({Math.max(0, Number(custPaymentTarget.currentBalance || 0)).toLocaleString()} {settings.currency}). سيتم حفظ الزيادة كـ "رصيد دائن / دفعة مقدمة للعميل (علينا)" دون تصفير الرصيد السالب.
              </div>
            )}

            <div>
              <label className="block font-bold mb-1">وسيلة التحصيل:</label>
              <div className="grid grid-cols-3 gap-2 font-bold">
                {[
                  { id: 'cash' as const, label: 'نقدي' },
                  { id: 'bank' as const, label: 'تحويل بنكي' },
                  { id: 'cheque' as const, label: 'شيك' },
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
              <label className="block font-bold mb-1">الخزينة المودع بها:</label>
              <select
                value={custPayCashboxId}
                onChange={(e) => setCustPayCashboxId(e.target.value)}
                className="w-full border rounded-lg px-2.5 py-1.5 font-bold"
              >
                {cashboxes.map((cb) => (
                  <option key={cb.id} value={cb.id}>
                    {cb.balanceHidden ? `${cb.name} (رصيد محجوب)` : `${cb.name} (رصيدها: ${(cb.currentBalance ?? 0).toLocaleString()})`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold mb-1">البيان والملاحظات:</label>
              <input
                type="text"
                value={custPayNotes}
                onChange={(e) => setCustPayNotes(e.target.value)}
                placeholder="تحصيل نقدي من حساب العميل..."
                className="w-full border rounded-lg px-2.5 py-1.5"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setCustPaymentTarget(null)} className="px-3.5 py-1.5 border rounded-lg font-bold cursor-pointer">
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSubmittingCustPay}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold cursor-pointer disabled:opacity-50"
              >
                {isSubmittingCustPay ? 'جاري التسجيل...' : 'تأكيد التحصيل'}
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
          title={`سداد دفعة للمورد: ${suppPaymentTarget.name}`}
          subtitle={
            suppPaymentTarget.currentBalance > 0
              ? `المستحق للمورد (علينا): ${suppPaymentTarget.currentBalance.toLocaleString()} ${settings.currency}`
              : suppPaymentTarget.currentBalance < 0
              ? `دفعة مقدمة لنا عند المورد: ${Math.abs(suppPaymentTarget.currentBalance).toLocaleString()} ${settings.currency}`
              : 'حساب المورد متوازن حالياً (0)'
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
              <label className="block font-bold mb-1">المبلغ المسدد ({settings.currency}):</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={suppPayAmount || ''}
                onChange={(e) => setSuppPayAmount(Number(e.target.value))}
                className="w-full border rounded-lg px-2.5 py-1.5 text-center text-purple-900 font-mono font-black text-base"
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
                        ? 'تنبيه دفعة مقدمة للمورد (رصيد لنا)'
                        : 'سداد يتجاوز المستحق يتطلب صلاحية اعتماد إدارية'}
                    </span>
                  </div>
                  <p>
                    المبلغ الزائد ({overpayment.toLocaleString()} {settings.currency}) يتجاوز المديونية الحالية ({debt.toLocaleString()} {settings.currency}) وسيُسجل كـ "دفعة مقدمة للمورد (لنا)" لحين تسويته مع فواتير مشتريات قادمة.
                  </p>
                  {!canApproveSupplierOverpayment && (
                    <p className="text-[11px] underline">
                      لا تملك صلاحية اعتماد الدفعة الزائدة للمورد (مسموح للمدير العام / مدير الفرع / صلاحية الاعتماد فقط).
                    </p>
                  )}
                </div>
              );
            })()}

            <div>
              <label className="block font-bold mb-1">الخزينة أو الحساب المسدد منه:</label>
              <select
                value={suppPayCashboxId}
                onChange={(e) => setSuppPayCashboxId(e.target.value)}
                className="w-full border rounded-lg px-2.5 py-1.5 font-bold"
              >
                {cashboxes.map((cb) => (
                  <option key={cb.id} value={cb.id}>
                    {cb.balanceHidden ? `${cb.name} (رصيد محجوب)` : `${cb.name} (رصيدها: ${(cb.currentBalance ?? 0).toLocaleString()})`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold mb-1">ملاحظات الصرف:</label>
              <input
                type="text"
                value={suppPayNotes}
                onChange={(e) => setSuppPayNotes(e.target.value)}
                placeholder="سداد دفعة من حساب المورد..."
                className="w-full border rounded-lg px-2.5 py-1.5"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setSuppPaymentTarget(null)} className="px-3.5 py-1.5 border rounded-lg font-bold cursor-pointer">
                إلغاء
              </button>
              <button
                type="submit"
                disabled={
                  isSubmittingSuppPay ||
                  (suppPayAmount - Math.max(0, Number(suppPaymentTarget.currentBalance || 0)) > 0.009 &&
                    !canApproveSupplierOverpayment)
                }
                className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold cursor-pointer disabled:opacity-50"
              >
                {isSubmittingSuppPay ? 'جاري الصرف...' : 'تأكيد الصرف للمورد'}
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
          title={`تسوية دفعة مقدمة للمورد: ${settleSupplierTarget.name}`}
          subtitle="تسوية داخلية من الرصيد المقدم المتاح على فاتورة مشتريات دون التأثير على الخزائن"
          maxWidth="md"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const { availableAdvance, openInvoices } = getSupplierAdvanceInfo(settleSupplierTarget);
              const inv = openInvoices.find((i) => i.id === settleInvoiceId);
              if (!inv) {
                setSettleError('يرجى اختيار فاتورة مشتريات مفتوحة للتسوية.');
                return;
              }
              if (settleAmount <= 0 || settleAmount > Math.min(availableAdvance, inv.remainingAmount) + 0.01) {
                setSettleError('مبلغ التسوية يتجاوز المسموح به على الفاتورة أو الرصيد المقدم المتاح.');
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
              <label className="block font-bold mb-1">فاتورة المشتريات المفتوحة:</label>
              <select
                value={settleInvoiceId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSettleInvoiceId(id);
                  const { openInvoices, availableAdvance } = getSupplierAdvanceInfo(settleSupplierTarget);
                  const found = openInvoices.find((i) => i.id === id);
                  if (found) setSettleAmount(Math.min(availableAdvance, Number(found.remainingAmount || 0)));
                }}
                className="w-full border rounded-lg px-2.5 py-1.5 font-bold"
              >
                {getSupplierAdvanceInfo(settleSupplierTarget).openInvoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoiceNumber} — متبقي: {Number(inv.remainingAmount || 0).toLocaleString()} {settings.currency}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold mb-1">
                مبلغ التسوية ({settings.currency}) — المتاح: {getSupplierAdvanceInfo(settleSupplierTarget).availableAdvance.toLocaleString()}
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={settleAmount || ''}
                onChange={(e) => setSettleAmount(Number(e.target.value))}
                className="w-full border rounded-lg px-2.5 py-1.5 text-center font-mono font-black text-emerald-800 text-sm"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">ملاحظات التسوية:</label>
              <input
                type="text"
                value={settleNotes}
                onChange={(e) => setSettleNotes(e.target.value)}
                className="w-full border rounded-lg px-2.5 py-1.5"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setSettleSupplierTarget(null)} className="px-3.5 py-1.5 border rounded-lg font-bold cursor-pointer">
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSettlingAdvance}
                className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-bold cursor-pointer disabled:opacity-50"
              >
                تنفيذ التسوية
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
        title="تأكيد تسوية الدفعة المقدمة"
        message={
          settleSupplierTarget
            ? `سيتم تسوية مبلغ ${settleAmount.toLocaleString()} ${settings.currency} من رصيد الدفعة المقدمة لحساب المورد (${settleSupplierTarget.name}) على الفاتورة المحددة دون أي سحب جديد من الخزينة.`
            : ''
        }
        confirmLabel="تأكيد التسوية"
      />

      {/* Transfer Modal */}
      <Modal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        title="تحويل نقدية بين الخزائن والبنوك"
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
            <label className="block font-bold mb-1">من الخزينة / الحساب:</label>
            <select
              value={fromCbId}
              onChange={(e) => setFromCbId(e.target.value)}
              className="w-full border rounded-lg px-2.5 py-1.5 font-bold"
            >
              {cashboxes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (رصيدها: {c.currentBalance})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold mb-1">إلى الخزينة / الحساب:</label>
            <select
              value={toCbId}
              onChange={(e) => setToCbId(e.target.value)}
              className="w-full border rounded-lg px-2.5 py-1.5 font-bold"
            >
              {cashboxes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (رصيدها: {c.currentBalance})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold mb-1">المبلغ المراد تحويله ({settings.currency}):</label>
            <input
              type="number"
              min="1"
              required
              placeholder="0.00"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full border rounded-lg px-2.5 py-1.5 font-mono font-black text-center text-sm"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">البيان:</label>
            <input
              type="text"
              value={transferNotes}
              onChange={(e) => setTransferNotes(e.target.value)}
              placeholder="إيداع بنكي لحساب المبيعات..."
              className="w-full border rounded-lg px-2.5 py-1.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsTransferModalOpen(false)} className="px-3.5 py-1.5 border rounded-lg font-bold cursor-pointer">
              إلغاء
            </button>
            <button type="submit" disabled={isSubmittingTransfer} className="px-4 py-1.5 bg-blue-900 text-white rounded-lg font-bold cursor-pointer disabled:opacity-50">
              {isSubmittingTransfer ? 'جاري التنفيذ...' : 'تنفيذ التحويل المالي'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Cashbox Modal */}
      <Modal
        isOpen={isAddCashboxOpen}
        onClose={() => setIsAddCashboxOpen(false)}
        title="إضافة خزينة أو حساب بنكي"
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
            <label className="block font-bold mb-1">نوع الحساب:</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNewCbType('cashbox')}
                className={`py-1.5 px-2 border rounded-lg font-bold cursor-pointer ${newCbType === 'cashbox' ? 'bg-blue-900 text-white' : 'bg-slate-50'}`}
              >
                خزينة نقدية
              </button>
              <button
                type="button"
                onClick={() => setNewCbType('bank')}
                className={`py-1.5 px-2 border rounded-lg font-bold cursor-pointer ${newCbType === 'bank' ? 'bg-blue-900 text-white' : 'bg-slate-50'}`}
              >
                حساب بنكي
              </button>
            </div>
          </div>

          <div>
            <label className="block font-bold mb-1">اسم الخزينة أو البنك:</label>
            <input
              type="text"
              required
              placeholder="مثال: حساب البنك الأهلي الجاري"
              value={newCbName}
              onChange={(e) => setNewCbName(e.target.value)}
              className="w-full border rounded-lg px-2.5 py-1.5 font-bold"
            />
          </div>

          {newCbType === 'bank' && (
            <div>
              <label className="block font-bold mb-1">رقم الحساب أو الآيبان:</label>
              <input
                type="text"
                placeholder="IBAN / Account Number"
                value={newCbAccount}
                onChange={(e) => setNewCbAccount(e.target.value)}
                className="w-full border rounded-lg px-2.5 py-1.5 font-mono"
              />
            </div>
          )}

          <div>
            <label className="block font-bold mb-1">الرصيد الافتتاحي:</label>
            <input
              type="number"
              placeholder="0.00"
              value={newCbOpening}
              onChange={(e) => setNewCbOpening(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full border rounded-lg px-2.5 py-1.5 font-mono font-bold"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsAddCashboxOpen(false)} className="px-3.5 py-1.5 border rounded-lg font-bold cursor-pointer">
              إلغاء
            </button>
            <button type="submit" disabled={isSubmittingCashbox} className="px-4 py-1.5 bg-blue-900 text-white rounded-lg font-bold cursor-pointer disabled:opacity-50">
              {isSubmittingCashbox ? 'جاري الحفظ...' : 'حفظ الحساب'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Expense/Income Voucher Modal */}
      <Modal
        isOpen={isExpenseModalOpen}
        onClose={() => setIsExpenseModalOpen(false)}
        title={recordType === 'expense' ? 'تسجيل سند صرف مصروفات' : 'تسجيل سند قبض إيرادات'}
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
            <label className="block font-bold mb-1">بند {recordType === 'expense' ? 'المصروف' : 'الإيراد'}:</label>
            <input
              type="text"
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="وقود، صيانة، كهرباء، إيجار، تخريد..."
              className="w-full border rounded-lg px-2.5 py-1.5 font-bold"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">المبلغ ({settings.currency}):</label>
            <input
              type="number"
              min="1"
              required
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full border rounded-lg px-2.5 py-1.5 font-mono font-black text-center text-sm"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">الخزينة المتأثرة:</label>
            <select
              value={selectedCashboxId}
              onChange={(e) => setSelectedCashboxId(e.target.value)}
              className="w-full border rounded-lg px-2.5 py-1.5 font-bold"
            >
              {cashboxes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (رصيدها: {c.currentBalance})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold mb-1">{recordType === 'expense' ? 'الجهة المستلمة للمصروف:' : 'الجهة المسددة للإيراد:'}</label>
            <input
              type="text"
              required
              value={recipientOrPayer}
              onChange={(e) => setRecipientOrPayer(e.target.value)}
              className="w-full border rounded-lg px-2.5 py-1.5"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">ملاحظات السند:</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full border rounded-lg px-2.5 py-1.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsExpenseModalOpen(false)} className="px-3.5 py-1.5 border rounded-lg font-bold cursor-pointer">
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSubmittingExpense}
              className={`px-4 py-1.5 text-white rounded-lg font-bold shadow-xs cursor-pointer disabled:opacity-50 ${
                recordType === 'expense' ? 'bg-orange-600 hover:bg-orange-700' : 'bg-teal-600 hover:bg-teal-700'
              }`}
            >
              {isSubmittingExpense ? 'جاري الاعتماد...' : 'اعتماد السند وطباعته'}
            </button>
          </div>
        </form>
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
