import React, { useState } from 'react';
import { 
  Users, Plus, Calendar, DollarSign, CheckCircle, Clock, 
  UserCheck, AlertCircle, Edit, Trash2, Printer 
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { Employee, SalaryPayroll } from '../../../types';
import { Modal } from '../../common/Modal';

export const EmployeesView: React.FC = () => {
  const { 
    employees, attendance, advancesDeductions, payrolls, cashboxes, 
    settings, addEmployee, updateEmployee, recordAttendance, addAdvanceDeduction, paySalary 
  } = useData();

  const [activeTab, setActiveTab] = useState<'employees' | 'attendance' | 'advances' | 'payrolls'>('employees');

  // Add Employee Modal
  const [isAddEmpOpen, setIsAddEmpOpen] = useState(false);
  const [empName, setEmpName] = useState('');
  const [empPhone, setEmpPhone] = useState('');
  const [empJob, setEmpJob] = useState('مندوب مبيعات وتوزيع');
  const [empDept, setEmpDept] = useState('المبيعات والتسويق');
  const [empSalary, setEmpSalary] = useState(6000);

  // Add Advance/Bonus Modal
  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState(employees[0]?.id || '');
  const [advanceType, setAdvanceType] = useState<'advance' | 'deduction' | 'bonus'>('advance');
  const [advanceAmount, setAdvanceAmount] = useState(500);
  const [advanceReason, setAdvanceReason] = useState('سلفة نقدية على الراتب');
  const [advanceCashboxId, setAdvanceCashboxId] = useState(cashboxes[0]?.id || '');

  // Generate Payroll Modal
  const [isPayrollModalOpen, setIsPayrollModalOpen] = useState(false);
  const [payrollEmpId, setPayrollEmpId] = useState(employees[0]?.id || '');
  const [payrollCashboxId, setPayrollCashboxId] = useState(cashboxes[0]?.id || '');

  const handleAddEmployeeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empName.trim()) return;

    await addEmployee({
      code: `EMP-${(employees.length + 101)}`,
      name: empName,
      phone: empPhone,
      jobTitle: empJob,
      department: empDept,
      basicSalary: empSalary,
      hireDate: new Date().toISOString().split('T')[0],
      status: 'active',
    });

    setIsAddEmpOpen(false);
    setEmpName('');
    setEmpPhone('');
  };

  const handleAddAdvanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const emp = employees.find(e => e.id === selectedEmpId);
    if (!emp) return;

    await addAdvanceDeduction({
      employeeId: emp.id,
      employeeName: emp.name,
      type: advanceType,
      amount: advanceAmount,
      date: new Date().toISOString().split('T')[0],
      reason: advanceReason,
      cashboxId: advanceType === 'advance' ? advanceCashboxId : undefined,
    });

    setIsAdvanceModalOpen(false);
  };

  const handlePaySalarySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const emp = employees.find(e => e.id === payrollEmpId);
    if (!emp) return;

    // Calculate advances, deductions, bonuses for this employee
    const empAdv = advancesDeductions
      .filter(a => a.employeeId === emp.id && a.type === 'advance' && !a.isSettled)
      .reduce((s, a) => s + a.amount, 0);

    const empDed = advancesDeductions
      .filter(a => a.employeeId === emp.id && a.type === 'deduction' && !a.isSettled)
      .reduce((s, a) => s + a.amount, 0);

    const empBon = advancesDeductions
      .filter(a => a.employeeId === emp.id && a.type === 'bonus' && !a.isSettled)
      .reduce((s, a) => s + a.amount, 0);

    const netSalary = Math.max(0, emp.basicSalary - empAdv - empDed + empBon);

    await paySalary({
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
      employeeId: emp.id,
      employeeName: emp.name,
      basicSalary: emp.basicSalary,
      advancesTotal: empAdv,
      deductionsTotal: empDed,
      bonusesTotal: empBon,
      netSalary,
      status: 'paid',
      paidDate: new Date().toISOString().split('T')[0],
      cashboxId: payrollCashboxId,
      notes: `صرف راتب شهر ${new Date().getMonth() + 1}`,
    });

    setIsPayrollModalOpen(false);
  };

  const handleQuickAttendance = async (empId: string, status: 'present' | 'absent') => {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;
    await recordAttendance({
      employeeId: emp.id,
      employeeName: emp.name,
      date: new Date().toISOString().split('T')[0],
      status,
      checkIn: status === 'present' ? '08:30 ص' : undefined,
    });
    alert(`تم تسجيل ${emp.name} كـ ${status === 'present' ? 'حاضر' : 'غائب'} لليوم`);
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

        <div className="flex gap-2">
          <button
            onClick={() => setIsAdvanceModalOpen(true)}
            className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold"
          >
            + سلفة / خصم / مكافأة
          </button>
          <button
            onClick={() => setIsPayrollModalOpen(true)}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold"
          >
            صرف راتب موظف
          </button>
          <button
            onClick={() => setIsAddEmpOpen(true)}
            className="px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl text-xs font-black shadow-md"
          >
            + إضافة موظف
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 text-xs font-bold gap-4">
        <button
          onClick={() => setActiveTab('employees')}
          className={`pb-2.5 transition-colors border-b-2 ${
            activeTab === 'employees' ? 'border-blue-900 text-blue-950' : 'border-transparent text-slate-500'
          }`}
        >
          قائمة الموظفين ({employees.length})
        </button>
        <button
          onClick={() => setActiveTab('advances')}
          className={`pb-2.5 transition-colors border-b-2 ${
            activeTab === 'advances' ? 'border-blue-900 text-blue-950' : 'border-transparent text-slate-500'
          }`}
        >
          سجل السلف والخصومات ({advancesDeductions.length})
        </button>
        <button
          onClick={() => setActiveTab('payrolls')}
          className={`pb-2.5 transition-colors border-b-2 ${
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
            <p className="text-sm font-bold text-slate-600">لا يوجد موظفون مسجلون حالياً</p>
            <p className="text-xs text-slate-400 mt-1">انقر على زر "+ موظف جديد" للبدء بتسجيل بيانات الكادر الوظيفي ومسيرات الرواتب.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {employees.map(emp => (
              <div key={emp.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs text-xs space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-mono text-[10px] font-bold text-blue-900 bg-blue-50 px-2 py-0.5 rounded">
                      {emp.code}
                    </span>
                    <h3 className="text-sm font-black text-slate-900 mt-1">{emp.name}</h3>
                    <p className="text-slate-500">{emp.jobTitle} - {emp.department}</p>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl flex justify-between items-center">
                  <span className="text-slate-600 font-bold">الراتب الأساسي:</span>
                  <span className="font-mono font-black text-blue-950 text-sm">
                    {emp.basicSalary.toLocaleString()} {settings.currency}
                  </span>
                </div>

                <div className="flex gap-2 pt-2 border-t text-[11px]">
                  <button
                    onClick={() => handleQuickAttendance(emp.id, 'present')}
                    className="flex-1 py-1.5 bg-emerald-50 text-emerald-800 font-bold rounded-lg hover:bg-emerald-100"
                  >
                    ✓ تسجيل حضور
                  </button>
                  <button
                    onClick={() => handleQuickAttendance(emp.id, 'absent')}
                    className="flex-1 py-1.5 bg-red-50 text-red-800 font-bold rounded-lg hover:bg-red-100"
                  >
                    ✗ تسجيل غياب
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Advances & Deductions Tab */}
      {activeTab === 'advances' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50 font-bold border-b text-slate-700">
                <th className="p-3">التاريخ</th>
                <th className="p-3">اسم الموظف</th>
                <th className="p-3">النوع</th>
                <th className="p-3 text-center">المبلغ</th>
                <th className="p-3">السبب / البيان</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {advancesDeductions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-400">
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
                    <td className="p-3 text-center font-mono font-bold">{a.amount} {settings.currency}</td>
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
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payrolls.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-slate-400">
                    لا توجد مسيرات رواتب مصدرة بعد
                  </td>
                </tr>
              ) : (
                payrolls.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="p-3 font-mono font-bold text-blue-900">{p.payrollNumber}</td>
                    <td className="p-3 font-bold text-slate-900">{p.employeeName}</td>
                    <td className="p-3 font-mono">{p.month} / {p.year}</td>
                    <td className="p-3 text-center font-bold">{p.basicSalary}</td>
                    <td className="p-3 text-center text-red-600 font-bold">-{p.advancesTotal + p.deductionsTotal}</td>
                    <td className="p-3 text-center text-emerald-600 font-bold">+{p.bonusesTotal}</td>
                    <td className="p-3 text-center font-black text-blue-950 font-mono text-sm">{p.netSalary} {settings.currency}</td>
                    <td className="p-3 text-slate-500 font-mono">{p.paidDate}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Employee Modal */}
      <Modal
        isOpen={isAddEmpOpen}
        onClose={() => setIsAddEmpOpen(false)}
        title="إضافة موظف جديد"
        maxWidth="md"
      >
        <form onSubmit={handleAddEmployeeSubmit} className="space-y-4 text-xs">
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
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsAddEmpOpen(false)} className="px-4 py-2 border rounded-xl font-bold">إلغاء</button>
            <button type="submit" className="px-6 py-2 bg-blue-900 text-white rounded-xl font-bold">حفظ الموظف</button>
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
          <div>
            <label className="block font-bold mb-1">الموظف:</label>
            <select
              value={selectedEmpId}
              onChange={(e) => setSelectedEmpId(e.target.value)}
              className="w-full border rounded-xl p-2.5 font-bold"
            >
              {employees.length === 0 ? (
                <option value="">-- لا يوجد موظفون مسجلون بعد (يرجى إضافة موظف أولاً) --</option>
              ) : (
                employees.map(e => (
                  <option key={e.id} value={e.id}>{e.name} ({e.jobTitle})</option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="block font-bold mb-1">نوع العملية:</label>
            <select
              value={advanceType}
              onChange={(e) => setAdvanceType(e.target.value as any)}
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
                  <option key={c.id} value={c.id}>{c.name}</option>
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
            <button type="button" onClick={() => setIsAdvanceModalOpen(false)} className="px-4 py-2 border rounded-xl font-bold">إلغاء</button>
            <button type="submit" className="px-6 py-2 bg-blue-900 text-white rounded-xl font-bold">تسجيل</button>
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
          <div>
            <label className="block font-bold mb-1">اختر الموظف:</label>
            <select
              value={payrollEmpId}
              onChange={(e) => setPayrollEmpId(e.target.value)}
              className="w-full border rounded-xl p-2.5 font-bold"
            >
              {employees.length === 0 ? (
                <option value="">-- لا يوجد موظفون مسجلون بعد (يرجى إضافة موظف أولاً) --</option>
              ) : (
                employees.map(e => (
                  <option key={e.id} value={e.id}>{e.name} - الأساسي: {e.basicSalary}</option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="block font-bold mb-1">الخزينة المسدد منها الراتب:</label>
            <select
              value={payrollCashboxId}
              onChange={(e) => setPayrollCashboxId(e.target.value)}
              className="w-full border rounded-xl p-2.5 font-bold"
            >
              {cashboxes.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setIsPayrollModalOpen(false)} className="px-4 py-2 border rounded-xl font-bold">إلغاء</button>
            <button type="submit" className="px-6 py-2 bg-emerald-600 text-white rounded-xl font-bold">اعتماد وصرف الراتب</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
