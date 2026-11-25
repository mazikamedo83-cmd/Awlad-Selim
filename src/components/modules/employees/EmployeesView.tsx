import React, { useState, useMemo } from 'react';
import {
  CheckCircle2, AlertCircle, Edit, UserX, UserCheck, Link2
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { Employee } from '../../../types';
import { Modal } from '../../common/Modal';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';

export const EmployeesView: React.FC = () => {
  const {
    employees, users, representatives, addEmployee, updateEmployee
  } = useData();

  const [empDeptFilter, setEmpDeptFilter] = useState<string>('all');
  const [empStatusFilter, setEmpStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add / Edit Employee Modal
  const [isEmpModalOpen, setIsEmpModalOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [empName, setEmpName] = useState('');
  const [empPhone, setEmpPhone] = useState('');
  const [empJob, setEmpJob] = useState('');
  const [empDept, setEmpDept] = useState('');
  const [empNationalId, setEmpNationalId] = useState('');
  const [empUserId, setEmpUserId] = useState('');
  const [empStatus, setEmpStatus] = useState<'active' | 'suspended'>('active');
  const [empNotes, setEmpNotes] = useState('');
  const [empError, setEmpError] = useState<string | null>(null);
  const [isSavingEmp, setIsSavingEmp] = useState(false);
  const [busyEmpActionId, setBusyEmpActionId] = useState<string | null>(null);

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status !== 'suspended'),
    [employees]
  );

  const suspendedCount = useMemo(
    () => employees.filter((e) => e.status === 'suspended').length,
    [employees]
  );

  const linkedAccountsCount = useMemo(
    () =>
      employees.filter(
        (e) => Boolean(e.userId) || users.some((u) => u.employeeId === e.id || (e.userId && u.id === e.userId))
      ).length,
    [employees, users]
  );

  const employeeDepartments = useMemo(() => {
    const depts = new Set<string>();
    employees.forEach((e) => {
      if (e.department?.trim()) depts.add(e.department.trim());
    });
    return Array.from(depts);
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      if (empDeptFilter !== 'all' && (emp.department || '').trim() !== empDeptFilter) return false;
      if (empStatusFilter === 'active') return emp.status !== 'suspended';
      if (empStatusFilter === 'suspended') return emp.status === 'suspended';
      return true;
    });
  }, [employees, empDeptFilter, empStatusFilter]);

  const openAddEmployeeModal = () => {
    setEditingEmp(null);
    setEmpName('');
    setEmpPhone('');
    setEmpJob('');
    setEmpDept('');
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
        const previouslyLinkedUser =
          Boolean(editingEmp.userId) ||
          users.some((u) => u.employeeId === editingEmp.id || u.id === editingEmp.userId);
        const res = await updateEmployee(editingEmp.id, {
          name: empName.trim(),
          phone: empPhone.trim(),
          jobTitle: empJob.trim(),
          department: empDept.trim(),
          basicSalary: Number(editingEmp.basicSalary ?? 0),
          nationalId: empNationalId.trim() || undefined,
          userId: empUserId ? empUserId : previouslyLinkedUser ? null : undefined,
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
          basicSalary: 0,
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

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white px-2.5 py-2 rounded-lg border border-slate-200">
        <div>
          <h2 className="text-sm font-black text-slate-900 tracking-tight">إدارة شؤون الموظفين</h2>
          <p className="text-[11px] text-slate-500">
            سجلات الموظفين والكادر الوظيفي والربط الوظيفي الموحد مع حسابات الدخول
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={openAddEmployeeModal}
            className="h-8 px-2.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md text-xs font-black cursor-pointer"
          >
            + إضافة موظف
          </button>
        </div>
      </div>

      {actionMessage && (
        <div
          className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center justify-between gap-2 ${
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
          <button type="button" onClick={() => setActionMessage(null)} className="underline text-[11px] cursor-pointer">
            إغلاق
          </button>
        </div>
      )}

      {/* Compact Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-slate-200 dark:bg-[#21375C] border border-slate-200 dark:border-[#21375C] rounded-lg overflow-hidden text-xs">
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">الموظفون النشطون</div>
          <div className="text-sm font-black font-mono tabular-nums text-[var(--awlad-navy-950)] dark:text-[#F3F7FC]">
            {activeEmployees.length} <span className="text-[10px] font-sans text-slate-500 dark:text-[#97AECE]">من أصل {employees.length}</span>
          </div>
        </div>
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">الموظفون الموقوفون</div>
          <div className="text-sm font-black font-mono tabular-nums text-slate-700 dark:text-[#DCE6F5]">
            {suspendedCount}
          </div>
        </div>
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-1.5">
          <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">مربوطون بحساب مستخدم</div>
          <div className="text-sm font-black font-mono tabular-nums text-[var(--awlad-royal-700)] dark:text-[#85B8FF]">
            {linkedAccountsCount}
          </div>
        </div>
      </div>

      {/* Employees Table */}
      <UnifiedDataTable<Employee>
        title={`سجل الموظفين (${filteredEmployees.length})`}
        data={filteredEmployees}
        rowKey={(emp) => emp.id}
        onRowClick={(emp) => openEditEmployeeModal(emp)}
        compact
        searchPlaceholder="بحث باسم الموظف أو الكود أو المسمى الوظيفي أو الهاتف..."
        exportFilename="AWLAD_SELIM_Employees"
        pdfTitle="قائمة الموظفين والكادر الوظيفي"
        emptyTitle="لا يوجد موظفون مطابقون"
        emptySubtitle={'انقر على زر "+ إضافة موظف" للبدء بتسجيل بيانات الكادر الوظيفي والربط مع الحسابات.'}
        toolbarFilters={
          <div className="flex flex-nowrap items-center gap-1.5 shrink-0">
            <select
              aria-label="تصفية بالقسم"
              value={empDeptFilter}
              onChange={(e) => setEmpDeptFilter(e.target.value)}
              className="h-8 shrink-0 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-2 text-xs font-bold text-slate-800 dark:text-[#EEF4FC]"
            >
              <option value="all">كل الأقسام</option>
              {employeeDepartments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <select
              aria-label="تصفية بالحالة"
              value={empStatusFilter}
              onChange={(e) => setEmpStatusFilter(e.target.value as 'all' | 'active' | 'suspended')}
              className="h-8 shrink-0 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-2 text-xs font-bold text-slate-800 dark:text-[#EEF4FC]"
            >
              <option value="all">كل الحالات</option>
              <option value="active">نشط فقط</option>
              <option value="suspended">موقوف</option>
            </select>
          </div>
        }
        columns={[
          {
            key: 'code',
            header: 'الكود',
            sortValue: (e) => e.code,
            exportValue: (e) => e.code,
            render: (emp) => (
              <span className="font-mono text-[11px] font-bold text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 whitespace-nowrap">
                {emp.code}
              </span>
            ),
          },
          {
            key: 'name',
            header: 'الاسم والربط الوظيفي',
            sortValue: (e) => e.name,
            exportValue: (e) => e.name,
            render: (emp) => {
              const linkedUsr = users.find((u) => u.id === emp.userId || u.employeeId === emp.id);
              const linkedRep = representatives.find(
                (r) =>
                  (emp.identityId && r.identityId === emp.identityId) ||
                  (linkedUsr && r.userId === linkedUsr.id)
              );
              return (
                <div className="space-y-0.5">
                  <div className="font-black text-slate-900">{emp.name}</div>
                  <div className="flex flex-wrap items-center gap-1">
                    {linkedUsr && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5]">
                        @{linkedUsr.username}
                      </span>
                    )}
                    {linkedRep && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#DCE6F5] text-[#002160] border border-[#B8CAE8]">
                        مندوب ميداني
                      </span>
                    )}
                  </div>
                </div>
              );
            },
          },
          {
            key: 'jobTitle',
            header: 'المسمى والقسم',
            sortValue: (e) => `${e.jobTitle} ${e.department}`,
            exportValue: (e) => `${e.jobTitle} - ${e.department}`,
            render: (emp) => (
              <div>
                <div className="font-bold text-slate-800">{emp.jobTitle || '—'}</div>
                <div className="text-[11px] text-slate-500">{emp.department || '—'}</div>
              </div>
            ),
          },
          {
            key: 'phone',
            header: 'الهاتف',
            sortValue: (e) => e.phone || '',
            exportValue: (e) => e.phone || '',
            render: (emp) => (
              <span className="font-mono tabular-nums text-slate-600" dir="ltr">
                {emp.phone || '—'}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'الحالة',
            align: 'center',
            sortValue: (e) => e.status,
            exportValue: (e) => (e.status === 'active' ? 'نشط' : 'موقوف'),
            render: (emp) => (
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                  emp.status === 'active'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-red-50 text-red-800 border-red-200'
                }`}
              >
                {emp.status === 'active' ? 'نشط' : 'موقوف'}
              </span>
            ),
          },
          {
            key: 'actions',
            header: 'الإجراءات',
            align: 'center',
            sortable: false,
            render: (emp) => (
              <div className="flex items-center justify-center gap-1 flex-wrap">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditEmployeeModal(emp);
                  }}
                  title="تعديل بيانات الموظف"
                  className="p-1 rounded-md text-slate-500 hover:text-blue-900 hover:bg-blue-50 cursor-pointer"
                >
                  <Edit className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={busyEmpActionId === emp.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleEmployeeStatus(emp);
                  }}
                  title={emp.status === 'active' ? 'إيقاف الموظف' : 'تفعيل الموظف'}
                  className={`p-1 rounded-md cursor-pointer disabled:opacity-40 ${
                    emp.status === 'active' ? 'text-red-500 hover:bg-red-50' : 'text-emerald-600 hover:bg-emerald-50'
                  }`}
                >
                  {emp.status === 'active' ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                </button>
              </div>
            ),
          },
        ]}
      />

      {/* Add / Edit Employee Modal */}
      <Modal
        isOpen={isEmpModalOpen}
        onClose={() => setIsEmpModalOpen(false)}
        title={editingEmp ? `تعديل بيانات الموظف: ${editingEmp.name}` : 'إضافة موظف جديد'}
        maxWidth="md"
      >
        <form onSubmit={handleEmployeeSubmit} className="space-y-2 text-xs">
          {empError && (
            <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold">{empError}</div>
          )}

          <div>
            <label className="block text-[11px] font-bold mb-0.5">اسم الموظف الثلاثي:</label>
            <input
              type="text"
              required
              value={empName}
              onChange={(e) => setEmpName(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold mb-0.5">رقم الهاتف:</label>
              <input
                type="tel"
                required
                value={empPhone}
                onChange={(e) => setEmpPhone(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold mb-0.5">الرقم القومي (اختياري):</label>
              <input
                type="text"
                value={empNationalId}
                onChange={(e) => setEmpNationalId(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2 font-mono"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold mb-0.5">المسمى الوظيفي:</label>
              <input
                type="text"
                required
                placeholder="أدخل المسمى الوظيفي"
                value={empJob}
                onChange={(e) => setEmpJob(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold mb-0.5">القسم:</label>
              <input
                type="text"
                required
                placeholder="أدخل القسم"
                value={empDept}
                onChange={(e) => setEmpDept(e.target.value)}
                className="w-full h-8 border border-slate-300 rounded-md px-2"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold mb-0.5">الحالة:</label>
            <select
              value={empStatus}
              onChange={(e) => setEmpStatus(e.target.value as 'active' | 'suspended')}
              className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold bg-white"
            >
              <option value="active">نشط (على رأس العمل)</option>
              <option value="suspended">موقوف</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold mb-0.5 flex items-center gap-1">
              <Link2 className="w-3.5 h-3.5 text-[#003589]" />
              <span>ربط بحساب مستخدم دخول للنظام (اختياري):</span>
            </label>
            <select
              value={empUserId}
              onChange={(e) => setEmpUserId(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold bg-slate-50"
            >
              <option value="">-- بدون ربط بحساب مستخدم --</option>
              {users
                .filter((u) => {
                  if (u.role === 'customer') return false;
                  const claimedByOtherEmployee = employees.some(
                    (e) => e.id !== editingEmp?.id && e.userId === u.id
                  );
                  const linkedToCurrentEditing = Boolean(
                    editingEmp && (u.employeeId === editingEmp.id || u.id === editingEmp.userId)
                  );
                  return linkedToCurrentEditing || (!u.employeeId && !claimedByOtherEmployee);
                })
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} (@{u.username}) — {u.role}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold mb-0.5">ملاحظات:</label>
            <input
              type="text"
              value={empNotes}
              onChange={(e) => setEmpNotes(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2"
            />
          </div>
          <div className="flex justify-end gap-1.5 pt-2 border-t">
            <button type="button" onClick={() => setIsEmpModalOpen(false)} className="h-8 px-2.5 border border-slate-300 rounded-md font-bold cursor-pointer">
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSavingEmp}
              className="h-8 px-3 bg-blue-900 text-white rounded-md font-bold disabled:opacity-50 cursor-pointer"
            >
              {isSavingEmp ? 'جاري الحفظ...' : editingEmp ? 'حفظ التعديلات' : 'حفظ الموظف'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
