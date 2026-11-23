import React, { useState, useEffect, useMemo } from 'react';
import {
  Users, Calendar, DollarSign, CheckCircle2, AlertCircle, Edit, UserX, UserCheck, Plus, Printer, Link2
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { Employee } from '../../../types';
import { Modal } from '../../common/Modal';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';

export interface EmployeesViewProps {
  initialTab?: 'employees' | 'attendance' | 'advances' | 'payrolls';
}

export const EmployeesView: React.FC<EmployeesViewProps> = ({ initialTab = 'employees' }) => {
  const {
    employees, users, representatives, attendance, advancesDeductions, payrolls, cashboxes,
    settings, addEmployee, updateEmployee, recordAttendance, addAdvanceDeduction, paySalary
  } = useData();

  const [activeTab, setActiveTab] = useState<'employees' | 'attendance' | 'advances' | 'payrolls'>(initialTab);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Add / Edit Employee Modal
  const [isEmpModalOpen, setIsEmpModalOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [empName, setEmpName] = useState('');
  const [empPhone, setEmpPhone] = useState('');
  const [empJob, setEmpJob] = useState('مندوب مبيعات وتوزيع');
  const [empDept, setEmpDept] = useState('المبيعات والتسويق');
  const [empSalary, setEmpSalary] = useState(6000);
  const [empNationalId, setEmpNationalId] = useState('');
  const [empUserId, setEmpUserId] = useState('');
  const [empStatus, setEmpStatus] = useState<'active' | 'suspended'>('active');
  const [empNotes, setEmpNotes] = useState('');
  const [empError, setEmpError] = useState<string | null>(null);
  const [isSavingEmp, setIsSavingEmp] = useState(false);

  // Attendance form state
  const [attDate, setAttDate] = useState(new Date().toISOString().split('T')[0]);
  const [attEmpId, setAttEmpId] = useState('');
  const [attStatus, setAttStatus] = useState<'present' | 'absent' | 'late' | 'leave'>('present');
  const [attCheckIn, setAttCheckIn] = useState('08:30');
  const [attCheckOut, setAttCheckOut] = useState('17:00');
  const [attNotes, setAttNotes] = useState('');
  const [isSavingAtt, setIsSavingAtt] = useState(false);

  // Add Advance/Bonus Modal
  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState(employees[0]?.id || '');
  const [advanceType, setAdvanceType] = useState<'advance' | 'deduction' | 'bonus'>('advance');
  const [advanceAmount, setAdvanceAmount] = useState(500);
  const [advanceReason, setAdvanceReason] = useState('سلفة نقدية على الراتب');
  const [advanceCashboxId, setAdvanceCashboxId] = useState(cashboxes[0]?.id || '');
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [isSavingAdvance, setIsSavingAdvance] = useState(false);

  // Generate Payroll Modal
  const [isPayrollModalOpen, setIsPayrollModalOpen] = useState(false);
  const [payrollEmpId, setPayrollEmpId] = useState(employees[0]?.id || '');
  const [payrollCashboxId, setPayrollCashboxId] = useState(cashboxes[0]?.id || '');
  const [payrollMonth, setPayrollMonth] = useState(new Date().getMonth() + 1);
  const [payrollYear, setPayrollYear] = useState(new Date().getFullYear());
  const [payrollNotes, setPayrollNotes] = useState('');
  const [payrollError, setPayrollError] = useState<string | null>(null);
  const [isSavingPayroll, setIsSavingPayroll] = useState(false);
  const [busyEmpActionId, setBusyEmpActionId] = useState<string | null>(null);
  const [printData, setPrintData] = useState<PrintData | null>(null);

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status !== 'suspended'),
    [employees]
  );

  // Sync default selectors when lists change
  useEffect(() => {
    const fallbackEmp = activeEmployees[0]?.id || employees[0]?.id || '';
    if (!employees.some((e) => e.id === selectedEmpId) && fallbackEmp) {
      setSelectedEmpId(fallbackEmp);
    }
    if (!employees.some((e) => e.id === payrollEmpId) && fallbackEmp) {
      setPayrollEmpId(fallbackEmp);
    }
    if (!employees.some((e) => e.id === attEmpId) && fallbackEmp) {
      setAttEmpId(fallbackEmp);
    }
  }, [employees, activeEmployees, selectedEmpId, payrollEmpId, attEmpId]);

  useEffect(() => {
    const fallbackCb = cashboxes[0]?.id || '';
    if (!cashboxes.some((c) => c.id === advanceCashboxId) && fallbackCb) {
      setAdvanceCashboxId(fallbackCb);
    }
    if (!cashboxes.some((c) => c.id === payrollCashboxId) && fallbackCb) {
      setPayrollCashboxId(fallbackCb);
    }
  }, [cashboxes, advanceCashboxId, payrollCashboxId]);

  // Live Payroll Preview
  const payrollPreview = useMemo(() => {
    const emp = employees.find((e) => e.id === payrollEmpId);
    if (!emp) return null;
    const empAdv = advancesDeductions
      .filter((a) => a.employeeId === emp.id && a.type === 'advance' && !a.isSettled)
      .reduce((s, a) => s + a.amount, 0);
    const empDed = advancesDeductions
      .filter((a) => a.employeeId === emp.id && a.type === 'deduction' && !a.isSettled)
      .reduce((s, a) => s + a.amount, 0);
    const empBon = advancesDeductions
      .filter((a) => a.employeeId === emp.id && a.type === 'bonus' && !a.isSettled)
      .reduce((s, a) => s + a.amount, 0);
    const netSalary = Math.max(0, emp.basicSalary - empAdv - empDed + empBon);
    const alreadyPaid = payrolls.some(
      (p) => p.employeeId === emp.id && Number(p.month) === Number(payrollMonth) && Number(p.year) === Number(payrollYear)
    );
    return { emp, empAdv, empDed, empBon, netSalary, alreadyPaid };
  }, [employees, payrollEmpId, advancesDeductions, payrolls, payrollMonth, payrollYear]);

  const openAddEmployeeModal = () => {
    setEditingEmp(null);
    setEmpName('');
    setEmpPhone('');
    setEmpJob('مندوب مبيعات وتوزيع');
    setEmpDept('المبيعات والتسويق');
    setEmpSalary(6000);
    setEmpNationalId('');
    setEmpUserId('');
    setEmpStatus('active');
    setEmpNotes('');
    setEmpError(null);
    setIsEmpModalOpen(true);
  };

  const openEditEmployeeModal = (emp: Employee) => {
    setEditingEmp(emp);
    setEmpName(emp.name);
    setEmpPhone(emp.phone);
    setEmpJob(emp.jobTitle);
    setEmpDept(emp.department);
    setEmpSalary(emp.basicSalary);
    setEmpNationalId(emp.nationalId || '');
    const linkedUsr = users.find((u) => u.id === emp.userId || u.employeeId === emp.id);
    setEmpUserId(linkedUsr?.id || emp.userId || '');
    setEmpStatus(emp.status);
    setEmpNotes(emp.notes || '');
    setEmpError(null);
    setIsEmpModalOpen(true);
  };

  const handleEmployeeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmpError(null);
    if (!empName.trim()) {
      setEmpError('يرجى إدخال اسم الموظف');
      return;
    }

    setIsSavingEmp(true);
    try {
      if (editingEmp) {
        const res = await updateEmployee(editingEmp.id, {
          name: empName.trim(),
          phone: empPhone.trim(),
          jobTitle: empJob.trim(),
          department: empDept.trim(),
          basicSalary: empSalary,
          nationalId: empNationalId.trim() || undefined,
          userId: empUserId || undefined,
          status: empStatus,
          notes: empNotes.trim() || undefined,
        });
        if (!res.success) {
          setEmpError(res.error || 'تعذر تحديث بيانات الموظف');
          return;
        }
        setActionMessage({ type: 'success', text: `تم تحديث بيانات الموظف (${empName.trim()}) بنجاح.` });
      } else {
        const res = await addEmployee({
          code: `EMP-${employees.length + 101}`,
          name: empName.trim(),
          phone: empPhone.trim(),
          jobTitle: empJob.trim(),
          department: empDept.trim(),
          basicSalary: empSalary,
          hireDate: new Date().toISOString().split('T')[0],
          nationalId: empNationalId.trim() || undefined,
          userId: empUserId || undefined,
          status: empStatus,
          notes: empNotes.trim() || undefined,
        });
        if (!res.success) {
          setEmpError(res.error || 'تعذر إضافة الموظف');
          return;
        }
        setActionMessage({ type: 'success', text: `تمت إضافة الموظف (${empName.trim()}) بنجاح.` });
      }
      setIsEmpModalOpen(false);
    } finally {
      setIsSavingEmp(false);
    }
  };

  const handleToggleEmployeeStatus = async (emp: Employee) => {
    if (busyEmpActionId) return;
    setBusyEmpActionId(emp.id);
    try {
      const nextStatus = emp.status === 'active' ? 'suspended' : 'active';
      const res = await updateEmployee(emp.id, { status: nextStatus });
      if (!res.success) {
        setActionMessage({ type: 'error', text: res.error || 'تعذر تغيير حالة الموظف' });
      } else {
        setActionMessage({
          type: 'success',
          text: `تم ${nextStatus === 'active' ? 'تفعيل' : 'إيقاف'} الموظف (${emp.name}) بنجاح.`,
        });
      }
    } finally {
      setBusyEmpActionId(null);
    }
  };

  const handleAddAdvanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdvanceError(null);
    const emp = employees.find((item) => item.id === selectedEmpId);
    if (!emp) {
      setAdvanceError('يرجى اختيار الموظف');
      return;
    }
    if (advanceAmount <= 0) {
      setAdvanceError('يرجى إدخال مبلغ صحيح أكبر من صفر');
      return;
    }
    if (advanceType === 'advance' && !advanceCashboxId) {
      setAdvanceError('يرجى تحديد الخزينة المنصرف منها السلفة');
      return;
    }

    setIsSavingAdvance(true);
    const res = await addAdvanceDeduction({
      employeeId: emp.id,
      employeeName: emp.name,
      type: advanceType,
      amount: advanceAmount,
      date: new Date().toISOString().split('T')[0],
      reason: advanceReason.trim(),
      cashboxId: advanceType === 'advance' ? advanceCashboxId : undefined,
    });
    setIsSavingAdvance(false);

    if (!res.success) {
      setAdvanceError(res.error || 'تعذر تسجيل الحركة');
      return;
    }
    setIsAdvanceModalOpen(false);
    setActionMessage({
      type: 'success',
      text: `تم تسجيل ${advanceType === 'advance' ? 'السلفة النقدية' : advanceType === 'deduction' ? 'الخصم' : 'المكافأة'} للموظف (${emp.name}) بنجاح.`,
    });
  };

  const handlePaySalarySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPayrollError(null);
    if (!payrollPreview) {
      setPayrollError('يرجى اختيار الموظف');
      return;
    }
    if (!payrollCashboxId) {
      setPayrollError('يرجى تحديد الخزينة المسدد منها الراتب');
      return;
    }
    if (payrollPreview.alreadyPaid) {
      setPayrollError(`تم صرف راتب شهر ${payrollMonth}/${payrollYear} للموظف (${payrollPreview.emp.name}) مسبقاً.`);
      return;
    }

    setIsSavingPayroll(true);
    const res = await paySalary({
      month: payrollMonth,
      year: payrollYear,
      employeeId: payrollPreview.emp.id,
      employeeName: payrollPreview.emp.name,
      basicSalary: payrollPreview.emp.basicSalary,
      advancesTotal: payrollPreview.empAdv,
      deductionsTotal: payrollPreview.empDed,
      bonusesTotal: payrollPreview.empBon,
      netSalary: payrollPreview.netSalary,
      status: 'paid',
      paidDate: new Date().toISOString().split('T')[0],
      cashboxId: payrollCashboxId,
      notes: payrollNotes.trim() || `صرف راتب شهر ${payrollMonth}/${payrollYear}`,
    });
    setIsSavingPayroll(false);

    if (!res.success) {
      setPayrollError(res.error || 'تعذر اعتماد وصرف الراتب');
      return;
    }
    setIsPayrollModalOpen(false);
    setPayrollNotes('');
    setActionMessage({
      type: 'success',
      text: `تم اعتماد وصرف راتب (${payrollPreview.emp.name}) لشهر ${payrollMonth}/${payrollYear} بقيمة ${payrollPreview.netSalary.toLocaleString()} ${settings.currency}.`,
    });
  };

  const handlePrintPayrollReceipt = (p: {
    payrollNumber: string;
    employeeName: string;
    month: number;
    year: number;
    basicSalary: number;
    advancesTotal: number;
    deductionsTotal: number;
    bonusesTotal: number;
    netSalary: number;
    paidDate?: string;
    notes?: string;
  }) => {
    setPrintData({
      title: 'سند صرف راتب موظف',
      docNumber: p.payrollNumber,
      docType: 'سند صرف',
      date: p.paidDate || new Date().toISOString().split('T')[0],
      partyName: p.employeeName,
      grandTotal: p.netSalary,
      paidAmount: p.netSalary,
      tableHeaders: ['م', 'البند', 'الفترة', 'العدد', 'القيمة', 'الخصم', 'الصافي'],
      items: [
        {
          name: 'الراتب الأساسي والمكافآت',
          unit: `${p.month}/${p.year}`,
          quantity: 1,
          price: p.basicSalary + p.bonusesTotal,
          discount: p.advancesTotal + p.deductionsTotal,
          total: p.netSalary,
        },
      ],
      notes: p.notes || `الأساسي: ${p.basicSalary} | السلف والخصومات: ${p.advancesTotal + p.deductionsTotal} | المكافآت: ${p.bonusesTotal}`,
    });
  };

  const handleQuickAttendance = async (empId: string, status: 'present' | 'absent' | 'late' | 'leave') => {
    if (busyEmpActionId) return;
    const emp = employees.find((item) => item.id === empId);
    if (!emp) return;
    setBusyEmpActionId(empId);
    try {
      const res = await recordAttendance({
        employeeId: emp.id,
        employeeName: emp.name,
        date: new Date().toISOString().split('T')[0],
        status,
        checkIn: status === 'present' || status === 'late' ? '08:30 ص' : undefined,
      });
      if (!res.success) {
        setActionMessage({ type: 'error', text: res.error || 'تعذر تسجيل الحضور' });
      } else {
        const label = status === 'present' ? 'حاضر' : status === 'absent' ? 'غائب' : status === 'late' ? 'متأخر' : 'إجازة';
        setActionMessage({ type: 'success', text: `تم تسجيل الموظف (${emp.name}) كـ "${label}" لليوم بنجاح.` });
      }
    } finally {
      setBusyEmpActionId(null);
    }
  };

  const handleAttendanceFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const emp = employees.find((item) => item.id === attEmpId);
    if (!emp) {
      setActionMessage({ type: 'error', text: 'يرجى اختيار الموظف أولاً.' });
      return;
    }
    setIsSavingAtt(true);
    const res = await recordAttendance({
      employeeId: emp.id,
      employeeName: emp.name,
      date: attDate,
      status: attStatus,
      checkIn: attStatus === 'present' || attStatus === 'late' ? attCheckIn : undefined,
      checkOut: attStatus === 'present' || attStatus === 'late' ? attCheckOut : undefined,
      notes: attNotes.trim() || undefined,
    });
    setIsSavingAtt(false);
    if (!res.success) {
      setActionMessage({ type: 'error', text: res.error || 'تعذر تسجيل حركة الحضور والانصراف' });
    } else {
      setAttNotes('');
      setActionMessage({ type: 'success', text: `تم تسجيل حركة الحضور والانصراف للموظف (${emp.name}) بتاريخ ${attDate}.` });
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight">إدارة شؤون الموظفين والرواتب</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            سجلات الموظفين، الحضور والانصراف، السلف، الخصومات، ومسير الرواتب الشهري
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setAdvanceError(null);
              setIsAdvanceModalOpen(true);
            }}
            className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold cursor-pointer"
          >
            + سلفة / خصم / مكافأة
          </button>
          <button
            type="button"
            onClick={() => {
              setPayrollError(null);
              setIsPayrollModalOpen(true);
            }}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer"
          >
            صرف راتب موظف
          </button>
          <button
            type="button"
            onClick={openAddEmployeeModal}
            className="px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl text-xs font-black shadow-md cursor-pointer"
          >
            + إضافة موظف
          </button>
        </div>
      </div>

      {actionMessage && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between gap-2 ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button onClick={() => setActionMessage(null)} className="underline text-[11px] cursor-pointer">
            إغلاق
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap border-b border-slate-200 text-xs font-bold gap-4">
        <button
          onClick={() => setActiveTab('employees')}
          className={`pb-2.5 transition-colors border-b-2 cursor-pointer ${
            activeTab === 'employees' ? 'border-blue-900 text-blue-950' : 'border-transparent text-slate-500'
          }`}
        >
          قائمة الموظفين ({employees.length})
        </button>
        <button
          onClick={() => setActiveTab('attendance')}
          className={`pb-2.5 transition-colors border-b-2 cursor-pointer ${
            activeTab === 'attendance' ? 'border-blue-900 text-blue-950' : 'border-transparent text-slate-500'
          }`}
        >
          الحضور والغياب ({attendance.length})
        </button>
        <button
          onClick={() => setActiveTab('advances')}
          className={`pb-2.5 transition-colors border-b-2 cursor-pointer ${
            activeTab === 'advances' ? 'border-blue-900 text-blue-950' : 'border-transparent text-slate-500'
          }`}
        >
          سجل السلف والخصومات ({advancesDeductions.length})
        </button>
        <button
          onClick={() => setActiveTab('payrolls')}
          className={`pb-2.5 transition-colors border-b-2 cursor-pointer ${
            activeTab === 'payrolls' ? 'border-blue-900 text-blue-950' : 'border-transparent text-slate-500'
          }`}
        >
          مسيرات الرواتب المصروفة ({payrolls.length})
        </button>
      </div>

      {/* Employees Tab */}
      {activeTab === 'employees' && (
        employees.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
            <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-slate-600">لا يوجد موظفون مسجلون حالياً</p>
            <p className="text-xs text-slate-400 mt-1">انقر على زر "+ إضافة موظف" للبدء بتسجيل بيانات الكادر الوظيفي ومسيرات الرواتب.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {employees.map(emp => {
              const unsettledAdv = advancesDeductions
                .filter((a) => a.employeeId === emp.id && a.type === 'advance' && !a.isSettled)
                .reduce((s, a) => s + a.amount, 0);
              const linkedUsr = users.find((u) => u.id === emp.userId || u.employeeId === emp.id);
              const linkedRep = representatives.find(
                (r) =>
                  (emp.identityId && r.identityId === emp.identityId) ||
                  (linkedUsr && r.userId === linkedUsr.id)
              );
              return (
                <div key={emp.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs text-xs space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[10px] font-bold text-blue-900 bg-blue-50 px-2 py-0.5 rounded">
                          {emp.code}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            emp.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {emp.status === 'active' ? 'نشط' : 'موقوف'}
                        </span>
                        {linkedUsr && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-800">
                            مستخدم: @{linkedUsr.username}
                          </span>
                        )}
                        {linkedRep && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-800">
                            مندوب ميداني
                          </span>
                        )}
                      </div>
                      <h3 className="text-sm font-black text-slate-900 mt-1.5">{emp.name}</h3>
                      <p className="text-slate-500">{emp.jobTitle} - {emp.department}</p>
                      {emp.phone && <p className="font-mono text-[11px] text-slate-500 mt-0.5">{emp.phone}</p>}
                      {emp.identityId && (
                        <p className="font-mono text-[10px] text-slate-400 mt-0.5">هوية موحدة: {emp.identityId}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditEmployeeModal(emp)}
                        title="تعديل بيانات الموظف"
                        className="p-1.5 rounded-lg text-slate-500 hover:text-blue-900 hover:bg-blue-50 cursor-pointer"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={busyEmpActionId === emp.id}
                        onClick={() => handleToggleEmployeeStatus(emp)}
                        title={emp.status === 'active' ? 'إيقاف الموظف' : 'تفعيل الموظف'}
                        className={`p-1.5 rounded-lg cursor-pointer disabled:opacity-40 ${
                          emp.status === 'active'
                            ? 'text-red-500 hover:bg-red-50'
                            : 'text-emerald-600 hover:bg-emerald-50'
                        }`}
                      >
                        {emp.status === 'active' ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600 font-bold">الراتب الأساسي:</span>
                      <span className="font-mono font-black text-blue-950 text-sm">
                        {emp.basicSalary.toLocaleString()} {settings.currency}
                      </span>
                    </div>
                    {unsettledAdv > 0 && (
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-amber-700 font-bold">سلف قائمة غير مسددة:</span>
                        <span className="font-mono font-bold text-amber-800">{unsettledAdv.toLocaleString()} {settings.currency}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2 border-t text-[11px]">
                    <button
                      type="button"
                      disabled={emp.status !== 'active' || busyEmpActionId === emp.id}
                      onClick={() => handleQuickAttendance(emp.id, 'present')}
                      className="flex-1 py-1.5 bg-emerald-50 text-emerald-800 font-bold rounded-lg hover:bg-emerald-100 disabled:opacity-40 cursor-pointer"
                    >
                      ✓ تسجيل حضور
                    </button>
                    <button
                      type="button"
                      disabled={emp.status !== 'active' || busyEmpActionId === emp.id}
                      onClick={() => handleQuickAttendance(emp.id, 'absent')}
                      className="flex-1 py-1.5 bg-red-50 text-red-800 font-bold rounded-lg hover:bg-red-100 disabled:opacity-40 cursor-pointer"
                    >
                      ✗ تسجيل غياب
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Attendance Tab */}
      {activeTab === 'attendance' && (
        <div className="space-y-4">
          <form onSubmit={handleAttendanceFormSubmit} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs text-xs space-y-3">
            <h3 className="font-black text-slate-900 text-sm flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-900" />
              <span>تسجيل حركة حضور / انصراف</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-end">
              <div className="sm:col-span-2">
                <label className="block font-bold mb-1">الموظف:</label>
                <select
                  value={attEmpId}
                  onChange={(e) => setAttEmpId(e.target.value)}
                  className="w-full border rounded-xl p-2 font-bold bg-slate-50"
                >
                  {employees.length === 0 ? (
                    <option value="">-- لا يوجد موظفون --</option>
                  ) : (
                    employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} {e.status === 'suspended' ? '(موقوف)' : ''}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label className="block font-bold mb-1">التاريخ:</label>
                <input
                  type="date"
                  value={attDate}
                  onChange={(e) => setAttDate(e.target.value)}
                  className="w-full border rounded-xl p-2 font-mono font-bold"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">الحالة:</label>
                <select
                  value={attStatus}
                  onChange={(e) => setAttStatus(e.target.value as any)}
                  className="w-full border rounded-xl p-2 font-bold"
                >
                  <option value="present">حاضر</option>
                  <option value="late">متأخر</option>
                  <option value="absent">غائب</option>
                  <option value="leave">إجازة</option>
                </select>
              </div>
              <div>
                <label className="block font-bold mb-1">وقت الحضور:</label>
                <input
                  type="time"
                  value={attCheckIn}
                  onChange={(e) => setAttCheckIn(e.target.value)}
                  disabled={attStatus === 'absent' || attStatus === 'leave'}
                  className="w-full border rounded-xl p-2 font-mono disabled:bg-slate-100"
                />
              </div>
              <div>
                <button
                  type="submit"
                  disabled={isSavingAtt || employees.length === 0}
                  className="w-full py-2 px-4 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-black cursor-pointer disabled:opacity-50"
                >
                  {isSavingAtt ? 'جاري الحفظ...' : 'تسجيل الحركة'}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block font-bold mb-1">وقت الانصراف:</label>
                <input
                  type="time"
                  value={attCheckOut}
                  onChange={(e) => setAttCheckOut(e.target.value)}
                  disabled={attStatus === 'absent' || attStatus === 'leave'}
                  className="w-full border rounded-xl p-2 font-mono disabled:bg-slate-100"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block font-bold mb-1">ملاحظات:</label>
                <input
                  type="text"
                  value={attNotes}
                  onChange={(e) => setAttNotes(e.target.value)}
                  placeholder="ملاحظة إضافية حول التأخير أو الإذن..."
                  className="w-full border rounded-xl p-2"
                />
              </div>
            </div>
          </form>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden awlad-table-scroll">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50 font-bold border-b text-slate-700">
                  <th className="p-3">التاريخ</th>
                  <th className="p-3">اسم الموظف</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">الحضور</th>
                  <th className="p-3">الانصراف</th>
                  <th className="p-3">ملاحظات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {attendance.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-400">
                      لا توجد سجلات حضور وغياب مسجلة بعد
                    </td>
                  </tr>
                ) : (
                  attendance.map((rec) => (
                    <tr key={rec.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono text-slate-600">{rec.date}</td>
                      <td className="p-3 font-bold text-slate-900">{rec.employeeName}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                            rec.status === 'present'
                              ? 'bg-emerald-100 text-emerald-800'
                              : rec.status === 'late'
                              ? 'bg-amber-100 text-amber-800'
                              : rec.status === 'leave'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {rec.status === 'present'
                            ? 'حاضر'
                            : rec.status === 'late'
                            ? 'متأخر'
                            : rec.status === 'leave'
                            ? 'إجازة'
                            : 'غائب'}
                        </span>
                      </td>
                      <td className="p-3 font-mono">{rec.checkIn || '-'}</td>
                      <td className="p-3 font-mono">{rec.checkOut || '-'}</td>
                      <td className="p-3 text-slate-600">{rec.notes || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Advances & Deductions Tab */}
      {activeTab === 'advances' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden awlad-table-scroll">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50 font-bold border-b text-slate-700">
                <th className="p-3">التاريخ</th>
                <th className="p-3">اسم الموظف</th>
                <th className="p-3">النوع</th>
                <th className="p-3 text-center">المبلغ</th>
                <th className="p-3">التسوية بالراتب</th>
                <th className="p-3">السبب / البيان</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {advancesDeductions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-400">
                    لا توجد سلف أو خصومات مسجلة حالياً
                  </td>
                </tr>
              ) : (
                advancesDeductions.map(a => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="p-3 font-mono text-slate-600">{a.date}</td>
                    <td className="p-3 font-bold text-slate-900">{a.employeeName}</td>
                    <td className="p-3">
                      {a.type === 'advance' ? (
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold text-[10px]">سلفة</span>
                      ) : a.type === 'deduction' ? (
                        <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-bold text-[10px]">خصم جزاء</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">مكافأة</span>
                      )}
                    </td>
                    <td className="p-3 text-center font-mono font-bold">{a.amount.toLocaleString()} {settings.currency}</td>
                    <td className="p-3">
                      {a.isSettled ? (
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">تمت التسوية</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 text-[10px] font-bold">قائمة للخصم بالمسير</span>
                      )}
                    </td>
                    <td className="p-3 text-slate-600">{a.reason}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Payrolls Tab */}
      {activeTab === 'payrolls' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden awlad-table-scroll">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50 font-bold border-b text-slate-700">
                <th className="p-3">رقم المسير</th>
                <th className="p-3">اسم الموظف</th>
                <th className="p-3">الشهر / السنة</th>
                <th className="p-3 text-center">الأساسي</th>
                <th className="p-3 text-center">السلف والخصم</th>
                <th className="p-3 text-center">المكافآت</th>
                <th className="p-3 text-center">الصافي المنصرف</th>
                <th className="p-3">تاريخ الصرف</th>
                <th className="p-3 text-center">طباعة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payrolls.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-slate-400">
                    لا توجد مسيرات رواتب مصدرة بعد
                  </td>
                </tr>
              ) : (
                payrolls.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="p-3 font-mono font-bold text-blue-900">{p.payrollNumber}</td>
                    <td className="p-3 font-bold text-slate-900">{p.employeeName}</td>
                    <td className="p-3 font-mono">{p.month} / {p.year}</td>
                    <td className="p-3 text-center font-bold">{p.basicSalary.toLocaleString()}</td>
                    <td className="p-3 text-center text-red-600 font-bold">-{(p.advancesTotal + p.deductionsTotal).toLocaleString()}</td>
                    <td className="p-3 text-center text-emerald-600 font-bold">+{p.bonusesTotal.toLocaleString()}</td>
                    <td className="p-3 text-center font-black text-blue-950 font-mono text-sm">{p.netSalary.toLocaleString()} {settings.currency}</td>
                    <td className="p-3 text-slate-500 font-mono">{p.paidDate}</td>
                    <td className="p-3 text-center">
                      <button
                        type="button"
                        onClick={() => handlePrintPayrollReceipt(p)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-blue-50 text-blue-900 rounded-lg font-bold cursor-pointer"
                        title="طباعة إيصال صرف راتب"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>إيصال</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit Employee Modal */}
      <Modal
        isOpen={isEmpModalOpen}
        onClose={() => setIsEmpModalOpen(false)}
        title={editingEmp ? `تعديل بيانات الموظف: ${editingEmp.name}` : 'إضافة موظف جديد'}
        maxWidth="md"
      >
        <form onSubmit={handleEmployeeSubmit} className="space-y-4 text-xs">
          {empError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">{empError}</div>
          )}

          <div>
            <label className="block font-bold mb-1">اسم الموظف الثلاثي:</label>
            <input
              type="text"
              required
              value={empName}
              onChange={(e) => setEmpName(e.target.value)}
              className="w-full border rounded-xl p-2.5 font-bold"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">رقم الهاتف:</label>
              <input
                type="tel"
                required
                value={empPhone}
                onChange={(e) => setEmpPhone(e.target.value)}
                className="w-full border rounded-xl p-2.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">الرقم القومي (اختياري):</label>
              <input
                type="text"
                value={empNationalId}
                onChange={(e) => setEmpNationalId(e.target.value)}
                className="w-full border rounded-xl p-2.5 font-mono"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">المسمى الوظيفي:</label>
              <input
                type="text"
                required
                value={empJob}
                onChange={(e) => setEmpJob(e.target.value)}
                className="w-full border rounded-xl p-2.5"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">القسم:</label>
              <input
                type="text"
                required
                value={empDept}
                onChange={(e) => setEmpDept(e.target.value)}
                className="w-full border rounded-xl p-2.5"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">الراتب الأساسي ({settings.currency}):</label>
              <input
                type="number"
                min="0"
                required
                value={empSalary}
                onChange={(e) => setEmpSalary(Number(e.target.value))}
                className="w-full border rounded-xl p-2.5 font-mono font-bold"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">الحالة:</label>
              <select
                value={empStatus}
                onChange={(e) => setEmpStatus(e.target.value as 'active' | 'suspended')}
                className="w-full border rounded-xl p-2.5 font-bold"
              >
                <option value="active">نشط (على رأس العمل)</option>
                <option value="suspended">موقوف</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block font-bold mb-1 flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-indigo-700" />
              <span>ربط بحساب مستخدم دخول للنظام (اختياري):</span>
            </label>
            <select
              value={empUserId}
              onChange={(e) => setEmpUserId(e.target.value)}
              className="w-full border rounded-xl p-2.5 font-bold bg-slate-50"
            >
              <option value="">-- بدون ربط بحساب مستخدم --</option>
              {users
                .filter(
                  (u) =>
                    u.role !== 'customer' &&
                    (!u.employeeId || (editingEmp && (u.employeeId === editingEmp.id || u.id === editingEmp.userId)))
                )
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} (@{u.username}) — {u.role}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="block font-bold mb-1">ملاحظات:</label>
            <input
              type="text"
              value={empNotes}
              onChange={(e) => setEmpNotes(e.target.value)}
              className="w-full border rounded-xl p-2.5"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsEmpModalOpen(false)} className="px-4 py-2 border rounded-xl font-bold cursor-pointer">
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSavingEmp}
              className="px-6 py-2 bg-blue-900 text-white rounded-xl font-bold disabled:opacity-50 cursor-pointer"
            >
              {isSavingEmp ? 'جاري الحفظ...' : editingEmp ? 'حفظ التعديلات' : 'حفظ الموظف'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Advance Modal */}
      <Modal
        isOpen={isAdvanceModalOpen}
        onClose={() => setIsAdvanceModalOpen(false)}
        title="تسجيل سلفة أو خصم أو مكافأة"
        maxWidth="md"
      >
        <form onSubmit={handleAddAdvanceSubmit} className="space-y-4 text-xs">
          {advanceError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">{advanceError}</div>
          )}

          <div>
            <label className="block font-bold mb-1">الموظف:</label>
            <select
              value={selectedEmpId}
              onChange={(e) => setSelectedEmpId(e.target.value)}
              className="w-full border rounded-xl p-2.5 font-bold"
            >
              {activeEmployees.length === 0 ? (
                <option value="">-- لا يوجد موظفون نشطون مسجلون بعد --</option>
              ) : (
                activeEmployees.map(e => (
                  <option key={e.id} value={e.id}>{e.name} ({e.jobTitle})</option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="block font-bold mb-1">نوع العملية:</label>
            <select
              value={advanceType}
              onChange={(e) => {
                const nextType = e.target.value as 'advance' | 'deduction' | 'bonus';
                setAdvanceType(nextType);
                const defaults = ['سلفة نقدية على الراتب', 'خصم إداري', 'مكافأة تشجيعية', ''];
                if (defaults.includes(advanceReason.trim())) {
                  setAdvanceReason(
                    nextType === 'advance'
                      ? 'سلفة نقدية على الراتب'
                      : nextType === 'deduction'
                      ? 'خصم إداري'
                      : 'مكافأة تشجيعية'
                  );
                }
              }}
              className="w-full border rounded-xl p-2.5 font-bold"
            >
              <option value="advance">سلفة نقدية (تخصم من الراتب وتصرف من الخزينة)</option>
              <option value="deduction">خصم جزاء أو غياب</option>
              <option value="bonus">مكافأة أو حافز إضافي</option>
            </select>
          </div>

          <div>
            <label className="block font-bold mb-1">المبلغ ({settings.currency}):</label>
            <input
              type="number"
              min="1"
              required
              value={advanceAmount}
              onChange={(e) => setAdvanceAmount(Number(e.target.value))}
              className="w-full border rounded-xl p-2.5 font-mono font-black text-center text-sm"
            />
          </div>

          {advanceType === 'advance' && (
            <div>
              <label className="block font-bold mb-1">الخزينة المنصرف منها السلفة:</label>
              <select
                value={advanceCashboxId}
                onChange={(e) => setAdvanceCashboxId(e.target.value)}
                className="w-full border rounded-xl p-2.5 font-bold"
              >
                {cashboxes.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.balanceHidden ? `${c.name} (رصيد محجوب)` : `${c.name} (رصيد: ${(c.currentBalance ?? 0).toLocaleString()} ${settings.currency})`}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block font-bold mb-1">السبب / البيان:</label>
            <input
              type="text"
              required
              value={advanceReason}
              onChange={(e) => setAdvanceReason(e.target.value)}
              className="w-full border rounded-xl p-2.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsAdvanceModalOpen(false)} className="px-4 py-2 border rounded-xl font-bold cursor-pointer">
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSavingAdvance || activeEmployees.length === 0}
              className="px-6 py-2 bg-blue-900 text-white rounded-xl font-bold disabled:opacity-50 cursor-pointer"
            >
              {isSavingAdvance ? 'جاري التسجيل...' : 'تسجيل'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Pay Salary Modal */}
      <Modal
        isOpen={isPayrollModalOpen}
        onClose={() => setIsPayrollModalOpen(false)}
        title="صرف مسير راتب موظف"
        maxWidth="md"
      >
        <form onSubmit={handlePaySalarySubmit} className="space-y-4 text-xs">
          {payrollError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">{payrollError}</div>
          )}

          <div>
            <label className="block font-bold mb-1">اختر الموظف:</label>
            <select
              value={payrollEmpId}
              onChange={(e) => setPayrollEmpId(e.target.value)}
              className="w-full border rounded-xl p-2.5 font-bold"
            >
              {activeEmployees.length === 0 ? (
                <option value="">-- لا يوجد موظفون نشطون مسجلون بعد --</option>
              ) : (
                activeEmployees.map(e => (
                  <option key={e.id} value={e.id}>{e.name} - الأساسي: {e.basicSalary.toLocaleString()}</option>
                ))
              )}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">الشهر:</label>
              <input
                type="number"
                min={1}
                max={12}
                value={payrollMonth}
                onChange={(e) => setPayrollMonth(Math.min(12, Math.max(1, Number(e.target.value))))}
                className="w-full border rounded-xl p-2.5 font-mono font-bold text-center"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">السنة:</label>
              <input
                type="number"
                min={2020}
                max={2100}
                value={payrollYear}
                onChange={(e) => setPayrollYear(Number(e.target.value))}
                className="w-full border rounded-xl p-2.5 font-mono font-bold text-center"
              />
            </div>
          </div>

          {payrollPreview && (
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-600">الراتب الأساسي:</span>
                <strong className="font-mono">{payrollPreview.emp.basicSalary.toLocaleString()} {settings.currency}</strong>
              </div>
              <div className="flex justify-between text-amber-800">
                <span>سلف تخصم من الراتب:</span>
                <strong className="font-mono">-{payrollPreview.empAdv.toLocaleString()}</strong>
              </div>
              <div className="flex justify-between text-red-700">
                <span>خصومات وجزاءات:</span>
                <strong className="font-mono">-{payrollPreview.empDed.toLocaleString()}</strong>
              </div>
              <div className="flex justify-between text-emerald-700">
                <span>مكافآت وحوافز:</span>
                <strong className="font-mono">+{payrollPreview.empBon.toLocaleString()}</strong>
              </div>
              <div className="flex justify-between text-sm font-black text-blue-950 border-t border-slate-200 pt-1.5">
                <span>صافي الراتب المستحق للصرف:</span>
                <strong className="font-mono">{payrollPreview.netSalary.toLocaleString()} {settings.currency}</strong>
              </div>
              {payrollPreview.alreadyPaid && (
                <p className="text-[11px] font-bold text-red-600 pt-1">
                  تنبيه: تم صرف راتب هذا الشهر ({payrollMonth}/{payrollYear}) لهذا الموظف مسبقاً.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block font-bold mb-1">الخزينة المسدد منها الراتب:</label>
            <select
              value={payrollCashboxId}
              onChange={(e) => setPayrollCashboxId(e.target.value)}
              className="w-full border rounded-xl p-2.5 font-bold"
            >
              {cashboxes.map(c => (
                <option key={c.id} value={c.id}>
                  {c.balanceHidden ? `${c.name} (رصيد محجوب)` : `${c.name} (رصيد: ${(c.currentBalance ?? 0).toLocaleString()} ${settings.currency})`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold mb-1">ملاحظات الصرف (اختياري):</label>
            <input
              type="text"
              value={payrollNotes}
              onChange={(e) => setPayrollNotes(e.target.value)}
              placeholder={`صرف راتب شهر ${payrollMonth}/${payrollYear}`}
              className="w-full border rounded-xl p-2.5"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsPayrollModalOpen(false)} className="px-4 py-2 border rounded-xl font-bold cursor-pointer">
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSavingPayroll || !payrollPreview || payrollPreview.alreadyPaid}
              className="px-6 py-2 bg-emerald-600 text-white rounded-xl font-bold disabled:opacity-50 cursor-pointer"
            >
              {isSavingPayroll ? 'جاري الصرف...' : 'اعتماد وصرف الراتب'}
            </button>
          </div>
        </form>
      </Modal>

      <PrintDocumentModal
        isOpen={!!printData}
        onClose={() => setPrintData(null)}
        data={printData}
      />
    </div>
  );
};
