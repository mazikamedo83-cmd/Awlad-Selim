import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus, KeyRound, AlertCircle, CheckCircle2, Trash2, Shield, RotateCcw, Save, Link2, GitMerge, RefreshCw, AlertTriangle, UserCheck
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleDate, formatLocaleDateTime } from '../../../i18n/translator';
import { AuditLogItem, IdentityEntityType, UnifiedIdentity, User, UserRole, UserPermissions } from '../../../types';
import { Modal } from '../../common/Modal';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { SearchableFilterSelect } from '../../common/SearchableFilterSelect';
import { UnifiedDataTable, UnifiedColumn } from '../../common/UnifiedDataTable';

interface UsersManagementViewProps {
  initialTab?: 'users' | 'audit' | 'presets' | 'identities';
}

const REP_SAFE_PRESET_KEYS: Array<{ key: keyof UserPermissions; labelAr: string; labelEn: string; locked?: boolean }> = [
  { key: 'canView', labelAr: 'العرض والقراءة الأساسية للبوابة (إلزامي)', labelEn: 'Basic Portal View & Read Access (Mandatory)', locked: true },
  { key: 'canAdd', labelAr: 'إضافة عملاء جدد وعروض وفواتير بيع', labelEn: 'Add New Customers, Offers & Sales Invoices' },
  { key: 'canEdit', labelAr: 'تعديل بيانات العملاء ومسوّدات فواتير الشراء الخاصة به', labelEn: 'Edit Customer Details & Own Draft Purchase Invoices' },
  { key: 'canDelete', labelAr: 'حذف مسوّدات الشراء الخاصة به فقط', labelEn: 'Delete Own Draft Purchase Invoices Only' },
  { key: 'canPrint', labelAr: 'طباعة الفواتير والإيصالات والتصدير PDF', labelEn: 'Print Invoices, Receipts & Export PDF' },
  { key: 'canExport', labelAr: 'تصدير التقارير والبيانات إلى Excel / CSV', labelEn: 'Export Reports & Data to Excel / CSV' },
  { key: 'canManageSales', labelAr: 'إنشاء فواتير البيع ومرتجعات البيع والطلبات من عهدة السيارة', labelEn: 'Create Sales Invoices, Returns & Orders from Van Custody' },
  { key: 'canCreatePurchase', labelAr: 'إنشاء فواتير شراء مسودة وإرسالها للإدارة', labelEn: 'Create & Submit Draft Purchase Invoices to Management' },
  { key: 'canManageTransfers', labelAr: 'نظام التحويل بالنصف والعهدة المالية للمندوب', labelEn: 'Half-Transfer System & Rep Cash Custody' },
  { key: 'canCreateStockTransfer', labelAr: 'إنشاء أوامر وطلبات تحويل أصناف', labelEn: 'Create Stock Transfer Requests & Orders' },
  { key: 'canSend', labelAr: 'إرسال البيانات والمزامنة (Send)', labelEn: 'Send Data & Sync (Send)' },
  { key: 'canReceive', labelAr: 'استلام المزامنة والبيانات فقط (Sync Receive — لا يمنح استلام مشتريات المخزن)', labelEn: 'Sync Receive Only (Does Not Grant Warehouse Purchase Receiving)' },
  { key: 'canViewReports', labelAr: 'عرض ملخصات مبيعات المندوب المسموحة (دون أرباح الشركة)', labelEn: 'View Allowed Rep Sales Summaries (Excluding Company Profits)' },
];

const CUSTOMER_SAFE_PRESET_KEYS: Array<{ key: keyof UserPermissions; labelAr: string; labelEn: string; locked?: boolean }> = [
  { key: 'canView', labelAr: 'عرض الكتالوج والطلبات والفواتير وكشف الحساب الشخصي (إلزامي)', labelEn: 'View Catalog, Orders, Invoices & Personal Statement (Mandatory)', locked: true },
  { key: 'canPrint', labelAr: 'طباعة الفواتير وكشف الحساب كملف PDF', labelEn: 'Print Invoices & Statement as PDF' },
  { key: 'canExport', labelAr: 'تصدير كشف الحساب الشخصي Excel / CSV', labelEn: 'Export Personal Statement as Excel / CSV' },
  { key: 'canViewReports', labelAr: 'عرض ملخص الرصيد وإجمالي المديونية والائتمان الشخصي', labelEn: 'View Balance Summary, Total Debt & Personal Credit' },
];

const ADMIN_ONLY_PERMISSION_KEYS = new Set<keyof UserPermissions>([
  'canManageUsers',
  'canManageSettings',
  'canManageEmployees',
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
  const { t, language } = usePreferences();
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
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [activeStatusFilter, setActiveStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
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
        canManageTransfers: true, canManageEmployees: true, canManageUsers: true,
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
        canApprove: true, canSend: true, canReceive: true, canReviewRepInvoices: true,
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
      setFormError(t('يرجى إدخال الاسم الكامل واسم الدخول.', 'Please enter full name and username.'));
      return;
    }
    if (!editingUser && password.trim().length < 6) {
      setFormError(t('يجب إدخال كلمة مرور لا تقل عن 6 أحرف للمستخدم الجديد.', 'Password must be at least 6 characters for new users.'));
      return;
    }
    if (editingUser && password.trim().length > 0 && password.trim().length < 6) {
      setFormError(t('كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف.', 'New password must be at least 6 characters.'));
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
          setFormError(res.error ? t(res.error) : t('تعذر تحديث بيانات المستخدم', 'Could not update user'));
          return;
        }
        setStatusMessage({
          type: 'success',
          text: t(`تم تحديث بيانات وصلاحيات (${fullName.trim()}) بنجاح.`, `Updated details and permissions for (${fullName.trim()}) successfully.`),
        });
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
          setFormError(res.error ? t(res.error) : t('تعذر إنشاء المستخدم', 'Could not create user'));
          return;
        }
        setStatusMessage({
          type: 'success',
          text:
            role === 'customer'
              ? t(
                  `تم إنشاء حساب العميل (${username.trim()}) وتفعيل صلاحياته وربطه بملف عميل تلقائياً بنجاح.`,
                  `Customer account (${username.trim()}) created, activated, and linked to a customer profile automatically.`
                )
              : role === 'representative'
              ? t(
                  `تم إنشاء حساب المندوب (${username.trim()}) وتفعيل صلاحياته الميدانية وإنشاء ملف المندوب ومستودع السيارة تلقائياً بنجاح.`,
                  `Rep account (${username.trim()}) created with field permissions, rep profile, and van warehouse automatically.`
                )
              : t(
                  `تم إنشاء حساب (${username.trim()}) وربطه بالهوية الموحدة بنجاح.`,
                  `Account (${username.trim()}) created and linked to unified identity successfully.`
                ),
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
      setResetError(t('كلمة المرور يجب أن تكون 6 أحرف على الأقل.', 'Password must be at least 6 characters.'));
      return;
    }
    setIsResettingPassword(true);
    try {
      const res = await updateUser(resetModalUser.id, { newPassword: resetNewPassword.trim() });
      if (!res.success) {
        setResetError(res.error ? t(res.error) : t('فشل تغيير كلمة المرور', 'Failed to reset password'));
        return;
      }
      setStatusMessage({
        type: 'success',
        text: t(
          `تمت إعادة تعيين كلمة المرور للمستخدم (${resetModalUser.fullName}) بنجاح.`,
          `Password reset for (${resetModalUser.fullName}) succeeded.`
        ),
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
        setStatusMessage({ type: 'error', text: res.error ? t(res.error) : t('تعذر حذف المستخدم', 'Could not delete user') });
      } else {
        setStatusMessage({
          type: 'success',
          text: t(`تم حذف الحساب (${userToDelete.username}).`, `Account (${userToDelete.username}) deleted.`),
        });
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
          text: t(
            'تم حفظ قوالب الصلاحيات التلقائية (صلاحيات المندوب وصلاحيات العميل) وتطبيقها على كل تسجيل جديد.',
            'Default permission presets (Representative & Customer) saved and applied to new registrations.'
          ),
        });
      } else {
        setStatusMessage({
          type: 'error',
          text: res.error ? t(res.error) : t('تعذر حفظ قوالب الصلاحيات التلقائية', 'Could not save default permission presets'),
        });
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
          text: t(
            'تم تنفيذ تدقيق الهويات الموحدة وحفظ نسخة احتياطية آمنة بنجاح دون دمج تلقائي غير مؤكد.',
            'Unified identity audit completed with safe backup and no unconfirmed auto-merges.'
          ),
        });
      } else {
        setStatusMessage({
          type: 'error',
          text: res.error ? t(res.error) : t('تعذر تنفيذ التدقيق الآمن للهويات', 'Could not run safe identity audit'),
        });
      }
    } finally {
      setIsRunningAudit(false);
    }
  };

  const handleManualIdentityLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkTargetId) {
      setStatusMessage({ type: 'error', text: t('يرجى اختيار السجل المستهدف لربطه.', 'Please select the target record to link.') });
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
          text: t(
            `تم ربط السجل بنجاح بالهوية الموحدة (${res.identityId || 'محدثة'}).`,
            `Record linked successfully to unified identity (${res.identityId || 'updated'}).`
          ),
        });
        setLinkTargetId('');
        setLinkIdentityId('');
        setLinkEmployeeTargetId('');
        setLinkUserTargetId('');
      } else {
        setStatusMessage({ type: 'error', text: res.error ? t(res.error) : t('تعذر ربط السجل بالهوية الموحدة', 'Could not link record to identity') });
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
          <h2 className="text-sm font-black text-slate-900 tracking-tight">
            {t('إدارة المستخدمين والصلاحيات وسجل الأمان', 'Users, Permissions & Security Audit Log')}
          </h2>
          <p className="text-[11px] text-slate-500">
            {t(
              'التحكم في حسابات الموظفين والعملاء، تحديد الصلاحيات على الخادم، ومراقبة سجل العمليات (Audit Log)',
              'Manage staff & customer accounts, enforce server permissions, and monitor the Audit Log.'
            )}
          </p>
        </div>

        {activeTab === 'users' && (
          <button
            onClick={handleOpenAdd}
            className="h-8 flex items-center gap-1.5 px-2.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md text-xs font-black cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('إضافة مستخدم جديد', 'Add New User')}</span>
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
            {t('إغلاق', 'Close')}
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
          {t('حسابات المستخدمين', 'User Accounts')} ({users.length})
        </button>
        <button
          onClick={() => setActiveTab('presets')}
          className={`pb-1.5 transition-colors border-b-2 cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'presets' ? 'border-[#003589] text-[#011E58]' : 'border-transparent text-slate-500'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>{t('قوالب الصلاحيات التلقائية (المندوب / العميل)', 'Auto Permission Presets (Rep / Customer)')}</span>
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
          <span>{t('الهويات الموحدة والتعارضات', 'Unified Identities & Conflicts')} ({identities.length})</span>
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
          {t('سجل تدقيق العمليات', 'Audit Log')} ({auditLogs.length})
        </button>
      </div>

      {/* Users Tab */}
      {activeTab === 'users' && (
        <UnifiedDataTable<User>
          compact
          title={t('حسابات المستخدمين والصلاحيات', 'User Accounts & Permissions')}
          subtitle={`${t('المعروض:', 'Showing:')} ${users.filter((u) => (roleFilter === 'all' || u.role === roleFilter) && (activeStatusFilter === 'all' || (activeStatusFilter === 'active' ? u.isActive : !u.isActive))).length} ${t('من', 'of')} ${users.length}`}
          data={users.filter((u) => {
            if (roleFilter !== 'all' && u.role !== roleFilter) return false;
            if (activeStatusFilter === 'active' && !u.isActive) return false;
            if (activeStatusFilter === 'inactive' && u.isActive) return false;
            return true;
          })}
          rowKey={(u) => u.id}
          onRowClick={(u) => handleOpenEdit(u)}
          searchPlaceholder={t('بحث بالاسم أو اسم الدخول أو الدور أو الهاتف...', 'Search by name, username, role, or phone...')}
          exportFilename="AWLAD_SELIM_Users"
          pdfTitle={t('دليل المستخدمين والصلاحيات', 'Users & Permissions Directory')}
          defaultPageSize={25}
          emptyTitle={t('لا توجد حسابات مستخدمين', 'No user accounts found')}
          toolbarFilters={
            <div className="flex flex-nowrap items-center gap-1.5 shrink-0">
              <select
                aria-label={t('تصفية حسب الدور', 'Filter by role')}
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="h-8 shrink-0 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-2 text-xs font-bold text-slate-800 dark:text-[#EEF4FC]"
              >
                <option value="all">{t('كل الأدوار', 'All Roles')} ({users.length})</option>
                <option value="admin">{t('مالك / مدير عام', 'Owner / General Admin')}</option>
                <option value="manager">{t('مدير', 'Manager')}</option>
                <option value="accountant">{t('محاسب', 'Accountant')}</option>
                <option value="sales">{t('موظف مبيعات', 'Sales Staff')}</option>
                <option value="purchases">{t('موظف مشتريات', 'Purchases Staff')}</option>
                <option value="warehouse">{t('أمين مستودع', 'Warehouse Keeper')}</option>
                <option value="representative">{t('مندوب مبيعات', 'Sales Representative')}</option>
                <option value="customer">{t('عميل تطبيق', 'App Customer')}</option>
              </select>
              <select
                aria-label={t('تصفية حسب الحالة', 'Filter by status')}
                value={activeStatusFilter}
                onChange={(e) => setActiveStatusFilter(e.target.value as any)}
                className="h-8 shrink-0 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-2 text-xs font-bold text-slate-800 dark:text-[#EEF4FC]"
              >
                <option value="all">{t('كل الحالات', 'All Statuses')}</option>
                <option value="active">{t('نشط فقط', 'Active Only')}</option>
                <option value="inactive">{t('معطل فقط', 'Disabled Only')}</option>
              </select>
            </div>
          }
          columns={[
            {
              key: 'fullName',
              header: t('الاسم الكامل والهوية', 'Full Name & Identity'),
              sortable: true,
              sortValue: (u) => u.fullName,
              exportValue: (u) => `${u.fullName}${u.identityId ? ` (${u.identityId})` : ''}`,
              render: (u) => (
                <div>
                  <div className="font-bold text-slate-900">{u.fullName}</div>
                  {u.identityId && (
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">{t('هوية:', 'ID:')} {u.identityId}</div>
                  )}
                </div>
              ),
            },
            {
              key: 'username',
              header: t('اسم المستخدم', 'Username'),
              sortable: true,
              sortValue: (u) => u.username,
              exportValue: (u) => u.username,
              render: (u) => <span className="font-mono text-blue-900 font-bold">{u.username}</span>,
            },
            {
              key: 'role',
              header: t('الدور / الأدوار المرتبطة', 'Role / Linked Roles'),
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
                        ? t('مالك / مدير عام', 'Owner / General Admin')
                        : u.role === 'manager'
                        ? t('مدير', 'Manager')
                        : u.role === 'accountant'
                        ? t('محاسب', 'Accountant')
                        : u.role === 'purchases'
                        ? t('موظف مشتريات', 'Purchases Staff')
                        : u.role === 'representative'
                        ? t('مندوب مبيعات', 'Sales Representative')
                        : u.role === 'customer'
                        ? t('عميل - تطبيق العملاء', 'Customer - Customer App')
                        : u.role === 'warehouse'
                        ? t('أمين مستودع', 'Warehouse Keeper')
                        : t('موظف مبيعات', 'Sales Staff')}
                    </span>
                    {linkedEmp && (
                      <span className="px-2 py-0.5 rounded border border-[#DCE6F5] bg-[#EEF3FA] text-[#011E58] text-[10px] font-bold" title={`${t('ملف موظف HR:', 'HR Employee:')} ${linkedEmp.name}`}>
                        {t('موظف HR:', 'HR Staff:')} {linkedEmp.code}
                      </span>
                    )}
                    {linkedRep && (
                      <span className="px-2 py-0.5 rounded border border-[#B8CAE8] bg-[#DCE6F5] text-[#002160] text-[10px] font-bold">
                        {t('ملف مندوب', 'Rep Profile')}
                      </span>
                    )}
                    {linkedCust && (
                      <span className="px-2 py-0.5 rounded border border-slate-300 bg-slate-100 text-slate-800 text-[10px] font-bold">
                        {t('عميل:', 'Customer:')} {linkedCust.code}
                      </span>
                    )}
                  </div>
                );
              },
            },
            {
              key: 'jobTitle',
              header: t('الوظيفة والقسم', 'Job Title & Department'),
              sortable: true,
              sortValue: (u) => `${u.jobTitle} ${u.department}`,
              exportValue: (u) => `${t(u.jobTitle)} - ${t(u.department)}`,
              render: (u) => <span className="text-slate-600">{t(u.jobTitle)} - {t(u.department)}</span>,
            },
            {
              key: 'phone',
              header: t('رقم الهاتف', 'Phone'),
              sortable: true,
              sortValue: (u) => u.phone || '',
              exportValue: (u) => u.phone || '',
              render: (u) => <span className="font-mono tabular-nums">{u.phone || '-'}</span>,
            },
            {
              key: 'isActive',
              header: t('الحالة', 'Status'),
              align: 'center',
              sortable: true,
              sortValue: (u) => (u.isActive ? 1 : 0),
              exportValue: (u) => (u.isActive ? t('نشط', 'Active') : t('معطل', 'Disabled')),
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
                        setStatusMessage({ type: 'error', text: res.error ? t(res.error) : t('تعذر تغيير حالة الحساب', 'Could not update account status') });
                      } else {
                        setStatusMessage({
                          type: 'success',
                          text: !u.isActive
                            ? t(`تم تفعيل حساب (${u.fullName}).`, `Activated account (${u.fullName}).`)
                            : t(`تم إيقاف حساب (${u.fullName}).`, `Suspended account (${u.fullName}).`),
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
                  {togglingUserId === u.id ? '...' : u.isActive ? t('نشط', 'Active') : t('معطل', 'Disabled')}
                </button>
              ),
            },
            {
              key: 'lastLogin',
              header: t('آخر دخول', 'Last Login'),
              sortable: true,
              sortValue: (u) => u.lastLogin || '',
              exportValue: (u) => (u.lastLogin ? formatLocaleDate(u.lastLogin) : t('لم يدخل بعد', 'Never')),
              render: (u) => (
                <span className="text-slate-500 text-[11px] tabular-nums">
                  {u.lastLogin ? formatLocaleDate(u.lastLogin) : t('لم يدخل بعد', 'Never')}
                </span>
              ),
            },
            {
              key: 'actions',
              header: t('الإجراءات', 'Actions'),
              align: 'center',
              exportValue: () => '',
              render: (u) => (
                <div className="flex items-center justify-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(u)}
                    className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded-md font-bold text-[11px] cursor-pointer"
                    title={t('تعديل الصلاحيات', 'Edit Permissions')}
                  >
                    {t('الصلاحيات', 'Permissions')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setResetError(null);
                      setResetNewPassword('');
                      setResetModalUser(u);
                    }}
                    className="p-1 text-slate-500 hover:text-blue-900 cursor-pointer"
                    title={t('إعادة تعيين كلمة المرور', 'Reset Password')}
                  >
                    <KeyRound className="w-4 h-4" />
                  </button>
                  {currentUser?.id !== u.id && (
                    <button
                      type="button"
                      onClick={() => handleDeleteUser(u)}
                      className="p-1 text-slate-400 hover:text-red-700 cursor-pointer"
                      title={t('حذف المستخدم', 'Delete User')}
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
              <h3 className="text-xs font-black">{t('القوالب التلقائية عند إنشاء أو تسجيل حساب مندوب أو عميل', 'Default Templates for New Rep or Customer Accounts')}</h3>
              <p className="text-[11px] text-blue-800 leading-snug">
                {t(
                  'يُطبق قالب «صلاحيات المندوب» أو «صلاحيات العميل» تلقائياً عند تسجيل الحساب من التطبيق أو لوحة الإدارة، مع إمكانية تعديل صلاحيات أي فرد لاحقاً.',
                  'Representative or Customer permission templates apply automatically on new signups from app or admin panel, while remaining customizable per individual.'
                )}
              </p>
            </div>
            <button
              type="button"
              disabled={isSavingPresets}
              onClick={handleSavePresets}
              className="h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSavingPresets ? t('جاري الحفظ...', 'Saving...') : t('حفظ قوالب الصلاحيات', 'Save Permission Presets')}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {/* Representative Preset Card */}
            <div className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <div>
                  <h4 className="text-xs font-black text-[#011E58]">{t('«صلاحيات المندوب» الافتراضية', 'Default Representative Permissions')}</h4>
                  <p className="text-[11px] text-slate-500">{t('الصلاحيات المسموحة والممنوحة تلقائياً لكل حساب مندوب جديد', 'Allowed permissions automatically granted to every new rep account')}</p>
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
                  <span>{t('استعادة الافتراضي', 'Restore Defaults')}</span>
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
                    <span className="font-bold text-slate-800">{language === 'en' ? item.labelEn : item.labelAr}</span>
                  </label>
                ))}
              </div>
              <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-900 font-bold">
                {t(
                  'ملاحظة أمنية: تظل صلاحيات الإدارة والمستخدمين والخزائن وأرباح الشركة والاعتماد النهائي محجوبة تماماً عن قالب المندوب على السيرفر.',
                  'Security Note: Admin, Users, Cashbox management, Company profits, and Final approval permissions remain strictly blocked for representative templates on the server.'
                )}
              </div>
            </div>

            {/* Customer Preset Card */}
            <div className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <div>
                  <h4 className="text-xs font-black text-blue-950">{t('«صلاحيات العميل» الافتراضية', 'Default Customer Permissions')}</h4>
                  <p className="text-[11px] text-slate-500">{t('الصلاحيات الممنوحة تلقائياً لكل حساب عميل بوابة جديد', 'Permissions automatically granted to every new customer portal account')}</p>
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
                  <span>{t('استعادة الافتراضي', 'Restore Defaults')}</span>
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
                    <span className="font-bold text-slate-800">{language === 'en' ? item.labelEn : item.labelAr}</span>
                  </label>
                ))}
              </div>
              <div className="p-2 rounded-md bg-blue-50 border border-blue-200 text-[11px] text-blue-900 font-bold">
                {t(
                  'ملاحظة أمنية: حساب العميل معزول بالكامل في بياناته وطلباته وفواتيره وكشف حسابه الشخصي ولا يمكنه الوصول لأي بيانات عملاء آخرين أو مالية الشركة.',
                  'Security Note: Customer accounts are strictly isolated to their own data, orders, invoices, and statements, with zero access to other customers or company finances.'
                )}
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
                <span>{t('سجل الهويات الموحدة وإدارة تداخل السجلات', 'Unified Identity Registry & Conflict Management')}</span>
              </h3>
              <p className="text-[11px] text-slate-500">
                {t(
                  'يربط هذا النظام ملفات الموظفين والمستخدمين والمندوبين والعملاء والموردين تحت معرف هوية موحد مع الحفاظ على فصل القيود المالية والرواتب.',
                  'Links employees, users, representatives, customers, and suppliers under one unified identity while separating financial ledgers and payroll.'
                )}
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
                <span>{t('تحديث', 'Refresh')}</span>
              </button>
              <button
                type="button"
                disabled={isRunningAudit}
                onClick={handleRunIdentityAudit}
                className="h-8 px-2.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>{isRunningAudit ? t('جاري الفحص الآمن...', 'Running Safe Audit...') : t('تشغيل التدقيق الآمن للهويات', 'Run Safe Identity Audit')}</span>
              </button>
            </div>
          </div>

          {/* Manual Link Form */}
          <form onSubmit={handleManualIdentityLink} className="bg-white rounded-lg border border-slate-200 p-2.5 space-y-2">
            <h4 className="font-black text-slate-900 flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-[#003589]" />
              <span>{t('ربط يدوي مؤكد بين سجل وهوية أو موظف / مستخدم', 'Manual Confirmed Link Between Record and Identity / Staff / User')}</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
              <div>
                <label className="block font-bold text-slate-700 mb-1">{t('نوع السجل الأساسي:', 'Primary Record Type:')}</label>
                <select
                  value={linkTargetType}
                  onChange={(e) => {
                    setLinkTargetType(e.target.value as IdentityEntityType);
                    setLinkTargetId('');
                  }}
                  className="w-full h-[34px] border border-slate-300 rounded-md px-2 font-bold bg-white"
                >
                  <option value="user">{t('حساب مستخدم', 'User Account')}</option>
                  <option value="employee">{t('ملف موظف (HR)', 'HR Employee Profile')}</option>
                  <option value="representative">{t('مندوب مبيعات', 'Sales Representative')}</option>
                  <option value="customer">{t('عميل', 'Customer')}</option>
                  <option value="supplier">{t('مورد', 'Supplier')}</option>
                </select>
              </div>
              <div>
                <SearchableFilterSelect
                  label={t('السجل المطلوب ربطه', 'Target Record to Link')}
                  value={linkTargetId || 'all'}
                  onChange={(val) => setLinkTargetId(val === 'all' ? '' : val)}
                  options={linkTargetOptions}
                  allOptionLabel={t('-- اختر السجل --', '-- Select Record --')}
                  allOptionValue="all"
                />
              </div>
              <div>
                <SearchableFilterSelect
                  label={t('ربط بهوية قائمة (اختياري)', 'Link to Existing Identity (Optional)')}
                  value={linkIdentityId || 'all'}
                  onChange={(val) => setLinkIdentityId(val === 'all' ? '' : val)}
                  options={identities.map((idn) => ({
                    value: idn.id,
                    label: idn.fullName,
                    subtitle: `${idn.id}${idn.phone ? ` • ${idn.phone}` : ''}`,
                  }))}
                  allOptionLabel={t('تلقائي / إنشاء جديد', 'Auto / Create New')}
                  allOptionValue="all"
                />
              </div>
              <div>
                <SearchableFilterSelect
                  label={t('ربط بملف موظف (اختياري)', 'Link to Employee (Optional)')}
                  value={linkEmployeeTargetId || 'all'}
                  onChange={(val) => setLinkEmployeeTargetId(val === 'all' ? '' : val)}
                  options={employees.map((e) => ({
                    value: e.id,
                    label: e.name,
                    subtitle: `${e.code} • ${e.jobTitle}`,
                  }))}
                  allOptionLabel={t('بدون تغيير', 'No Change')}
                  allOptionValue="all"
                />
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <SearchableFilterSelect
                    label={t('ربط بمستخدم (اختياري)', 'Link to User (Optional)')}
                    value={linkUserTargetId || 'all'}
                    onChange={(val) => setLinkUserTargetId(val === 'all' ? '' : val)}
                    options={users.map((u) => ({
                      value: u.id,
                      label: u.fullName,
                      subtitle: `@${u.username}`,
                    }))}
                    allOptionLabel={t('بدون تغيير', 'No Change')}
                    allOptionValue="all"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLinkingIdentity || !linkTargetId}
                  className="h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black disabled:opacity-50 shrink-0 cursor-pointer"
                >
                  {isLinkingIdentity ? '...' : t('ربط', 'Link')}
                </button>
              </div>
            </div>
          </form>

          {/* Identity Conflicts Review Section */}
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-2.5 py-2 border-b bg-amber-50/70 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-black text-amber-950">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>{t('سجلات الاشتباه والتعارض', 'Suspected Duplicates & Conflicts')} ({identityConflicts.length})</span>
              </div>
              <span className="text-[11px] font-bold text-amber-800">
                {t('قيد المراجعة:', 'Pending Review:')} {pendingConflictsCount}
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {identityConflicts.length === 0 ? (
                <div className="p-3 text-center text-slate-400 font-bold">
                  {t('لا توجد أي تعارضات أو اشتباهات مسجلة حالياً.', 'No identity conflicts or suspected duplicates recorded.')}
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
                            {t('المؤشر:', 'Key:')} {cf.identifierKey}
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
                            ? t('قيد المراجعة', 'Pending Review')
                            : cf.status === 'resolved'
                            ? t('تم الحل', 'Resolved')
                            : t('مستبعد', 'Dismissed')}
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
                        <div className="text-[11px] text-slate-600">{t('ملاحظة المعالجة:', 'Resolution Note:')} {cf.resolutionNotes}</div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <input
                        type="text"
                        aria-label={t('ملاحظة قرار المراجعة', 'Review decision note')}
                        value={conflictNotesById[cf.id] ?? ''}
                        onChange={(e) => setConflictNotesById((prev) => ({ ...prev, [cf.id]: e.target.value }))}
                        className="h-8 w-44 border border-slate-300 rounded-md px-2 text-xs"
                      />
                      <button
                        type="button"
                        disabled={busyConflictId === cf.id}
                        onClick={async () => {
                          setBusyConflictId(cf.id);
                          await resolveIdentityConflict(cf.id, {
                            status: 'resolved',
                            resolutionNotes: conflictNotesById[cf.id] || t('تم التحقق واعتماد الربط من الإدارة', 'Verified and approved by management'),
                          });
                          setBusyConflictId(null);
                        }}
                        className="h-8 px-2.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer disabled:opacity-50"
                      >
                        {t('تأكيد الحل', 'Confirm Resolution')}
                      </button>
                      <button
                        type="button"
                        disabled={busyConflictId === cf.id}
                        onClick={async () => {
                          setBusyConflictId(cf.id);
                          await resolveIdentityConflict(cf.id, {
                            status: 'dismissed',
                            resolutionNotes: conflictNotesById[cf.id] || t('شخصان مختلفان — مستبعد', 'Different persons — Dismissed'),
                          });
                          setBusyConflictId(null);
                        }}
                        className="h-8 px-2.5 rounded-md bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold cursor-pointer disabled:opacity-50"
                      >
                        {t('تجاهل', 'Dismiss')}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Unified Identities Directory */}
          <UnifiedDataTable
            title={`${t('دليل الهويات الموحدة', 'Unified Identities Directory')} (${identities.length})`}
            data={filteredIdentities}
            rowKey={(idn) => idn.id}
            onRowClick={(idn) => setPreviewIdentity(idn)}
            searchValue={identitySearch}
            onSearchChange={setIdentitySearch}
            searchPlaceholder={t('بحث بالاسم أو الهاتف أو الرقم القومي أو معرف الهوية...', 'Search by name, phone, national ID, or identity ID...')}
            exportFilename="AWLAD_SELIM_UnifiedIdentities"
            pdfTitle={t('دليل الهويات الموحدة', 'Unified Identities Directory')}
            defaultPageSize={25}
            compact
            emptyTitle={t('لا توجد هويات مطابقة', 'No matching identities')}
            columns={[
              {
                key: 'id',
                header: t('معرف الهوية', 'Identity ID'),
                sortable: true,
                sortValue: (idn) => idn.id,
                exportValue: (idn) => idn.id,
                render: (idn) => <span className="font-mono font-bold text-blue-900">{idn.id}</span>,
              },
              {
                key: 'fullName',
                header: t('الاسم الكامل', 'Full Name'),
                sortable: true,
                sortValue: (idn) => idn.fullName,
                exportValue: (idn) => idn.fullName,
                render: (idn) => <span className="font-bold text-slate-900">{idn.fullName}</span>,
              },
              {
                key: 'phone',
                header: t('الهاتف', 'Phone'),
                sortable: true,
                sortValue: (idn) => idn.phone || '',
                exportValue: (idn) => idn.phone || '-',
                render: (idn) => <span className="font-mono tabular-nums">{idn.phone || '-'}</span>,
              },
              {
                key: 'nationalId',
                header: t('الرقم القومي', 'National ID'),
                sortable: true,
                sortValue: (idn) => idn.nationalId || '',
                exportValue: (idn) => idn.nationalId || '-',
                render: (idn) => <span className="font-mono tabular-nums">{idn.nationalId || '-'}</span>,
              },
              {
                key: 'roles',
                header: t('السجلات والأدوار المرتبطة', 'Linked Records & Roles'),
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
          title={t('سجل تدقيق العمليات', 'Audit Log')}
          subtitle={`${t('إجمالي الأحداث المسجلة:', 'Total Recorded Events:')} ${auditLogs.length}`}
          data={auditLogs}
          rowKey={(log) => log.id}
          onRowClick={(log) => setPreviewAuditLog(log)}
          searchPlaceholder={t('بحث بالمستخدم أو الوحدة أو الإجراء أو التفاصيل...', 'Search by user, module, action, or details...')}
          exportFilename="AWLAD_SELIM_AuditLogs"
          pdfTitle={t('سجل تدقيق العمليات', 'Audit Log')}
          defaultPageSize={25}
          emptyTitle={t('لا توجد سجلات بعد', 'No logs recorded yet')}
          columns={[
            {
              key: 'timestamp',
              header: t('التاريخ والوقت', 'Date & Time'),
              sortable: true,
              sortValue: (log) => log.timestamp,
              exportValue: (log) => formatLocaleDateTime(log.timestamp),
              render: (log) => (
                <span className="font-mono text-slate-500 tabular-nums">
                  {formatLocaleDateTime(log.timestamp)}
                </span>
              ),
            },
            {
              key: 'userName',
              header: t('المستخدم', 'User'),
              sortable: true,
              sortValue: (log) => log.userName,
              exportValue: (log) => log.userName,
              render: (log) => <span className="font-bold text-slate-900">{log.userName}</span>,
            },
            {
              key: 'module',
              header: t('الوحدة / القسم', 'Module / Section'),
              sortable: true,
              sortValue: (log) => log.module,
              exportValue: (log) => t(log.module),
              render: (log) => <span className="font-semibold text-blue-900">{t(log.module)}</span>,
            },
            {
              key: 'action',
              header: t('الإجراء المنفذ', 'Action Executed'),
              sortable: true,
              sortValue: (log) => log.action,
              exportValue: (log) => t(log.action),
              render: (log) => <span className="font-bold">{t(log.action)}</span>,
            },
            {
              key: 'details',
              header: t('تفاصيل العملية', 'Operation Details'),
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
        title={editingUser ? `${t('تعديل وصلاحيات:', 'Edit & Permissions:')} ${editingUser.fullName}` : t('إضافة حساب مستخدم جديد', 'Add New User Account')}
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
              <label className="block text-[11px] font-bold mb-0.5">{t('الاسم الكامل:', 'Full Name:')}</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full h-8 bg-white border rounded-md px-2 font-bold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold mb-0.5">{t('اسم الدخول (Username):', 'Username:')}</label>
              <input
                type="text"
                dir="ltr"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full h-8 bg-white border rounded-md px-2 font-mono font-bold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold mb-0.5">
                {editingUser
                  ? t('كلمة المرور (اتركها فارغة للإبقاء عليها):', 'Password (leave empty to keep current):')
                  : t('كلمة المرور (6 أحرف على الأقل):', 'Password (at least 6 characters):')}
              </label>
              <input
                type="password"
                dir="ltr"
                required={!editingUser}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-8 bg-white border rounded-md px-2 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] font-bold mb-0.5">{t('نوع الحساب / الدور:', 'Account Type / Role:')}</label>
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
                <option value="admin">{t('مالك / مدير عام (كامل الصلاحيات)', 'Owner / General Admin (Full Access)')}</option>
                <option value="manager">{t('مدير فرع', 'Branch Manager')}</option>
                <option value="accountant">{t('محاسب مالي', 'Financial Accountant')}</option>
                <option value="sales">{t('موظف مبيعات', 'Sales Staff')}</option>
                <option value="purchases">{t('موظف مشتريات', 'Purchases Staff')}</option>
                <option value="warehouse">{t('أمين مستودع', 'Warehouse Keeper')}</option>
                <option value="representative">{t('مندوب مبيعات خارجي', 'Field Sales Representative')}</option>
                <option value="customer">{t('عميل - تطبيق العملاء', 'Customer - Customer App')}</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold mb-0.5">{t('المسمى الوظيفي:', 'Job Title:')}</label>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="w-full h-8 border rounded-md px-2"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold mb-0.5">{t('رقم الهاتف:', 'Phone Number:')}</label>
              <input
                type="tel"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full h-8 border rounded-md px-2 font-mono"
              />
            </div>
          </div>

          {role !== 'customer' && (
            <div className="p-2 rounded-lg bg-[#EEF3FA] border border-[#DCE6F5] space-y-1">
              <label className="block text-[11px] font-bold text-[#011E58]">
                {t('ربط بسجل الموظف (HR) — لمنع تكرار الموظف وتوحيد الهوية:', 'Link to HR Employee Record — Prevent duplicates & unify identity:')}
              </label>
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
                <option value="">{t('-- بدون ربط بموظف / اختياري --', '-- No Employee Link / Optional --')}</option>
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
              {t(
                'سيتم تفعيل صلاحيات المندوب الأساسية تلقائياً (عرض وإضافة وتعديل العملاء، البيع من عهدة السيارة، إنشاء وإرسال فواتير شراء مسودة، التحويلات والمزامنة) وإنشاء ملف مندوب ومستودع سيارة 1:1 تلقائياً دون تكرار.',
                'Basic rep permissions (customers, van-custody sales, draft purchases, transfers & sync) and a 1:1 rep profile + van warehouse will be auto-provisioned without duplicates.'
              )}
            </div>
          )}

          {role === 'customer' && (
            <div className="p-2 rounded-lg bg-blue-50 border border-blue-200 space-y-1">
              <label className="block text-[11px] font-bold text-blue-950">{t('ربط هذا الحساب بملف العميل مباشرة (1:1):', 'Link This Account Directly to Customer Profile (1:1):')}</label>
              {editingUser && (() => {
                const alreadyLinked = customers.find((c) => c.userId === editingUser.id);
                if (alreadyLinked) {
                  return (
                    <div className="p-1.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-900 font-bold">
                      {t('مربوط حالياً بملف العميل:', 'Currently linked to customer profile:')} {alreadyLinked.name}{' '}
                      {alreadyLinked.shopName ? `(${alreadyLinked.shopName})` : ''} — {alreadyLinked.code}
                    </div>
                  );
                }
                return (
                  <div className="p-1.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 font-bold text-[11px]">
                    {t(
                      'تنبيه: حساب العميل غير مربوط بملف عميل حالياً — اختر عميلاً من القائمة أو احفظ لإنشاء وربط ملف عميل تلقائياً.',
                      'Notice: Customer account is not linked yet — select an existing customer or save to auto-create and link one.'
                    )}
                  </div>
                );
              })()}

              {(!editingUser || !customers.some((c) => c.userId === editingUser.id)) && (
                <select
                  value={linkedCustomerId}
                  onChange={(e) => setLinkedCustomerId(e.target.value)}
                  className="w-full h-8 bg-white border border-blue-300 rounded-md px-2 font-bold"
                >
                  <option value="">{t('-- إنشاء وربط ملف عميل جديد تلقائياً (مستحسن) --', '-- Auto-Create & Link New Customer Profile (Recommended) --')}</option>
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
            <span className="font-bold text-amber-900">
              {t('إلزام المستخدم بتغيير كلمة المرور عند تسجيل الدخول القادم', 'Require user to change password on next login')}
            </span>
          </label>

          {/* Granular Permissions Checkboxes */}
          <div className="space-y-1.5 border-t pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-black text-slate-800 text-xs">{t('تخصيص الصلاحيات الفردية (Granular Permissions):', 'Individual Granular Permissions:')}</h4>
              <button
                type="button"
                onClick={() => {
                  setPermissions(buildPresetPermissions(role));
                  setHasManualPermEdits(false);
                }}
                className="px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>{t('تطبيق القالب الافتراضي للدور', 'Apply Default Role Preset')}</span>
              </button>
            </div>
            {(role === 'representative' || role === 'customer') && (
              <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-bold flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span>
                  {role === 'representative'
                    ? t(
                        'حماية الدور: الصلاحيات الإدارية والمالية والحساسة مقفلة تلقائياً على دور المندوب ويتم تجريدها من الخادم أيضاً.',
                        'Role Protection: Admin, financial, and sensitive permissions are automatically locked for representatives and stripped server-side.'
                      )
                    : t(
                        'حماية الدور: دور العميل يقتصر على صلاحيات العرض والطباعة والتصدير والتقارير الشخصية فقط، وجميع الصلاحيات الإدارية مقفلة.',
                        'Role Protection: Customer role is restricted to personal view, print, export, and statement reports only.'
                      )}
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 p-2 bg-slate-50 rounded-lg border">
              {[
                { key: 'canView', ar: 'صلاحية العرض والقراءة', en: 'View & Read Access' },
                { key: 'canAdd', ar: 'صلاحية الإضافة والإنشاء', en: 'Add & Create Access' },
                { key: 'canEdit', ar: 'صلاحية التعديل', en: 'Edit Access' },
                { key: 'canDelete', ar: 'صلاحية الحذف والإلغاء', en: 'Delete & Cancel Access' },
                { key: 'canPrint', ar: 'صلاحية الطباعة', en: 'Print Access' },
                { key: 'canExport', ar: 'صلاحية تصدير Excel', en: 'Export to Excel' },
                { key: 'canViewReports', ar: 'الاطلاع على التقارير المالية', en: 'View Financial Reports' },
                { key: 'canManageSales', ar: 'إدارة المبيعات وفواتير البيع', en: 'Manage Sales & Invoices' },
                { key: 'canManagePurchases', ar: 'إدارة المشتريات والموردين (الاعتماد الكامل)', en: 'Manage Purchases & Suppliers (Full Approval)' },
                { key: 'canCreatePurchase', ar: 'إنشاء وإرسال فواتير شراء مسودة (للمندوب/الموظف)', en: 'Create & Submit Draft Purchase Invoices' },
                { key: 'canManageInventory', ar: 'إدارة المخزون والأصناف', en: 'Manage Inventory & Products' },
                { key: 'canManageWarehouses', ar: 'إدارة المستودعات والتحويلات', en: 'Manage Warehouses & Transfers' },
                { key: 'canManageCashboxes', ar: 'إدارة الخزائن والحسابات', en: 'Manage Cashboxes & Accounts' },
                { key: 'canManageTransfers', ar: 'نظام طلب تحويل بالنصف', en: 'Half-Transfer Request System' },
                { key: 'canApprove', ar: 'اعتماد العمليات والمستندات', en: 'Approve Operations & Documents' },
                { key: 'canReviewRepInvoices', ar: 'مراجعة واعتماد فواتير المناديب', en: 'Review & Approve Rep Invoices' },
                { key: 'canSend', ar: 'صلاحية إرسال المزامنة Send', en: 'Sync Send Access' },
                { key: 'canReceive', ar: 'صلاحية استلام المزامنة فقط (Sync Receive)', en: 'Sync Receive Only' },
                { key: 'canManageEmployees', ar: 'إدارة الموظفين والربط الوظيفي', en: 'Manage Employees & HR Links' },
                { key: 'canManageUsers', ar: 'إدارة حسابات المستخدمين', en: 'Manage User Accounts' },
                { key: 'canManageSettings', ar: 'إعدادات النظام والنسخ الاحتياطي', en: 'System Settings & Backups' },
                { key: 'canAllowNegativeInventory', ar: 'السماح بالبيع بالسالب عند نفاد الرصيد', en: 'Allow Negative Stock Sales' },
                { key: 'canViewPersonalAccounts', ar: 'عرض الحسابات الشخصية للملاك', en: 'View Owner Personal Accounts' },
                { key: 'canCreatePersonalTx', ar: 'تسجيل سحب/إيداع في الحسابات الشخصية', en: 'Record Personal Account Withdrawals/Deposits' },
                { key: 'canEditPersonalTx', ar: 'تعديل حركات الحسابات الشخصية', en: 'Edit Personal Account Transactions' },
                { key: 'canApprovePersonalAdjustment', ar: 'اعتماد تسويات الحسابات الشخصية', en: 'Approve Personal Account Adjustments' },
                { key: 'canCreateStockCount', ar: 'إنشاء وتقديم جرد المخزن', en: 'Create & Submit Stock Count' },
                { key: 'canApproveStockCount', ar: 'اعتماد ورفض جرد المخزن', en: 'Approve / Reject Stock Count' },
                { key: 'canCreateStockTransfer', ar: 'إنشاء أوامر تحويل الأصناف', en: 'Create Stock Transfer Orders' },
                { key: 'canApproveStockTransfer', ar: 'اعتماد أوامر تحويل الأصناف', en: 'Approve Stock Transfer Orders' },
                { key: 'canExecuteStockTransfer', ar: 'تنفيذ وترحيل تحويلات الأصناف', en: 'Execute & Post Stock Transfers' },
                { key: 'canViewDeletedInvoices', ar: 'الاطلاع على الفواتير المحذوفة والملغاة', en: 'View Deleted & Cancelled Invoices' },
              ].map((perm) => {
                const permKey = perm.key as keyof UserPermissions;
                const lockedForRole = isPermissionLockedForRole(permKey, role);
                return (
                  <label
                    key={perm.key}
                    title={lockedForRole ? t('صلاحية مقيدة لهذا الدور بموجب سياسة الأمان', 'Permission restricted for this role by security policy') : undefined}
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
                    <span className="font-semibold text-slate-800">{language === 'en' ? perm.en : perm.ar}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-1.5 pt-2 border-t">
            <button type="button" onClick={() => setIsAddModalOpen(false)} className="h-8 px-2.5 border rounded-md font-bold cursor-pointer">
              {t('إلغاء', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="h-8 px-3 bg-blue-900 text-white rounded-md font-bold disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? t('جاري الحفظ...', 'Saving...') : t('حفظ الحساب', 'Save Account')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Password Reset Modal */}
      {resetModalUser && (
        <Modal
          isOpen={!!resetModalUser}
          onClose={() => setResetModalUser(null)}
          title={`${t('إعادة تعيين كلمة المرور لـ:', 'Reset Password for:')} ${resetModalUser.fullName}`}
          maxWidth="sm"
        >
          <form onSubmit={handleResetPassword} className="space-y-2 text-xs">
            {resetError && (
              <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold">
                {resetError}
              </div>
            )}
            <div>
              <label className="block text-[11px] font-bold mb-0.5">{t('كلمة المرور الجديدة (6 أحرف على الأقل):', 'New Password (at least 6 characters):')}</label>
              <input
                type="password"
                dir="ltr"
                required
                value={resetNewPassword}
                onChange={(e) => setResetNewPassword(e.target.value)}
                className="w-full h-8 border rounded-md px-2 font-mono"
              />
            </div>
            <div className="flex justify-end gap-1.5 pt-2 border-t">
              <button type="button" onClick={() => setResetModalUser(null)} className="h-8 px-2.5 border rounded-md font-bold cursor-pointer">
                {t('إلغاء', 'Cancel')}
              </button>
              <button type="submit" disabled={isResettingPassword} className="h-8 px-3 bg-blue-900 text-white rounded-md font-bold cursor-pointer disabled:opacity-50">
                {isResettingPassword ? t('جاري الحفظ...', 'Saving...') : t('حفظ كلمة المرور', 'Save Password')}
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
        title={t('تأكيد حذف حساب المستخدم', 'Confirm Delete User Account')}
        message={
          userToDelete
            ? t(
                `هل أنت متأكد من حذف حساب المستخدم (${userToDelete.fullName} - ${userToDelete.username}) نهائياً؟`,
                `Are you sure you want to permanently delete user (${userToDelete.fullName} - ${userToDelete.username})?`
              )
            : ''
        }
        confirmLabel={t('حذف الحساب', 'Delete Account')}
      />

      {/* Unified Identity Details Modal */}
      <Modal
        isOpen={!!previewIdentity}
        onClose={() => setPreviewIdentity(null)}
        title={previewIdentity ? `${t('تفاصيل الهوية الموحدة:', 'Unified Identity Details:')} ${previewIdentity.fullName}` : t('تفاصيل الهوية', 'Identity Details')}
        subtitle={previewIdentity?.id}
        maxWidth="lg"
      >
        {previewIdentity && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('الاسم الكامل', 'Full Name')}</span>
                <strong>{previewIdentity.fullName}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('الهاتف', 'Phone')}</span>
                <strong className="font-mono tabular-nums">{previewIdentity.phone || '—'}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('الرقم القومي', 'National ID')}</span>
                <strong className="font-mono tabular-nums">{previewIdentity.nationalId || '—'}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('معرف الهوية', 'Identity ID')}</span>
                <strong className="font-mono">{previewIdentity.id}</strong>
              </div>
            </div>
            <div className="space-y-1">
              <div className="font-bold text-slate-700 dark:text-[#A9BCD9]">{t('السجلات المرتبطة بهذه الهوية:', 'Records Linked to This Identity:')}</div>
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
                {t('إغلاق', 'Close')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Audit Log Entry Detail Modal */}
      <Modal
        isOpen={!!previewAuditLog}
        onClose={() => setPreviewAuditLog(null)}
        title={t('تفاصيل سجل التدقيق', 'Audit Log Details')}
        subtitle={previewAuditLog ? t(previewAuditLog.module) : undefined}
        maxWidth="md"
      >
        {previewAuditLog && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('المستخدم', 'User')}</span>
                <strong>{previewAuditLog.userName}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('التاريخ والوقت', 'Date & Time')}</span>
                <strong className="font-mono tabular-nums">
                  {formatLocaleDateTime(previewAuditLog.timestamp)}
                </strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('القسم', 'Module')}</span>
                <strong>{t(previewAuditLog.module)}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 dark:text-[#97AECE] block">{t('رقم السجل المرجعي', 'Reference Record ID')}</span>
                <strong className="font-mono">{previewAuditLog.recordId || '—'}</strong>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] space-y-1">
              <div>
                <span className="font-bold text-slate-600 dark:text-[#97AECE]">{t('الإجراء:', 'Action:')} </span>
                <strong>{t(previewAuditLog.action)}</strong>
              </div>
              {previewAuditLog.details && (
                <div>
                  <span className="font-bold text-slate-600 dark:text-[#97AECE]">{t('التفاصيل:', 'Details:')} </span>
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
                {t('إغلاق', 'Close')}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
