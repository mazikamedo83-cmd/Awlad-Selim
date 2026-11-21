import React, { useState, useEffect } from 'react';
import {
  Plus, KeyRound, AlertCircle, CheckCircle2, Trash2
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { User, UserRole, UserPermissions } from '../../../types';
import { Modal } from '../../common/Modal';
import { ConfirmDialog } from '../../common/ConfirmDialog';

interface UsersManagementViewProps {
  initialTab?: 'users' | 'audit';
}

export const UsersManagementView: React.FC<UsersManagementViewProps> = ({ initialTab }) => {
  const { users, customers, auditLogs, addUser, updateUser, deleteUser } = useData();
  const { currentUser } = useAuth();

  const [activeTab, setActiveTab] = useState<'users' | 'audit'>(initialTab || 'users');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  // Form states
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('sales');
  const [linkedCustomerId, setLinkedCustomerId] = useState('');
  const [jobTitle, setJobTitle] = useState('موظف مبيعات');
  const [department, setDepartment] = useState('المبيعات');
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const DEFAULT_PERMISSIONS: UserPermissions = {
    canView: true,
    canAdd: true,
    canEdit: false,
    canDelete: false,
    canPrint: true,
    canExport: false,
    canViewReports: false,
    canManageSales: true,
    canManagePurchases: false,
    canManageInventory: false,
    canManageWarehouses: false,
    canManageCashboxes: false,
    canManageAccounts: false,
    canManageReps: false,
    canManageTransfers: false,
    canManageEmployees: false,
    canManageSalaries: false,
    canManageUsers: false,
    canManageSettings: false,
    canAllowNegativeInventory: false,
    canApprove: false,
    canSend: true,
    canReceive: true,
    canReviewRepInvoices: false,
    canViewPersonalAccounts: false,
    canCreatePersonalTx: false,
    canEditPersonalTx: false,
    canApprovePersonalAdjustment: false,
    canCreateStockCount: false,
    canApproveStockCount: false,
    canCreateStockTransfer: false,
    canApproveStockTransfer: false,
    canExecuteStockTransfer: false,
    canViewDeletedInvoices: false,
  };

  const ROLE_PERMISSION_PRESETS: Record<UserRole, { jobTitle: string; department: string; perms: Partial<UserPermissions> }> = {
    admin: {
      jobTitle: 'مالك / مدير عام',
      department: 'الإدارة العامة',
      perms: {
        canView: true, canAdd: true, canEdit: true, canDelete: true, canPrint: true, canExport: true,
        canViewReports: true, canManageSales: true, canManagePurchases: true, canManageInventory: true,
        canManageWarehouses: true, canManageCashboxes: true, canManageAccounts: true, canManageReps: true,
        canManageTransfers: true, canManageEmployees: true, canManageSalaries: true, canManageUsers: true,
        canManageSettings: true, canApprove: true, canSend: true, canReceive: true, canReviewRepInvoices: true,
        canViewPersonalAccounts: true, canCreatePersonalTx: true, canEditPersonalTx: true,
        canApprovePersonalAdjustment: true, canCreateStockCount: true, canApproveStockCount: true,
        canCreateStockTransfer: true, canApproveStockTransfer: true, canExecuteStockTransfer: true,
        canViewDeletedInvoices: true,
      },
    },
    manager: {
      jobTitle: 'مدير فرع',
      department: 'الإدارة',
      perms: {
        canView: true, canAdd: true, canEdit: true, canDelete: false, canPrint: true, canExport: true,
        canViewReports: true, canManageSales: true, canManagePurchases: true, canManageInventory: true,
        canManageWarehouses: true, canManageCashboxes: true, canManageAccounts: true, canManageReps: true,
        canManageTransfers: true, canApprove: true, canSend: true, canReceive: true, canReviewRepInvoices: true,
        canCreateStockCount: true, canApproveStockCount: true, canCreateStockTransfer: true,
        canApproveStockTransfer: true, canExecuteStockTransfer: true, canViewDeletedInvoices: true,
      },
    },
    accountant: {
      jobTitle: 'محاسب مالي',
      department: 'الحسابات والمالية',
      perms: {
        canView: true, canAdd: true, canEdit: true, canPrint: true, canExport: true, canViewReports: true,
        canManageSales: true, canManagePurchases: true, canManageCashboxes: true, canManageAccounts: true,
        canManageSalaries: true, canApprove: true, canSend: true, canReceive: true, canReviewRepInvoices: true,
      },
    },
    sales: {
      jobTitle: 'موظف مبيعات',
      department: 'المبيعات',
      perms: {
        canView: true, canAdd: true, canPrint: true, canManageSales: true, canSend: true, canReceive: true,
      },
    },
    purchases: {
      jobTitle: 'موظف مشتريات',
      department: 'المشتريات والموردين',
      perms: {
        canView: true, canAdd: true, canEdit: true, canPrint: true, canExport: true,
        canManagePurchases: true, canManageInventory: true, canManageSales: false,
        canManageCashboxes: false, canManageUsers: false, canSend: true, canReceive: true,
      },
    },
    warehouse: {
      jobTitle: 'أمين مستودع',
      department: 'المخازن والمستودعات',
      perms: {
        canView: true, canAdd: true, canPrint: true, canManageInventory: true, canManageWarehouses: true,
        canManageSales: false, canCreateStockCount: true, canCreateStockTransfer: true,
        canExecuteStockTransfer: true, canSend: true, canReceive: true,
      },
    },
    representative: {
      jobTitle: 'مندوب مبيعات ميداني',
      department: 'المبيعات الخارجية',
      perms: {
        canView: true, canAdd: true, canPrint: true, canManageSales: true, canManageTransfers: true,
        canSend: true, canReceive: true,
      },
    },
    customer: {
      jobTitle: 'عميل بوابة الطلبات',
      department: 'العملاء',
      perms: {
        canView: true, canAdd: true, canPrint: true, canManageSales: false, canSend: true, canReceive: true,
      },
    },
  };

  const buildPresetPermissions = (targetRole: UserRole): UserPermissions => {
    const base: UserPermissions = Object.keys(DEFAULT_PERMISSIONS).reduce((acc, key) => {
      (acc as any)[key] = false;
      return acc;
    }, {} as UserPermissions);
    return {
      ...base,
      ...(ROLE_PERMISSION_PRESETS[targetRole]?.perms || {}),
    };
  };

  const [permissions, setPermissions] = useState<UserPermissions>(DEFAULT_PERMISSIONS);

  // Password reset modal
  const [resetModalUser, setResetModalUser] = useState<User | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);

  const handleOpenAdd = () => {
    setFullName('');
    setUsername('');
    setPassword('');
    setPhone('');
    setRole('sales');
    setLinkedCustomerId('');
    setJobTitle(ROLE_PERMISSION_PRESETS.sales.jobTitle);
    setDepartment(ROLE_PERMISSION_PRESETS.sales.department);
    setPermissions(buildPresetPermissions('sales'));
    setMustChangePassword(false);
    setFormError(null);
    setEditingUser(null);
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (u: User) => {
    setFullName(u.fullName);
    setUsername(u.username);
    setPassword('');
    setPhone(u.phone);
    setRole(u.role);
    const linkedCust = customers.find((c) => c.userId === u.id);
    setLinkedCustomerId(linkedCust?.id || '');
    setJobTitle(u.jobTitle);
    setDepartment(u.department);
    setPermissions({ ...DEFAULT_PERMISSIONS, ...(u.permissions || {}) });
    setMustChangePassword(Boolean(u.mustChangePassword));
    setFormError(null);
    setEditingUser(u);
    setIsAddModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!username.trim() || !fullName.trim()) {
      setFormError('يرجى إدخال الاسم الكامل واسم الدخول.');
      return;
    }
    if (!editingUser && password.trim().length < 6) {
      setFormError('يجب إدخال كلمة مرور لا تقل عن 6 أحرف للمستخدم الجديد.');
      return;
    }
    if (editingUser && password.trim().length > 0 && password.trim().length < 6) {
      setFormError('كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف.');
      return;
    }

    setIsSaving(true);
    try {
      if (editingUser) {
        const currentLinkedCustomer = customers.find((c) => c.userId === editingUser.id);
        const res = await updateUser(editingUser.id, {
          fullName: fullName.trim(),
          username: username.trim(),
          phone: phone.trim(),
          role,
          jobTitle,
          department,
          permissions,
          mustChangePassword,
          newPassword: password.trim() || undefined,
          linkedCustomerId: role === 'customer' && linkedCustomerId ? linkedCustomerId : undefined,
          autoCreateCustomerProfile: role === 'customer' && !linkedCustomerId && !currentLinkedCustomer,
        });
        if (!res.success) {
          setFormError(res.error || 'تعذر تحديث بيانات المستخدم');
          return;
        }
        setStatusMessage({ type: 'success', text: `تم تحديث بيانات وصلاحيات (${fullName.trim()}) بنجاح.` });
      } else {
        const res = await addUser({
          fullName: fullName.trim(),
          username: username.trim(),
          passwordHash: '',
          password: password.trim(),
          phone: phone.trim(),
          role,
          jobTitle,
          department,
          isActive: true,
          mustChangePassword,
          permissions,
          linkedCustomerId: role === 'customer' && linkedCustomerId ? linkedCustomerId : undefined,
          autoCreateCustomerProfile: role === 'customer' && !linkedCustomerId,
        });
        if (!res.success) {
          setFormError(res.error || 'تعذر إنشاء المستخدم');
          return;
        }
        setStatusMessage({
          type: 'success',
          text:
            role === 'customer'
              ? `تم إنشاء حساب العميل (${username.trim()}) وربطه بملف عميل تلقائياً بنجاح.`
              : `تم إنشاء حساب (${username.trim()}) بنجاح على السيرفر.`,
        });
      }
      setIsAddModalOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isResettingPassword) return;
    setResetError(null);
    if (!resetModalUser) return;
    if (resetNewPassword.trim().length < 6) {
      setResetError('كلمة المرور يجب أن تكون 6 أحرف على الأقل.');
      return;
    }
    setIsResettingPassword(true);
    try {
      const res = await updateUser(resetModalUser.id, { newPassword: resetNewPassword.trim() });
      if (!res.success) {
        setResetError(res.error || 'فشل تغيير كلمة المرور');
        return;
      }
      setStatusMessage({
        type: 'success',
        text: `تمت إعادة تعيين كلمة المرور للمستخدم (${resetModalUser.fullName}) بنجاح.`,
      });
      setResetModalUser(null);
      setResetNewPassword('');
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleDeleteUser = (u: User) => {
    setUserToDelete(u);
  };

  const handleConfirmDeleteUser = async () => {
    if (!userToDelete) return;
    setIsDeletingUser(true);
    try {
      const res = await deleteUser(userToDelete.id);
      if (!res.success) {
        setStatusMessage({ type: 'error', text: res.error || 'تعذر حذف المستخدم' });
      } else {
        setStatusMessage({ type: 'success', text: `تم حذف الحساب (${userToDelete.username}).` });
      }
      setUserToDelete(null);
    } finally {
      setIsDeletingUser(false);
    }
  };

  const togglePermission = (key: keyof UserPermissions) => {
    setPermissions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight">إدارة المستخدمين والصلاحيات وسجل الأمان</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            التحكم في حسابات الموظفين والعملاء، تحديد الصلاحيات على الخادم، ومراقبة سجل العمليات (Audit Log)
          </p>
        </div>

        {activeTab === 'users' && (
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-2 px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl text-xs font-black shadow-md cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة مستخدم جديد</span>
          </button>
        )}
      </div>

      {statusMessage && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between gap-2 ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button onClick={() => setStatusMessage(null)} className="underline text-[11px] cursor-pointer">
            إغلاق
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-200 text-xs font-bold gap-4">
        <button
          onClick={() => setActiveTab('users')}
          className={`pb-2.5 transition-colors border-b-2 cursor-pointer ${
            activeTab === 'users' ? 'border-blue-900 text-blue-950' : 'border-transparent text-slate-500'
          }`}
        >
          حسابات المستخدمين ({users.length})
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`pb-2.5 transition-colors border-b-2 cursor-pointer ${
            activeTab === 'audit' ? 'border-blue-900 text-blue-950' : 'border-transparent text-slate-500'
          }`}
        >
          سجل تدقيق العمليات ({auditLogs.length})
        </button>
      </div>

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50 font-bold border-b text-slate-700">
                  <th className="p-3">الاسم الكامل</th>
                  <th className="p-3">اسم المستخدم</th>
                  <th className="p-3">الدور / الرتبة</th>
                  <th className="p-3">الوظيفة والقسم</th>
                  <th className="p-3">رقم الهاتف</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">آخر دخول</th>
                  <th className="p-3 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="p-3 font-bold text-slate-900">{u.fullName}</td>
                    <td className="p-3 font-mono text-blue-900 font-bold">{u.username}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 text-[10px] font-bold">
                        {u.role === 'admin'
                          ? 'مالك / مدير عام'
                          : u.role === 'manager'
                          ? 'مدير'
                          : u.role === 'accountant'
                          ? 'محاسب'
                          : u.role === 'purchases'
                          ? 'موظف مشتريات'
                          : u.role === 'representative'
                          ? 'مندوب مبيعات'
                          : u.role === 'customer'
                          ? 'عميل - تطبيق العملاء'
                          : u.role === 'warehouse'
                          ? 'أمين مستودع'
                          : 'موظف مبيعات'}
                      </span>
                    </td>
                    <td className="p-3 text-slate-600">
                      {u.jobTitle} - {u.department}
                    </td>
                    <td className="p-3 font-mono">{u.phone}</td>
                    <td className="p-3">
                      <button
                        disabled={togglingUserId === u.id}
                        onClick={async () => {
                          if (togglingUserId) return;
                          setTogglingUserId(u.id);
                          try {
                            const res = await updateUser(u.id, { isActive: !u.isActive });
                            if (!res.success) {
                              setStatusMessage({ type: 'error', text: res.error || 'تعذر تغيير حالة الحساب' });
                            } else {
                              setStatusMessage({
                                type: 'success',
                                text: !u.isActive ? `تم تفعيل حساب (${u.fullName}).` : `تم إيقاف حساب (${u.fullName}).`,
                              });
                            }
                          } finally {
                            setTogglingUserId(null);
                          }
                        }}
                        className={`px-2 py-0.5 rounded-full font-bold text-[10px] cursor-pointer disabled:opacity-50 ${
                          u.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {togglingUserId === u.id ? '...' : u.isActive ? 'نشط' : 'معطل'}
                      </button>
                    </td>
                    <td className="p-3 text-slate-500 text-[11px]">
                      {u.lastLogin ? new Date(u.lastLogin).toLocaleDateString('ar-EG') : 'لم يدخل بعد'}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => handleOpenEdit(u)}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded font-bold cursor-pointer"
                          title="تعديل الصلاحيات"
                        >
                          الصلاحيات
                        </button>
                        <button
                          onClick={() => {
                            setResetError(null);
                            setResetNewPassword('');
                            setResetModalUser(u);
                          }}
                          className="p-1 text-slate-500 hover:text-blue-900 cursor-pointer"
                          title="إعادة تعيين كلمة المرور"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                        {currentUser?.id !== u.id && (
                          <button
                            onClick={() => handleDeleteUser(u)}
                            className="p-1 text-slate-400 hover:text-red-700 cursor-pointer"
                            title="حذف المستخدم"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Audit Log Tab */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50 font-bold border-b text-slate-700">
                  <th className="p-3">التاريخ والوقت</th>
                  <th className="p-3">المستخدم</th>
                  <th className="p-3">الوحدة / القسم</th>
                  <th className="p-3">الإجراء المنفذ</th>
                  <th className="p-3">تفاصيل العملية</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-400">
                      لا توجد سجلات بعد
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono text-slate-500">
                        {new Date(log.timestamp).toLocaleString('ar-EG')}
                      </td>
                      <td className="p-3 font-bold text-slate-900">{log.userName}</td>
                      <td className="p-3 font-semibold text-blue-900">{log.module}</td>
                      <td className="p-3 font-bold">{log.action}</td>
                      <td className="p-3 text-slate-600">{log.details}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit User Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title={editingUser ? `تعديل وصلاحيات: ${editingUser.fullName}` : 'إضافة حساب مستخدم جديد'}
        maxWidth="4xl"
      >
        <form onSubmit={handleSaveUser} className="space-y-4 text-xs">
          {formError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-3 rounded-xl border">
            <div>
              <label className="block font-bold mb-1">الاسم الكامل:</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full bg-white border rounded-xl p-2 font-bold"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">اسم الدخول (Username):</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-white border rounded-xl p-2 font-mono font-bold"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">كلمة المرور:</label>
              <input
                type="password"
                required={!editingUser}
                placeholder={editingUser ? 'اتركه فارغاً للإبقاء عليها' : '6 أحرف على الأقل'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white border rounded-xl p-2 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-bold mb-1">نوع الحساب / الدور:</label>
              <select
                value={role}
                onChange={(e) => {
                  const nextRole = e.target.value as UserRole;
                  setRole(nextRole);
                  if (!editingUser && ROLE_PERMISSION_PRESETS[nextRole]) {
                    setJobTitle(ROLE_PERMISSION_PRESETS[nextRole].jobTitle);
                    setDepartment(ROLE_PERMISSION_PRESETS[nextRole].department);
                    setPermissions(buildPresetPermissions(nextRole));
                  }
                }}
                className="w-full border rounded-xl p-2 font-bold"
              >
                <option value="admin">مالك / مدير عام (كامل الصلاحيات)</option>
                <option value="manager">مدير فرع</option>
                <option value="accountant">محاسب مالي</option>
                <option value="sales">موظف مبيعات</option>
                <option value="purchases">موظف مشتريات</option>
                <option value="warehouse">أمين مستودع</option>
                <option value="representative">مندوب مبيعات خارجي</option>
                <option value="customer">عميل - تطبيق العملاء</option>
              </select>
            </div>
            <div>
              <label className="block font-bold mb-1">المسمى الوظيفي:</label>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="w-full border rounded-xl p-2"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">رقم الهاتف:</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full border rounded-xl p-2 font-mono"
              />
            </div>
          </div>

          {role === 'customer' && (
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 space-y-1.5">
              <label className="block font-bold text-blue-950">ربط هذا الحساب بملف العميل مباشرة (1:1):</label>
              {editingUser && (() => {
                const alreadyLinked = customers.find((c) => c.userId === editingUser.id);
                if (alreadyLinked) {
                  return (
                    <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 font-bold">
                      مربوط حالياً بملف العميل: {alreadyLinked.name}{' '}
                      {alreadyLinked.shopName ? `(${alreadyLinked.shopName})` : ''} — {alreadyLinked.code}
                    </div>
                  );
                }
                return (
                  <div className="p-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 font-bold text-[11px]">
                    تنبيه: حساب العميل غير مربوط بملف عميل حالياً — اختر عميلاً من القائمة أو احفظ لإنشاء وربط ملف عميل تلقائياً.
                  </div>
                );
              })()}

              {(!editingUser || !customers.some((c) => c.userId === editingUser.id)) && (
                <select
                  value={linkedCustomerId}
                  onChange={(e) => setLinkedCustomerId(e.target.value)}
                  className="w-full bg-white border border-blue-300 rounded-xl p-2 font-bold"
                >
                  <option value="">-- إنشاء وربط ملف عميل جديد تلقائياً (مستحسن) --</option>
                  {customers
                    .filter((c) => !c.userId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.shopName ? `(${c.shopName})` : ''} — {c.phone}
                      </option>
                    ))}
                </select>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 cursor-pointer">
            <input
              type="checkbox"
              checked={mustChangePassword}
              onChange={(e) => setMustChangePassword(e.target.checked)}
              className="w-4 h-4 rounded text-blue-900"
            />
            <span className="font-bold text-amber-900">إلزام المستخدم بتغيير كلمة المرور عند تسجيل الدخول القادم</span>
          </label>

          {/* Granular Permissions Checkboxes */}
          <div className="space-y-2 border-t pt-3">
            <h4 className="font-black text-slate-800 text-sm">تخصيص الصلاحيات الفردية (Granular Permissions):</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-3 bg-slate-50 rounded-xl border">
              {[
                { key: 'canView', label: 'صلاحية العرض والقراءة' },
                { key: 'canAdd', label: 'صلاحية الإضافة والإنشاء' },
                { key: 'canEdit', label: 'صلاحية التعديل' },
                { key: 'canDelete', label: 'صلاحية الحذف والإلغاء' },
                { key: 'canPrint', label: 'صلاحية الطباعة' },
                { key: 'canExport', label: 'صلاحية تصدير Excel' },
                { key: 'canViewReports', label: 'الاطلاع على التقارير المالية' },
                { key: 'canManageSales', label: 'إدارة المبيعات وفواتير البيع' },
                { key: 'canManagePurchases', label: 'إدارة المشتريات والموردين' },
                { key: 'canManageInventory', label: 'إدارة المخزون والأصناف' },
                { key: 'canManageWarehouses', label: 'إدارة المستودعات والتحويلات' },
                { key: 'canManageCashboxes', label: 'إدارة الخزائن والحسابات' },
                { key: 'canManageTransfers', label: 'نظام طلب تحويل بالنصف' },
                { key: 'canApprove', label: 'اعتماد العمليات والمستندات' },
                { key: 'canReviewRepInvoices', label: 'مراجعة واعتماد فواتير المناديب' },
                { key: 'canSend', label: 'صلاحية إرسال المزامنة Send' },
                { key: 'canReceive', label: 'صلاحية استلام المزامنة Receive' },
                { key: 'canManageEmployees', label: 'إدارة الموظفين والغياب' },
                { key: 'canManageSalaries', label: 'إدارة وصرف الرواتب' },
                { key: 'canManageUsers', label: 'إدارة حسابات المستخدمين' },
                { key: 'canManageSettings', label: 'إعدادات النظام والنسخ الاحتياطي' },
                { key: 'canAllowNegativeInventory', label: 'السماح بالبيع بالسالب عند نفاد الرصيد' },
                { key: 'canViewPersonalAccounts', label: 'عرض الحسابات الشخصية للملاك' },
                { key: 'canCreatePersonalTx', label: 'تسجيل سحب/إيداع في الحسابات الشخصية' },
                { key: 'canEditPersonalTx', label: 'تعديل حركات الحسابات الشخصية' },
                { key: 'canApprovePersonalAdjustment', label: 'اعتماد تسويات الحسابات الشخصية' },
                { key: 'canCreateStockCount', label: 'إنشاء وتقديم جرد المخزن' },
                { key: 'canApproveStockCount', label: 'اعتماد ورفض جرد المخزن' },
                { key: 'canCreateStockTransfer', label: 'إنشاء أوامر تحويل الأصناف' },
                { key: 'canApproveStockTransfer', label: 'اعتماد أوامر تحويل الأصناف' },
                { key: 'canExecuteStockTransfer', label: 'تنفيذ وترحيل تحويلات الأصناف' },
                { key: 'canViewDeletedInvoices', label: 'الاطلاع على الفواتير المحذوفة والملغاة' },
              ].map((perm) => (
                <label key={perm.key} className="flex items-center gap-2 p-1.5 rounded bg-white border border-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(permissions[perm.key as keyof UserPermissions])}
                    onChange={() => togglePermission(perm.key as keyof UserPermissions)}
                    className="w-4 h-4 rounded text-blue-900 focus:ring-blue-500"
                  />
                  <span className="font-semibold text-slate-800">{perm.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <button type="button" onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 border rounded-xl font-bold cursor-pointer">
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-2 bg-blue-900 text-white rounded-xl font-bold shadow-md disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? 'جاري الحفظ...' : 'حفظ الحساب'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Password Reset Modal */}
      {resetModalUser && (
        <Modal
          isOpen={!!resetModalUser}
          onClose={() => setResetModalUser(null)}
          title={`إعادة تعيين كلمة المرور لـ: ${resetModalUser.fullName}`}
          maxWidth="sm"
        >
          <form onSubmit={handleResetPassword} className="space-y-4 text-xs">
            {resetError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">
                {resetError}
              </div>
            )}
            <div>
              <label className="block font-bold mb-1">كلمة المرور الجديدة (6 أحرف على الأقل):</label>
              <input
                type="password"
                required
                placeholder="أدخل كلمة المرور الجديدة"
                value={resetNewPassword}
                onChange={(e) => setResetNewPassword(e.target.value)}
                className="w-full border rounded-xl p-2.5 font-mono"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={() => setResetModalUser(null)} className="px-4 py-2 border rounded-xl font-bold cursor-pointer">
                إلغاء
              </button>
              <button type="submit" disabled={isResettingPassword} className="px-6 py-2 bg-blue-900 text-white rounded-xl font-bold cursor-pointer disabled:opacity-50">
                {isResettingPassword ? 'جاري الحفظ...' : 'حفظ كلمة المرور'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmDialog
        isOpen={!!userToDelete}
        onClose={() => !isDeletingUser && setUserToDelete(null)}
        onConfirm={handleConfirmDeleteUser}
        variant="danger"
        isLoading={isDeletingUser}
        title="تأكيد حذف حساب المستخدم"
        message={userToDelete ? `هل أنت متأكد من حذف حساب المستخدم (${userToDelete.fullName} - ${userToDelete.username}) نهائياً؟` : ''}
        confirmLabel="حذف الحساب"
      />
    </div>
  );
};
