import React from 'react';

export interface AppIconProps {
  className?: string;
}

/** العملاء — أيقونة مجموعة أشخاص حديثة متعددة الدرجات */
export const CustomersGroupIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    {/* Side right person */}
    <circle cx="47" cy="21" r="6" fill="#60A5FA" />
    <path d="M38 44c0-5.5 4-9.5 9-9.5s9 4 9 9.5v4H38v-4z" fill="#3B82F6" />
    {/* Side left person */}
    <circle cx="17" cy="21" r="6" fill="#60A5FA" />
    <path d="M8 44c0-5.5 4-9.5 9-9.5s9 4 9 9.5v4H8v-4z" fill="#3B82F6" />
    {/* Center primary person */}
    <circle cx="32" cy="18" r="7.5" fill="#2563EB" />
    <path d="M20 46c0-7 5.2-12 12-12s12 5 12 12v6H20v-6z" fill="#1D4ED8" />
    <path d="M26 35.5l6 4.5 6-4.5" stroke="#BFDBFE" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** إضافة عميل جديد — أشخاص مع شارة + خضراء */
export const CustomerAddIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <circle cx="26" cy="20" r="8" fill="#0284C7" />
    <path d="M11 49c0-7.5 6.5-13 15-13s15 5.5 15 13v4H11v-4z" fill="#0369A1" />
    <circle cx="47" cy="44" r="11" fill="#10B981" stroke="#FFFFFF" strokeWidth="2.5" />
    <path d="M47 39v10M42 44h10" stroke="#FFFFFF" strokeWidth="2.8" strokeLinecap="round" />
  </svg>
);

/** الموردون — تبادل وتوريد بضائع */
export const SuppliersTruckIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    {/* Delivery truck body */}
    <rect x="8" y="20" width="32" height="22" rx="4" fill="#6366F1" />
    <path d="M40 27h10.5l5.5 7v8H40V27z" fill="#4338CA" />
    <rect x="43" y="30" width="8.5" height="6" rx="1.2" fill="#E0E7FF" />
    {/* Package inside */}
    <rect x="14" y="25" width="12" height="10" rx="2" fill="#FBBF24" />
    <path d="M19 25v4" stroke="#B45309" strokeWidth="2" />
    {/* Chassis & wheels */}
    <rect x="7" y="42" width="49" height="4" rx="2" fill="#312E81" />
    <circle cx="18" cy="48" r="5.5" fill="#1E293B" stroke="#E2E8F0" strokeWidth="2" />
    <circle cx="47" cy="48" r="5.5" fill="#1E293B" stroke="#E2E8F0" strokeWidth="2" />
  </svg>
);

/** إضافة مورد جديد */
export const SupplierAddIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="10" y="16" width="34" height="30" rx="5" fill="#7C3AED" />
    <path d="M10 25h34" stroke="#DDD6FE" strokeWidth="2.5" />
    <rect x="17" y="30" width="12" height="10" rx="2" fill="#FDE68A" />
    <circle cx="47" cy="44" r="11" fill="#10B981" stroke="#FFFFFF" strokeWidth="2.5" />
    <path d="M47 39v10M42 44h10" stroke="#FFFFFF" strokeWidth="2.8" strokeLinecap="round" />
  </svg>
);

/** فاتورة بيع — مستند فاتورة مع شارة مالية */
export const SalesInvoiceIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="13" y="8" width="34" height="48" rx="4" fill="#EFF6FF" stroke="#1D4ED8" strokeWidth="2.5" />
    <rect x="19" y="15" width="22" height="5" rx="2" fill="#2563EB" />
    <path d="M19 26h22M19 33h16M19 40h18M19 47h12" stroke="#93C5FD" strokeWidth="3" strokeLinecap="round" />
    <circle cx="46" cy="44" r="10.5" fill="#10B981" stroke="#FFFFFF" strokeWidth="2.5" />
    <path d="M46 39v10M43 42.2c0-1.1 1.3-2 3-2s3 .9 3 2c0 1.3-1.4 1.7-3 2.1-1.6.4-3 .8-3 2.1 0 1.2 1.3 2.1 3 2.1s3-.9 3-2.1" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** فاتورة شراء — مستند توريد مع صندوق وعربة */
export const PurchaseInvoiceIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="17" y="8" width="34" height="44" rx="4" fill="#EEF2FF" stroke="#4338CA" strokeWidth="2.5" />
    <rect x="23" y="15" width="22" height="5" rx="2" fill="#4F46E5" />
    <path d="M23 26h20M23 33h14M23 40h17" stroke="#A5B4FC" strokeWidth="3" strokeLinecap="round" />
    <circle cx="20" cy="44" r="11" fill="#F59E0B" stroke="#FFFFFF" strokeWidth="2.5" />
    <path d="M20 38v8m0 0l-3.5-3.5M20 46l3.5-3.5" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** مرتجع بيع */
export const SalesReturnIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="13" y="9" width="34" height="45" rx="4" fill="#FFF1F2" stroke="#E11D48" strokeWidth="2.5" />
    <path d="M20 19h20M20 27h16M20 35h13" stroke="#FDA4AF" strokeWidth="3" strokeLinecap="round" />
    <circle cx="45" cy="44" r="11" fill="#E11D48" stroke="#FFFFFF" strokeWidth="2.5" />
    <path d="M40 44h9.5M40 44l4-4M40 44l4 4" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** مرتجع شراء */
export const PurchaseReturnIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="13" y="9" width="34" height="45" rx="4" fill="#FFF7ED" stroke="#EA580C" strokeWidth="2.5" />
    <path d="M20 19h20M20 27h16M20 35h13" stroke="#FDBA74" strokeWidth="3" strokeLinecap="round" />
    <circle cx="45" cy="44" r="11" fill="#EA580C" stroke="#FFFFFF" strokeWidth="2.5" />
    <path d="M50 44h-9.5M50 44l-4-4M50 44l-4 4" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** عرض سعر */
export const PriceQuoteIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="12" y="10" width="40" height="44" rx="5" fill="#F0FDF4" stroke="#0D9488" strokeWidth="2.5" />
    <rect x="18" y="16" width="28" height="8" rx="2" fill="#0F766E" />
    <circle cx="24" cy="33" r="3" fill="#14B8A6" />
    <path d="M31 33h14" stroke="#5EEAD4" strokeWidth="3" strokeLinecap="round" />
    <circle cx="24" cy="43" r="3" fill="#14B8A6" />
    <path d="M31 43h14" stroke="#5EEAD4" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

/** المخزن والأصناف — صناديق كرتون مكدسة مثل النموذج */
export const WarehouseBoxesIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    {/* Top box */}
    <rect x="22" y="10" width="20" height="16" rx="2" fill="#F59E0B" />
    <rect x="29" y="10" width="6" height="5" fill="#FEF3C7" />
    {/* Middle row */}
    <rect x="14" y="25" width="19" height="16" rx="2" fill="#FBBF24" />
    <rect x="20.5" y="25" width="6" height="5" fill="#FEF3C7" />
    <rect x="33" y="25" width="19" height="16" rx="2" fill="#D97706" />
    <rect x="39.5" y="25" width="6" height="5" fill="#FDE68A" />
    {/* Bottom row */}
    <rect x="8" y="40" width="20" height="16" rx="2" fill="#D97706" />
    <rect x="15" y="40" width="6" height="5" fill="#FDE68A" />
    <rect x="28" y="40" width="20" height="16" rx="2" fill="#F59E0B" />
    <rect x="35" y="40" width="6" height="5" fill="#FEF3C7" />
    <rect x="47" y="40" width="9" height="16" rx="2" fill="#B45309" />
  </svg>
);

/** الحسابات وكشوف الحسابات — دفتر حسابات معتمد + شارة تحقق خضراء */
export const AccountsLedgerIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <circle cx="20" cy="22" r="7.5" fill="#38BDF8" stroke="#0F172A" strokeWidth="2" />
    <path d="M9 48c0-6.5 4.8-11 11-11s11 4.5 11 11v4H9v-4z" fill="#38BDF8" stroke="#0F172A" strokeWidth="2" />
    <rect x="29" y="14" width="24" height="34" rx="3" fill="#FFFFFF" stroke="#0F172A" strokeWidth="2" />
    <path d="M34 22h14M34 28h14M34 34h10M34 40h12" stroke="#64748B" strokeWidth="2.4" strokeLinecap="round" />
    <circle cx="51" cy="15" r="7.5" fill="#22C55E" stroke="#0F172A" strokeWidth="2" />
    <path d="M47.5 15l2.3 2.5 4.5-4.5" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** الخزينة والمالية — خزنة حديدية زرقاء حديثة */
export const SafeVaultIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="10" y="14" width="44" height="36" rx="5" fill="#0284C7" />
    <rect x="14" y="18" width="36" height="28" rx="3" fill="#38BDF8" />
    <rect x="14" y="50" width="8" height="4" rx="1.5" fill="#0369A1" />
    <rect x="42" y="50" width="8" height="4" rx="1.5" fill="#0369A1" />
    {/* Dial & keypad */}
    <circle cx="25" cy="32" r="7" fill="#0F172A" />
    <circle cx="25" cy="32" r="3.5" fill="#94A3B8" />
    <rect x="35" y="23" width="11" height="17" rx="2" fill="#0F172A" />
    <circle cx="38" cy="27" r="1.2" fill="#E2E8F0" />
    <circle cx="43" cy="27" r="1.2" fill="#E2E8F0" />
    <circle cx="38" cy="31.5" r="1.2" fill="#E2E8F0" />
    <circle cx="43" cy="31.5" r="1.2" fill="#E2E8F0" />
    <circle cx="38" cy="36" r="1.2" fill="#E2E8F0" />
    <circle cx="43" cy="36" r="1.2" fill="#22C55E" />
  </svg>
);

/** التقارير والإحصائيات — أعمدة بيانية صاعدة مع سهم اتجاه */
export const ReportsChartIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="10" y="38" width="9" height="16" rx="2" fill="#93C5FD" />
    <rect x="22" y="30" width="9" height="24" rx="2" fill="#60A5FA" />
    <rect x="34" y="23" width="9" height="31" rx="2" fill="#3B82F6" />
    <rect x="46" y="16" width="9" height="38" rx="2" fill="#1D4ED8" />
    <path d="M12 27l13-8 10 4 17-12" stroke="#0F172A" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M46 10h7v7" stroke="#0F172A" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** المصروفات والنقدية — أوراق مالية خضراء */
export const ExpensesCashIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="13" y="15" width="40" height="24" rx="3.5" transform="rotate(-6 13 15)" fill="#86EFAC" />
    <rect x="11" y="22" width="42" height="26" rx="3.5" fill="#22C55E" stroke="#15803D" strokeWidth="2" />
    <circle cx="32" cy="35" r="7" fill="#166534" />
    <circle cx="17" cy="35" r="2" fill="#DCFCE7" />
    <circle cx="47" cy="35" r="2" fill="#DCFCE7" />
    <path d="M32 31v8M29.5 33.5c0-1 1.1-1.7 2.5-1.7s2.5.7 2.5 1.7-1.1 1.4-2.5 1.7c-1.4.3-2.5.7-2.5 1.8s1.1 1.7 2.5 1.7 2.5-.7 2.5-1.7" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/** الأقساط والجدولة */
export const InstallmentsIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="10" y="13" width="44" height="40" rx="5" fill="#ECFDF5" stroke="#059669" strokeWidth="2.5" />
    <path d="M10 24h44" stroke="#059669" strokeWidth="2.5" />
    <rect x="18" y="8" width="5" height="9" rx="2" fill="#047857" />
    <rect x="41" y="8" width="5" height="9" rx="2" fill="#047857" />
    <circle cx="22" cy="34" r="3" fill="#10B981" />
    <path d="M29 34h16" stroke="#6EE7B7" strokeWidth="3" strokeLinecap="round" />
    <circle cx="22" cy="43" r="3" fill="#10B981" />
    <path d="M29 43h12" stroke="#6EE7B7" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

/** الشيكات والحوالات البنكية */
export const ChequesIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="8" y="16" width="48" height="32" rx="4" fill="#F5F3FF" stroke="#6D28D9" strokeWidth="2.5" />
    <rect x="8" y="23" width="48" height="6" fill="#7C3AED" />
    <path d="M15 36h22M15 42h14" stroke="#A78BFA" strokeWidth="2.8" strokeLinecap="round" />
    <rect x="41" y="34" width="10" height="8" rx="1.5" fill="#DDD6FE" stroke="#6D28D9" strokeWidth="1.5" />
  </svg>
);

/** المندوبون والتوزيع */
export const RepsFleetIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <circle cx="37" cy="17" r="5" fill="#EF4444" />
    <rect x="10" y="24" width="17" height="14" rx="2.5" fill="#F59E0B" />
    <path d="M28 38h18l-5-13h-8l-5 13z" fill="#DC2626" />
    <circle cx="19" cy="46" r="6" fill="#1E293B" stroke="#E2E8F0" strokeWidth="2" />
    <circle cx="47" cy="46" r="6" fill="#1E293B" stroke="#E2E8F0" strokeWidth="2" />
  </svg>
);

/** الموظفون وشؤون العاملين */
export const EmployeesHrIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="14" y="14" width="36" height="42" rx="5" fill="#FFF1F2" stroke="#E11D48" strokeWidth="2.5" />
    <rect x="25" y="9" width="14" height="8" rx="2.5" fill="#BE123C" />
    <circle cx="32" cy="28" r="6" fill="#FB7185" />
    <path d="M21 46c0-5.2 4.8-9 11-9s11 3.8 11 9v2H21v-2z" fill="#E11D48" />
  </svg>
);

/** الطلبات — لوح مهام بعلامات اختيار */
export const OrdersClipboardIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="14" y="12" width="36" height="44" rx="5" fill="#F8FAFC" stroke="#1E293B" strokeWidth="2.5" />
    <rect x="24" y="8" width="16" height="7" rx="2.5" fill="#1E293B" />
    <path d="M21 25l2.5 2.5 4.5-4.5M32 26h11" stroke="#0F172A" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M21 35l2.5 2.5 4.5-4.5M32 36h11" stroke="#0F172A" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M21 45l2.5 2.5 4.5-4.5M32 46h9" stroke="#2563EB" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** تحويلات وعهدة — أسهم مزدوجة */
export const TransferArrowsIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <circle cx="32" cy="32" r="24" fill="#ECFEFF" stroke="#0891B2" strokeWidth="2.5" />
    <path d="M18 25h25m0 0l-6-6m6 6l-6 6" stroke="#0E7490" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M46 39H21m0 0l6-6m-6 6l6 6" stroke="#06B6D4" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** المزامنة والتحديث — سحابة بأسهم صعود وهبوط */
export const RefreshCloudIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <path d="M20 44h25c5.5 0 9.5-3.8 9.5-9 0-4.7-3.4-8.4-8-9C45 18.5 38.6 13.5 30.8 13.5c-8.3 0-15 6.3-15.4 14.3-3.9 1-6.9 4.4-6.9 8.6C8.5 41.2 13.2 44 20 44z" fill="#E0F2FE" stroke="#0284C7" strokeWidth="2.2" />
    <path d="M26 49V31m0 0l-4.5 4.5M26 31l4.5 4.5" stroke="#0284C7" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M38 26v18m0 0l-4.5-4.5M38 44l4.5-4.5" stroke="#EF4444" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** الإعدادات — ترسان متداخلان بأسهم زرقاء مثل النموذج */
export const SettingsTwinGearsIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    {/* Upper light blue gear */}
    <path d="M24 11l2.2 3.2 3.8-.5 1.1 3.7 3.5 1.5-.8 3.8 2.2 3.1-2.2 3.1.8 3.8-3.5 1.5-1.1 3.7-3.8-.5L24 40l-2.2-3.2-3.8.5-1.1-3.7-3.5-1.5.8-3.8L12 25.2l2.2-3.1-.8-3.8 3.5-1.5 1.1-3.7 3.8.5L24 11z" fill="#3B82F6" />
    <circle cx="24" cy="25.5" r="5" fill="#FFFFFF" />
    {/* Lower indigo gear */}
    <path d="M41 28l1.9 2.7 3.3-.4 1 3.2 3 1.3-.7 3.3 1.9 2.6-1.9 2.7.7 3.3-3 1.3-1 3.2-3.3-.4L41 53l-1.9-2.7-3.3.4-1-3.2-3-1.3.7-3.3-1.9-2.7 1.9-2.6-.7-3.3 3-1.3 1-3.2 3.3.4L41 28z" fill="#4F46E5" />
    <circle cx="41" cy="40.5" r="4.3" fill="#FFFFFF" />
    {/* Curved sync arrows */}
    <path d="M40 15c5 1 8.5 4.5 9.5 9.5M49.5 24.5l-3.5-2M49.5 24.5l1.5-3.5" stroke="#4338CA" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M24 49c-5-1-8.5-4.5-9.5-9.5M14.5 39.5l3.5 2M14.5 39.5L13 43" stroke="#4338CA" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** تسجيل الخروج — باب مفتوح مع سهم خروج واضح مثل النموذج */
export const LogoutDoorIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="20" y="10" width="24" height="44" rx="2.5" fill="#0F172A" />
    <path d="M13 14l17-4v44l-17-4V14z" fill="#FB7185" />
    <circle cx="26" cy="32" r="2" fill="#FFF1F2" />
    <path d="M32 32h20m0 0l-6-6m6 6l-6 6" stroke="#E11D48" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** إدارة المستخدمين والصلاحيات */
export const UsersShieldIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <circle cx="24" cy="21" r="7.5" fill="#334155" />
    <path d="M11 49c0-7 5.5-12 13-12s13 5 13 12v3H11v-3z" fill="#475569" />
    <path d="M44 26l11 4.5v9.5c0 7-4.6 12.5-11 15-6.4-2.5-11-8-11-15v-9.5L44 26z" fill="#2563EB" stroke="#FFFFFF" strokeWidth="2" />
    <path d="M39.5 40.5l3 3 6-6" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** المحفظة / الخزائن والبنوك */
export const WalletCashIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <path d="M18 16l24-5 3 10H18V16z" fill="#22C55E" />
    <rect x="10" y="19" width="42" height="33" rx="6" fill="#92400E" />
    <rect x="37" y="29" width="18" height="12" rx="4" fill="#F59E0B" />
    <circle cx="44" cy="35" r="2.5" fill="#78350F" />
  </svg>
);

/** النسخ الاحتياطي */
export const BackupCloudIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <ellipse cx="32" cy="18" rx="18" ry="6" fill="#3B82F6" />
    <path d="M14 18v12c0 3.3 8 6 18 6s18-2.7 18-6V18" fill="#60A5FA" />
    <path d="M14 30v14c0 3.3 8 6 18 6s18-2.7 18-6V30" fill="#2563EB" />
    <ellipse cx="32" cy="18" rx="18" ry="6" fill="#93C5FD" />
  </svg>
);

/** لوحة التحكم الرئيسية */
export const DashboardHomeIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="10" y="10" width="20" height="20" rx="5" fill="#2563EB" />
    <rect x="34" y="10" width="20" height="13" rx="4" fill="#38BDF8" />
    <rect x="34" y="27" width="20" height="27" rx="5" fill="#10B981" />
    <rect x="10" y="34" width="20" height="20" rx="5" fill="#F59E0B" />
    <circle cx="20" cy="20" r="4" fill="#DBEAFE" />
    <path d="M39 45l4-5 3.5 3 4.5-6" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** عرض فواتير البيع — شاشة قائمة فواتير مع شارة المبيعات */
export const SalesInvoicesListIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="10" y="10" width="44" height="44" rx="6" fill="#E0F2FE" stroke="#0284C7" strokeWidth="2.4" />
    <rect x="15" y="15" width="34" height="10" rx="3" fill="#FFFFFF" stroke="#BAE6FD" strokeWidth="1.5" />
    <circle cx="21" cy="20" r="2.8" fill="#10B981" />
    <path d="M27 20h17" stroke="#0284C7" strokeWidth="2.6" strokeLinecap="round" />
    <rect x="15" y="29" width="34" height="9" rx="2.5" fill="#FFFFFF" />
    <path d="M20 33.5h15M39 33.5h5" stroke="#64748B" strokeWidth="2.5" strokeLinecap="round" />
    <rect x="15" y="41" width="34" height="9" rx="2.5" fill="#FFFFFF" />
    <path d="M20 45.5h19M42 45.5h3" stroke="#64748B" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

/** عرض فواتير الشراء — لوح تدقيق واستلام فواتير التوريد */
export const PurchaseInvoicesListIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="13" y="11" width="38" height="44" rx="5" fill="#EEF2FF" stroke="#312E81" strokeWidth="2.4" />
    <rect x="23" y="7" width="18" height="7" rx="3" fill="#4338CA" />
    <path d="M20 24l2.5 2.5 4.5-4.5M31 24.5h13" stroke="#10B981" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20 35l2.5 2.5 4.5-4.5M31 35.5h13" stroke="#4F46E5" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20 46l2.5 2.5 4.5-4.5M31 46.5h10" stroke="#F59E0B" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** إضافة صنف جديد */
export const ProductAddIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <path d="M12 22l20-10 20 10v20L32 52 12 42V22z" fill="#FDE68A" stroke="#D97706" strokeWidth="2.4" strokeLinejoin="round" />
    <path d="M12 22l20 10 20-10M32 32v20" stroke="#B45309" strokeWidth="2.2" />
    <circle cx="47" cy="44" r="11" fill="#10B981" stroke="#FFFFFF" strokeWidth="2.5" />
    <path d="M47 39v10M42 44h10" stroke="#FFFFFF" strokeWidth="2.8" strokeLinecap="round" />
  </svg>
);

/** التحويلات المخزنية */
export const StockTransfersIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="8" y="13" width="20" height="18" rx="3" fill="#F59E0B" />
    <rect x="36" y="33" width="20" height="18" rx="3" fill="#0284C7" />
    <path d="M31 20h14m0 0l-5-5m5 5l-5 5" stroke="#0F766E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M33 44H19m0 0l5-5m-5 5l5 5" stroke="#2563EB" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** حركات المخزن */
export const StockMovementsIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="11" y="11" width="42" height="42" rx="7" fill="#F0FDF4" stroke="#16A34A" strokeWidth="2.4" />
    <path d="M18 39l8-9 7 6 13-15" stroke="#15803D" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M39 21h7v7" stroke="#15803D" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="18" cy="39" r="3" fill="#22C55E" />
    <circle cx="26" cy="30" r="3" fill="#22C55E" />
    <circle cx="33" cy="36" r="3" fill="#22C55E" />
  </svg>
);

/** جرد المخزون */
export const StockCountIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="12" y="14" width="28" height="36" rx="4" fill="#FEF3C7" stroke="#B45309" strokeWidth="2.4" />
    <path d="M18 24h14M18 32h11M18 40h9" stroke="#D97706" strokeWidth="2.6" strokeLinecap="round" />
    <circle cx="43" cy="38" r="11" fill="#FFFFFF" stroke="#1D4ED8" strokeWidth="2.8" />
    <path d="M51 46l6 6" stroke="#1D4ED8" strokeWidth="3.5" strokeLinecap="round" />
    <path d="M39 38l2.5 2.5 5-5" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** حركة النقدية والتحويل بين الخزائن */
export const CashTransferIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <circle cx="22" cy="24" r="11" fill="#10B981" />
    <path d="M22 18v12M19 21.5c0-1 1.3-1.8 3-1.8s3 .8 3 1.8-1.3 1.5-3 1.8-3 .8-3 1.9 1.3 1.8 3 1.8 3-.8 3-1.8" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
    <circle cx="42" cy="40" r="11" fill="#0284C7" />
    <path d="M42 34v12M39 37.5c0-1 1.3-1.8 3-1.8s3 .8 3 1.8-1.3 1.5-3 1.8-3 .8-3 1.9 1.3 1.8 3 1.8 3-.8 3-1.8" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
    <path d="M35 20h11m0 0l-4-4m4 4l-4 4" stroke="#047857" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M29 44H18m0 0l4-4m-4 4l4 4" stroke="#0369A1" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** سجل المراجعة والتدقيق */
export const AuditShieldIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <path d="M32 8l20 7.5v15c0 12.5-8.4 22.3-20 26.5-11.6-4.2-20-14-20-26.5v-15L32 8z" fill="#EEF2FF" stroke="#4338CA" strokeWidth="2.6" />
    <circle cx="31" cy="31" r="9" fill="#FFFFFF" stroke="#4F46E5" strokeWidth="2.5" />
    <path d="M37.5 37.5l6.5 6.5" stroke="#4338CA" strokeWidth="3.2" strokeLinecap="round" />
    <path d="M27.5 31l2.3 2.3 4.7-4.7" stroke="#10B981" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** الفروع والمحافظات */
export const BranchMapIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <path d="M10 18l14-5 16 6 14-5v32l-14 5-16-6-14 5V18z" fill="#E0F2FE" stroke="#0284C7" strokeWidth="2.4" strokeLinejoin="round" />
    <path d="M24 13v32M40 19v32" stroke="#7DD3FC" strokeWidth="2" />
    <path d="M32 14c-5 0-9 3.9-9 8.8 0 6.7 9 15.7 9 15.7s9-9 9-15.7c0-4.9-4-8.8-9-8.8z" fill="#EF4444" stroke="#FFFFFF" strokeWidth="2" />
    <circle cx="32" cy="22.5" r="3" fill="#FFFFFF" />
  </svg>
);

/** طباعة الباركود */
export const BarcodeScanIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="8" y="14" width="48" height="36" rx="5" fill="#F8FAFC" stroke="#334155" strokeWidth="2.4" />
    <path d="M15 22v20M20 22v20M26 22v20M31 22v20M38 22v20M43 22v20M49 22v20" stroke="#0F172A" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M11 32h42" stroke="#EF4444" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

/** الطابعات والأجهزة */
export const PrintersIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="18" y="10" width="28" height="14" rx="2" fill="#E2E8F0" stroke="#475569" strokeWidth="2.2" />
    <rect x="9" y="22" width="46" height="22" rx="5" fill="#3B82F6" />
    <circle cx="46" cy="29" r="2.5" fill="#22C55E" />
    <rect x="18" y="36" width="28" height="18" rx="2" fill="#FFFFFF" stroke="#1E293B" strokeWidth="2.2" />
    <path d="M23 42h18M23 47h12" stroke="#64748B" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

/** التصنيفات والوسوم */
export const CategoriesTagIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <path d="M12 14h20l20 20-16 16L16 30V14z" fill="#FEF3C7" stroke="#D97706" strokeWidth="2.4" strokeLinejoin="round" />
    <circle cx="22" cy="24" r="3.5" fill="#D97706" />
    <path d="M29 31l9 9M25 36l8 8" stroke="#F59E0B" strokeWidth="2.6" strokeLinecap="round" />
  </svg>
);

/** المحلات والعميل */
export const StoreShopIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <path d="M10 24l5-12h34l5 12H10z" fill="#EF4444" />
    <path d="M21 12l-2 12h10l1-12h-9zM43 12l2 12H35l-1-12h9z" fill="#FEE2E2" />
    <rect x="13" y="24" width="38" height="28" rx="3" fill="#FFFBEB" stroke="#D97706" strokeWidth="2.4" />
    <rect x="26" y="34" width="12" height="18" rx="2" fill="#2563EB" />
    <rect x="16" y="30" width="7" height="8" rx="1.5" fill="#BAE6FD" stroke="#0284C7" strokeWidth="1.5" />
    <rect x="41" y="30" width="7" height="8" rx="1.5" fill="#BAE6FD" stroke="#0284C7" strokeWidth="1.5" />
  </svg>
);

/** إعدادات الحساب وكلمة المرور والصلاحيات */
export const StaffAccountSettingsIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <circle cx="28" cy="21" r="8.5" fill="#0284C7" />
    <path d="M12 49c0-7.5 6.8-13 16-13s16 5.5 16 13v3H12v-3z" fill="#0369A1" />
    <circle cx="46" cy="42" r="11" fill="#F59E0B" stroke="#FFFFFF" strokeWidth="2.5" />
    <circle cx="46" cy="39" r="3" fill="#FFFFFF" />
    <path d="M46 42v6M43.5 46h4" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

/** الفواتير المحذوفة والملغاة */
export const DeletedInvoicesIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="13" y="9" width="32" height="44" rx="4" fill="#FEF2F2" stroke="#DC2626" strokeWidth="2.4" />
    <path d="M20 19h18M20 27h14M20 35h10" stroke="#FCA5A5" strokeWidth="3" strokeLinecap="round" />
    <circle cx="45" cy="44" r="11" fill="#DC2626" stroke="#FFFFFF" strokeWidth="2.5" />
    <path d="M41 40l8 8M49 40l-8 8" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" />
  </svg>
);

/** قوالب الصلاحيات التلقائية */
export const PermissionPresetsIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <path d="M32 8l19 7v14c0 12-8 21.5-19 25.5C21 50.5 13 41 13 29V15l19-7z" fill="#E0E7FF" stroke="#4338CA" strokeWidth="2.4" />
    <rect x="23" y="23" width="18" height="4" rx="2" fill="#4F46E5" />
    <circle cx="26" cy="25" r="3.5" fill="#10B981" stroke="#FFFFFF" strokeWidth="1.5" />
    <rect x="23" y="33" width="18" height="4" rx="2" fill="#4F46E5" />
    <circle cx="38" cy="35" r="3.5" fill="#F59E0B" stroke="#FFFFFF" strokeWidth="1.5" />
  </svg>
);

/** الحسابات المحفوظة والتبديل السريع */
export const SavedAccountsIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <circle cx="24" cy="21" r="7.5" fill="#0284C7" />
    <path d="M10 47c0-6.5 6-11.5 14-11.5S38 40.5 38 47v3H10v-3z" fill="#0369A1" />
    <circle cx="43" cy="23" r="6" fill="#38BDF8" />
    <path d="M34 45c.5-5 4.2-8.5 9-8.5s8.5 3.5 9 8.5v3H34v-3z" fill="#0EA5E9" />
    <circle cx="46" cy="45" r="10" fill="#10B981" stroke="#FFFFFF" strokeWidth="2.2" />
    <path d="M41 43h10l-3-3M51 47H41l3 3" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** بياناتي والمحل (بوابة العميل) */
export const CustomerProfileIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="11" y="13" width="42" height="38" rx="6" fill="#EFF6FF" stroke="#1D4ED8" strokeWidth="2.4" />
    <circle cx="25" cy="28" r="6.5" fill="#2563EB" />
    <path d="M15 44c0-5 4.3-8.5 10-8.5s10 3.5 10 8.5v2H15v-2z" fill="#1D4ED8" />
    <path d="M37 25h11M37 32h11M37 39h8" stroke="#60A5FA" strokeWidth="2.8" strokeLinecap="round" />
  </svg>
);

/** البضاعة التالفة والمنتهية */
export const DamagedStockIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="12" y="18" width="32" height="32" rx="4" fill="#FEF3C7" stroke="#D97706" strokeWidth="2.4" />
    <path d="M12 28h32" stroke="#F59E0B" strokeWidth="2.4" />
    <circle cx="46" cy="44" r="11" fill="#EF4444" stroke="#FFFFFF" strokeWidth="2.4" />
    <path d="M46 38v7M46 48.5h.01" stroke="#FFFFFF" strokeWidth="2.8" strokeLinecap="round" />
  </svg>
);

/** الفروع والإدارات */
export const BranchesBuildingIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="12" y="16" width="24" height="38" rx="3" fill="#2563EB" />
    <rect x="36" y="24" width="16" height="30" rx="3" fill="#0EA5E9" />
    <rect x="17" y="22" width="5" height="5" rx="1" fill="#DBEAFE" />
    <rect x="26" y="22" width="5" height="5" rx="1" fill="#DBEAFE" />
    <rect x="17" y="31" width="5" height="5" rx="1" fill="#DBEAFE" />
    <rect x="26" y="31" width="5" height="5" rx="1" fill="#DBEAFE" />
    <rect x="21" y="42" width="6" height="12" rx="1" fill="#1E3A8A" />
    <rect x="41" y="30" width="6" height="5" rx="1" fill="#E0F2FE" />
    <rect x="41" y="39" width="6" height="5" rx="1" fill="#E0F2FE" />
  </svg>
);

/** إعدادات السيرفر والمزامنة */
export const SyncSettingsIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="11" y="12" width="42" height="14" rx="4" fill="#1E293B" />
    <rect x="11" y="30" width="42" height="14" rx="4" fill="#334155" />
    <circle cx="19" cy="19" r="2.5" fill="#22C55E" />
    <circle cx="19" cy="37" r="2.5" fill="#38BDF8" />
    <path d="M27 19h18M27 37h12" stroke="#94A3B8" strokeWidth="2.6" strokeLinecap="round" />
    <circle cx="47" cy="46" r="10" fill="#2563EB" stroke="#FFFFFF" strokeWidth="2.2" />
    <path d="M43 45a4.5 4.5 0 017.8-2M51 47a4.5 4.5 0 01-7.8 2" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** الحسابات الشخصية للملاك */
export const PersonalAccountsIcon: React.FC<AppIconProps> = ({ className = 'w-10 h-10' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="12" y="12" width="40" height="40" rx="7" fill="#ECFDF5" stroke="#047857" strokeWidth="2.4" />
    <circle cx="32" cy="25" r="6.5" fill="#10B981" />
    <path d="M20 43c0-5 5.4-8.5 12-8.5s12 3.5 12 8.5v2H20v-2z" fill="#059669" />
  </svg>
);


