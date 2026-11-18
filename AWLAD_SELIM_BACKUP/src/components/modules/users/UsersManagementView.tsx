import React, { useState, useMemo } from 'react';
import { 
  Users, Plus, Shield, KeyRound, Check, X, Lock, 
  UserCheck, UserX, Clock, Eye, AlertCircle 
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { User, UserRole, UserPermissions } from '../../../types';
import { hashPassword, getAuditLogs } from '../../../services/storage';
import { Modal } from '../../common/Modal';

export const UsersManagementView: React.FC = () => {
  const { users, addUser, updateUser, deleteUser } = useData();
  const { currentUser } = useAuth();

  const [activeTab, setActiveTab] = useState<'users' | 'audit'>('users');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  // Form states
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('sales');
  const [jobTitle, setJobTitle] = useState('موظف مبيعات');
  const [department, setDepartment] = useState('المبيعات');
  const [permissions, setPermissions] = useState<UserPermissions>({
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
  });

  // Password reset modal
  const [resetModalUser, setResetModalUser] = useState<User | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState('');

  const auditLogs = useMemo(() => getAuditLogs(), [activeTab]);

  const handleOpenAdd = () => {
    setFullName('');
    setUsername('');
    setPassword('123456');
    setPhone('');
    setRole('sales');
    setJobTitle('موظف مبيعات');
    setDepartment('المبيعات');
    setEditingUser(null);
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (u: User) => {
    setFullName(u.fullName);
    setUsername(u.username);
    setPassword('');
    setPhone(u.phone);
    setRole(u.role);
    setJobTitle(u.jobTitle);
    setDepartment(u.department);
    setPermissions(u.permissions);
    setEditingUser(u);
    setIsAddModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !fullName.trim()) return;

    if (editingUser) {
      const updates: Partial<User> = {
        fullName,
        username,
        phone,
        role,
        jobTitle,
        department,
        permissions,
      };
      if (password.trim()) {
        updates.passwordHash = await hashPassword(password.trim());
      }
      await updateUser(editingUser.id, updates);
    } else {
      const pwHash = await hashPassword(password.trim() || '123456');
      await addUser({
        fullName,
        username,
        passwordHash: pwHash,
        phone,
        role,
        jobTitle,
        department,
        isActive: true,
        permissions,
      });
    }

    setIsAddModalOpen(false);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModalUser || !resetNewPassword.trim()) return;
    const newHash = await hashPassword(resetNewPassword.trim());
    await updateUser(resetModalUser.id, { passwordHash: newHash });
    alert(`تمت إعادة تعيين كلمة المرور بنجاح للمستخدم: ${resetModalUser.fullName}`);
    setResetModalUser(null);
    setResetNewPassword('');
  };

  const togglePermission = (key: keyof UserPermissions) => {
    setPermissions(prev => ({
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
            التحكم في حسابات الموظفين، تحديد الصلاحيات بدقة، ومراقبة سجل العمليات (Audit Log)
          </p>
        </div>

        {activeTab === 'users' && (
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-2 px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl text-xs font-black shadow-md"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة مستخدم جديد</span>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 text-xs font-bold gap-4">
        <button
          onClick={() => setActiveTab('users')}
          className={`pb-2.5 transition-colors border-b-2 ${
            activeTab === 'users' ? 'border-blue-900 text-blue-950' : 'border-transparent text-slate-500'
          }`}
        >
          حسابات المستخدمين ({users.length})
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`pb-2.5 transition-colors border-b-2 ${
            activeTab === 'audit' ? 'border-blue-900 text-blue-950' : 'border-transparent text-slate-500'
          }`}
        >
          سجل تدقيق العمليات (Audit Trail)
        </button>
      </div>

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
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
              {users.map(u => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="p-3 font-bold text-slate-900">{u.fullName}</td>
                  <td className="p-3 font-mono text-blue-900 font-bold">{u.username}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 text-[10px] font-bold">
                      {u.role === 'admin' ? 'مالك / مدير عام' :
                       u.role === 'manager' ? 'مدير' :
                       u.role === 'accountant' ? 'محاسب' :
                       u.role === 'representative' ? 'مندوب مبيعات' :
                       u.role === 'customer' ? 'عميل - تطبيق العملاء' :
                       u.role === 'warehouse' ? 'أمين مستودع' : 'موظف مبيعات'}
                    </span>
                  </td>
                  <td className="p-3 text-slate-600">{u.jobTitle} - {u.department}</td>
                  <td className="p-3 font-mono">{u.phone}</td>
                  <td className="p-3">
                    <button
                      onClick={() => updateUser(u.id, { isActive: !u.isActive })}
                      className={`px-2 py-0.5 rounded-full font-bold text-[10px] cursor-pointer ${
                        u.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {u.isActive ? 'نشط' : 'معطل'}
                    </button>
                  </td>
                  <td className="p-3 text-slate-500 text-[11px]">
                    {u.lastLogin ? new Date(u.lastLogin).toLocaleDateString('ar-EG') : 'لم يدخل بعد'}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => handleOpenEdit(u)}
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded font-bold"
                        title="تعديل الصلاحيات"
                      >
                        الصلاحيات
                      </button>
                      <button
                        onClick={() => setResetModalUser(u)}
                        className="p-1 text-slate-500 hover:text-blue-900"
                        title="إعادة تعيين كلمة المرور"
                      >
                        <KeyRound className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Audit Log Tab */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
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
                auditLogs.map(log => (
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
      )}

      {/* Add / Edit User Modal with Granular Permissions */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title={editingUser ? `تعديل وصلاحيات: ${editingUser.fullName}` : 'إضافة حساب مستخدم جديد'}
        maxWidth="4xl"
      >
        <form onSubmit={handleSaveUser} className="space-y-4 text-xs">
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
                placeholder={editingUser ? 'اتركه فارغاً للإبقاء عليها' : 'كلمة المرور'}
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
                onChange={(e) => setRole(e.target.value as any)}
                className="w-full border rounded-xl p-2 font-bold"
              >
                <option value="admin">مالك / مدير عام (كامل الصلاحيات)</option>
                <option value="manager">مدير فرع</option>
                <option value="accountant">محاسب مالي</option>
                <option value="sales">موظف مبيعات</option>
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

          {/* Granular Permissions Checkboxes (Requirement 3) */}
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
                { key: 'canManageEmployees', label: 'إدارة الموظفين والغياب' },
                { key: 'canManageSalaries', label: 'إدارة وصرف الرواتب' },
                { key: 'canManageUsers', label: 'إدارة حسابات المستخدمين' },
                { key: 'canManageSettings', label: 'إعدادات النظام والنسخ الاحتياطي' },
                { key: 'canAllowNegativeInventory', label: 'السماح بالبيع بالسالب عند نفاد الرصيد' },
              ].map(perm => (
                <label key={perm.key} className="flex items-center gap-2 p-1.5 rounded bg-white border border-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={permissions[perm.key as keyof UserPermissions]}
                    onChange={() => togglePermission(perm.key as keyof UserPermissions)}
                    className="w-4 h-4 rounded text-blue-900 focus:ring-blue-500"
                  />
                  <span className="font-semibold text-slate-800">{perm.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <button type="button" onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 border rounded-xl font-bold">إلغاء</button>
            <button type="submit" className="px-6 py-2 bg-blue-900 text-white rounded-xl font-bold shadow-md">حفظ الحساب</button>
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
            <div>
              <label className="block font-bold mb-1">كلمة المرور الجديدة:</label>
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
              <button type="button" onClick={() => setResetModalUser(null)} className="px-4 py-2 border rounded-xl font-bold">إلغاء</button>
              <button type="submit" className="px-6 py-2 bg-blue-900 text-white rounded-xl font-bold">حفظ كلمة المرور</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
