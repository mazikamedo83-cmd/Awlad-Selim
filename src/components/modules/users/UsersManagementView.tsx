import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus, KeyRound, AlertCircle, CheckCircle2, Trash2, Shield, RotateCcw, Save, Link2, GitMerge, RefreshCw, AlertTriangle, UserCheck
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { AuditLogItem, IdentityEntityType, UnifiedIdentity, User, UserRole, UserPermissions } from '../../../types';
import { Modal } from '../../common/Modal';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { SearchableFilterSelect } from '../../common/SearchableFilterSelect';
import { UnifiedDataTable, UnifiedColumn } from '../../common/UnifiedDataTable';

interface UsersManagementViewProps {
  initialTab?: 'users' | 'audit' | 'presets' | 'identities';
}

const REP_SAFE_PRESET_KEYS: Array<{ key: keyof UserPermissions; label: string; locked?: boolean }> = [
  { key: 'canView', label: 'العرض والقراءة الأساسية للبوابة (إلزامي)', locked: true },
  { key: 'canAdd', label: 'إضافة عملاء جدد وعروض وفواتير بيع' },
  { key: 'canEdit', label: 'تعديل بيانات العملاء ومسوّدات فواتير الشراء الخاصة به' },
  { key: 'canDelete', label: 'حذف مسوّدات الشراء الخاصة به فقط' },
  { key: 'canPrint', label: 'طباعة الفواتير والإيصالات والتصدير PDF' },
  { key: 'canExport', label: 'تصدير التقارير والبيانات إلى Excel / CSV' },
  { key: 'canManageSales', label: 'إنشاء فواتير البيع ومرتجعات البيع والطلبات من عهدة السيارة' },
  { key: 'canCreatePurchase', label: 'إنشاء فواتير شراء مسودة وإرسالها للإدارة' },
  { key: 'canManageTransfers', label: 'نظام التحويل بالنصف والعهدة المالية للمندوب' },
  { key: 'canCreateStockTransfer', label: 'إنشاء أوامر وطلبات تحويل أصناف' },
  { key: 'canSend', label: 'إرسال البيانات والمزامنة للسيرفر (Send)' },
  { key: 'canReceive', label: 'استلام المزامنة والبيانات فقط (Sync Receive — لا يمنح استلام مشتريات المخزن)' },
  { key: 'canViewReports', label: 'عرض ملخصات مبيعات المندوب المسموحة (دون أرباح الشركة)' },
];

const CUSTOMER_SAFE_PRESET_KEYS: Array<{ key: keyof UserPermissions; label: string; locked?: boolean }> = [
  { key: 'canView', label: 'عرض الكتالوج والطلبات والفواتير وكشف الحساب الشخصي (إلزامي)', locked: true },
  { key: 'canPrint', label: 'طباعة الفواتير وكشف الحساب كملف PDF' },
  { key: 'canExport', label: 'تصدير كشف الحساب الشخصي Excel / CSV' },
  { key: 'canViewReports', label: 'عرض ملخص الرصيد وإجمالي المديونية والائتمان الشخصي' },
];

const ADMIN_ONLY_PERMISSION_KEYS = new Set<keyof UserPermissions>([
  'canManageUsers',
  'canManageSettings',
  'canManageEmployees',
  'canManageSalaries',
  'canManageCashboxes',
  'canManageAccounts',
  'canManageReps',
  'canManageInventory',
  'canManageWarehouses',
  'canManagePurchases',
  'canAllowNegativeInventory',
  'canViewPersonalAccounts',
  'canCreatePersonalTx',
  'canEditPersonalTx',
  'canApprovePersonalAdjustment',
  'canCreateStockCount',
  'canApproveStockCount',
  'canApproveStockTransfer',
  'canExecuteStockTransfer',
  'canViewDeletedInvoices',
  'canApprove',
  'canReviewRepInvoices',
]);

const CUSTOMER_ALLOWED_PERMISSION_KEYS = new Set<keyof UserPermissions>([
  'canView',
  'canPrint',
  'canExport',
  'canViewReports',
]);

export const UsersManagementView: React.FC<UsersManagementViewProps> = ({ initialTab }) => {
  const {
    users,
    customers,
    employees,
    representatives,
    suppliers,
    auditLogs,
    identities,
    identityRoles,
    identityConflicts,
    refreshIdentitiesOverview,
    runIdentityAudit,
    linkEntityToIdentity,
    resolveIdentityConflict,
    addUser,
    updateUser,
    deleteUser,
    permissionPresets,
    loadPermissionPresets,
    updatePermissionPresets,
  } = useData();
  const { currentUser } = useAuth();

  const [activeTab, setActiveTab] = useState<'users' | 'presets' | 'identities' | 'audit'>(initialTab || 'users');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);
  const [hasManualPermEdits, setHasManualPermEdits] = useState(false);
  const [isSavingPresets, setIsSavingPresets] = useState(false);
  const [previewIdentity, setPreviewIdentity] = useState<UnifiedIdentity | null>(null);
  const [previewAuditLog, setPreviewAuditLog] = useState<AuditLogItem | null>(null);

  // Unified Identity & Conflicts tab state
  const [isRunningAudit, setIsRunningAudit] = useState(false);
  const [isLoadingIdentities, setIsLoadingIdentities] = useState(false);
  const [identitySearch, setIdentitySearch] = useState('');
  const [linkTargetType, setLinkTargetType] = useState<IdentityEntityType>('user');
  const [linkTargetId, setLinkTargetId] = useState('');
  const [linkIdentityId, setLinkIdentityId] = useState('');
  const [linkEmployeeTargetId, setLinkEmployeeTargetId] = useState('');
  const [linkUserTargetId, setLinkUserTargetId] = useState('');
  const [isLinkingIdentity, setIsLinkingIdentity] = useState(false);
  const [conflictNotesById, setConflictNotesById] = useState<Record<string, string>>({});
  const [busyConflictId, setBusyConflictId] = useState<string | null>(null);

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
  const [linkedEmployeeId, setLinkedEmployeeId] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [department, setDepartment] = useState('');
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
    canCreatePurchase: false,
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
        canViewReports: true, canManageSales: true, canManagePurchases: true, canCreatePurchase: true, canManageInventory: true,
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
        canViewReports: true, canManageSales: true, canManagePurchases: true, canCreatePurchase: true, canManageInventory: true,
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
        canManageSales: true, canManagePurchases: true, canCreatePurchase: true, canManageCashboxes: true, canManageAccounts: true,
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
        canManagePurchases: true, canCreatePurchase: true, canManageInventory: true, canManageSales: false,
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
        canView: true, canAdd: true, canEdit: true, canPrint: true, canManageSales: true,
        canManagePurchases: false, canCreatePurchase: true, canManageTransfers: true,
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
    const livePreset =
      targetRole === 'representative'
        ? permissionPresets?.representative
        : targetRole === 'customer'
        ? permissionPresets?.customer
        : undefined;
    return {
      ...base,
      ...(livePreset || ROLE_PERMISSION_PRESETS[targetRole]?.perms || {}),
    };
  };

  const [permissions, setPermissions] = useState<UserPermissions>(DEFAULT_PERMISSIONS);
  const [repPresetDraft, setRepPresetDraft] = useState<UserPermissions>(() => buildPresetPermissions('representative'));
  const [customerPresetDraft, setCustomerPresetDraft] = useState<UserPermissions>(() => buildPresetPermissions('customer'));

  useEffect(() => {
    loadPermissionPresets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (permissionPresets?.representative) {
      setRepPresetDraft({
        ...Object.keys(DEFAULT_PERMISSIONS).reduce((a, k) => ({ ...a, [k]: false }), {} as UserPermissions),
        ...permissionPresets.representative,
        canView: true,
      });
    }
    if (permissionPresets?.customer) {
      setCustomerPresetDraft({
        ...Object.keys(DEFAULT_PERMISSIONS).reduce((a, k) => ({ ...a, [k]: false }), {} as UserPermissions),
        ...permissionPresets.customer,
        canView: true,
      });
    }
  }, [permissionPresets]);

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
    setLinkedEmployeeId('');
    setJobTitle(ROLE_PERMISSION_PRESETS.sales.jobTitle);
    setDepartment(ROLE_PERMISSION_PRESETS.sales.department);
    setPermissions(buildPresetPermissions('sales'));
    setHasManualPermEdits(false);
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
    const linkedEmp = employees.find((e) => e.id === u.employeeId || e.userId === u.id);
    setLinkedEmployeeId(linkedEmp?.id || u.employeeId || '');
    setJobTitle(u.jobTitle);
    setDepartment(u.department);
    setPermissions({ ...DEFAULT_PERMISSIONS, ...(u.permissions || {}) });
    setHasManualPermEdits(true);
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
        const hadLinkedEmployee = Boolean(
          editingUser.employeeId || employees.some((e) => e.userId === editingUser.id)
        );
        const nextLinkedEmployeePayload =
          role === 'customer'
            ? hadLinkedEmployee
              ? null
              : undefined
            : linkedEmployeeId
            ? linkedEmployeeId
            : hadLinkedEmployee
            ? null
            : undefined;
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
          linkedEmployeeId: nextLinkedEmployeePayload,
          autoCreateCustomerProfile: role === 'customer' && !linkedCustomerId && !currentLinkedCustomer,
          autoCreateRepProfile: role === 'representative',
          applyRolePreset: !hasManualPermEdits,
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
          linkedEmployeeId: role !== 'customer' && linkedEmployeeId ? linkedEmployeeId : undefined,
          autoCreateCustomerProfile: role === 'customer' && !linkedCustomerId,
          autoCreateRepProfile: role === 'representative',
          applyRolePreset: !hasManualPermEdits,
        });
        if (!res.success) {
          setFormError(res.error || 'تعذر إنشاء المستخدم');
          return;
        }
        setStatusMessage({
          type: 'success',
          text:
            role === 'customer'
              ? `تم إنشاء حساب العميل (${username.trim()}) وتفعيل صلاحياته وربطه بملف عميل تلقائياً بنجاح.`
              : role === 'representative'
              ? `تم إنشاء حساب المندوب (${username.trim()}) وتفعيل صلاحياته الميدانية وإنشاء ملف المندوب ومستودع السيارة تلقائياً بنجاح.`
              : `تم إنشاء حساب (${username.trim()}) وربطه بالهوية الموحدة بنجاح.`,
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

  const isPermissionLockedForRole = (key: keyof UserPermissions, targetRole: UserRole): boolean => {
    if (targetRole === 'representative') {
      return ADMIN_ONLY_PERMISSION_KEYS.has(key);
    }
    if (targetRole === 'customer') {
      return ADMIN_ONLY_PERMISSION_KEYS.has(key) || !CUSTOMER_ALLOWED_PERMISSION_KEYS.has(key);
    }
    return false;
  };

  const togglePermission = (key: keyof UserPermissions) => {
    if (isPermissionLockedForRole(key, role)) {
      return;
    }
    setHasManualPermEdits(true);
    setPermissions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSavePresets = async () => {
    setIsSavingPresets(true);
    setStatusMessage(null);
    try {
      const res = await updatePermissionPresets({
        representative: { ...repPresetDraft, canView: true },
        customer: { ...customerPresetDraft, canView: true },
      });
      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: 'تم حفظ قوالب الصلاحيات التلقائية (صلاحيات المندوب وصلاحيات العميل) وتطبيقها على كل تسجيل جديد.',
        });
      } else {
        setStatusMessage({ type: 'error', text: res.error || 'تعذر حفظ قوالب الصلاحيات التلقائية' });
      }
    } finally {
      setIsSavingPresets(false);
    }
  };

  const pendingConflictsCount = useMemo(
    () => identityConflicts.filter((c) => c.status === 'pending_review').length,
    [identityConflicts]
  );

  const linkTargetOptions = useMemo(() => {
    if (linkTargetType === 'user') {
      return users.map((u) => ({ value: u.id, label: u.fullName, subtitle: `@${u.username} • ${u.phone || ''}` }));
    }
    if (linkTargetType === 'employee') {
      return employees.map((e) => ({ value: e.id, label: e.name, subtitle: `${e.code} • ${e.jobTitle}` }));
    }
    if (linkTargetType === 'representative') {
      return representatives.map((r) => ({ value: r.id, label: r.name, subtitle: r.phone }));
    }
    if (linkTargetType === 'customer') {
      return customers.map((c) => ({ value: c.id, label: c.name, subtitle: `${c.code} • ${c.phone || ''}` }));
    }
    return suppliers.map((s) => ({ value: s.id, label: s.name, subtitle: `${s.code} • ${s.phone || ''}` }));
  }, [linkTargetType, users, employees, representatives, customers, suppliers]);

  const filteredIdentities = useMemo(() => {
    const q = identitySearch.trim().toLowerCase();
    if (!q) return identities;
    return identities.filter((idn) =>
      [idn.id, idn.fullName, idn.phone, idn.nationalId, idn.address]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [identities, identitySearch]);

  const handleRunIdentityAudit = async () => {
    setIsRunningAudit(true);
    setStatusMessage(null);
    try {
      const res = await runIdentityAudit(true);
      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: 'تم تنفيذ تدقيق الهويات الموحدة وحفظ نسخة احتياطية آمنة بنجاح دون دمج تلقائي غير مؤكد.',
        });
      } else {
        setStatusMessage({ type: 'error', text: res.error || 'تعذر تنفيذ التدقيق الآمن للهويات' });
      }
    } finally {
      setIsRunningAudit(false);
    }
  };

  const handleManualIdentityLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkTargetId) {
      setStatusMessage({ type: 'error', text: 'يرجى اختيار السجل المستهدف لربطه.' });
      return;
    }
    setIsLinkingIdentity(true);
    setStatusMessage(null);
    try {
      const res = await linkEntityToIdentity({
        targetType: linkTargetType,
        targetId: linkTargetId,
        identityId: linkIdentityId || null,
        linkEmployeeId: linkEmployeeTargetId || null,
        linkUserId: linkUserTargetId || null,
      });
      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: `تم ربط السجل بنجاح بالهوية الموحدة (${res.identityId || 'محدثة'}).`,
        });
        setLinkTargetId('');
        setLinkIdentityId('');
        setLinkEmployeeTargetId('');
        setLinkUserTargetId('');
      } else {
        setStatusMessage({ type: 'error', text: res.error || 'تعذر ربط السجل بالهوية الموحدة' });
      }
    } finally {
      setIsLinkingIdentity(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-white px-2.5 py-2 rounded-lg border border-slate-200">
        <div>
          <h2 className="text-sm font-black text-slate-900 tracking-tight">إدارة المستخدمين والصلاحيات وسجل الأمان</h2>
          <p className="text-[11px] text-slate-500">
            التحكم في حسابات الموظفين والعملاء، تحديد الصلاحيات على الخادم، ومراقبة سجل العمليات (Audit Log)
          </p>
        </div>

        {activeTab === 'users' && (
          <button
            onClick={handleOpenAdd}
            className="h-8 flex items-center gap-1.5 px-2.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md text-xs font-black cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>إضافة مستخدم جديد</span>
          </button>
        )}
      </div>

      {statusMessage && (
        <div
          className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center justify-between gap-2 ${
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
      <div className="flex flex-wrap border-b border-slate-200 text-xs font-bold gap-3">
        <button
          onClick={() => setActiveTab('users')}
          className={`pb-1.5 transition-colors border-b-2 cursor-pointer ${
            activeTab === 'users' ? 'border-[#003589] text-[#011E58]' : 'border-transparent text-slate-500'
          }`}
        >
          حسابات المستخدمين ({users.length})
        </button>
        <button
          onClick={() => setActiveTab('presets')}
          className={`pb-1.5 transition-colors border-b-2 cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'presets' ? 'border-[#003589] text-[#011E58]' : 'border-transparent text-slate-500'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>قوالب الصلاحيات التلقائية (المندوب / العميل)</span>
        </button>
        <button
          onClick={() => {
            setActiveTab('identities');
            setIsLoadingIdentities(true);
            refreshIdentitiesOverview().finally(() => setIsLoadingIdentities(false));
          }}
          className={`pb-1.5 transition-colors border-b-2 cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'identities' ? 'border-[#003589] text-[#011E58]' : 'border-transparent text-slate-500'
          }`}
        >
          <GitMerge className="w-3.5 h-3.5" />
          <span>الهويات الموحدة والتعارضات ({identities.length})</span>
          {pendingConflictsCount > 0 && (
            <span className="px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-800 text-[10px] font-black tabular-nums">
              {pendingConflictsCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`pb-1.5 transition-colors border-b-2 cursor-pointer ${
            activeTab === 'audit' ? 'border-[#003589] text-[#011E58]' : 'border-transparent text-slate-500'
          }`}
        >
          سجل تدقيق العمليات ({auditLogs.length})
        </button>
      </div>

      {/* Users Tab */}
      {activeTab === 'users' && (
        <UnifiedDataTable<User>
          compact
          title="حسابات المستخدمين والصلاحيات"
          subtitle={`إجمالي الحسابات: ${users.length}`}
          data={users}
          rowKey={(u) => u.id}
          onRowClick={(u) => handleOpenEdit(u)}
          searchPlaceholder="بحث بالاسم أو اسم الدخول أو الدور أو الهاتف..."
          exportFilename="AWLAD_SELIM_Users"
          pdfTitle="دليل المستخدمين والصلاحيات"
          defaultPageSize={25}
          emptyTitle="لا توجد حسابات مستخدمين"
          columns={[
            {
              key: 'fullName',
              header: 'الاسم الكامل والهوية',
              sortable: true,
              sortValue: (u) => u.fullName,
              exportValue: (u) => `${u.fullName}${u.identityId ? ` (${u.identityId})` : ''}`,
              render: (u) => (
                <div>
                  <div className="font-bold text-slate-900">{u.fullName}</div>
                  {u.identityId && (
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">هوية: {u.identityId}</div>
                  )}
                </div>
              ),
            },
            {
              key: 'username',
              header: 'اسم المستخدم',
              sortable: true,
              sortValue: (u) => u.username,
              exportValue: (u) => u.username,
              render: (u) => <span className="font-mono text-blue-900 font-bold">{u.username}</span>,
            },
            {
              key: 'role',
              header: 'الدور / الأدوار المرتبطة',
              sortable: true,
              sortValue: (u) => u.role,
              exportValue: (u) => u.role,
              render: (u) => {
                const linkedEmp = employees.find((e) => e.id === u.employeeId || e.userId === u.id);
                const linkedRep = representatives.find((r) => r.userId === u.id);
                const linkedCust = customers.find((c) => c.userId === u.id);
                return (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="px-2 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-800 text-[10px] font-bold">
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
                    {linkedEmp && (
                      <span className="px-2 py-0.5 rounded border border-[#DCE6F5] bg-[#EEF3FA] text-[#011E58] text-[10px] font-bold" title={`ملف موظف HR: ${linkedEmp.name}`}>
                        موظف HR: {linkedEmp.code}
                      </span>
                    )}
                    {linkedRep && (
                      <span className="px-2 py-0.5 rounded border border-[#B8CAE8] bg-[#DCE6F5] text-[#002160] text-[10px] font-bold">
                        ملف مندوب
                      </span>
                    )}
                    {linkedCust && (
                      <span className="px-2 py-0.5 rounded border border-slate-300 bg-slate-100 text-slate-800 text-[10px] font-bold">
                        عميل: {linkedCust.code}
                      </span>
                    )}
                  </div>
                );
              },
            },
            {
              key: 'jobTitle',
              header: 'الوظيفة والقسم',
              sortable: true,
              sortValue: (u) => `${u.jobTitle} ${u.department}`,
              exportValue: (u) => `${u.jobTitle} - ${u.department}`,
              render: (u) => <span className="text-slate-600">{u.jobTitle} - {u.department}</span>,
            },
            {
              key: 'phone',
              header: 'رقم الهاتف',
              sortable: true,
              sortValue: (u) => u.phone || '',
              exportValue: (u) => u.phone || '',
              render: (u) => <span className="font-mono tabular-nums">{u.phone || '-'}</span>,
            },
            {
              key: 'isActive',
              header: 'الحالة',
              align: 'center',
              sortable: true,
              sortValue: (u) => (u.isActive ? 1 : 0),
              exportValue: (u) => (u.isActive ? 'نشط' : 'معطل'),
              render: (u) => (
                <button
                  type="button"
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
                  className={`px-2 py-0.5 rounded border font-bold text-[10px] cursor-pointer disabled:opacity-50 ${
                    u.isActive ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
                  }`}
                >
                  {togglingUserId === u.id ? '...' : u.isActive ? 'نشط' : 'معطل'}
                </button>
              ),
            },
            {
              key: 'lastLogin',
              header: 'آخر دخول',
              sortable: true,
              sortValue: (u) => u.lastLogin || '',
              exportValue: (u) => (u.lastLogin ? new Date(u.lastLogin).toLocaleDateString('ar-EG') : 'لم يدخل بعد'),
              render: (u) => (
                <span className="text-slate-500 text-[11px] tabular-nums">
                  {u.lastLogin ? new Date(u.lastLogin).toLocaleDateString('ar-EG') : 'لم يدخل بعد'}
                </span>
              ),
            },
            {
              key: 'actions',
              header: 'الإجراءات',
              align: 'center',
              exportValue: () => '',
              render: (u) => (
                <div className="flex items-center justify-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(u)}
                    className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded-md font-bold text-[11px] cursor-pointer"
                    title="تعديل الصلاحيات"
                  >
                    الصلاحيات
                  </button>
                  <button
                    type="button"
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
                      type="button"
                      onClick={() => handleDeleteUser(u)}
                      className="p-1 text-slate-400 hover:text-red-700 cursor-pointer"
                      title="حذف المستخدم"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ),
            },
          ] as UnifiedColumn<User>[]}
        />
      )}

      {/* Presets Tab */}
      {activeTab === 'presets' && (
        <div className="space-y-2 text-xs">
          <div className="px-2.5 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-950 flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-0.5">
              <h3 className="text-xs font-black">القوالب التلقائية عند إنشاء أو تسجيل حساب مندوب أو عميل</h3>
              <p className="text-[11px] text-blue-800 leading-snug">
                يُطبق قالب «صلاحيات المندوب» أو «صلاحيات العميل» تلقائياً عند تسجيل الحساب من التطبيق أو لوحة الإدارة، مع إمكانية تعديل صلاحيات أي فرد لاحقاً.
              </p>
            </div>
            <button
              type="button"
              disabled={isSavingPresets}
              onClick={handleSavePresets}
              className="h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSavingPresets ? 'جاري الحفظ...' : 'حفظ قوالب الصلاحيات'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {/* Representative Preset Card */}
            <div className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <div>
                  <h4 className="text-xs font-black text-[#011E58]">«صلاحيات المندوب» الافتراضية</h4>
                  <p className="text-[11px] text-slate-500">الصلاحيات المسموحة والممنوحة تلقائياً لكل حساب مندوب جديد</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const base = Object.keys(DEFAULT_PERMISSIONS).reduce((a, k) => ({ ...a, [k]: false }), {} as UserPermissions);
                    setRepPresetDraft({ ...base, ...ROLE_PERMISSION_PRESETS.representative.perms, canView: true });
                  }}
                  className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>استعادة الافتراضي</span>
                </button>
              </div>
              <div className="space-y-1">
                {REP_SAFE_PRESET_KEYS.map((item) => (
                  <label
                    key={item.key}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-md border ${
                      item.locked ? 'bg-slate-50 border-slate-200 opacity-85' : 'bg-white border-slate-200 hover:border-[#003589] cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={item.locked}
                      checked={item.locked ? true : Boolean(repPresetDraft[item.key])}
                      onChange={() =>
                        setRepPresetDraft((prev) => ({
                          ...prev,
                          [item.key]: !prev[item.key],
                        }))
                      }
                      className="w-3.5 h-3.5 rounded text-blue-900"
                    />
                    <span className="font-bold text-slate-800">{item.label}</span>
                  </label>
                ))}
              </div>
              <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-900 font-bold">
                ملاحظة أمنية: تظل صلاحيات الإدارة والمستخدمين والخزائن وأرباح الشركة والاعتماد النهائي محجوبة تماماً عن قالب المندوب على السيرفر.
              </div>
            </div>

            {/* Customer Preset Card */}
            <div className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <div>
                  <h4 className="text-xs font-black text-blue-950">«صلاحيات العميل» الافتراضية</h4>
                  <p className="text-[11px] text-slate-500">الصلاحيات الممنوحة تلقائياً لكل حساب عميل بوابة جديد</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const base = Object.keys(DEFAULT_PERMISSIONS).reduce((a, k) => ({ ...a, [k]: false }), {} as UserPermissions);
                    setCustomerPresetDraft({ ...base, ...ROLE_PERMISSION_PRESETS.customer.perms, canView: true });
                  }}
                  className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>استعادة الافتراضي</span>
                </button>
              </div>
              <div className="space-y-1">
                {CUSTOMER_SAFE_PRESET_KEYS.map((item) => (
                  <label
                    key={item.key}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-md border ${
                      item.locked ? 'bg-slate-50 border-slate-200 opacity-85' : 'bg-white border-slate-200 hover:border-blue-300 cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={item.locked}
                      checked={item.locked ? true : Boolean(customerPresetDraft[item.key])}
                      onChange={() =>
                        setCustomerPresetDraft((prev) => ({
                          ...prev,
                          [item.key]: !prev[item.key],
                        }))
                      }
                      className="w-3.5 h-3.5 rounded text-blue-900"
                    />
                    <span className="font-bold text-slate-800">{item.label}</span>
                  </label>
                ))}
              </div>
              <div className="p-2 rounded-md bg-blue-50 border border-blue-200 text-[11px] text-blue-900 font-bold">
                ملاحظة أمنية: حساب العميل معزول بالكامل في بياناته وطلباته وفواتيره وكشف حسابه الشخصي ولا يمكنه الوصول لأي بيانات عملاء آخرين أو مالية الشركة.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unified Identities & Conflicts Tab */}
      {activeTab === 'identities' && (
        <div className="space-y-2 text-xs">
          <div className="bg-white rounded-lg border border-slate-200 px-2.5 py-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                <GitMerge className="w-4 h-4 text-blue-900" />
                <span>سجل الهويات الموحدة وإدارة تداخل السجلات</span>
              </h3>
              <p className="text-[11px] text-slate-500">
                يربط هذا النظام ملفات الموظفين والمستخدمين والمندوبين والعملاء والموردين تحت معرف هوية موحد مع الحفاظ على فصل القيود المالية والرواتب.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={isLoadingIdentities}
                onClick={() => {
                  setIsLoadingIdentities(true);
                  refreshIdentitiesOverview().finally(() => setIsLoadingIdentities(false));
                }}
                className="h-8 px-2.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingIdentities ? 'animate-spin' : ''}`} />
                <span>تحديث</span>
              </button>
              <button
                type="button"
                disabled={isRunningAudit}
                onClick={handleRunIdentityAudit}
                className="h-8 px-2.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>{isRunningAudit ? 'جاري الفحص الآمن...' : 'تشغيل التدقيق الآمن للهويات'}</span>
              </button>
            </div>
          </div>

          {/* Manual Link Form */}
          <form onSubmit={handleManualIdentityLink} className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-2">
            <h4 className="font-black text-slate-900 flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-[#003589]" />
              <span>ربط يدوي مؤكد بين سجل وهوية أو موظف / مستخدم</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
              <div>
                <label className="block font-bold text-slate-700 mb-1">نوع السجل الأساسي:</label>
                <select
                  value={linkTargetType}
                  onChange={(e) => {
                    setLinkTargetType(e.target.value as IdentityEntityType);
                    setLinkTargetId('');
                  }}
                  className="w-full h-[34px] border border-slate-300 rounded-md px-2 font-bold bg-white"
                >
                  <option value="user">حساب مستخدم</option>
                  <option value="employee">ملف موظف (HR)</option>
                  <option value="representative">مندوب مبيعات</option>
                  <option value="customer">عميل</option>
                  <option value="supplier">مورد</option>
                </select>
              </div>
              <div>
                <SearchableFilterSelect
                  label="السجل المطلوب ربطه"
                  value={linkTargetId || 'all'}
                  onChange={(val) => setLinkTargetId(val === 'all' ? '' : val)}
                  options={linkTargetOptions}
                  allOptionLabel="-- اختر السجل --"
                  allOptionValue="all"
                />
              </div>
              <div>
                <SearchableFilterSelect
                  label="ربط بهوية قائمة (اختياري)"
                  value={linkIdentityId || 'all'}
                  onChange={(val) => setLinkIdentityId(val === 'all' ? '' : val)}
                  options={identities.map((idn) => ({
                    value: idn.id,
                    label: idn.fullName,
                    subtitle: `${idn.id}${idn.phone ? ` • ${idn.phone}` : ''}`,
                  }))}
                  allOptionLabel="تلقائي / إنشاء جديد"
                  allOptionValue="all"
                />
              </div>
              <div>
                <SearchableFilterSelect
                  label="ربط بملف موظف (اختياري)"
                  value={linkEmployeeTargetId || 'all'}
                  onChange={(val) => setLinkEmployeeTargetId(val === 'all' ? '' : val)}
                  options={employees.map((e) => ({
                    value: e.id,
                    label: e.name,
                    subtitle: `${e.code} • ${e.jobTitle}`,
                  }))}
                  allOptionLabel="بدون تغيير"
                  allOptionValue="all"
                />
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <SearchableFilterSelect
                    label="ربط بمستخدم (اختياري)"
                    value={linkUserTargetId || 'all'}
                    onChange={(val) => setLinkUserTargetId(val === 'all' ? '' : val)}
                    options={users.map((u) => ({
                      value: u.id,
                      label: u.fullName,
                      subtitle: `@${u.username}`,
                    }))}
                    allOptionLabel="بدون تغيير"
                    allOptionValue="all"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLinkingIdentity || !linkTargetId}
                  className="h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black disabled:opacity-50 shrink-0 cursor-pointer"
                >
                  {isLinkingIdentity ? '...' : 'ربط'}
                </button>
              </div>
            </div>
          </form>

          {/* Identity Conflicts Review Section */}
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-2.5 py-2 border-b bg-amber-50/70 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-black text-amber-950">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>سجلات الاشتباه والتعارض ({identityConflicts.length})</span>
              </div>
              <span className="text-[11px] font-bold text-amber-800">
                قيد المراجعة: {pendingConflictsCount}
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {identityConflicts.length === 0 ? (
                <div className="p-3 text-center text-slate-400 font-bold">
                  لا توجد أي تعارضات أو اشتباهات مسجلة حالياً.
                </div>
              ) : (
                identityConflicts.map((cf) => (
                  <div key={cf.id} className="p-2.5 flex flex-col lg:flex-row lg:items-center justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-bold text-slate-600">{cf.id}</span>
                        <span className="px-2 py-0.5 rounded border border-slate-200 bg-slate-100 text-slate-800 font-bold text-[10px]">
                          {cf.conflictType}
                        </span>
                        {cf.identifierKey && (
                          <span className="font-mono text-[11px] text-blue-900 bg-blue-50 px-2 py-0.5 rounded">
                            المؤشر: {cf.identifierKey}
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded border font-bold text-[10px] ${
                            cf.status === 'pending_review'
                              ? 'bg-amber-50 border-amber-200 text-amber-800'
                              : cf.status === 'resolved'
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                              : 'bg-slate-200 border-slate-300 text-slate-700'
                          }`}
                        >
                          {cf.status === 'pending_review'
                            ? 'قيد المراجعة'
                            : cf.status === 'resolved'
                            ? 'تم الحل'
                            : 'مستبعد'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(cf.candidateRecords || []).map((cand, idx) => (
                          <span
                            key={`${cf.id}-cand-${idx}`}
                            className="px-2 py-0.5 rounded-md bg-slate-50 border border-slate-200 text-[11px] font-bold text-slate-800"
                          >
                            {cand.recordType}: {cand.name || cand.recordId}
                            {cand.phone ? ` (${cand.phone})` : ''}
                          </span>
                        ))}
                      </div>
                      {cf.resolutionNotes && (
                        <div className="text-[11px] text-slate-600">ملاحظة المعالجة: {cf.resolutionNotes}</div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <input
                        type="text"
                        value={conflictNotesById[cf.id] ?? ''}
                        onChange={(e) => setConflictNotesById((prev) => ({ ...prev, [cf.id]: e.target.value }))}
                        placeholder="ملاحظة قرار المراجعة..."
                        className="h-8 w-44 border border-slate-300 rounded-md px-2 text-xs"
                      />
                      <button
                        type="button"
                        disabled={busyConflictId === cf.id}
                        onClick={async () => {
                          setBusyConflictId(cf.id);
                          await resolveIdentityConflict(cf.id, {
                            status: 'resolved',
                            resolutionNotes: conflictNotesById[cf.id] || 'تم التحقق واعتماد الربط من الإدارة',
                          });
                          setBusyConflictId(null);
                        }}
                        className="h-8 px-2.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer disabled:opacity-50"
                      >
                        تأكيد الحل
                      </button>
                      <button
                        type="button"
                        disabled={busyConflictId === cf.id}
                        onClick={async () => {
                          setBusyConflictId(cf.id);
                          await resolveIdentityConflict(cf.id, {
                            status: 'dismissed',
                            resolutionNotes: conflictNotesById[cf.id] || 'شخصان مختلفان — مستبعد',
                          });
                          setBusyConflictId(null);
                        }}
                        className="h-8 px-2.5 rounded-md bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold cursor-pointer disabled:opacity-50"
                      >
                        تجاهل
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Unified Identities Directory */}
          <UnifiedDataTable
            title={`دليل الهويات الموحدة (${identities.length})`}
            data={filteredIdentities}
            rowKey={(idn) => idn.id}
            onRowClick={(idn) => setPreviewIdentity(idn)}
            searchValue={identitySearch}
            onSearchChange={setIdentitySearch}
            searchPlaceholder="بحث بالاسم أو الهاتف أو الرقم القومي أو معرف الهوية..."
            exportFilename="AWLAD_SELIM_UnifiedIdentities"
            pdfTitle="دليل الهويات الموحدة"
            defaultPageSize={25}
            compact
            emptyTitle="لا توجد هويات مطابقة"
            columns={[
              {
                key: 'id',
                header: 'معرف الهوية',
                sortable: true,
                sortValue: (idn) => idn.id,
                exportValue: (idn) => idn.id,
                render: (idn) => <span className="font-mono font-bold text-blue-900">{idn.id}</span>,
              },
              {
                key: 'fullName',
                header: 'الاسم الكامل',
                sortable: true,
                sortValue: (idn) => idn.fullName,
                exportValue: (idn) => idn.fullName,
                render: (idn) => <span className="font-bold text-slate-900">{idn.fullName}</span>,
              },
              {
                key: 'phone',
                header: 'الهاتف',
                sortable: true,
                sortValue: (idn) => idn.phone || '',
                exportValue: (idn) => idn.phone || '-',
                render: (idn) => <span className="font-mono tabular-nums">{idn.phone || '-'}</span>,
              },
              {
                key: 'nationalId',
                header: 'الرقم القومي',
                sortable: true,
                sortValue: (idn) => idn.nationalId || '',
                exportValue: (idn) => idn.nationalId || '-',
                render: (idn) => <span className="font-mono tabular-nums">{idn.nationalId || '-'}</span>,
              },
              {
                key: 'roles',
                header: 'السجلات والأدوار المرتبطة',
                exportValue: (idn) => {
                  const roles = idn.roles && idn.roles.length > 0 ? idn.roles : identityRoles.filter((r) => r.identityId === idn.id);
                  return roles.map((r) => `${r.linkedRecordType}:${r.linkedRecordId}`).join(', ');
                },
                render: (idn) => {
                  const roles = idn.roles && idn.roles.length > 0 ? idn.roles : identityRoles.filter((r) => r.identityId === idn.id);
                  return (
                    <div className="flex flex-wrap gap-1">
                      {roles.map((r) => (
                        <span
                          key={r.id}
                          className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-800 text-[10px] font-bold"
                        >
                          {r.linkedRecordType}: {r.linkedRecordId}
                        </span>
                      ))}
                    </div>
                  );
                },
              },
            ]}
          />
        </div>
      )}

      {/* Audit Log Tab */}
      {activeTab === 'audit' && (
        <UnifiedDataTable
          compact
          title="سجل تدقيق العمليات"
          subtitle={`إجمالي الأحداث المسجلة: ${auditLogs.length}`}
          data={auditLogs}
          rowKey={(log) => log.id}
          onRowClick={(log) => setPreviewAuditLog(log)}
          searchPlaceholder="بحث بالمستخدم أو الوحدة أو الإجراء أو التفاصيل..."
          exportFilename="AWLAD_SELIM_AuditLogs"
          pdfTitle="سجل تدقيق العمليات"
          defaultPageSize={25}
          emptyTitle="لا توجد سجلات بعد"
          columns={[
            {
              key: 'timestamp',
              header: 'التاريخ والوقت',
              sortable: true,
              sortValue: (log) => log.timestamp,
              exportValue: (log) => new Date(log.timestamp).toLocaleString('ar-EG'),
              render: (log) => (
                <span className="font-mono text-slate-500 tabular-nums">
                  {new Date(log.timestamp).toLocaleString('ar-EG')}
                </span>
              ),
            },
            {
              key: 'userName',
              header: 'المستخدم',
              sortable: true,
              sortValue: (log) => log.userName,
              exportValue: (log) => log.userName,
              render: (log) => <span className="font-bold text-slate-900">{log.userName}</span>,
            },
            {
              key: 'module',
              header: 'الوحدة / القسم',
              sortable: true,
              sortValue: (log) => log.module,
              exportValue: (log) => log.module,
              render: (log) => <span className="font-semibold text-blue-900">{log.module}</span>,
            },
            {
              key: 'action',
              header: 'الإجراء المنفذ',
              sortable: true,
              sortValue: (log) => log.action,
              exportValue: (log) => log.action,
              render: (log) => <span className="font-bold">{log.action}</span>,
            },
            {
              key: 'details',
              header: 'تفاصيل العملية',
              sortable: true,
              sortValue: (log) => log.details,
              exportValue: (log) => log.details,
              render: (log) => <span className="text-slate-600">{log.details}</span>,
            },
          ]}
        />
      )}

      {/* Add / Edit User Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title={editingUser ? `تعديل وصلاحيات: ${editingUser.fullName}` : 'إضافة حساب مستخدم جديد'}
        maxWidth="4xl"
      >
        <form onSubmit={handleSaveUser} className="space-y-2 text-xs">
          {formError && (
            <div className="px-2.5 py-1.5 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 p-2 rounded-lg border">
            <div>
              <label className="block text-[11px] font-bold mb-0.5">الاسم الكامل:</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full h-8 bg-white border rounded-md px-2 font-bold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold mb-0.5">اسم الدخول (Username):</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full h-8 bg-white border rounded-md px-2 font-mono font-bold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold mb-0.5">كلمة المرور:</label>
              <input
                type="password"
                required={!editingUser}
                placeholder={editingUser ? 'اتركه فارغاً للإبقاء عليها' : '6 أحرف على الأقل'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-8 bg-white border rounded-md px-2 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] font-bold mb-0.5">نوع الحساب / الدور:</label>
              <select
                value={role}
                onChange={(e) => {
                  const nextRole = e.target.value as UserRole;
                  setRole(nextRole);
                  if (ROLE_PERMISSION_PRESETS[nextRole] && (!editingUser || nextRole === 'representative' || nextRole === 'customer')) {
                    setJobTitle(ROLE_PERMISSION_PRESETS[nextRole].jobTitle);
                    setDepartment(ROLE_PERMISSION_PRESETS[nextRole].department);
                    setPermissions(buildPresetPermissions(nextRole));
                    setHasManualPermEdits(false);
                  }
                }}
                className="w-full h-8 border rounded-md px-2 font-bold bg-white"
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
              <label className="block text-[11px] font-bold mb-0.5">المسمى الوظيفي:</label>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="w-full h-8 border rounded-md px-2"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold mb-0.5">رقم الهاتف:</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full h-8 border rounded-md px-2 font-mono"
              />
            </div>
          </div>

          {role !== 'customer' && (
            <div className="p-2 rounded-lg bg-[#EEF3FA] border border-[#DCE6F5] space-y-1">
              <label className="block text-[11px] font-bold text-[#011E58]">ربط بسجل الموظف (HR) — لمنع تكرار الموظف وتوحيد الهوية:</label>
              <select
                value={linkedEmployeeId}
                onChange={(e) => {
                  const empId = e.target.value;
                  setLinkedEmployeeId(empId);
                  if (!editingUser && empId) {
                    const emp = employees.find((item) => item.id === empId);
                    if (emp) {
                      if (!fullName.trim()) setFullName(emp.name);
                      if (!phone.trim() && emp.phone) setPhone(emp.phone);
                      if (emp.jobTitle) setJobTitle(emp.jobTitle);
                      if (emp.department) setDepartment(emp.department);
                    }
                  }
                }}
                className="w-full h-8 bg-white border border-[#B8CAE8] rounded-md px-2 font-bold"
              >
                <option value="">-- بدون ربط بموظف / اختياري --</option>
                {employees
                  .filter((e) => {
                    const claimedByOtherUser = users.some(
                      (u) => u.id !== editingUser?.id && u.employeeId === e.id
                    );
                    const linkedToCurrentEditing = Boolean(
                      editingUser && (e.userId === editingUser.id || e.id === editingUser.employeeId)
                    );
                    return linkedToCurrentEditing || (!e.userId && !claimedByOtherUser);
                  })
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({e.code}) — {e.jobTitle}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {role === 'representative' && (
            <div className="p-2 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] text-[#011E58] font-bold text-[11px] leading-snug">
              سيتم تفعيل صلاحيات المندوب الأساسية تلقائياً (عرض وإضافة وتعديل العملاء، البيع من عهدة السيارة، إنشاء وإرسال فواتير شراء مسودة، التحويلات والمزامنة) وإنشاء ملف مندوب ومستودع سيارة 1:1 تلقائياً دون تكرار.
            </div>
          )}

          {role === 'customer' && (
            <div className="p-2 rounded-lg bg-blue-50 border border-blue-200 space-y-1">
              <label className="block text-[11px] font-bold text-blue-950">ربط هذا الحساب بملف العميل مباشرة (1:1):</label>
              {editingUser && (() => {
                const alreadyLinked = customers.find((c) => c.userId === editingUser.id);
                if (alreadyLinked) {
                  return (
                    <div className="p-1.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-900 font-bold">
                      مربوط حالياً بملف العميل: {alreadyLinked.name}{' '}
                      {alreadyLinked.shopName ? `(${alreadyLinked.shopName})` : ''} — {alreadyLinked.code}
                    </div>
                  );
                }
                return (
                  <div className="p-1.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 font-bold text-[11px]">
                    تنبيه: حساب العميل غير مربوط بملف عميل حالياً — اختر عميلاً من القائمة أو احفظ لإنشاء وربط ملف عميل تلقائياً.
                  </div>
                );
              })()}

              {(!editingUser || !customers.some((c) => c.userId === editingUser.id)) && (
                <select
                  value={linkedCustomerId}
                  onChange={(e) => setLinkedCustomerId(e.target.value)}
                  className="w-full h-8 bg-white border border-blue-300 rounded-md px-2 font-bold"
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

          <label className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-amber-50 border border-amber-200 cursor-pointer">
            <input
              type="checkbox"
              checked={mustChangePassword}
              onChange={(e) => setMustChangePassword(e.target.checked)}
              className="w-3.5 h-3.5 rounded text-blue-900"
            />
            <span className="font-bold text-amber-900">إلزام المستخدم بتغيير كلمة المرور عند تسجيل الدخول القادم</span>
          </label>

          {/* Granular Permissions Checkboxes */}
          <div className="space-y-1.5 border-t pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-black text-slate-800 text-xs">تخصيص الصلاحيات الفردية (Granular Permissions):</h4>
              <button
                type="button"
                onClick={() => {
                  setPermissions(buildPresetPermissions(role));
                  setHasManualPermEdits(false);
                }}
                className="px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>تطبيق القالب الافتراضي للدور</span>
              </button>
            </div>
            {(role === 'representative' || role === 'customer') && (
              <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-bold flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span>
                  {role === 'representative'
                    ? 'حماية الدور: الصلاحيات الإدارية والمالية والحساسة مقفلة تلقائياً على دور المندوب ويتم تجريدها من الخادم أيضاً.'
                    : 'حماية الدور: دور العميل يقتصر على صلاحيات العرض والطباعة والتصدير والتقارير الشخصية فقط، وجميع الصلاحيات الإدارية مقفلة.'}
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 p-2 bg-slate-50 rounded-lg border">
              {[
                { key: 'canView', label: 'صلاحية العرض والقراءة' },
                { key: 'canAdd', label: 'صلاحية الإضافة والإنشاء' },
                { key: 'canEdit', label: 'صلاحية التعديل' },
                { key: 'canDelete', label: 'صلاحية الحذف والإلغاء' },
                { key: 'canPrint', label: 'صلاحية الطباعة' },
                { key: 'canExport', label: 'صلاحية تصدير Excel' },
                { key: 'canViewReports', label: 'الاطلاع على التقارير المالية' },
                { key: 'canManageSales', label: 'إدارة المبيعات وفواتير البيع' },
                { key: 'canManagePurchases', label: 'إدارة المشتريات والموردين (الاعتماد الكامل)' },
                { key: 'canCreatePurchase', label: 'إنشاء وإرسال فواتير شراء مسودة (للمندوب/الموظف)' },
                { key: 'canManageInventory', label: 'إدارة المخزون والأصناف' },
                { key: 'canManageWarehouses', label: 'إدارة المستودعات والتحويلات' },
                { key: 'canManageCashboxes', label: 'إدارة الخزائن والحسابات' },
                { key: 'canManageTransfers', label: 'نظام طلب تحويل بالنصف' },
                { key: 'canApprove', label: 'اعتماد العمليات والمستندات' },
                { key: 'canReviewRepInvoices', label: 'مراجعة واعتماد فواتير المناديب' },
                { key: 'canSend', label: 'صلاحية إرسال المزامنة Send' },
                { key: 'canReceive', label: 'صلاحية استلام المزامنة فقط (Sync Receive)' },
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
              ].map((perm) => {
                const permKey = perm.key as keyof UserPermissions;
                const lockedForRole = isPermissionLockedForRole(permKey, role);
                return (
                  <label
                    key={perm.key}
                    title={lockedForRole ? 'صلاحية مقيدة لهذا الدور بموجب سياسة الأمان' : undefined}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md border ${
                      lockedForRole
                        ? 'bg-slate-100 border-slate-200 opacity-55 cursor-not-allowed'
                        : 'bg-white border-slate-200 cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={lockedForRole}
                      checked={lockedForRole ? false : Boolean(permissions[permKey])}
                      onChange={() => togglePermission(permKey)}
                      className="w-3.5 h-3.5 rounded text-blue-900 focus:ring-blue-500 disabled:opacity-50"
                    />
                    <span className="font-semibold text-slate-800">{perm.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-1.5 pt-2 border-t">
            <button type="button" onClick={() => setIsAddModalOpen(false)} className="h-8 px-2.5 border rounded-md font-bold cursor-pointer">
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="h-8 px-3 bg-blue-900 text-white rounded-md font-bold disabled:opacity-50 cursor-pointer"
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
          <form onSubmit={handleResetPassword} className="space-y-2 text-xs">
            {resetError && (
              <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold">
                {resetError}
              </div>
            )}
            <div>
              <label className="block text-[11px] font-bold mb-0.5">كلمة المرور الجديدة (6 أحرف على الأقل):</label>
              <input
                type="password"
                required
                placeholder="أدخل كلمة المرور الجديدة"
                value={resetNewPassword}
                onChange={(e) => setResetNewPassword(e.target.value)}
                className="w-full h-8 border rounded-md px-2 font-mono"
              />
            </div>
            <div className="flex justify-end gap-1.5 pt-2 border-t">
              <button type="button" onClick={() => setResetModalUser(null)} className="h-8 px-2.5 border rounded-md font-bold cursor-pointer">
                إلغاء
              </button>
              <button type="submit" disabled={isResettingPassword} className="h-8 px-3 bg-blue-900 text-white rounded-md font-bold cursor-pointer disabled:opacity-50">
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

      {/* Unified Identity Details Modal */}
      <Modal
        isOpen={!!previewIdentity}
        onClose={() => setPreviewIdentity(null)}
        title={previewIdentity ? `تفاصيل الهوية الموحدة: ${previewIdentity.fullName}` : 'تفاصيل الهوية'}
        subtitle={previewIdentity?.id}
        maxWidth="lg"
      >
        {previewIdentity && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">الاسم الكامل</span>
                <strong>{previewIdentity.fullName}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">الهاتف</span>
                <strong className="font-mono tabular-nums">{previewIdentity.phone || '—'}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">الرقم القومي</span>
                <strong className="font-mono tabular-nums">{previewIdentity.nationalId || '—'}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">معرف الهوية</span>
                <strong className="font-mono">{previewIdentity.id}</strong>
              </div>
            </div>
            <div className="space-y-1">
              <div className="font-bold text-slate-700 dark:text-[#A9BCD9]">السجلات المرتبطة بهذه الهوية:</div>
              <div className="flex flex-wrap gap-1.5">
                {(previewIdentity.roles && previewIdentity.roles.length > 0
                  ? previewIdentity.roles
                  : identityRoles.filter((r) => r.identityId === previewIdentity.id)
                ).map((r) => (
                  <span
                    key={r.id}
                    className="px-2 py-1 rounded bg-slate-100 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] font-bold"
                  >
                    {r.linkedRecordType}: {r.linkedRecordId}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-[#21375C]">
              <button
                type="button"
                onClick={() => setPreviewIdentity(null)}
                className="h-8 px-3 rounded-md border border-slate-300 dark:border-[#2A436E] font-bold cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Audit Log Entry Detail Modal */}
      <Modal
        isOpen={!!previewAuditLog}
        onClose={() => setPreviewAuditLog(null)}
        title="تفاصيل سجل التدقيق"
        subtitle={previewAuditLog?.module}
        maxWidth="md"
      >
        {previewAuditLog && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">المستخدم</span>
                <strong>{previewAuditLog.userName}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">التاريخ والوقت</span>
                <strong className="font-mono tabular-nums">
                  {new Date(previewAuditLog.timestamp).toLocaleString('ar-EG')}
                </strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">القسم</span>
                <strong>{previewAuditLog.module}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">رقم السجل المرجعي</span>
                <strong className="font-mono">{previewAuditLog.recordId || '—'}</strong>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] space-y-1">
              <div>
                <span className="font-bold text-slate-600 dark:text-[#97AECE]">الإجراء: </span>
                <strong>{previewAuditLog.action}</strong>
              </div>
              {previewAuditLog.details && (
                <div>
                  <span className="font-bold text-slate-600 dark:text-[#97AECE]">التفاصيل: </span>
                  <span>{previewAuditLog.details}</span>
                </div>
              )}
            </div>
            <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-[#21375C]">
              <button
                type="button"
                onClick={() => setPreviewAuditLog(null)}
                className="h-8 px-3 rounded-md border border-slate-300 dark:border-[#2A436E] font-bold cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
